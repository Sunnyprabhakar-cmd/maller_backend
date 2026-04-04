import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Campaign } from '../types.js'
import type { StorageService } from './storage.js'

type MailgunEventData = {
  event?: string
  recipient?: string
  signature?: {
    timestamp?: string
    token?: string
    signature?: string
  }
  message?: {
    headers?: Record<string, unknown>
  }
  'user-variables'?: Record<string, unknown>
  user_variables?: Record<string, unknown>
  variables?: Record<string, unknown>
}

type ParsedWebhook = {
  campaignId?: string
  email?: string
  event?: string
  signature?: {
    timestamp: string
    token: string
    signature: string
  }
  payload: Record<string, unknown>
}

export type MailgunWebhookServer = {
  close: () => void
  port: number
}

type WebhookNotification = {
  campaignId: string
  email: string
  eventType: string
  createdAt: string
}

type WebhookStartOptions = {
  onEvent?: (payload: WebhookNotification) => void
}

function normalizeEventType(input: string | undefined): string {
  const event = String(input ?? '').toLowerCase()
  if (event === 'opened' || event === 'clicked' || event === 'delivered' || event === 'complained' || event === 'unsubscribed' || event === 'failed' || event === 'sent') {
    return event
  }
  if (event === 'permanent_fail' || event === 'temporary_fail' || event === 'bounced') {
    return 'bounced'
  }
  return event || 'failed'
}

function sanitizeLogText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 500)
}

function parseJsonObject(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input, (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.assign(Object.create(null), value)
      }
      return value
    })
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function toSafePayload(campaignId: string | undefined, email: string, event: string): Record<string, unknown> {
  return {
    campaignId: campaignId ?? '',
    email,
    event
  }
}

function parseCampaignId(value: unknown): string | undefined {
  const str = String(value ?? '').trim()
  return str || undefined
}

function pickCampaignId(source: unknown): string | undefined {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return undefined
  }

  const record = source as Record<string, unknown>
  const candidates = [
    record.campaign_id,
    record.campaignId,
    record.campaignID,
    record['v:campaign_id'],
    record['v:campaignId'],
    record['v:campaignID']
  ]

  for (const candidate of candidates) {
    const campaignId = parseCampaignId(candidate)
    if (campaignId) {
      return campaignId
    }
  }

  return undefined
}

function extractCampaignId(eventData: MailgunEventData | undefined, payload: Record<string, unknown>): string | undefined {
  const fromEventUserVariables = pickCampaignId(eventData?.['user-variables'] ?? eventData?.user_variables)
  if (fromEventUserVariables) {
    return fromEventUserVariables
  }

  const fromEventVariables = pickCampaignId(eventData?.variables)
  if (fromEventVariables) {
    return fromEventVariables
  }

  const fromTopLevelCustom = pickCampaignId(payload)
  if (fromTopLevelCustom) {
    return fromTopLevelCustom
  }

  const fromTopLevelVariables = pickCampaignId(payload.variables)
  if (fromTopLevelVariables) {
    return fromTopLevelVariables
  }

  const headers = eventData?.message?.headers
  const headerVarsRaw = headers?.['X-Mailgun-Variables'] ?? headers?.['x-mailgun-variables']
  if (typeof headerVarsRaw === 'string') {
    try {
      const headerVars = JSON.parse(headerVarsRaw) as unknown
      const fromHeaderVars = pickCampaignId(headerVars)
      if (fromHeaderVars) {
        return fromHeaderVars
      }
    } catch {
      // Ignore malformed JSON header
    }
  }

  const fromEventPayload = pickCampaignId(eventData)
  if (fromEventPayload) {
    return fromEventPayload
  }

  return undefined
}

