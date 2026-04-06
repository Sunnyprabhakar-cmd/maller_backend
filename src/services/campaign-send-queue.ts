import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { Server } from 'socket.io'
import IORedis from 'ioredis'
import { Job, Queue, QueueEvents, Worker, type JobsOptions } from 'bullmq'
import mailer from './mailer.js'
import { buildEmailHtml, buildTextFallback } from './render.js'
import {
  buildEmailHtmlOptions,
  buildEmailVariables,
  buildInlineAttachments,
  buildTextFallbackOptions,
  mergeCampaignForSend,
  renderSubjectTemplate
} from '../api/campaigns.js'

type QueueResult =
  | {
      queued: true
      jobId: string
      status: 'queued'
      total: number
      sent: number
      failed: number
      queuedRecipients: number
    }
  | {
      queued: false
      noRecipients: true
    }
  | {
      queued: false
      scheduled: true
    }

type CampaignSendJob = {
  id: string
  campaignId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  total: number
  sent: number
  failed: number
  createdAt: string
  updatedAt: string
  override?: Record<string, unknown>
  error?: string
}

type RecipientRow = {
  id: string
  email: string
  name?: string | null
  data?: unknown
}

type CampaignSendJobData = {
  campaignId: string
  override?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class CampaignSendQueue {
  private prisma: PrismaClient | null = null
  private ioProvider: (() => Server | undefined) | null = null
  private jobs = new Map<string, CampaignSendJob>()
  private activeCampaignJobs = new Map<string, string>()
  private timer: NodeJS.Timeout | undefined
  private processingPromise: Promise<void> | null = null
  private bullQueue: Queue<CampaignSendJobData> | null = null
  private bullWorker: Worker<CampaignSendJobData> | null = null
  private bullQueueEvents: QueueEvents | null = null
  private redisConnection: IORedis | null = null
  private bullMqEnabled = false
  private tokenBucket = {
    tokens: 0,
    capacity: 0,
    refillPerMs: 0,
    updatedAt: Date.now()
  }

  private readonly batchSize = Math.max(25, Number(process.env.MAILGUN_SEND_BATCH_SIZE ?? 250))
  private readonly throttlePerMinute = Math.max(1, Number(process.env.MAILGUN_SENDS_PER_MINUTE ?? 600))
  private readonly retryAttempts = Math.max(1, Number(process.env.MAILGUN_RETRY_ATTEMPTS ?? 3))

  private resolveRedisUrl(): string {
    return String(process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || process.env.UPSTASH_REDIS_URL || '').trim()
  }

  private canUseBullMq(): boolean {
    return Boolean(this.resolveRedisUrl())
  }

  bindPrisma(prisma: PrismaClient): void {
    this.prisma = prisma
  }

  bindIoProvider(provider: () => Server | undefined): void {
    this.ioProvider = provider
  }

  private initializeBullMq(): void {
    if (this.bullMqEnabled || this.bullQueue || this.bullWorker) {
      return
    }

    const redisUrl = this.resolveRedisUrl()
    if (!redisUrl) {
      return
    }

    try {
      this.redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      })
      this.bullQueue = new Queue<CampaignSendJobData>('campaign-send', {
        connection: this.redisConnection
      })
      this.bullQueueEvents = new QueueEvents('campaign-send', {
        connection: this.redisConnection
      })
      this.bullWorker = new Worker<CampaignSendJobData>(
        'campaign-send',
        async (job: Job<CampaignSendJobData>) => {
          const prisma = this.prisma
          if (!prisma) {
            throw new Error('Prisma client unavailable')
          }

          const record = this.jobs.get(job.id) ?? {
            id: job.id,
            campaignId: job.data.campaignId,
            status: 'queued',
            total: 0,
            sent: 0,
            failed: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            override: job.data.override
          }
          this.jobs.set(job.id, record)
          this.activeCampaignJobs.set(job.data.campaignId, job.id)
          record.status = 'processing'
          record.updatedAt = new Date().toISOString()
          await this.processJob(prisma, record)
        },
        {
          connection: this.redisConnection,
          concurrency: Math.max(1, Number(process.env.MAILGUN_WORKER_CONCURRENCY ?? 2))
        }
      )
      this.bullMqEnabled = true
      console.log('[Queue] BullMQ worker enabled')
    } catch (error) {
      console.warn('[Queue] Failed to initialize BullMQ, falling back to in-memory processing:', (error as Error).message)
      this.shutdownBullMq()
      this.bullMqEnabled = false
    }
  }

  private shutdownBullMq(): void {
    void this.bullWorker?.close()
    void this.bullQueueEvents?.close()
    void this.bullQueue?.close()
    void this.redisConnection?.quit()
    this.bullWorker = null
    this.bullQueue = null
    this.bullQueueEvents = null
    this.redisConnection = null
    this.bullMqEnabled = false
  }

  start(): void {
    if (this.timer || this.bullMqEnabled) {
      return
    }

    if (this.canUseBullMq()) {
      this.initializeBullMq()
      if (this.bullMqEnabled) {
        return
      }
    }

    this.timer = setInterval(() => {
      void this.processPendingJobs()
    }, 1000)
  }

  stop(): void {
    this.shutdownBullMq()
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async flush(): Promise<void> {
    while (this.processingPromise || [...this.jobs.values()].some((job) => job.status === 'queued' || job.status === 'processing')) {
      await this.processingPromise
      if (!this.processingPromise) {
        await sleep(50)
      }
    }
  }

  async enqueueCampaignSend(prisma: PrismaClient, campaignId: string, overrideInput?: unknown, io?: Server): Promise<QueueResult> {
    this.bindPrisma(prisma)
    if (io) {
      this.bindIoProvider(() => io)
    }

    const storedCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    })

    if (!storedCampaign) {
      throw new Error('Campaign not found')
    }

    const recipientCount = await prisma.campaignRecipient.count({
      where: { campaignId }
    })

    if (recipientCount === 0) {
      return { queued: false, noRecipients: true }
    }

    const campaign = mergeCampaignForSend(storedCampaign, overrideInput)

    if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'scheduled', updatedAt: new Date() }
      })
      return { queued: false, scheduled: true }
    }

    const activeJobId = this.activeCampaignJobs.get(campaignId)
    if (activeJobId) {
      const activeJob = this.jobs.get(activeJobId)
      if (activeJob) {
        return {
          queued: true,
          jobId: activeJob.id,
          status: 'queued',
          total: activeJob.total,
          sent: activeJob.sent,
          failed: activeJob.failed,
          queuedRecipients: Math.max(0, activeJob.total - activeJob.sent - activeJob.failed)
        }
      }
    }

    const now = new Date()
    await prisma.campaignRecipient.updateMany({
      where: { campaignId },
      data: {
        sendStatus: 'queued',
        sendAttempts: 0,
        lastSendError: null,
        queuedAt: now,
        sentAt: null,
        processedAt: null,
        mailgunMessageId: null
      }
    })

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'queued', updatedAt: now }
    })

    const job: CampaignSendJob = {
      id: randomUUID(),
      campaignId,
      status: 'queued',
      total: recipientCount,
      sent: 0,
      failed: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      override: overrideInput && typeof overrideInput === 'object' && !Array.isArray(overrideInput)
        ? asRecord(overrideInput)
        : undefined
    }

    this.jobs.set(job.id, job)
    this.activeCampaignJobs.set(campaignId, job.id)

    if (this.bullMqEnabled && this.bullQueue) {
      const jobOptions: JobsOptions = {
        jobId: job.id,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true
      }
      try {
        await this.bullQueue.add('send-campaign', {
          campaignId,
          override: job.override
        }, jobOptions)
      } catch (error) {
        console.warn('[Queue] BullMQ enqueue failed, falling back to in-memory processing:', (error as Error).message)
        this.bullMqEnabled = false
        this.shutdownBullMq()
        void this.processPendingJobs()
      }
    } else {
      void this.processPendingJobs()
    }

    return {
      queued: true,
      jobId: job.id,
      status: 'queued',
      total: job.total,
      sent: 0,
      failed: 0,
      queuedRecipients: recipientCount
    }
  }

  getCampaignProgress(prisma: PrismaClient, campaignId: string) {
    return this.computeProgress(prisma, campaignId)
  }

  private configureTokenBucket(): void {
    if (this.tokenBucket.capacity !== this.throttlePerMinute) {
      this.tokenBucket.capacity = this.throttlePerMinute
      this.tokenBucket.refillPerMs = this.throttlePerMinute / 60000
      this.tokenBucket.tokens = this.tokenBucket.capacity
      this.tokenBucket.updatedAt = Date.now()
    }
  }

  private refillTokens(now: number): void {
    const elapsed = Math.max(0, now - this.tokenBucket.updatedAt)
    if (elapsed <= 0) {
      return
    }
    const refill = elapsed * this.tokenBucket.refillPerMs
    this.tokenBucket.tokens = Math.min(this.tokenBucket.capacity, this.tokenBucket.tokens + refill)
    this.tokenBucket.updatedAt = now
  }

  private async waitForSendSlot(): Promise<void> {
    this.configureTokenBucket()
    while (true) {
      const now = Date.now()
      this.refillTokens(now)
      if (this.tokenBucket.tokens >= 1) {
        this.tokenBucket.tokens -= 1
        return
      }

      const need = 1 - this.tokenBucket.tokens
      const waitMs = Math.max(100, Math.ceil(need / this.tokenBucket.refillPerMs))
      await sleep(waitMs)
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

  private async processPendingJobs(): Promise<void> {
    if (this.bullMqEnabled) {
      return
    }

    if (this.processingPromise) {
      return this.processingPromise
    }

    this.processingPromise = (async () => {
      const prisma = this.prisma
      if (!prisma) {
        return
      }

      try {
        while (true) {
          const nextJob = [...this.jobs.values()].find((job) => job.status === 'queued')
          if (!nextJob) {
            break
          }

          nextJob.status = 'processing'
          nextJob.updatedAt = new Date().toISOString()
          try {
            await this.processJob(prisma, nextJob)
          } catch (error) {
            nextJob.status = 'failed'
            nextJob.error = String((error as Error)?.message ?? error ?? 'Unknown error')
            nextJob.updatedAt = new Date().toISOString()
            this.activeCampaignJobs.delete(nextJob.campaignId)
            await prisma.campaign.update({
              where: { id: nextJob.campaignId },
              data: { status: 'failed', updatedAt: new Date() }
            })
          }
        }
      } finally {
        this.processingPromise = null
      }
    })()

    return this.processingPromise
  }

  private async processJob(prisma: PrismaClient, job: CampaignSendJob): Promise<void> {
    const storedCampaign = await prisma.campaign.findUnique({
      where: { id: job.campaignId }
    })

    if (!storedCampaign) {
      job.status = 'failed'
      job.error = 'Campaign not found'
      job.updatedAt = new Date().toISOString()
      this.activeCampaignJobs.delete(job.campaignId)
      return
    }

    const campaign = mergeCampaignForSend(storedCampaign, job.override)
    const attachments = await buildInlineAttachments(campaign)

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'sending', updatedAt: new Date() }
    })

    let batchCount = 0
    while (true) {
      const recipients = await prisma.campaignRecipient.findMany({
        where: {
          campaignId: campaign.id,
          sendStatus: 'queued'
        },
        orderBy: { queuedAt: 'asc' },
        take: this.batchSize
      }) as RecipientRow[]

      if (recipients.length === 0) {
        break
      }

      for (const recipient of recipients) {
        await this.processRecipient(prisma, campaign, recipient, attachments, job)
      }

      batchCount += recipients.length
      await this.emitProgress(prisma, campaign.id)
      await sleep(0)
    }

    const progress = await this.computeProgress(prisma, campaign.id)
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: progress.failed > 0 && progress.sent === 0 ? 'failed' : 'sent',
        updatedAt: new Date()
      }
    })

    job.sent = progress.sent
    job.failed = progress.failed
    job.status = 'completed'
    job.updatedAt = new Date().toISOString()
    this.activeCampaignJobs.delete(job.campaignId)
    await this.emitProgress(prisma, campaign.id)

    console.log(`[Campaign] Background send completed for ${campaign.id}: processed=${batchCount}, sent=${progress.sent}, failed=${progress.failed}`)
  }

  private async processRecipient(
    prisma: PrismaClient,
    campaign: any,
    recipient: RecipientRow,
    attachments: Array<{ filename: string; data: string; cid: string }>,
    job: CampaignSendJob
  ): Promise<void> {
    let attempts = 0
    let lastError = ''

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        sendStatus: 'sending',
        sendAttempts: { increment: 1 },
        processedAt: new Date()
      }
    })

    while (attempts < this.retryAttempts) {
      attempts += 1
      try {
        await this.waitForSendSlot()

        const data = buildEmailVariables(campaign, recipient)
        const html = buildEmailHtml(buildEmailHtmlOptions(campaign, data))
        const text = buildTextFallback(buildTextFallbackOptions(campaign, data))
        const messageId = await mailer.sendEmail({
          to: recipient.email,
          recipientName: recipient.name || undefined,
          campaignId: campaign.id,
          subject: renderSubjectTemplate(campaign.subject, data),
          html,
          text,
          from: campaign.senderEmail || undefined,
          replyTo: campaign.replyToEmail || undefined,
          attachments
        })

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'sent',
            sendAttempts: attempts,
            lastSendError: null,
            sentAt: new Date(),
            processedAt: new Date(),
            mailgunMessageId: messageId
          }
        })

        await prisma.webhookEvent.create({
          data: {
            campaignId: campaign.id,
            email: recipient.email,
            event: 'sent',
            data: {
              _source: 'send-worker',
              messageId,
              attempts
            }
          }
        })

        job.sent += 1
        this.emitSocket('email:sent', {
          campaignId: campaign.id,
          email: recipient.email,
          messageId,
          timestamp: new Date()
        })
        return
      } catch (error) {
        lastError = String((error as Error)?.message ?? error ?? 'Unknown error')
        const retryable = attempts < this.retryAttempts
        if (retryable) {
          await sleep(this.retryDelayMs(attempts))
          continue
        }

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'failed',
            sendAttempts: attempts,
            lastSendError: lastError,
            processedAt: new Date()
          }
        })

        await prisma.webhookEvent.create({
          data: {
            campaignId: campaign.id,
            email: recipient.email,
            event: 'failed',
            data: {
              _source: 'send-worker',
              error: lastError,
              attempts
            }
          }
        })

        job.failed += 1
        this.emitSocket('email:failed', {
          campaignId: campaign.id,
          email: recipient.email,
          error: lastError,
          timestamp: new Date()
        })
        return
      }
    }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        sendStatus: 'failed',
        sendAttempts: attempts,
        lastSendError: lastError,
        processedAt: new Date()
      }
    })
  }

  private async computeProgress(prisma: PrismaClient, campaignId: string) {
    const [total, queued, sending, sent, failed, suppressed] = await Promise.all([
      prisma.campaignRecipient.count({ where: { campaignId } }),
      prisma.campaignRecipient.count({ where: { campaignId, sendStatus: 'queued' } }),
      prisma.campaignRecipient.count({ where: { campaignId, sendStatus: 'sending' } }),
      prisma.campaignRecipient.count({ where: { campaignId, sendStatus: 'sent' } }),
      prisma.campaignRecipient.count({ where: { campaignId, sendStatus: 'failed' } }),
      prisma.campaignRecipient.count({ where: { campaignId, sendStatus: 'suppressed' } })
    ])

    const inProgress = Math.max(0, sending)
    const percent = total === 0 ? 0 : Math.round(((sent + failed + suppressed) / total) * 100)

    return { total, queued, sent, failed, suppressed, inProgress, percent }
  }

  private emitSocket(eventName: 'email:sent' | 'email:failed', payload: Record<string, unknown>): void {
    const io = this.ioProvider?.()
    io?.emit(eventName, payload)
  }

  private async emitProgress(prisma: PrismaClient, campaignId: string): Promise<void> {
    const progress = await this.computeProgress(prisma, campaignId)
    const io = this.ioProvider?.()
    io?.emit('campaign:progress', {
      campaignId,
      progress,
      timestamp: new Date().toISOString()
    })
  }
}

export const campaignSendQueue = new CampaignSendQueue()