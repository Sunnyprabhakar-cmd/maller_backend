import DOMPurify from 'isomorphic-dompurify'

interface BuildEmailHtmlOptions {
  template: string
  data: Record<string, any>
  imageUrl?: string
  imageCid?: string
  sourceType: 'cid' | 'url'
  logoText?: string
  webhookUrl?: string
}

const SOCIAL_ICONS: Record<string, string> = {
  facebook: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%231877F2"%3E%3Cpath d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/%3E%3C/svg%3E',
  twitter: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%231DA1F2"%3E%3Cpath d="M23.953 4.57a10 10 0 002.856-3.513 9.957 9.957 0 01-2.784.756 4.994 4.994 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/%3E%3C/svg%3E',
  linkedin: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%230A66C2"%3E%3Cpath d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/%3E%3C/svg%3E'
}

function resolveImageSrc(sourceType: string, imageUrl?: string, imageCid?: string): string {
  if (sourceType === 'cid' && imageCid) {
    return `cid:${imageCid}`
  }
  if (sourceType === 'url' && imageUrl) {
    return imageUrl
  }
  return ''
}

function normalizeLinkUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  if (url.startsWith('www.')) {
    return `https://${url}`
  }
  // Bare domain
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?(\.[a-zA-Z]{2,})+$/.test(url)) {
    return `https://${url}`
  }
  return ''
}

function interpolateTemplate(template: string, data: Record<string, any>): string {
  let html = template
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    html = html.replace(regex, String(value || ''))
  }
  return html
}

export function buildEmailHtml(options: BuildEmailHtmlOptions): string {
  const imageUrl = resolveImageSrc(options.sourceType, options.imageUrl, options.imageCid)

  // Interpolate variables
  let html = interpolateTemplate(options.template, options.data)

  // Build complete email wrapper
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
        .email-container { max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .banner { width: 100%; max-height: 300px; object-fit: cover; margin: 10px 0; border-radius: 4px; }
        .social-icons { display: flex; gap: 10px; justify-content: center; margin: 20px 0; }
        .social-icon { width: 40px; height: 40px; }
        .social-icon a { text-decoration: none; display: block; }
        .social-icon img { width: 100%; height: 100%; }
        .footer { background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; }
        a { color: #667eea; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>${options.logoText || 'Maigun Campaign'}</h1>
        </div>
        <div class="content">
          ${imageUrl ? `<img src="${imageUrl}" alt="Campaign banner" class="banner">` : ''}
          ${html}
          ${options.webhookUrl ? `<img src="${options.webhookUrl}?campaign_id={{campaign_id}}&email={{email}}" style="display:none;" alt="">` : ''}
        </div>
        <div class="footer">
          <p>© 2024. This is an automated email.</p>
        </div>
      </div>
    </body>
    </html>
  `

  return DOMPurify.sanitize(emailHtml, { ALLOWED_TAGS: ['*'], ALLOWED_ATTR: ['*'] })
}

export { resolveImageSrc, normalizeLinkUrl, interpolateTemplate }
