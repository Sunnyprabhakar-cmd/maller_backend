import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const router = Router()

// No auth needed for webhooks (Mailgun uses signature verification instead)

interface MailgunEvent {
  timestamp?: string
  token?: string
  signature?: string
  'event-data'?: {
    event?: string
    recipient?: string
    variables?: Record<string, unknown>
    user_variables?: Record<string, unknown>
    'user-variables'?: Record<string, unknown>
    message?: {
      headers?: {
        'message-id'?: string
      }
    }
  }
}

function parseEventData(input: unknown): any {
  if (!input) return null
  if (typeof input === 'object') return input
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch {
      return null
    }
  }
  return null
}

function verifyMailgunSignature(payload: any): boolean {
  const token = payload?.token ?? payload?.signature?.token
  const timestamp = payload?.timestamp ?? payload?.signature?.timestamp
  const signature = payload?.signature?.signature ?? payload?.signature

  if (!token || !timestamp || !signature) {
    return false
  }

  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || ''
  if (!signingKey) {
    console.warn('[Webhook] MAILGUN_WEBHOOK_SIGNING_KEY is missing')
    return false
  }

  const data = `${String(timestamp)}${String(token)}`
  const computed = crypto.createHmac('sha256', signingKey).update(data).digest('hex')

  const isValid = computed === signature
  if (!isValid) {
    console.warn('[Webhook] Invalid signature')
  }
  return isValid
}

function extractCampaignId(payload: any): string | null {
  const pickCampaignId = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null
    const candidates = [
      obj.campaign_id,
      obj.campaignId,
      obj.campaignID,
      obj['v:campaign_id'],
      obj['v:campaignId'],
      obj['v:campaignID']
    ]
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return null
  }

  // Check nested event-data first
  const eventData = parseEventData(payload['event-data'])
  const fromEventUserVariables = pickCampaignId(eventData?.['user-variables'])
  if (fromEventUserVariables) return fromEventUserVariables

  const fromEventUserVariablesAlt = pickCampaignId(eventData?.user_variables)
  if (fromEventUserVariablesAlt) return fromEventUserVariablesAlt

  const fromEventVariables = pickCampaignId(eventData?.variables)
  if (fromEventVariables) return fromEventVariables

  // Check top-level custom variables (v:campaign_id)
  const fromTopLevelCustom = pickCampaignId(payload)
  if (fromTopLevelCustom) return fromTopLevelCustom

  // Check variables object
  const fromTopLevelVariables = pickCampaignId(payload.variables)
  if (fromTopLevelVariables) return fromTopLevelVariables

  // Some Mailgun payloads include custom variables in message headers as JSON
  const headers = eventData?.message?.headers
  const headerVarsRaw = headers?.['X-Mailgun-Variables'] ?? headers?.['x-mailgun-variables']
  if (typeof headerVarsRaw === 'string') {
    try {
      const headerVars = JSON.parse(headerVarsRaw)
      const fromHeaderVars = pickCampaignId(headerVars)
      if (fromHeaderVars) return fromHeaderVars
    } catch {
      // Ignore malformed JSON header
    }
  }

  // Final fallback: shallow scan common payload branches
  const fromPayloadEventData = pickCampaignId(eventData)
  if (fromPayloadEventData) return fromPayloadEventData

  return null
}

function buildPlaceholderCampaign(campaignId: string, email?: string | null) {
  const suffix = campaignId.slice(0, 8)
  const now = new Date()

  return {
    name: `Recovered campaign ${suffix}`,
    subject: `Webhook activity for ${email || 'unknown recipient'}`,
    template: '<p>Webhook activity received.</p>',
    sourceType: 'url' as const,
    imageUrl: null,
    imageCid: null,
    webhookUrl: null,
    createdAt: now,
    updatedAt: now
  }
}

function buildRecoveredCampaignId(email: string): string {
  const normalized = email.trim().toLowerCase()
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return `recovered-${digest}`
}

async function resolveCampaignId(prisma: PrismaClient, explicitCampaignId: string | null, email: string): Promise<string | null> {
  if (explicitCampaignId) {
    // Trust Mailgun-provided campaign id and let placeholder creation handle first-seen campaigns.
    return explicitCampaignId
  }

  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive'
      }
    },
    select: {
      campaignId: true
    }
  })

  if (recipient?.campaignId) {
    return recipient.campaignId
  }

  const recentEvent = await prisma.webhookEvent.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive'
      }
    },
    orderBy: {
      timestamp: 'desc'
    },
    select: {
      campaignId: true
    }
  })

  if (recentEvent?.campaignId && !String(recentEvent.campaignId).startsWith('recovered-')) {
    return recentEvent.campaignId
  }

  return null
}

// Handle Mailgun webhooks
router.post('/', async (req: Request, res: Response) => {
  try {
    const payload = req.body
    const prisma = (req as any).prisma as PrismaClient
    const io = (global as any).io

    // Verify Mailgun signature
    if (!verifyMailgunSignature(payload)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const eventData = parseEventData(payload['event-data'])
    if (!eventData) {
      return res.status(400).json({ error: 'Invalid payload structure' })
    }

    const event = eventData.event || 'unknown'
    const email = eventData.recipient
    const campaignId = extractCampaignId(payload)

    if (!email) {
      return res.status(400).json({ error: 'Missing recipient' })
    }

    console.log(`[Webhook] Received ${event} for ${email} (campaign: ${campaignId})`)

    let resolvedCampaignId = await resolveCampaignId(prisma, campaignId, email)
    if (!resolvedCampaignId) {
      resolvedCampaignId = buildRecoveredCampaignId(email)
      console.warn(`[Webhook] No campaign mapping found; using recovered id (${resolvedCampaignId})`)
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: resolvedCampaignId },
      select: { id: true }
    })

    if (!campaign) {
      console.warn(`[Webhook] Creating placeholder campaign for missing id (${resolvedCampaignId})`)
      await prisma.campaign.create({
        data: {
          id: resolvedCampaignId,
          ...buildPlaceholderCampaign(resolvedCampaignId, email)
        }
      })
    }

    // Store webhook event
    let webhookEvent
    try {
      const existingEvent = await prisma.webhookEvent.findFirst({
        where: {
          campaignId: resolvedCampaignId,
          email: {
            equals: email,
            mode: 'insensitive'
          },
          event,
          data: {
            equals: eventData
          }
        },
        select: {
          id: true
        }
      })

      if (existingEvent?.id) {
        return res.json({ success: true, duplicate: true, eventId: existingEvent.id })
      }

      webhookEvent = await prisma.webhookEvent.create({
        data: {
          campaignId: resolvedCampaignId,
          email,
          event,
          data: eventData
        }
      })
    } catch (error: any) {
      if (String(error?.message || '').includes('WebhookEvent_campaignId_fkey')) {
        console.warn(`[Webhook] Skipping persistence: FK constraint for campaign (${campaignId})`)
        return res.json({ success: true, skipped: true, reason: 'campaign_fk_violation' })
      }
      throw error
    }

    // Broadcast to connected clients via socket.io
    if (io) {
      io.emit('webhook:event', {
        campaignId: resolvedCampaignId,
        email,
        event,
        timestamp: new Date()
      })
    }

    res.json({ success: true, eventId: webhookEvent.id })
  } catch (error: any) {
    console.error('[Webhook] Error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

export default router
