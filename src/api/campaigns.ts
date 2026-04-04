import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { buildEmailHtml } from '../services/render.js'
import mailer from '../services/mailer.js'
import { PrismaClient } from '@prisma/client'

const router = Router()

// Middleware
router.use(authMiddleware)

// Create campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, subject, template, sourceType, imageUrl, imageCid } = req.body
    const prisma = (req as any).prisma as PrismaClient

    const campaign = await prisma.campaign.create({
      data: {
        name,
        subject,
        template,
        sourceType: sourceType || 'cid',
        imageUrl,
        imageCid
      }
    })

    res.json(campaign)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get all campaigns
router.get('/', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const campaigns = await prisma.campaign.findMany({
      include: { recipients: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json(campaigns)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get campaign by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        recipients: true,
        events: { orderBy: { timestamp: 'desc' } }
      }
    })

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    res.json(campaign)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Add recipients from CSV
router.post('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const { recipients } = req.body // Array of { email, name, data: {} }
    const prisma = (req as any).prisma as PrismaClient

    const created = await Promise.all(
      recipients.map((r: any) =>
        prisma.campaignRecipient.upsert({
          where: {
            campaignId_email: {
              campaignId: req.params.id,
              email: r.email
            }
          },
          create: {
            campaignId: req.params.id,
            email: r.email,
            name: r.name,
            data: r.data
          },
          update: {
            name: r.name,
            data: r.data
          }
        })
      )
    )

    res.json({ count: created.length })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Send test email
router.post('/:id/send-test', async (req: Request, res: Response) => {
  try {
    const { testEmail } = req.body
    const prisma = (req as any).prisma as PrismaClient
    const io = (req as any).io

    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { recipients: true }
    })

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    // Build email HTML
    const html = buildEmailHtml({
      template: campaign.template,
      data: { campaign_id: campaign.id, email: testEmail },
      imageUrl: campaign.imageUrl ?? undefined,
      imageCid: campaign.imageCid ?? undefined,
      sourceType: (campaign.sourceType === 'cid' ? 'cid' : 'url') as 'cid' | 'url',
      webhookUrl: campaign.webhookUrl ?? undefined
    })

    // Send via Mailgun
    const messageId = await mailer.sendEmail({
      to: testEmail,
      campaignId: campaign.id,
      subject: campaign.subject,
      html
    })

    // Emit to connected clients
    io.emit('email:sent', {
      campaignId: campaign.id,
      email: testEmail,
      messageId,
      timestamp: new Date()
    })

    res.json({ messageId, sent: true })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Send to all recipients
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const io = (req as any).io

    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { recipients: true }
    })

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' })
    }

    let sent = 0
    let failed = 0

    for (const recipient of campaign.recipients) {
      try {
        const html = buildEmailHtml({
          template: campaign.template,
          data: (recipient.data as any) || { campaign_id: campaign.id, email: recipient.email },
          imageUrl: campaign.imageUrl ?? undefined,
          imageCid: campaign.imageCid ?? undefined,
          sourceType: (campaign.sourceType === 'cid' ? 'cid' : 'url') as 'cid' | 'url',
          webhookUrl: campaign.webhookUrl ?? undefined
        })

        await mailer.sendEmail({
          to: recipient.email,
          recipientName: recipient.name || undefined,
          campaignId: campaign.id,
          subject: campaign.subject,
          html
        })

        sent++
        io.emit('email:sent', {
          campaignId: campaign.id,
          email: recipient.email,
          timestamp: new Date()
        })
      } catch (error) {
        failed++
        io.emit('email:failed', {
          campaignId: campaign.id,
          email: recipient.email,
          error: String(error)
        })
      }
    }

    res.json({ sent, failed, total: campaign.recipients.length })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get campaign events/webhooks
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const events = await prisma.webhookEvent.findMany({
      where: { campaignId: req.params.id },
      orderBy: { timestamp: 'desc' },
      take: 100
    })
    res.json(events)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

export default router
