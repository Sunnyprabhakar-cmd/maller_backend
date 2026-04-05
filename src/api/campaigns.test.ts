import test from 'node:test'
import assert from 'node:assert/strict'

import mailer from '../services/mailer.js'

type CampaignRecord = Record<string, any>
type RecipientRecord = Record<string, any>

function createMockPrisma() {
  const campaigns = new Map<string, CampaignRecord>()
  const recipients = new Map<string, RecipientRecord[]>()

  return {
    campaigns,
    recipients,
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
            ...create
          }
          recipients.set(campaignId, [...existingRows, next])
          return next
        }
      },
      webhookEvent: {
        async findMany() {
          return []
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
  const { prisma, campaigns, recipients } = createMockPrisma()
  campaigns.set('campaign-send-1', {
    id: 'campaign-send-1',
    name: 'Send Campaign',
    subject: 'Welcome {{name}}',
    template: '<p>Hello {{name}}</p>',
    htmlBody: '<p>Hello {{name}}, use {{offer_code}}</p>',
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
      prisma,
      io: {
        emit: (...args: any[]) => ioEvents.push(args)
      }
    }
    const res = createResponse()

    await handler(req, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.sent, 1)
    assert.equal(res.body.failed, 0)
    assert.equal(sendCalls.length, 1)
    assert.equal(sendCalls[0].from, 'sender@example.com')
    assert.equal(sendCalls[0].replyTo, 'reply@example.com')
    assert.match(sendCalls[0].html, /Newsletter Issue 9/)
    assert.match(sendCalls[0].html, /Acme Footer/)
    assert.match(sendCalls[0].text, /AB12/)
    assert.equal(ioEvents.length, 1)
    assert.equal(ioEvents[0][0], 'email:sent')
  } finally {
    mailer.sendEmail = originalSendEmail
  }
})
