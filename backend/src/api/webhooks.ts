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
    message?: {
      headers?: {
        'message-id'?: string
      }
    }
  }
}

function verifyMailgunSignature(payload: any): boolean {
  const token = payload.token
  const timestamp = payload.timestamp
  const signature = payload.signature

  if (!token || !timestamp || !signature) {
    console.warn('[Webhook] Missing signature components')
    return false
  }

  const apiKey = process.env.MAILGUN_API_KEY || ''
  const data = `${timestamp}${token}`
  const computed = crypto.createHmac('sha256', apiKey).update(data).digest('hex')

  const isValid = computed === signature
  if (!isValid) {
    console.warn('[Webhook] Invalid signature')
  }
  return isValid
}

function extractCampaignId(payload: any): string | null {
  // Check nested event-data first
  const eventData = payload['event-data']
  if (eventData?.variables?.campaign_id) {
    return eventData.variables.campaign_id
  }

  // Check top-level custom variables (v:campaign_id)
  if (payload['v:campaign_id']) {
    return payload['v:campaign_id']
  }

  // Check variables object
  if (payload.variables?.campaign_id) {
    return payload.variables.campaign_id
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

    const eventData = payload['event-data']
    if (!eventData) {
      return res.status(400).json({ error: 'Invalid payload structure' })
    }

    const event = eventData.event
    const email = eventData.recipient
    const campaignId = extractCampaignId(payload)

    if (!email) {
      return res.status(400).json({ error: 'Missing recipient' })
    }

    console.log(`[Webhook] Received ${event} for ${email} (campaign: ${campaignId})`)

    // Store webhook event
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        campaignId: campaignId || 'unknown',
        email,
        event,
        data: eventData
      }
    })

    // Broadcast to connected clients via socket.io
    if (io) {
      io.emit('webhook:event', {
        campaignId: campaignId || 'unknown',
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