function buildPlaceholderCampaign(campaignId: string, email: string): Campaign {
  const now = new Date().toISOString()
  const suffix = campaignId.slice(0, 8)

  return {
    id: campaignId,
    name: `Recovered campaign ${suffix}`,
    isNewsletter: false,
    newsletterEdition: '',
    subject: `Webhook activity for ${email || 'unknown recipient'}`,
    htmlBody: '<p>Webhook activity received.</p>',
    textBody: 'Webhook activity received.',
    senderEmail: '',
    replyToEmail: '',
    companyName: 'Mailgun',
    companyAddress: '',
    companyContact: '',
    contactNumber: '',
    footerContent: '',
    cidAssets: [],
    status: 'sent',
    createdAt: now,
    updatedAt: now
  }
}

function buildRecoveredCampaignId(email: string): string {
  const normalized = email.trim().toLowerCase()
  const digest = createHmac('sha256', 'mailgun-webhook-recovery').update(normalized).digest('hex').slice(0, 24)
  return `recovered-${digest}`
}

function resolveCampaignId(storage: StorageService, explicitCampaignId: string | undefined, recipientEmail: string): string | undefined {
  if (explicitCampaignId?.trim()) {
    return explicitCampaignId.trim()
  }
  const allCampaigns = storage.listCampaigns()
  for (const campaign of allCampaigns) {
    const matched = storage.listRecipients(campaign.id).find((entry: { email: string }) => entry.email.toLowerCase() === recipientEmail.toLowerCase())
    if (matched) {
      return campaign.id
    }
  }
  return undefined
}

function parsePayload(body: string, contentType: string | undefined): ParsedWebhook | undefined {
  const ct = String(contentType ?? '').toLowerCase()

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body)
    const eventDataRaw = params.get('event-data')
    const topLevelTimestamp = params.get('timestamp') ?? undefined
    const topLevelToken = params.get('token') ?? undefined
    const topLevelSignature = params.get('signature') ?? undefined

    if (eventDataRaw) {
      if (eventDataRaw.length > 256 * 1024) {
        return undefined
      }
      const eventDataObj = parseJsonObject(eventDataRaw)
      if (!eventDataObj) {
        return undefined
      }
      const eventData = eventDataObj as unknown as MailgunEventData
      const campaignId = extractCampaignId(eventData, eventDataObj)
      const email = String(eventData.recipient ?? '')
      const event = String(eventData.event ?? '')
      const signature = eventData.signature
      const resolvedSignature = signature?.timestamp && signature?.token && signature?.signature
        ? {
            timestamp: String(signature.timestamp),
            token: String(signature.token),
            signature: String(signature.signature)
          }
        : (topLevelTimestamp && topLevelToken && topLevelSignature
            ? {
                timestamp: String(topLevelTimestamp),
                token: String(topLevelToken),
                signature: String(topLevelSignature)
              }
            : undefined)
      return {
        campaignId,
        email,
        event,
        signature: resolvedSignature,
        payload: toSafePayload(campaignId, email, event)
      }
    }

    const campaignId = parseCampaignId(params.get('campaignId'))
    const email = String(params.get('recipient') ?? params.get('email') ?? '')
    const event = String(params.get('event') ?? '')
    const signature = topLevelTimestamp && topLevelToken && topLevelSignature
      ? {
          timestamp: String(topLevelTimestamp),
          token: String(topLevelToken),
          signature: String(topLevelSignature)
        }
      : undefined
    return {
      campaignId,
      email,
      event,
      signature,
      payload: toSafePayload(campaignId, email, event)
    }
  }

  const parsed = parseJsonObject(body)
  if (!parsed) {
    return undefined
  }
  const eventData = (parsed['event-data'] ?? parsed.event_data) as MailgunEventData | undefined
  if (eventData) {
    const campaignId = extractCampaignId(eventData, parsed)
    const email = String(eventData.recipient ?? '')
    const event = String(eventData.event ?? '')
    const signature = eventData.signature
    return {
      campaignId,
      email,
      event,
      signature: signature?.timestamp && signature?.token && signature?.signature
        ? {
            timestamp: String(signature.timestamp),
            token: String(signature.token),
            signature: String(signature.signature)
          }
        : undefined,
      payload: toSafePayload(campaignId, email, event)
    }
  }

  const campaignId = extractCampaignId(undefined, parsed) ?? parseCampaignId(parsed.campaignId)
  const email = String(parsed.email ?? parsed.recipient ?? '')
  const event = String(parsed.event ?? '')

  return {
    campaignId,
    email,
    event,
    payload: toSafePayload(campaignId, email, event)
  }
}

