import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import mailer from '../services/mailer.js'
import { campaignSendQueue } from '../services/campaign-send-queue.js'

type CampaignRecord = Record<string, any>
type RecipientRecord = Record<string, any>

function createMockPrisma() {
  const campaigns = new Map<string, CampaignRecord>()
  const recipients = new Map<string, RecipientRecord[]>()
  const webhookEvents: Array<Record<string, any>> = []

  function findRecipientLocation(recipientId: string) {
    for (const [campaignId, rows] of recipients.entries()) {
      const index = rows.findIndex((entry) => entry.id === recipientId)
      if (index >= 0) {
        return { campaignId, rows, index }
      }
    }
    return null
  }

  function matchesRecipient(entry: RecipientRecord, where: any) {
    if (!where) {
      return true
    }
    if (where.id && entry.id !== where.id) {
      return false
    }
    if (where.campaignId && entry.campaignId !== where.campaignId) {
      return false
    }
    if (where.sendStatus && entry.sendStatus !== where.sendStatus) {
      return false
    }
    return true
  }

  return {
    campaigns,
    recipients,
    webhookEvents,
    prisma: {
      campaign: {
        async create({ data }: any) {
          const record = {
            id: data.id ?? `campaign-${campaigns.size + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data
          }
          campaigns.set(record.id, record)
          return record
        },
        async update({ where, data }: any) {
          const existing = campaigns.get(where.id)
          if (!existing) {
            throw new Error('Campaign not found')
          }
          const updated = {
            ...existing,
            ...data,
            id: where.id,
            updatedAt: new Date()
          }
          campaigns.set(where.id, updated)
          return updated
        },
        async findUnique({ where, include, select }: any) {
          const campaign = campaigns.get(where.id)
          if (!campaign) {
            return null
          }
          if (select?.id) {
            return { id: campaign.id }
          }
          if (include?.recipients || include?.events) {
            return {
              ...campaign,
              recipients: recipients.get(where.id) ?? [],
              events: []
            }
          }
          return campaign
        },
        async findMany() {
          return [...campaigns.values()]
        }
      },
      campaignRecipient: {
        async upsert({ where, create, update }: any) {
          const campaignId = where.campaignId_email.campaignId
          const email = where.campaignId_email.email
          const existingRows = recipients.get(campaignId) ?? []
          const existingIndex = existingRows.findIndex((entry) => entry.email === email)

          if (existingIndex >= 0) {
            const next = {
              ...existingRows[existingIndex],
              ...update
            }
            existingRows[existingIndex] = next
            recipients.set(campaignId, existingRows)
            return next
          }

          const next = {
            id: `recipient-${existingRows.length + 1}`,
            sendStatus: 'queued',
            sendAttempts: 0,
            lastSendError: null,
            queuedAt: new Date(),
            sentAt: null,
            processedAt: null,
            mailgunMessageId: null,
            ...create
          }
          recipients.set(campaignId, [...existingRows, next])
          return next
        },
        async update({ where, data }: any) {
          const location = findRecipientLocation(where.id)
          if (!location) {
            throw new Error('Recipient not found')
          }
          const next = {
            ...location.rows[location.index],
            ...data
          }
          location.rows[location.index] = next
          recipients.set(location.campaignId, location.rows)
          return next
        },
        async updateMany({ where, data }: any) {
          let count = 0
          for (const [campaignId, rows] of recipients.entries()) {
            const nextRows = rows.map((entry) => {
              if (!matchesRecipient(entry, where)) {
                return entry
              }
              count += 1
              return { ...entry, ...data }
            })
            recipients.set(campaignId, nextRows)
          }
          return { count }
        },
        async findMany({ where, take }: any) {
          const rows = [...(recipients.get(where?.campaignId) ?? [])].filter((entry) => matchesRecipient(entry, where))
          rows.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
          return typeof take === 'number' ? rows.slice(0, take) : rows
        },
        async count({ where }: any) {
          return (recipients.get(where?.campaignId) ?? []).filter((entry) => matchesRecipient(entry, where)).length
        }
      },
      webhookEvent: {
        async create({ data }: any) {
          const record = { id: `event-${webhookEvents.length + 1}`, createdAt: new Date(), ...data }
          webhookEvents.push(record)
          return record
        },
        async findMany() {
          return webhookEvents
        },
        async deleteMany({ where }: any) {
          const before = webhookEvents.length
          const next = webhookEvents.filter((entry) => entry.campaignId !== where.campaignId)
          webhookEvents.length = 0
          webhookEvents.push(...next)
          return { count: before - next.length }
        }
      }
    }
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    }
  }
}

async function loadRouteHandler(path: string, method: 'post' | 'put') {
  process.env.API_TOKEN = 'bootstrap-token'
  const { default: campaignRoutes } = await import('./campaigns.js')
  const layer = (campaignRoutes as any).stack.find((entry: any) => entry.route?.path === path && entry.route?.methods?.[method])
  if (!layer) {
    throw new Error(`Unable to find ${method.toUpperCase()} ${path} handler`)
  }
  return layer.route.stack[layer.route.stack.length - 1].handle
}

test('POST /api/campaigns persists rich campaign fields', async () => {
  const { prisma, campaigns } = createMockPrisma()
  const handler = await loadRouteHandler('/', 'post')
  const req: any = {
    body: {
      id: 'campaign-rich-1',
      name: 'Launch',
      subject: 'Hello {{name}}',
      htmlBody: '<p>Hi {{name}}</p>',
      textBody: 'Hi {{name}}',
      senderEmail: 'team@example.com',
      replyToEmail: 'reply@example.com',
      companyName: 'Acme',
      footerContent: 'Footer text',
      facebookUrl: 'facebook.com/acme',
      socialIconSize: 36,
      isNewsletter: true,
      newsletterEdition: 'Issue 7'
    },
    prisma
  }
  const res = createResponse()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.id, 'campaign-rich-1')
  assert.equal(res.body.senderEmail, 'team@example.com')
  assert.equal(res.body.companyName, 'Acme')
  assert.equal(res.body.socialIconSize, 36)
  assert.equal(res.body.isNewsletter, true)
  assert.equal(campaigns.get('campaign-rich-1')?.footerContent, 'Footer text')
})

test('PUT /api/campaigns/:id updates stored campaign fields', async () => {
  const { prisma, campaigns } = createMockPrisma()
  campaigns.set('campaign-1', {
    id: 'campaign-1',
    name: 'Draft',
    subject: 'Initial',
    template: '<p>Old</p>',
    htmlBody: '<p>Old</p>',
    status: 'draft'
  })

  const handler = await loadRouteHandler('/:id', 'put')
  const req: any = {
    params: { id: 'campaign-1' },
    body: {
      name: 'Updated',
      subject: 'Updated subject',
      htmlBody: '<p>Updated body</p>',
      senderEmail: 'new@example.com',
      instagramUrl: 'instagram.com/acme'
    },
    prisma
  }
  const res = createResponse()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.name, 'Updated')
  assert.equal(res.body.subject, 'Updated subject')
  assert.equal(res.body.senderEmail, 'new@example.com')
  assert.equal(campaigns.get('campaign-1')?.instagramUrl, 'instagram.com/acme')
})

test('POST /api/campaigns/:id/send emits websocket events and uses rendered email data', async () => {
  const { prisma, campaigns, recipients, webhookEvents } = createMockPrisma()
  const logoPath = path.join(os.tmpdir(), `maigun-logo-${Date.now()}.png`)
  const bodyPath = path.join(os.tmpdir(), `maigun-body-${Date.now()}.png`)
  await fs.writeFile(logoPath, Buffer.from('89504e470d0a1a0a', 'hex'))
  await fs.writeFile(bodyPath, Buffer.from('89504e470d0a1a0a', 'hex'))
  campaigns.set('campaign-send-1', {
    id: 'campaign-send-1',
    name: 'Send Campaign',
    subject: 'Welcome {{name}}',
    template: '<p>Hello {{name}}</p>',
    htmlBody: '<p>Hello {{name}}, use {{offer_code}}</p><img src="cid:body-asset" alt="Body asset" />',
    textBody: 'Hello {{name}}, use {{offer_code}}',
    senderEmail: 'sender@example.com',
    replyToEmail: 'reply@example.com',
    companyName: 'Acme',
    headerCompanyName: 'Acme Header',
    footerCompanyName: 'Acme Footer',
    companyAddress: '123 Road',
    companyContact: 'support@example.com',
    contactNumber: '+1-555-1234',
    footerContent: 'Footer copy',
    facebookUrl: 'facebook.com/acme',
    whatsappUrl: 'wa.me/123',
    youtubeUrl: 'youtube.com/acme',
    socialIconSize: 32,
    isNewsletter: true,
    newsletterEdition: 'Issue 9',
    logoSourceType: 'cid',
    logoCid: 'logo-inline',
    sourceType: 'url',
    imageUrl: null,
    imageCid: null,
    webhookUrl: 'https://backend.example/api/webhooks/track/open'
  })

  recipients.set('campaign-send-1', [
    {
      id: 'recipient-1',
      campaignId: 'campaign-send-1',
      email: 'user@example.com',
      name: 'User',
      data: {
        offer_code: 'AB12',
        unsubscribe_url: 'https://example.com/unsub'
      }
    }
  ])
  webhookEvents.push({
    id: 'old-webhook-1',
    campaignId: 'campaign-send-1',
    email: 'user@example.com',
    event: 'delivered'
  })

  const sendCalls: any[] = []
  const ioEvents: any[] = []
  const originalSendEmail = mailer.sendEmail
  mailer.sendEmail = async (options: any) => {
    sendCalls.push(options)
    return 'message-1'
  }

  try {
    const handler = await loadRouteHandler('/:id/send', 'post')
    const req: any = {
      params: { id: 'campaign-send-1' },
      body: {
        override: {
          logoSourceType: 'cid',
          logoCid: 'logo-inline',
          logoPath,
          cidAssets: [
            {
              cid: 'body-asset',
              filePath: bodyPath,
              fileName: 'body.png'
            }
          ]
        }
      },
      prisma,
      io: {
        emit: (...args: any[]) => ioEvents.push(args)
      }
    }
    const res = createResponse()

    await handler(req, res)
    await campaignSendQueue.flush()

    assert.equal(res.statusCode, 202)
    assert.equal(res.body.queued, true)
    assert.equal(res.body.total, 1)
    assert.equal(sendCalls.length, 1)
    assert.equal(sendCalls[0].from, 'sender@example.com')
    assert.equal(sendCalls[0].replyTo, 'reply@example.com')
    assert.match(sendCalls[0].html, /Newsletter Issue 9/)
    assert.match(sendCalls[0].html, /Acme Footer/)
    assert.match(sendCalls[0].html, /cid:social_facebook/)
    assert.match(sendCalls[0].html, /cid:logo-inline/)
    assert.equal(Array.isArray(sendCalls[0].attachments), true)
    assert.equal(sendCalls[0].attachments.some((entry: any) => entry.cid === 'social_facebook'), true)
    assert.equal(sendCalls[0].attachments.some((entry: any) => entry.cid === 'logo-inline'), true)
    assert.equal(sendCalls[0].attachments.some((entry: any) => entry.cid === 'body-asset'), true)
    assert.match(sendCalls[0].text, /AB12/)
    assert.equal(ioEvents.filter((entry) => entry[0] === 'email:sent').length, 1)
    assert.equal(webhookEvents.filter((entry) => entry.event === 'sent').length, 1)
  } finally {
    mailer.sendEmail = originalSendEmail
    await fs.rm(logoPath, { force: true })
    await fs.rm(bodyPath, { force: true })
  }
})
