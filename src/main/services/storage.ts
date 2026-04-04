import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSettings, Campaign, DeliveryEvent, RecipientRecord } from '../types'

type StoreShape = {
  campaigns: Campaign[]
  recipients: RecipientRecord[]
  events: DeliveryEvent[]
  suppressionList: string[]
  settings: AppSettings
  campaignDraft: Partial<Campaign>
}

const defaultSettings: AppSettings = {
  mailgunApiKey: '',
  mailgunDomain: '',
  senderEmails: [],
  recentTestEmails: [],
  defaultReplyTo: '',
  webhookSecret: '',
  throttlePerMinute: 60,
  retryAttempts: 3,
  autoWatchFolder: '',
  imageUploadProvider: 'none',
  imageUploadApiKey: '',
  googleDriveEnabled: false,
  googleDriveClientId: '',
  googleDriveClientSecret: '',
  googleDriveRefreshToken: '',
  googleDriveFolderId: '',
  appUsername: '',
  appPassword: ''
}

const defaultCampaignDraft: Partial<Campaign> = {
  name: 'Spring Launch',
  isNewsletter: false,
  newsletterEdition: '',
  subject: 'A fresh update for {{name}}',
  htmlBody: '<h1>Hi {{name}},</h1><p>Your offer code is <strong>{{offer_code}}</strong>.</p><p><a href="{{cta_url}}">Open offer</a></p>',
  textBody: 'Hi {{name}}, your offer code is {{offer_code}}.',
  senderEmail: 'sales@domain.com',
  replyToEmail: 'support@domain.com',
  companyName: 'Acme Studio',
  headerCompanyName: 'Acme Studio',
  footerCompanyName: 'Acme Studio',
  companyAddress: '123 Market Street, San Francisco, CA',
  companyContact: 'support@acmestudio.com',
  contactNumber: '+1 (555) 123-4567',
  footerContent: 'You are receiving this email because you opted in.',
  logoSourceType: 'url',
  logoLinkUrl: '',
  bannerSourceType: 'url',
  bannerLinkUrl: '',
  inlineImageSourceType: 'url',
  inlineImageLinkUrl: '',
  cidAssets: [],
  ctaUrl: 'https://example.com',
  facebookUrl: '',
  instagramUrl: '',
  xUrl: '',
  linkedinUrl: '',
  whatsappUrl: '',
  youtubeUrl: ''
}

function defaultStore(): StoreShape {
  return {
    campaigns: [],
    recipients: [],
    events: [],
    suppressionList: [],
    settings: defaultSettings,
    campaignDraft: defaultCampaignDraft
  }
}

export class StorageService {
  private readonly filePath: string
  private data: StoreShape

  constructor() {
    const dir = app.getPath('userData')
    this.filePath = path.join(dir, 'maigun-store.json')
    this.data = this.load()
  }

  private load(): StoreShape {
    try {
      if (!fs.existsSync(this.filePath)) {
        return defaultStore()
      }
      const content = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(content) as Partial<StoreShape>
      return {
        ...defaultStore(),
        ...parsed,
        settings: { ...defaultSettings, ...parsed.settings },
        campaignDraft: { ...defaultCampaignDraft, ...parsed.campaignDraft }
      }
    } catch {
      return defaultStore()
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  getState(): StoreShape {
    return structuredClone(this.data)
  }

  saveCampaign(campaign: Campaign): Campaign {
    const index = this.data.campaigns.findIndex((entry) => entry.id === campaign.id)
    if (index >= 0) {
      this.data.campaigns[index] = campaign
    } else {
      this.data.campaigns.unshift(campaign)
    }
    this.persist()
    return campaign
  }

  deleteCampaign(campaignId: string): void {
    this.data.campaigns = this.data.campaigns.filter((entry) => entry.id !== campaignId)
    this.data.recipients = this.data.recipients.filter((entry) => entry.campaignId !== campaignId)
    this.data.events = this.data.events.filter((entry) => entry.campaignId !== campaignId)
    this.persist()
  }

  saveRecipients(campaignId: string, recipients: Array<Omit<RecipientRecord, 'id' | 'campaignId' | 'createdAt' | 'updatedAt' | 'attempts' | 'status'>>): RecipientRecord[] {
    const now = new Date().toISOString()
    const existingRecipients = this.listRecipients(campaignId)
    const existingByEmail = new Map(existingRecipients.map((recipient) => [recipient.email.toLowerCase(), recipient]))
    const records = recipients.map((recipient) => {
      const normalizedEmail = recipient.email.trim().toLowerCase()
      const existing = existingByEmail.get(normalizedEmail)
      if (existing) {
        return {
          ...existing,
          email: normalizedEmail,
          name: recipient.name,
          customFields: recipient.customFields,
          updatedAt: now
        }
      }
      return {
        ...recipient,
        id: randomUUID(),
        campaignId,
        attempts: 0,
        status: 'queued' as const,
        createdAt: now,
        updatedAt: now
      }
    })
    this.data.recipients = this.data.recipients.filter((recipient) => recipient.campaignId !== campaignId).concat(records)
    this.persist()
    return records
  }

  updateRecipient(recipientId: string, patch: Partial<RecipientRecord>): RecipientRecord | undefined {
    const recipient = this.data.recipients.find((entry) => entry.id === recipientId)
    if (!recipient) {
      return undefined
    }
    Object.assign(recipient, patch, { updatedAt: new Date().toISOString() })
    this.persist()
    return recipient
  }

  listRecipients(campaignId?: string): RecipientRecord[] {
    return this.data.recipients.filter((recipient) => !campaignId || recipient.campaignId === campaignId)
  }

  addEvent(event: DeliveryEvent): void {
    this.data.events.unshift(event)
    this.persist()
  }

  listEvents(campaignId?: string): DeliveryEvent[] {
    return this.data.events.filter((event) => !campaignId || event.campaignId === campaignId)
  }

  clearEvents(campaignId?: string): void {
    if (!campaignId) {
      this.data.events = []
    } else {
      this.data.events = this.data.events.filter((event) => event.campaignId !== campaignId)
    }
    this.persist()
  }

  isSuppressed(email: string): boolean {
    const normalized = email.trim().toLowerCase()
    return this.data.suppressionList.includes(normalized)
  }

  addSuppression(email: string): void {
    const normalized = email.trim().toLowerCase()
    if (!this.data.suppressionList.includes(normalized)) {
      this.data.suppressionList.push(normalized)
      this.persist()
    }
  }

  getSettings(): AppSettings {
    return { ...this.data.settings }
  }

  saveSettings(settings: AppSettings): AppSettings {
    this.data.settings = { ...settings }
    this.persist()
    return this.getSettings()
  }

  getCampaignDraft(): Partial<Campaign> {
    return { ...this.data.campaignDraft }
  }

  saveCampaignDraft(draft: Partial<Campaign>): Partial<Campaign> {
    this.data.campaignDraft = {
      ...this.data.campaignDraft,
      ...draft
    }
    this.persist()
    return this.getCampaignDraft()
  }

  listCampaigns(): Campaign[] {
    return [...this.data.campaigns]
  }
}