import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import { StorageService } from './services/storage'
import { parseRecipientsCsv } from './services/csv'
import { QueueService } from './services/queue'
import { startWebhookServer } from './services/webhook'
import type { AppSettings, Campaign } from './types'
import { sendWithMailgun } from './services/mailer'

const storage = new StorageService()
const queue = new QueueService(storage)
let webhookServer: { close: () => void } | undefined
let webhookPort = 3535

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, '../preload/index.js'),
    path.join(__dirname, '../preload/index.mjs')
  ]
  return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? candidates[0]
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    backgroundColor: '#f7f5ef',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  queue.start()
  webhookServer = await startWebhookServer(storage, {
    onEvent: (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('webhook:received', payload)
      }
    }
  })
  webhookPort = webhookServer.port
  createWindow()
})

app.on('window-all-closed', () => {
  queue.stop()
  webhookServer?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('app:get-state', () => storage.getState())
ipcMain.handle('webhook:port', () => webhookPort)

ipcMain.handle('campaign:create', (_event, input: Partial<Campaign>) => {
  const now = new Date().toISOString()
  const campaign: Campaign = {
    id: randomUUID(),
    name: input.name ?? 'Untitled Campaign',
    isNewsletter: input.isNewsletter ?? false,
    newsletterEdition: input.newsletterEdition ?? '',
    subject: input.subject ?? '',
    htmlBody: input.htmlBody ?? '<p>Hello {{name}}</p>',
    textBody: input.textBody ?? 'Hello {{name}}',
    senderEmail: input.senderEmail ?? '',
    replyToEmail: input.replyToEmail ?? '',
    companyName: input.companyName ?? 'Company',
    companyAddress: input.companyAddress ?? '',
    companyContact: input.companyContact ?? '',
    contactNumber: input.contactNumber ?? '',
    footerContent: input.footerContent ?? 'You received this email because you subscribed.',
    logoUrl: input.logoUrl,
    logoLinkUrl: input.logoLinkUrl,
    logoSourceType: input.logoSourceType ?? 'url',
    logoCid: input.logoCid,
    logoPath: input.logoPath,
    bannerUrl: input.bannerUrl,
    bannerLinkUrl: input.bannerLinkUrl,
    bannerSourceType: input.bannerSourceType ?? 'url',
    bannerCid: input.bannerCid,
    bannerPath: input.bannerPath,
    inlineImageUrl: input.inlineImageUrl,
    inlineImageLinkUrl: input.inlineImageLinkUrl,
    inlineImageSourceType: input.inlineImageSourceType ?? 'url',
    inlineImageCid: input.inlineImageCid,
    inlineImagePath: input.inlineImagePath,
    cidAssets: input.cidAssets ?? [],
    ctaUrl: input.ctaUrl,
    ctaImageUrl: input.ctaImageUrl,
    facebookUrl: input.facebookUrl,
    instagramUrl: input.instagramUrl,
    xUrl: input.xUrl,
    linkedinUrl: input.linkedinUrl,
    whatsappUrl: input.whatsappUrl,
    youtubeUrl: input.youtubeUrl,
    socialIconSize: input.socialIconSize === 28 || input.socialIconSize === 36 ? input.socialIconSize : 32,
    scheduledAt: input.scheduledAt,
    status: 'draft',
    createdAt: now,
    updatedAt: now
  }
  storage.saveCampaign(campaign)
  return campaign
})

ipcMain.handle('campaign:save', (_event, campaign: Campaign) => {
  return storage.saveCampaign({ ...campaign, updatedAt: new Date().toISOString() })
})

ipcMain.handle('campaign:list', () => storage.listCampaigns())

ipcMain.handle('campaign:delete', (_event, campaignId: string) => {
  storage.deleteCampaign(campaignId)
  return { ok: true }
})

ipcMain.handle('campaign:duplicate', (_event, campaignId: string) => {
  const source = storage.listCampaigns().find((entry) => entry.id === campaignId)
  if (!source) {
    throw new Error('Campaign not found')
  }
  const now = new Date().toISOString()
  const duplicate: Campaign = {
    ...source,
    id: randomUUID(),
    name: `${source.name} (Copy)`,
    status: 'draft',
    createdAt: now,
    updatedAt: now
  }
  storage.saveCampaign(duplicate)
  return duplicate
})

ipcMain.handle('csv:parse', (_event, csvText: string) => parseRecipientsCsv(csvText))

ipcMain.handle('csv:import', (_event, campaignId: string, csvText: string) => {
  const summary = parseRecipientsCsv(csvText)
  storage.saveRecipients(campaignId, summary.rows)
  return summary
})

ipcMain.handle('recipients:list', (_event, campaignId: string) => storage.listRecipients(campaignId))

ipcMain.handle('queue:send', (_event, campaignId: string, override?: Partial<Campaign>) => {
  const stored = storage.listCampaigns().find((entry) => entry.id === campaignId)
  if (!stored) {
    throw new Error('Campaign not found')
  }
  const campaign: Campaign = {
    ...stored,
    ...(override ?? {}),
    id: stored.id,
    updatedAt: new Date().toISOString()
  }
  storage.saveCampaign(campaign)
  const recipients = storage.listRecipients(campaign.id)
  if (recipients.length === 0) {
    return { queued: false, noRecipients: true }
  }
  const deliverableRecipients = recipients.filter((entry) => !storage.isSuppressed(entry.email))
  if (deliverableRecipients.length === 0) {
    return { queued: false, noDeliverableRecipients: true }
  }
  if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()) {
    storage.saveCampaign({ ...campaign, status: 'scheduled' })
    return { queued: false, scheduled: true }
  }
  void queue.enqueueCampaign(campaign)
  return { queued: true }
})

ipcMain.handle('queue:pause', (_event, campaignId: string) => {
  const campaign = storage.listCampaigns().find((entry) => entry.id === campaignId)
  if (!campaign) {
    throw new Error('Campaign not found')
  }
  queue.pauseCampaign(campaign)
  return { paused: true }
})

ipcMain.handle('queue:resume', (_event, campaignId: string) => {
  const campaign = storage.listCampaigns().find((entry) => entry.id === campaignId)
  if (!campaign) {
    throw new Error('Campaign not found')
  }
  void queue.resumeCampaign(campaign)
  return { resumed: true }
})

ipcMain.handle('queue:progress', (_event, campaignId: string) => {
  return queue.getCampaignProgress(campaignId)
})

ipcMain.handle('queue:send-test', async (_event, campaignId: string, testEmail: string, override?: Partial<Campaign>) => {
  const stored = storage.listCampaigns().find((entry) => entry.id === campaignId)
  if (!stored) {
    throw new Error('Campaign not found')
  }
  const campaign: Campaign = {
    ...stored,
    ...(override ?? {}),
    id: stored.id,
    updatedAt: new Date().toISOString()
  }
  storage.saveCampaign(campaign)
  const settings = storage.getSettings()
  const result = await sendWithMailgun(
    campaign,
    {
      email: testEmail,
      name: 'Test User',
      customFields: {
        unsubscribe_url: 'https://example.com/unsubscribe'
      }
    },
    settings
  )
  return result
})

ipcMain.handle('settings:get', () => storage.getSettings())

ipcMain.handle('settings:save', (_event, settings: AppSettings) => storage.saveSettings(settings))

ipcMain.handle('draft:get', () => storage.getCampaignDraft())

ipcMain.handle('draft:save', (_event, draft: Partial<Campaign>) => {
  return storage.saveCampaignDraft(draft)
})

ipcMain.handle('events:list', (_event, campaignId?: string) => storage.listEvents(campaignId))

ipcMain.handle('report:export-campaigns', async () => {
  const campaigns = storage.listCampaigns()
  const lines = [
    ['Campaign Name', 'Status', 'Total Recipients', 'Sent', 'Failed', 'Suppressed', 'Delivered', 'Opened', 'Clicked', 'Bounced', 'Open Rate %', 'Click Rate %', 'Bounce Rate %', 'Last Updated'].join(',')
  ]

  for (const campaign of campaigns) {
    const recipients = storage.listRecipients(campaign.id)
    const sent = recipients.filter((entry) => entry.status === 'sent').length
    const failed = recipients.filter((entry) => entry.status === 'failed').length
    const suppressed = recipients.filter((entry) => entry.status === 'suppressed').length

    const campaignEvents = storage.listEvents(campaign.id)
    const webhookEvents = campaignEvents.filter((event) => event?.payload?._source === 'mailgun-webhook')
    const realWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated !== true)

    const delivered = new Set(realWebhookEvents.filter((event) => event.type === 'delivered').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
    const opened = new Set(realWebhookEvents.filter((event) => event.type === 'opened').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
    const clicked = new Set(realWebhookEvents.filter((event) => event.type === 'clicked').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
    const bounced = new Set(realWebhookEvents.filter((event) => event.type === 'bounced').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size

    const base = Math.max(delivered, sent)
    const openRate = base ? Math.min(100, Math.floor((opened / base) * 100)) : 0
    const clickRate = base ? Math.min(100, Math.floor((clicked / base) * 100)) : 0
    const bounceRate = base ? Math.min(100, Math.floor((bounced / base) * 100)) : 0

    const row = [
      campaign.name,
      campaign.status,
      String(recipients.length),
      String(sent),
      String(failed),
      String(suppressed),
      String(delivered),
      String(opened),
      String(clicked),
      String(bounced),
      String(openRate),
      String(clickRate),
      String(bounceRate),
      campaign.updatedAt
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')

    lines.push(row)
  }

  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const save = await dialog.showSaveDialog({
    title: 'Save campaign report',
    defaultPath: `maigun-campaign-report-${stamp}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (save.canceled || !save.filePath) {
    return { ok: false, canceled: true }
  }

  fsSync.writeFileSync(save.filePath, `${lines.join('\n')}\n`, 'utf8')
  return { ok: true, filePath: save.filePath }
})

ipcMain.handle('webhook:simulate', (_event, campaignId: string, eventType = 'opened') => {
  const recipients = storage.listRecipients(campaignId)
  const recipientEmail = recipients[0]?.email ?? 'simulated@example.com'
  const normalized = String(eventType).toLowerCase()
  const supported = new Set(['delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed'])
  const type = supported.has(normalized) ? normalized : 'opened'

  const addSimulatedEvent = (eventName: string) => {
    storage.addEvent({
      id: randomUUID(),
      campaignId,
      recipientEmail: recipientEmail,
      type: eventName as never,
      payload: {
        _source: 'mailgun-webhook',
        _simulated: true
      },
      createdAt: new Date().toISOString()
    })
  }

  if (type === 'opened' || type === 'clicked') {
    addSimulatedEvent('delivered')
  }

  addSimulatedEvent(type)

  if (type === 'bounced' || type === 'complained' || type === 'unsubscribed') {
    storage.addSuppression(recipientEmail)
  }

  return { ok: true, campaignId, recipientEmail, eventType: type }
})

ipcMain.handle('suppression:add', (_event, email: string) => {
  storage.addSuppression(email)
  return { ok: true }
})

ipcMain.handle('csv:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose CSV file',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('image:pick-local', async () => {
  const pick = await dialog.showOpenDialog({
    title: 'Choose image for CID',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
  })
  if (pick.canceled || pick.filePaths.length === 0) {
    return { canceled: true }
  }

  const filePath = pick.filePaths[0]
  const fileName = path.basename(filePath)
  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
  const defaultCid = `${baseName || 'image'}-${randomUUID().slice(0, 8)}`
  return {
    canceled: false,
    filePath,
    fileName,
    cid: defaultCid
  }
})

ipcMain.handle('image:social-icons', async () => {
  const socialIcons: Record<string, string> = {}
  const iconNames = ['facebook', 'instagram', 'x', 'linkedin', 'whatsapp', 'youtube']

  for (const name of iconNames) {
    try {
      const candidates = [
        path.join(process.cwd(), 'src/shared/social-icons', `${name}.png`),
        path.join(app.getAppPath(), 'src/shared/social-icons', `${name}.png`),
        path.join(app.getAppPath(), 'dist/shared/social-icons', `${name}.png`)
      ]
      const filePath = candidates.find((candidate) => fsSync.existsSync(candidate)) ?? candidates[0]
      const data = await fs.readFile(filePath)
      socialIcons[name] = `data:image/png;base64,${data.toString('base64')}`
    } catch (error) {
      console.error(`Failed to read social icon ${name}:`, error)
    }
  }

  return socialIcons
})