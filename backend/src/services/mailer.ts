import axios from 'axios'
import FormData from 'form-data'

interface SendEmailOptions {
  to: string
  recipientName?: string
  campaignId: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Array<{ filename: string; data: string; cid: string }>
}

function coerceHtmlBody(input: string): string {
  const content = String(input ?? '').trim()
  if (!content) {
    return '<html><body><p></p></body></html>'
  }

  if (/<\/?[a-z][\s\S]*>/i.test(content)) {
    return content
  }

  const safe = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br />')

  return `<html><body><p>${safe}</p></body></html>`
}

export class MailgunService {
  private apiKey: string
  private domain: string
  private baseUrl: string

  constructor() {
    this.apiKey = process.env.MAILGUN_API_KEY || process.env.MAIL_API_KEY || ''
    this.domain = process.env.MAILGUN_DOMAIN || process.env.MAIL_DOMAIN || ''
    this.baseUrl = `https://api.mailgun.net/v3/${this.domain}`

    if (!this.apiKey || !this.domain) {
      console.warn('[Mailgun] Missing API key or domain in environment')
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<string> {
    try {
      const form = new FormData()
      const appendSharedField = (key: string, value: string) => {
        form.append(key, value)
      }

      appendSharedField('from', options.from || `noreply@${this.domain}`)
      appendSharedField('to', options.to)
      appendSharedField('subject', options.subject)
      appendSharedField('html', coerceHtmlBody(options.html))
      if (options.text) {
        appendSharedField('text', options.text)
      }
      if (options.replyTo) {
        appendSharedField('h:Reply-To', options.replyTo)
      }

      // Custom data for webhook tracking
      appendSharedField('v:campaign_id', options.campaignId)
      appendSharedField('v:recipient_name', options.recipientName || '')

      // Add attachments with CID for inline images
      if (options.attachments) {
        for (const attachment of options.attachments) {
          form.append(
            'inline',
            Buffer.from(attachment.data, 'base64'),
            {
              filename: attachment.filename,
              contentType: 'image/png'
            } as any
          )
        }
      }

      const response = await axios.post(
        `${this.baseUrl}/messages`,
        form,
        {
          auth: {
            username: 'api',
            password: this.apiKey
          },
          headers: form.getHeaders()
        }
      )

      console.log(`[Mailgun] Email sent to ${options.to} (ID: ${response.data.id})`)
      return response.data.id
    } catch (error: any) {
      console.error(`[Mailgun] Failed to send email to ${options.to}:`, error.response?.data || error.message)
      throw error
    }
  }

  async getDeliveryStatus(messageId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/events`,
        {
          params: { 'message-id': messageId },
          auth: {
            username: 'api',
            password: this.apiKey
          }
        }
      )
      return response.data
    } catch (error) {
      console.error('[Mailgun] Failed to get delivery status:', error)
      throw error
    }
  }
}

export default new MailgunService()