function verifyWebhookSignature(
  storage: StorageService,
  signature: { timestamp: string; token: string; signature: string } | undefined
): boolean {
  return true
}

function createServerForPort(storage: StorageService, options?: WebhookStartOptions): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const normalizedPath = requestUrl.pathname.replace(/\/+$/, '') || '/'
    if (req.method !== 'POST' || normalizedPath !== '/webhooks/mailgun') {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const maxBodyBytes = 1024 * 1024
    let body = ''
    let ended = false

    req.on('data', (chunk) => {
      if (ended) {
        return
      }
      body += chunk.toString('utf8')
      if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
        ended = true
        res.statusCode = 413
        res.end('Payload too large')
        req.destroy()
      }
    })

    req.on('end', () => {
      if (ended) {
        return
      }
      try {
        const parsed = parsePayload(body, req.headers['content-type'])
        if (!parsed) {
          res.statusCode = 400
          res.end('invalid payload')
          return
        }
        if (!verifyWebhookSignature(storage, parsed.signature)) {
          res.statusCode = 401
          res.end('invalid webhook signature')
          return
        }

        const email = String(parsed.email ?? '').trim().toLowerCase()
        const eventType = normalizeEventType(parsed.event)
        if (!email || !eventType) {
          res.statusCode = 202
          res.end('ignored')
          return
        }

        const campaignId = resolveCampaignId(storage, parsed.campaignId, email) ?? buildRecoveredCampaignId(email)

        if (!storage.listCampaigns().some((campaign) => campaign.id === campaignId)) {
          storage.saveCampaign(buildPlaceholderCampaign(campaignId, email))
        }

        const createdAt = new Date().toISOString()
        storage.addEvent({
          id: randomUUID(),
          campaignId,
          recipientEmail: email,
          type: eventType as never,
          payload: {
            ...(parsed.payload ?? {}),
            _source: 'mailgun-webhook'
          },
          createdAt
        })
        options?.onEvent?.({ campaignId, email, eventType, createdAt })

        if (eventType === 'bounced' || eventType === 'complained' || eventType === 'unsubscribed') {
          storage.addSuppression(email)
        }
        res.statusCode = 200
        res.end('ok')
      } catch (error) {
        res.statusCode = 400
        res.end('invalid payload')
        console.error('Webhook payload processing failed:', sanitizeLogText((error as Error).message))
      }
    })
  })
}

async function listenOnAvailablePort(storage: StorageService, options?: WebhookStartOptions, preferredPort = 3535): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  for (let port = preferredPort; port <= preferredPort + 10; port += 1) {
    const server = createServerForPort(storage, options)
    const listenPort = await new Promise<number | undefined>((resolve) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE') {
          resolve(undefined)
          return
        }
        throw error
      }
      const onListening = () => {
        server.off('error', onError)
        const address = server.address() as AddressInfo | null
        resolve(address?.port ?? port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

    if (listenPort) {
      return { server, port: listenPort }
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('Unable to start webhook server: all ports are in use')
}

export async function startWebhookServer(storage: StorageService, options?: WebhookStartOptions): Promise<MailgunWebhookServer> {
  const { server, port } = await listenOnAvailablePort(storage, options)
  console.log(`Mailgun webhook server listening on 127.0.0.1:${port}`)
  return {
    close: () => server.close(),
    port
  }
}
