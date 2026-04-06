import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEmailHtml, buildTextFallback, getSocialIconInlineAttachments } from '../services/render.js'
import type { BuildEmailHtmlOptions } from '../services/render.js'
import mailer from '../services/mailer.js'
import { PrismaClient } from '@prisma/client'
import { campaignSendQueue } from '../services/campaign-send-queue.js'

const router = Router()

function resolveOpenTrackingUrl(): string {
  const configured = String(process.env.WEBHOOK_URL || '').trim().replace(/\/+$/, '')
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
    : 'http://localhost:3000'

  if (!configured) {
    return `${renderHost}/api/webhooks/track/open`
  }

  // Backward-compatible normalization for older WEBHOOK_URL values.
  if (configured.endsWith('/track/open')) {
    return configured
  }
  if (configured.endsWith('/api/webhooks') || configured.endsWith('/webhooks')) {
    return `${configured}/track/open`
  }

  return `${configured}/track/open`
}

// Middleware
router.use(authMiddleware)

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toNullableText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text : null
}

function toNullableSourceType(value: unknown): 'cid' | 'url' | null {
  return value === 'cid' || value === 'url' ? value : null
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toSocialIconSize(value: unknown): number {
  const size = Number(value)
  return [28, 32, 36].includes(size) ? size : 32
}

function buildCampaignRecord(input: Record<string, unknown>) {
  const htmlBody = toText(input.htmlBody, toText(input.template, '<p>Hello {{name}}</p>'))
  const bannerSourceType = toNullableSourceType(input.bannerSourceType) || toNullableSourceType(input.sourceType) || 'url'
  const bannerUrl = toNullableText(input.bannerUrl) ?? toNullableText(input.imageUrl)
  const bannerCid = toNullableText(input.bannerCid) ?? toNullableText(input.imageCid)

  return {
    name: toText(input.name, 'Untitled Campaign'),
    subject: toText(input.subject, ''),
    status: toText(input.status, 'draft'),
    template: htmlBody,
    htmlBody,
    textBody: toNullableText(input.textBody),
    isNewsletter: toBoolean(input.isNewsletter, false),
    newsletterEdition: toText(input.newsletterEdition, ''),
    senderEmail: toNullableText(input.senderEmail),
    replyToEmail: toNullableText(input.replyToEmail),
    companyName: toNullableText(input.companyName),
    headerCompanyName: toNullableText(input.headerCompanyName),
    footerCompanyName: toNullableText(input.footerCompanyName),
    companyAddress: toNullableText(input.companyAddress),
    companyContact: toNullableText(input.companyContact),
    contactNumber: toNullableText(input.contactNumber),
    footerContent: toNullableText(input.footerContent),
    sourceType: bannerSourceType,
    imageUrl: bannerUrl,
    imageCid: bannerCid,
    logoSourceType: toNullableSourceType(input.logoSourceType),
    logoUrl: toNullableText(input.logoUrl),
    logoLinkUrl: toNullableText(input.logoLinkUrl),
    logoCid: toNullableText(input.logoCid),
    bannerSourceType,
    bannerUrl,
    bannerLinkUrl: toNullableText(input.bannerLinkUrl),
    bannerCid,
    inlineImageSourceType: toNullableSourceType(input.inlineImageSourceType),
    inlineImageUrl: toNullableText(input.inlineImageUrl),
    inlineImageLinkUrl: toNullableText(input.inlineImageLinkUrl),
    inlineImageCid: toNullableText(input.inlineImageCid),
    ctaUrl: toNullableText(input.ctaUrl),
    facebookUrl: toNullableText(input.facebookUrl),
    instagramUrl: toNullableText(input.instagramUrl),
    xUrl: toNullableText(input.xUrl),
    linkedinUrl: toNullableText(input.linkedinUrl),
    whatsappUrl: toNullableText(input.whatsappUrl),
    youtubeUrl: toNullableText(input.youtubeUrl),
    socialIconSize: toSocialIconSize(input.socialIconSize),
    webhookUrl: resolveOpenTrackingUrl()
  }
}

function buildCampaignCreateRecord(input: Record<string, unknown>) {
  const base = buildCampaignRecord(input) as Record<string, unknown>
  const explicitId = toNullableText(input.id)
  if (explicitId) {
    base.id = explicitId
  }
  return base
}

export function buildEmailVariables(campaign: any, recipient: { email: string; name?: string | null; data?: any }) {
  return {
    ...(recipient.data && typeof recipient.data === 'object' ? recipient.data : {}),
    name: recipient.name || '',
    email: recipient.email,
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    company_name: campaign.companyName || '',
    header_company_name: campaign.headerCompanyName || campaign.companyName || '',
    footer_company_name: campaign.footerCompanyName || campaign.companyName || '',
    company_address: campaign.companyAddress || '',
    company_contact: campaign.companyContact || '',
    contact_number: campaign.contactNumber || '',
    cta_url: campaign.ctaUrl || '',
    unsubscribe_url: recipient.data?.unsubscribe_url || '#',
    offer_code: recipient.data?.offer_code || '',
    whatsapp_url: campaign.whatsappUrl || '',
    youtube_url: campaign.youtubeUrl || ''
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function toCidAssetList(value: unknown): Array<{ cid?: string; filePath?: string; fileName?: string }> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((entry) => {
    const item = toRecord(entry)
    return {
      cid: toNullableText(item.cid) ?? undefined,
      filePath: toNullableText(item.filePath) ?? undefined,
      fileName: toNullableText(item.fileName) ?? undefined
    }
  })
}

function normalizeLocalFilePath(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }
  if (!raw.startsWith('file://')) {
    return raw
  }
  try {
    return fileURLToPath(raw)
  } catch {
    return raw
  }
}

export function mergeCampaignForSend(storedCampaign: any, overrideInput: unknown) {
  const override = toRecord(overrideInput)
  const { recipients: _ignoredRecipients, events: _ignoredEvents, ...rest } = override
  const merged = {
    ...storedCampaign,
    ...rest,
    id: storedCampaign.id,
    recipients: storedCampaign.recipients
  } as any

  if (hasOwnKey(rest, 'logoPath')) {
    merged.logoPath = normalizeLocalFilePath(rest.logoPath)
  }
  if (hasOwnKey(rest, 'bannerPath')) {
    merged.bannerPath = normalizeLocalFilePath(rest.bannerPath)
  }
  if (hasOwnKey(rest, 'inlineImagePath')) {
    merged.inlineImagePath = normalizeLocalFilePath(rest.inlineImagePath)
  }
  if (hasOwnKey(rest, 'cidAssets')) {
    merged.cidAssets = toCidAssetList(rest.cidAssets)
  }

  return merged
}

export function buildEmailHtmlOptions(campaign: any, data: Record<string, unknown>): BuildEmailHtmlOptions {
  const logoSourceType = campaign.logoSourceType === 'cid' ? 'cid' : 'url'
  const bannerSourceType = campaign.bannerSourceType === 'cid' ? 'cid' : 'url'
  const inlineImageSourceType = campaign.inlineImageSourceType === 'cid' ? 'cid' : 'url'
  return {
    template: campaign.template,
    htmlBody: campaign.htmlBody ?? campaign.template,
    textBody: campaign.textBody ?? undefined,
    data,
    sourceType: (campaign.sourceType === 'cid' ? 'cid' : 'url') as 'cid' | 'url',
    imageUrl: campaign.imageUrl ?? undefined,
    imageCid: campaign.imageCid ?? undefined,
    logoSourceType,
    logoUrl: campaign.logoUrl ?? undefined,
    logoCid: campaign.logoCid ?? undefined,
    logoLinkUrl: campaign.logoLinkUrl ?? undefined,
    bannerSourceType,
    bannerUrl: campaign.bannerUrl ?? undefined,
    bannerCid: campaign.bannerCid ?? undefined,
    bannerLinkUrl: campaign.bannerLinkUrl ?? undefined,
    inlineImageSourceType,
    inlineImageUrl: campaign.inlineImageUrl ?? undefined,
    inlineImageCid: campaign.inlineImageCid ?? undefined,
    inlineImageLinkUrl: campaign.inlineImageLinkUrl ?? undefined,
    companyName: campaign.companyName ?? undefined,
    headerCompanyName: campaign.headerCompanyName ?? undefined,
    footerCompanyName: campaign.footerCompanyName ?? undefined,
    companyAddress: campaign.companyAddress ?? undefined,
    companyContact: campaign.companyContact ?? undefined,
    contactNumber: campaign.contactNumber ?? undefined,
    footerContent: campaign.footerContent ?? undefined,
    ctaUrl: campaign.ctaUrl ?? undefined,
    facebookUrl: campaign.facebookUrl ?? undefined,
    instagramUrl: campaign.instagramUrl ?? undefined,
    xUrl: campaign.xUrl ?? undefined,
    linkedinUrl: campaign.linkedinUrl ?? undefined,
    whatsappUrl: campaign.whatsappUrl ?? undefined,
    youtubeUrl: campaign.youtubeUrl ?? undefined,
    socialIconSize: campaign.socialIconSize ?? undefined,
    isNewsletter: campaign.isNewsletter ?? false,
    newsletterEdition: campaign.newsletterEdition ?? undefined,
    webhookUrl: campaign.webhookUrl ?? undefined
  }
}

export function buildTextFallbackOptions(campaign: any, data: Record<string, unknown>) {
  return {
    template: campaign.template,
    htmlBody: campaign.htmlBody ?? campaign.template,
    textBody: campaign.textBody ?? undefined,
    data,
    companyName: campaign.companyName ?? undefined,
    headerCompanyName: campaign.headerCompanyName ?? undefined,
    footerCompanyName: campaign.footerCompanyName ?? undefined,
    companyAddress: campaign.companyAddress ?? undefined,
    companyContact: campaign.companyContact ?? undefined,
    contactNumber: campaign.contactNumber ?? undefined,
    ctaUrl: campaign.ctaUrl ?? undefined,
    whatsappUrl: campaign.whatsappUrl ?? undefined,
    youtubeUrl: campaign.youtubeUrl ?? undefined
  }
}

export async function buildInlineAttachments(campaign: any): Promise<Array<{ filename: string; data: string; cid: string }>> {
  const attachments = new Map<string, { filename: string; data: string; cid: string }>()

  const addAttachment = async (label: string, cidValue: unknown, filePathValue: unknown, fileNameValue?: unknown) => {
    const cid = String(cidValue ?? '').trim()
    const filePath = normalizeLocalFilePath(filePathValue)
    if (!cid && !filePath) {
      return
    }
    if (!cid || !filePath) {
      throw new Error(`${label} is set to CID mode but CID or local file is missing.`)
    }

    const data = await fs.readFile(filePath)
    attachments.set(cid, {
      filename: String(fileNameValue ?? path.basename(filePath) ?? cid).trim() || `${cid}.png`,
      data: data.toString('base64'),
      cid
    })
  }

  if (campaign.logoSourceType === 'cid') {
    await addAttachment('Logo', campaign.logoCid, campaign.logoPath)
  }
  if (campaign.bannerSourceType === 'cid' || campaign.sourceType === 'cid') {
    await addAttachment('Banner', campaign.bannerCid ?? campaign.imageCid, campaign.bannerPath)
  }
  if (campaign.inlineImageSourceType === 'cid') {
    await addAttachment('Inline image', campaign.inlineImageCid, campaign.inlineImagePath)
  }

  for (const asset of toCidAssetList(campaign.cidAssets)) {
    await addAttachment('Additional CID asset', asset.cid, asset.filePath, asset.fileName)
  }

  for (const attachment of getSocialIconInlineAttachments()) {
    attachments.set(attachment.cid, attachment)
  }

  return [...attachments.values()]
}

export function renderSubjectTemplate(subject: string | null | undefined, data: Record<string, unknown>): string {
  let rendered = String(subject ?? '')
  for (const [key, value] of Object.entries(data)) {
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''))
  }
  return rendered
}

