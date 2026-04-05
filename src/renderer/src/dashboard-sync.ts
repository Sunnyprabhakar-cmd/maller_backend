import { apiClient } from './api-client'
import type { Campaign, CampaignEvent, Progress, Recipient } from './types'

export function normalizeEmail(input: unknown): string {
  return String(input ?? '').trim().toLowerCase()
}

export function normalizeRemoteEvent(event: any): CampaignEvent {
  const rawType = String(event?.event ?? event?.type ?? 'failed').toLowerCase()
  const normalizedType = rawType === 'open'
    ? 'opened'
    : rawType === 'click'
      ? 'clicked'
      : rawType === 'bounce'
        ? 'bounced'
        : rawType

  return {
    id: String(event?.id ?? ''),
    campaignId: String(event?.campaignId ?? ''),
    recipientEmail: String(event?.email ?? event?.recipientEmail ?? event?.recipient ?? ''),
    type: normalizedType,
    payload: {
      ...(event?.data ?? event?.payload ?? {}),
      _source: 'mailgun-webhook'
    },
    createdAt: String(event?.timestamp ?? event?.createdAt ?? new Date().toISOString())
  }
}

export function normalizeSocketWebhookEvent(event: any): CampaignEvent {
  return {
    id: '',
    campaignId: String(event?.campaignId ?? ''),
    recipientEmail: String(event?.email ?? event?.recipientEmail ?? event?.recipient ?? ''),
    type: canonicalEventType(event?.event ?? event?.type ?? 'failed'),
    payload: {
      _source: 'mailgun-webhook'
    },
    createdAt: String(event?.timestamp ?? new Date().toISOString())
  }
}

export function mergeEventsUnique(localEvents: CampaignEvent[], remoteEvents: CampaignEvent[]): CampaignEvent[] {
  const merged = new Map<string, CampaignEvent>()
  const keyFor = (event: CampaignEvent) => {
    const idPart = String(event?.id ?? '')
    if (idPart) {
      return `id:${idPart}`
    }
    return [
      String(event?.campaignId ?? ''),
      String(event?.recipientEmail ?? ''),
      String(event?.type ?? ''),
      String(event?.createdAt ?? '')
    ].join('|')
  }

  for (const event of [...localEvents, ...remoteEvents]) {
    merged.set(keyFor(event), event)
  }

  return [...merged.values()].sort((left, right) => {
    const a = new Date(String(left?.createdAt ?? 0)).getTime()
    const b = new Date(String(right?.createdAt ?? 0)).getTime()
    return b - a
  })
}

export function canonicalEventType(value: unknown): string {
  const raw = String(value ?? '').toLowerCase()
  if (raw === 'open') return 'opened'
  if (raw === 'click') return 'clicked'
  if (raw === 'bounce') return 'bounced'
  return raw
}

export function isWebhookMetricEvent(event: Pick<CampaignEvent, 'type'> | any): boolean {
  const type = canonicalEventType(event?.type ?? event?.event)
  return type === 'delivered' || type === 'opened' || type === 'clicked' || type === 'bounced' || type === 'failed' || type === 'accepted'
}

export function hasRealWebhookEvent(rows: CampaignEvent[]): boolean {
  return rows.some((event) => event?.payload?._source === 'mailgun-webhook' && event?.payload?._simulated !== true)
}

export function mergeCampaignLists(localCampaigns: Campaign[], remoteCampaigns: any[]): Campaign[] {
  const merged = new Map<string, Campaign>()
  for (const campaign of localCampaigns) {
    merged.set(campaign.id, campaign)
  }
  for (const campaign of remoteCampaigns) {
    const existing = merged.get(String(campaign?.id ?? ''))
    if (existing) {
      merged.set(existing.id, {
        ...existing,
        name: campaign?.name ?? existing.name,
        subject: campaign?.subject ?? existing.subject,
        status: campaign?.status ?? existing.status,
        updatedAt: campaign?.updatedAt ? String(campaign.updatedAt) : existing.updatedAt,
        createdAt: campaign?.createdAt ? String(campaign.createdAt) : existing.createdAt
      } as Campaign)
    } else if (campaign?.id) {
      merged.set(String(campaign.id), {
        id: String(campaign.id),
        name: String(campaign.name ?? 'Recovered campaign'),
        isNewsletter: false,
        newsletterEdition: '',
        subject: String(campaign.subject ?? ''),
        htmlBody: '<p>Recovered campaign.</p>',
        textBody: 'Recovered campaign.',
        senderEmail: '',
        replyToEmail: '',
        companyName: 'Mailgun',
        headerCompanyName: 'Mailgun',
        footerCompanyName: 'Mailgun',
        companyAddress: '',
        companyContact: '',
        contactNumber: '',
        footerContent: '',
        cidAssets: [],
        status: String(campaign.status ?? 'sent'),
        createdAt: campaign.createdAt ? String(campaign.createdAt) : new Date().toISOString(),
        updatedAt: campaign.updatedAt ? String(campaign.updatedAt) : new Date().toISOString()
      } as Campaign)
    }
  }
  return [...merged.values()]
}

export async function fetchRecoveredHostedEventsForRecipients(recipientEmails: Set<string>): Promise<CampaignEvent[]> {
  if (recipientEmails.size === 0) {
    return []
  }

  try {
    const campaigns = await apiClient.getCampaigns()
    const recoveredCampaignIds = (Array.isArray(campaigns) ? campaigns : [])
      .map((entry) => String(entry?.id ?? ''))
      .filter((id) => id.startsWith('recovered-'))

    if (recoveredCampaignIds.length === 0) {
      return []
    }

    const rows = await Promise.all(recoveredCampaignIds.map(async (id) => {
      try {
        const events = await apiClient.getCampaignEvents(id)
        return Array.isArray(events) ? events.map(normalizeRemoteEvent) : []
      } catch {
        return []
      }
    }))

    return rows
      .flat()
      .filter((event) => recipientEmails.has(normalizeEmail(event?.recipientEmail)))
  } catch {
    return []
  }
}

export function buildRecipientEmailSet(recipients: Recipient[]): Set<string> {
  return new Set(
    recipients
      .map((entry) => normalizeEmail(entry?.email))
      .filter(Boolean)
  )
}

export async function fetchRemoteCampaignEvents(remoteCampaignList: Array<Partial<Campaign>>): Promise<CampaignEvent[]> {
  const remoteEventRows = await Promise.all(remoteCampaignList.map(async (entry) => {
    const campaignId = String(entry?.id ?? '')
    if (!campaignId) {
      return []
    }
    try {
      const events = await apiClient.getCampaignEvents(campaignId)
      return Array.isArray(events) ? events.map(normalizeRemoteEvent) : []
    } catch {
      return []
    }
  }))
  return remoteEventRows.flat()
}

export async function fetchCampaignProgressMap(campaigns: Campaign[]): Promise<Record<string, Progress>> {
  const progressRows = await Promise.all(campaigns.map(async (entry) => {
    const pg = await window.maigun.getCampaignProgress(entry.id)
    return [entry.id, pg] as const
  }))
  return Object.fromEntries(progressRows)
}
