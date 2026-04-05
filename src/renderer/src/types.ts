export type {
  AppSettings as Settings,
  Campaign,
  CidAsset,
  DeliveryEvent as CampaignEvent,
  EmailRecipient as Recipient,
  Progress
} from '../../shared/app-types'
import type { EmailRecipient, UploadSummary as SharedUploadSummary } from '../../shared/app-types'

export type UploadSummary = Pick<SharedUploadSummary, 'validCount' | 'invalidCount' | 'duplicateCount'>

export type HostedRecipient = {
  email: string
  name?: string
  data: Record<string, string>
}

export type SocialIconUrls = Record<string, string>

export type LocalImagePickResult = {
  canceled?: boolean
  filePath?: string
  fileName?: string
  cid?: string
}

export type LocalSendResult = {
  ok?: boolean
  error?: string
  sent?: number
  total?: number
  failed?: number
  noRecipients?: boolean
  noDeliverableRecipients?: boolean
  scheduled?: boolean
}

export type HostedSendResult = {
  sent?: boolean
  total?: number
  failed?: number
}

export type SocketWebhookPayload = {
  campaignId?: string
  email?: string
  recipientEmail?: string
  recipient?: string
  event?: string
  type?: string
  timestamp?: string
}
