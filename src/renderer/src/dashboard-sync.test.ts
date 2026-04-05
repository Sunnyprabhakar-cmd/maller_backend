import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRecipientEmailSet,
  canonicalEventType,
  hasRealWebhookEvent,
  isWebhookMetricEvent,
  mergeCampaignLists,
  mergeEventsUnique,
  normalizeEmail,
  normalizeRemoteEvent,
  normalizeSocketWebhookEvent
} from './dashboard-sync'

test('normalizeEmail lowercases and trims values', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com')
})

test('canonicalEventType normalizes webhook aliases', () => {
  assert.equal(canonicalEventType('open'), 'opened')
  assert.equal(canonicalEventType('click'), 'clicked')
  assert.equal(canonicalEventType('bounce'), 'bounced')
  assert.equal(canonicalEventType('accepted'), 'accepted')
})

test('normalizeRemoteEvent and normalizeSocketWebhookEvent map event payloads', () => {
  const remote = normalizeRemoteEvent({
    id: 'evt-1',
    campaignId: 'cmp-1',
    email: 'person@example.com',
    event: 'open',
    timestamp: '2026-01-01T00:00:00.000Z'
  })
  const socket = normalizeSocketWebhookEvent({
    campaignId: 'cmp-1',
    recipientEmail: 'person@example.com',
    type: 'click',
    timestamp: '2026-01-01T00:00:00.000Z'
  })

  assert.equal(remote.type, 'opened')
  assert.equal(remote.payload._source, 'mailgun-webhook')
  assert.equal(socket.type, 'clicked')
})

test('mergeEventsUnique deduplicates by id and sorts descending by createdAt', () => {
  const merged = mergeEventsUnique(
    [
      { id: 'evt-1', campaignId: 'cmp', recipientEmail: 'a@example.com', type: 'opened', payload: {}, createdAt: '2026-01-01T00:00:00.000Z' }
    ],
    [
      { id: 'evt-1', campaignId: 'cmp', recipientEmail: 'a@example.com', type: 'opened', payload: {}, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'evt-2', campaignId: 'cmp', recipientEmail: 'b@example.com', type: 'clicked', payload: {}, createdAt: '2026-01-02T00:00:00.000Z' }
    ]
  )

  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.id, 'evt-2')
})

test('hasRealWebhookEvent ignores simulated webhook entries', () => {
  assert.equal(hasRealWebhookEvent([
    {
      id: 'evt-1',
      campaignId: 'cmp',
      recipientEmail: 'a@example.com',
      type: 'opened',
      payload: { _source: 'mailgun-webhook', _simulated: true },
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]), false)

  assert.equal(hasRealWebhookEvent([
    {
      id: 'evt-2',
      campaignId: 'cmp',
      recipientEmail: 'a@example.com',
      type: 'opened',
      payload: { _source: 'mailgun-webhook' },
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]), true)
})

test('isWebhookMetricEvent accepts expected analytics event types', () => {
  assert.equal(isWebhookMetricEvent({ type: 'delivered' }), true)
  assert.equal(isWebhookMetricEvent({ type: 'open' }), true)
  assert.equal(isWebhookMetricEvent({ type: 'complained' }), false)
})

test('mergeCampaignLists merges remote fields and creates recovered campaigns', () => {
  const local = [{
    id: 'cmp-1',
    name: 'Local',
    isNewsletter: false,
    newsletterEdition: '',
    subject: 'Local subject',
    htmlBody: '<p>Local</p>',
    textBody: 'Local',
    senderEmail: 'local@example.com',
    replyToEmail: '',
    companyName: 'Acme',
    headerCompanyName: 'Acme',
    footerCompanyName: 'Acme',
    companyAddress: '',
    companyContact: '',
    contactNumber: '',
    footerContent: '',
    cidAssets: [],
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }]

  const merged = mergeCampaignLists(local, [
    { id: 'cmp-1', name: 'Remote', subject: 'Updated subject', status: 'sent', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'recovered-1', name: 'Recovered remote', subject: 'Recovered subject', status: 'sent' }
  ])

  assert.equal(merged.length, 2)
  assert.equal(merged.find((row) => row.id === 'cmp-1')?.name, 'Remote')
  assert.equal(merged.find((row) => row.id === 'recovered-1')?.companyName, 'Mailgun')
})

test('buildRecipientEmailSet normalizes emails into a unique set', () => {
  const set = buildRecipientEmailSet([
    { email: 'USER@example.com' },
    { email: ' user@example.com ' },
    { email: 'other@example.com' }
  ])

  assert.equal(set.size, 2)
  assert.equal(set.has('user@example.com'), true)
  assert.equal(set.has('other@example.com'), true)
})
