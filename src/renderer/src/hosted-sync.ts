import { apiClient } from './api-client'
import type { Campaign, HostedRecipient, Recipient } from './types'

type HostedResult = { ok: true } | { ok: false; error: string }

export async function syncCampaignToHosted(campaign: Partial<Campaign>): Promise<HostedResult> {
  try {
    await apiClient.updateCampaign(String(campaign.id), campaign)
    return { ok: true }
  } catch (updateError) {
    try {
      await apiClient.createCampaign(campaign)
      return { ok: true }
    } catch (createError) {
      const message = (createError as Error)?.message || (updateError as Error)?.message || 'Unknown hosted sync error'
      return { ok: false, error: message }
    }
  }
}

export async function syncRecipientsToHosted(
  campaignId: string,
  recipients: Recipient[]
): Promise<HostedResult> {
  try {
    const hostedRecipients: HostedRecipient[] = recipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name,
      data: recipient.customFields ?? {}
    }))
    await apiClient.addRecipients(campaignId, hostedRecipients)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: (error as Error)?.message || 'Unknown hosted recipient sync error'
    }
  }
}

export async function loadLocalRecipientsForHostedSync(campaignId: string): Promise<Recipient[]> {
  const rows = await window.maigun.listRecipients(campaignId)
  if (!Array.isArray(rows)) {
    return []
  }
  return rows.map((recipient) => ({
    email: String(recipient?.email ?? ''),
    name: recipient?.name ? String(recipient.name) : undefined,
    customFields: recipient?.customFields && typeof recipient.customFields === 'object'
      ? (recipient.customFields as Record<string, string>)
      : {}
  }))
}

export async function ensureHostedCampaignReady(campaign: Partial<Campaign>, includeRecipients = false): Promise<HostedResult> {
  const hostedCampaignSync = await syncCampaignToHosted(campaign)
  if (!hostedCampaignSync.ok) {
    return hostedCampaignSync
  }

  if (!includeRecipients) {
    return { ok: true }
  }

  const recipients = await loadLocalRecipientsForHostedSync(String(campaign.id))
  const hostedRecipientSync = await syncRecipientsToHosted(String(campaign.id), recipients)
  if (!hostedRecipientSync.ok) {
    return hostedRecipientSync
  }

  return { ok: true }
}
