import type { AppSettings, Campaign, EmailRecipient } from '../types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildEmailHtml, buildTextFallback, renderCampaignSubject, getSocialIconCidAssets } from './render'

type SendResult = {
  ok: boolean
  status: 'sent' | 'failed' | 'suppressed'
  error?: string
  httpStatus?: number
  category?: 'bad_request' | 'auth' | 'rate_limited' | 'server' | 'network' | 'unknown'
  retryable?: boolean
  retryAfterMs?: number
}

type InlineAsset = {
  cid: string
  filePath: string
  fileName: string
  mimeType: string
}

function inferMimeType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'image/jpeg'
}

function collectInlineAssets(campaign: Campaign): { assets: InlineAsset[]; error?: string } {
  const candidates = [
    { type: campaign.logoSourceType, cid: campaign.logoCid, path: campaign.logoPath, label: 'Logo' },
    { type: campaign.bannerSourceType, cid: campaign.bannerCid, path: campaign.bannerPath, label: 'Banner' },
    { type: campaign.inlineImageSourceType, cid: campaign.inlineImageCid, path: campaign.inlineImagePath, label: 'Inline image' }
  ]
  const assets: InlineAsset[] = []
  for (const candidate of candidates) {
    if (candidate.type !== 'cid') {
      continue
    }
    const cid = candidate.cid?.trim()
    const filePath = candidate.path?.trim()
    if (!cid && !filePath) {
      continue
    }
    if (!cid || !filePath) {
      return { assets: [], error: `${candidate.label} is set to CID mode but CID or local file is missing.` }
    }
    assets.push({ cid, filePath, fileName: path.basename(filePath), mimeType: inferMimeType(filePath) })
  }

  for (const asset of campaign.cidAssets ?? []) {
    const cid = asset.cid?.trim()
    const filePath = asset.filePath?.trim()
    if (!cid && !filePath) {
      continue
    }
    if (!cid || !filePath) {
      return { assets: [], error: 'One of the additional CID assets is missing CID or local file.' }
    }
    assets.push({ cid, filePath, fileName: path.basename(filePath), mimeType: inferMimeType(filePath) })
  }

  const uniqueByCid = new Map<string, InlineAsset>()
  for (const asset of assets) {
    uniqueByCid.set(asset.cid, asset)
  }
  return { assets: [...uniqueByCid.values()] }
}

export async function sendWithMailgun(
  campaign: Campaign,
  recipient: EmailRecipient,
  settings: AppSettings
): Promise<SendResult> {
  if (!settings.mailgunApiKey || !settings.mailgunDomain) {
    return { ok: false, status: 'failed', error: 'Mailgun is not configured' }
  }

  // Include social icon CID assets in the campaign
  const socialIconAssets = getSocialIconCidAssets()
  const campaignWithSocial = {
    ...campaign,
    cidAssets: [...(campaign.cidAssets ?? []), ...socialIconAssets]
  }

  const inlineAssets = collectInlineAssets(campaignWithSocial)
  if (inlineAssets.error) {
    return { ok: false, status: 'failed', error: inlineAssets.error }
  }

  const form = new FormData()
  form.append('from', campaign.senderEmail)
  form.append('to', recipient.email)
  form.append('subject', renderCampaignSubject(campaign, recipient))
  form.append('html', buildEmailHtml(campaign, recipient))
  form.append('text', buildTextFallback(campaign, recipient))
  form.append('h:Reply-To', campaign.replyToEmail || settings.defaultReplyTo)
  form.append('v:campaignId', campaign.id)
  form.append('o:tracking', 'yes')
  form.append('o:tracking-opens', 'yes')
  form.append('o:tracking-clicks', 'yes')

  for (const asset of inlineAssets.assets) {
    try {
      const data = await fs.readFile(asset.filePath)
      const blob = new Blob([data], { type: asset.mimeType })
      // Mailgun resolves cid:<value> against the inline part filename/content-id.
      // Keep CID as the part name so body references like cid:logo-main render inline.
      form.append('inline', blob, asset.cid)
    } catch {
      return { ok: false, status: 'failed', error: `Unable to read CID file: ${asset.filePath}` }
    }
  }

  try {
    const response = await fetch(`https://api.mailgun.net/v3/${settings.mailgunDomain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${settings.mailgunApiKey}`).toString('base64')}`
      },
      body: form
    })

    if (response.ok) {
      return { ok: true, status: 'sent', httpStatus: response.status }
    }

    const bodyText = await response.text()
    const retryAfterRaw = response.headers.get('retry-after')
    const retryAfterSec = Number(retryAfterRaw ?? '')
    const retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.floor(retryAfterSec * 1000) : undefined

    if (response.status === 400) {
      return { ok: false, status: 'failed', httpStatus: 400, category: 'bad_request', retryable: false, error: bodyText || 'Bad request to Mailgun' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 'failed', httpStatus: response.status, category: 'auth', retryable: false, error: bodyText || 'Mailgun authentication failed' }
    }
    if (response.status === 429) {
      return {
        ok: false,
        status: 'failed',
        httpStatus: 429,
        category: 'rate_limited',
        retryable: true,
        retryAfterMs,
        error: bodyText || 'Mailgun rate limit reached'
      }
    }
    if (response.status >= 500) {
      return { ok: false, status: 'failed', httpStatus: response.status, category: 'server', retryable: true, error: bodyText || 'Mailgun server error' }
    }

    return { ok: false, status: 'failed', httpStatus: response.status, category: 'unknown', retryable: false, error: bodyText || 'Mailgun request failed' }
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      category: 'network',
      retryable: true,
      error: (error as Error).message || 'Network error while sending email'
    }
  }
}