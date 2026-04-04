import { randomUUID } from 'node:crypto'
import type { Campaign, DeliveryEvent } from '../types'
import type { StorageService } from './storage'
import { sendWithMailgun } from './mailer'

export class QueueService {
  private running = false
  private timer: NodeJS.Timeout | undefined
  private tokenBucket = {
    tokens: 1,
    capacity: 1,
    refillPerMs: 1 / 60000,
    updatedAt: Date.now()
  }

  constructor(private readonly storage: StorageService) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.processNext(), 1000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async enqueueCampaign(campaign: Campaign): Promise<void> {
    // Reset campaign event timeline for a new send cycle.
    this.storage.clearEvents(campaign.id)
    const recipients = this.storage.listRecipients(campaign.id)
    for (const recipient of recipients) {
      if (this.storage.isSuppressed(recipient.email)) {
        this.storage.updateRecipient(recipient.id, { status: 'suppressed', attempts: 0, lastError: undefined })
        this.storage.addEvent(this.eventFor(campaign.id, recipient.email, 'unsubscribed', { reason: 'suppressed' }))
      } else {
        this.storage.updateRecipient(recipient.id, { status: 'queued', attempts: 0, lastError: undefined })
      }
    }
    this.storage.saveCampaign({ ...campaign, status: 'queued' })
    await this.processNext()
  }

  async resumeCampaign(campaign: Campaign): Promise<void> {
    this.storage.saveCampaign({ ...campaign, status: 'queued' })
    await this.processNext()
  }

  pauseCampaign(campaign: Campaign): void {
    this.storage.saveCampaign({ ...campaign, status: 'paused' })
  }

  getCampaignProgress(campaignId: string): {
    total: number
    queued: number
    sent: number
    failed: number
    suppressed: number
    inProgress: number
    percent: number
  } {
    const recipients = this.storage.listRecipients(campaignId)
    const total = recipients.length
    const queued = recipients.filter((entry) => entry.status === 'queued').length
    const sent = recipients.filter((entry) => entry.status === 'sent').length
    const failed = recipients.filter((entry) => entry.status === 'failed').length
    const suppressed = recipients.filter((entry) => entry.status === 'suppressed').length
    const inProgress = Math.max(0, total - queued - sent - failed - suppressed)
    const percent = total === 0 ? 0 : Math.round(((sent + failed + suppressed) / total) * 100)
    return { total, queued, sent, failed, suppressed, inProgress, percent }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private configureTokenBucket(throttlePerMinute: number): void {
    const ratePerMinute = Math.max(1, Number.isFinite(throttlePerMinute) ? Math.floor(throttlePerMinute) : 60)
    const capacity = Math.max(1, Math.min(20, Math.ceil(ratePerMinute / 6)))
    this.tokenBucket.capacity = capacity
    this.tokenBucket.refillPerMs = ratePerMinute / 60000
    this.tokenBucket.tokens = Math.min(this.tokenBucket.tokens, capacity)
    this.tokenBucket.updatedAt = Date.now()
  }

  private refillTokens(now: number): void {
    const elapsed = Math.max(0, now - this.tokenBucket.updatedAt)
    if (elapsed <= 0) return
    const refill = elapsed * this.tokenBucket.refillPerMs
    this.tokenBucket.tokens = Math.min(this.tokenBucket.capacity, this.tokenBucket.tokens + refill)
    this.tokenBucket.updatedAt = now
  }

  private async waitForSendSlot(throttlePerMinute: number): Promise<void> {
    this.configureTokenBucket(throttlePerMinute)
    while (true) {
      const now = Date.now()
      this.refillTokens(now)
      if (this.tokenBucket.tokens >= 1) {
        this.tokenBucket.tokens -= 1
        return
      }
      const need = 1 - this.tokenBucket.tokens
      const waitMs = Math.max(100, Math.ceil(need / this.tokenBucket.refillPerMs))
      await this.sleep(waitMs)
    }
  }

  private retryDelayMs(attempt: number, hintedRetryAfterMs?: number): number {
    if (hintedRetryAfterMs && hintedRetryAfterMs > 0) {
      return Math.min(120000, hintedRetryAfterMs)
    }
    if (attempt <= 1) return 1000
    if (attempt === 2) return 5000
    return 30000
  }

  private async processNext(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    try {
      const campaigns = this.storage
        .listCampaigns()
        .filter((campaign) => {
          if (campaign.status === 'queued' || campaign.status === 'sending') {
            return true
          }
          if (campaign.status === 'scheduled' && campaign.scheduledAt) {
            return new Date(campaign.scheduledAt).getTime() <= Date.now()
          }
          return false
        })
      const campaign = campaigns[0]
      if (!campaign) {
        return
      }

      this.storage.saveCampaign({ ...campaign, status: 'sending' })
      const settings = this.storage.getSettings()
      const batch = this.storage.listRecipients(campaign.id).filter((recipient) => recipient.status === 'queued')
      let sentCount = 0
      let failedCount = 0

      for (const recipient of batch) {
        const refreshedCampaign = this.storage.listCampaigns().find((entry) => entry.id === campaign.id)
        if (!refreshedCampaign || refreshedCampaign.status === 'paused') {
          return
        }
        const current = this.storage.listRecipients(campaign.id).find((entry) => entry.id === recipient.id)
        if (!current || current.status !== 'queued') {
          continue
        }
        if (this.storage.isSuppressed(recipient.email)) {
          this.storage.updateRecipient(recipient.id, { status: 'suppressed' })
          continue
        }

        let attempts = 0
        let lastError = ''
        while (attempts < Math.max(1, settings.retryAttempts)) {
          attempts += 1
          await this.waitForSendSlot(settings.throttlePerMinute)
          const result = await sendWithMailgun(refreshedCampaign, recipient, settings)
          if (result.ok) {
            this.storage.updateRecipient(recipient.id, { status: 'sent', attempts })
            this.storage.addEvent(this.eventFor(campaign.id, recipient.email, 'sent', { attempts }))
            sentCount += 1
            break
          }
          lastError = result.error ?? 'Unknown error'
          const shouldRetry = result.retryable !== false && attempts < settings.retryAttempts
          if (shouldRetry) {
            const waitMs = this.retryDelayMs(attempts, result.retryAfterMs)
            await this.sleep(waitMs)
            continue
          }
          this.storage.updateRecipient(recipient.id, { status: 'failed', attempts, lastError })
          this.storage.addEvent(this.eventFor(campaign.id, recipient.email, 'failed', {
            attempts,
            error: lastError,
            category: result.category,
            httpStatus: result.httpStatus,
            retryable: result.retryable
          }))
          failedCount += 1
          break
        }
      }

      this.storage.saveCampaign({ ...campaign, status: sentCount > 0 || failedCount === 0 ? 'sent' : 'failed' })
    } finally {
      this.running = false
    }
  }

  private eventFor(campaignId: string, recipientEmail: string, type: DeliveryEvent['type'], payload: Record<string, unknown>): DeliveryEvent {
    return {
      id: randomUUID(),
      campaignId,
      recipientEmail,
      type,
      payload,
      createdAt: new Date().toISOString()
    }
  }
}