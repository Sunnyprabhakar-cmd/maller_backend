export type EmailRecipient = {
  email: string
  name?: string
  customFields?: Record<string, string>
}

export type CampaignStatus = 'draft' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'paused' | 'failed'

export type Campaign = {
  id: string
  name: string
  isNewsletter: boolean
  newsletterEdition: string
  subject: string
  htmlBody: string
  textBody: string
  senderEmail: string
  replyToEmail: string
  companyName: string
  headerCompanyName?: string
  footerCompanyName?: string
  companyAddress: string
  companyContact: string
  contactNumber: string
  footerContent: string
  logoUrl?: string
  logoLinkUrl?: string
  logoSourceType?: 'url' | 'cid'
  logoCid?: string
  logoPath?: string
  bannerUrl?: string
  bannerLinkUrl?: string
  bannerSourceType?: 'url' | 'cid'
  bannerCid?: string
  bannerPath?: string
  inlineImageUrl?: string
  inlineImageLinkUrl?: string
  inlineImageSourceType?: 'url' | 'cid'
  inlineImageCid?: string
  inlineImagePath?: string
  cidAssets?: Array<{
    cid: string
    filePath: string
    fileName: string
  }>
  ctaUrl?: string
  ctaImageUrl?: string
  facebookUrl?: string
  instagramUrl?: string
  xUrl?: string
  linkedinUrl?: string
  whatsappUrl?: string
  youtubeUrl?: string
  socialIconSize?: 28 | 32 | 36
  scheduledAt?: string
  status: CampaignStatus
  createdAt: string
  updatedAt: string
}

export type UploadSummary = {
  validCount: number
  invalidCount: number
  duplicateCount: number
  totalCount: number
  rows: EmailRecipient[]
  invalidRows: Array<{ row: number; reason: string }>
}

export type RecipientRecord = EmailRecipient & {
  id: string
  campaignId: string
  status: 'queued' | 'sent' | 'failed' | 'suppressed'
  attempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type EventType = 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed' | 'failed' | 'sent'

export type DeliveryEvent = {
  id: string
  campaignId: string
  recipientEmail: string
  type: EventType
  payload: Record<string, unknown>
  createdAt: string
}

export type AppSettings = {
  mailgunApiKey: string
  mailgunDomain: string
  senderEmails: string[]
  recentTestEmails: string[]
  defaultReplyTo: string
  webhookSecret: string
  throttlePerMinute: number
  retryAttempts: number
  autoWatchFolder: string
  imageUploadProvider: 'none' | 'imgbb'
  imageUploadApiKey: string
  googleDriveEnabled: boolean
  googleDriveClientId: string
  googleDriveClientSecret: string
  googleDriveRefreshToken: string
  googleDriveFolderId: string
  appUsername: string
  appPassword: string
}

export type DashboardStats = {
  totalEmails: number
  sent: number
  failed: number
  suppressed: number
}