// Create campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const input = (req.body ?? {}) as Record<string, unknown>
    const prisma = (req as any).prisma as PrismaClient

    const campaign = await prisma.campaign.create({
      data: buildCampaignCreateRecord(input) as any
    })

    res.json(campaign)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Update campaign
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const input = (req.body ?? {}) as Record<string, unknown>
    const prisma = (req as any).prisma as PrismaClient

    const existing = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    })

    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: buildCampaignRecord({ ...input, id: req.params.id }) as any
    })

    res.json(campaign)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get all campaigns
router.get('/', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const campaigns = await prisma.campaign.findMany({
      include: { recipients: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json(campaigns)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get campaign by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        recipients: true,
        events: { orderBy: { timestamp: 'desc' } }
      }
    })

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    res.json(campaign)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Add recipients from CSV
router.post('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const { recipients } = req.body // Array of { email, name, data: {} }
    const prisma = (req as any).prisma as PrismaClient

    const created: unknown[] = []
    const batchSize = 250
    for (let index = 0; index < recipients.length; index += batchSize) {
      const batch = recipients.slice(index, index + batchSize)
      const batchResults = await Promise.all(
        batch.map((r: any) =>
          prisma.campaignRecipient.upsert({
            where: {
              campaignId_email: {
                campaignId: req.params.id,
                email: r.email
              }
            },
            create: {
              campaignId: req.params.id,
              email: r.email,
              name: r.name,
              data: r.data,
              sendStatus: 'queued',
              sendAttempts: 0,
              lastSendError: null,
              queuedAt: new Date(),
              sentAt: null,
              processedAt: null,
              mailgunMessageId: null
            },
            update: {
              name: r.name,
              data: r.data,
              sendStatus: 'queued',
              sendAttempts: 0,
              lastSendError: null,
              queuedAt: new Date(),
              sentAt: null,
              processedAt: null,
              mailgunMessageId: null
            }
          })
        )
      )
      created.push(...batchResults)
    }

    res.json({ count: created.length })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Send test email
router.post('/:id/send-test', async (req: Request, res: Response) => {
  try {
    const { testEmail } = req.body
    const prisma = (req as any).prisma as PrismaClient
    const io = (req as any).io

    const storedCampaign: any = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { recipients: true }
    })

    if (!storedCampaign) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    const campaign = mergeCampaignForSend(storedCampaign, req.body?.override)
    console.log(`[Campaign] Hosted test send start for ${testEmail} (campaign: ${campaign.id})`)
    const data = buildEmailVariables(campaign, { email: testEmail, name: 'Test User' })

    // Build email HTML
    const html = buildEmailHtml(buildEmailHtmlOptions(campaign, data))
    const attachments = await buildInlineAttachments(campaign)

    // Send via Mailgun
    const messageId = await mailer.sendEmail({
      to: testEmail,
      campaignId: campaign.id,
      subject: renderSubjectTemplate(campaign.subject, data),
      html,
      text: buildTextFallback(buildTextFallbackOptions(campaign, data)),
      from: campaign.senderEmail || undefined,
      replyTo: campaign.replyToEmail || undefined,
      attachments
    })

    // Emit to connected clients
    io.emit('email:sent', {
      campaignId: campaign.id,
      email: testEmail,
      messageId,
      timestamp: new Date()
    })

    res.json({ messageId, sent: true })
  } catch (error: any) {
    console.error(`[Campaign] Hosted test send failed for ${req.body?.testEmail ?? 'unknown'} (campaign: ${req.params.id})`, error?.message || error)
    res.status(400).json({ error: error.message })
  }
})

// Send to all recipients
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const io = (req as any).io

    const result = await campaignSendQueue.enqueueCampaignSend(prisma, req.params.id, req.body?.override, io)
    return res.status(result.queued ? 202 : 200).json(result)
  } catch (error: any) {
    console.error(`[Campaign] Hosted bulk send route failed for campaign ${req.params.id}`, error?.message || error)
    res.status(400).json({ error: error.message })
  }
})

// Get campaign events/webhooks
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const events = await prisma.webhookEvent.findMany({
      where: { campaignId: req.params.id },
      orderBy: { timestamp: 'desc' },
      take: 100
    })
    res.json(events)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

export default router
