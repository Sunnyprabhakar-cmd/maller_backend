export type {
  AppSettings,
  Campaign,
  CampaignStatus,
  DeliveryEvent,
  EmailRecipient,
  EventType,
  Progress,
  UploadSummary
} from '../shared/app-types'
import type { EmailRecipient } from '../shared/app-types'

export type RecipientRecord = EmailRecipient & {
  id: string
  campaignId: string
  status: 'queued' | 'sent' | 'failed' | 'suppressed'
  attempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type DashboardStats = {
  totalEmails: number
  sent: number
  failed: number
  suppressed: number
}
