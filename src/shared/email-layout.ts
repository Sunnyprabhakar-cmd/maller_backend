export type WrappedEmailOptions = {
  subject: string
  bodyHtml: string
  newsletterBadgeHtml?: string
  logoHtml?: string
  bannerHtml?: string
  inlineImageHtml?: string
  trackingPixelHtml?: string
  footerContent: string
  footerCompanyName?: string
  companyAddress?: string
  companyContact?: string
  contactNumberHtml?: string
  socialRowHtml?: string
  unsubscribeUrl: string
}

export type TemplateCampaignContext = {
  name?: string
  companyName?: string
  headerCompanyName?: string
  footerCompanyName?: string
  companyAddress?: string
  companyContact?: string
  contactNumber?: string
  ctaUrl?: string
  whatsappUrl?: string
  youtubeUrl?: string
}

export type TemplateRecipientContext = {
  name?: string
  email: string
  customFields?: Record<string, unknown>
}

export function normalizeLinkUrl(value: string | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(candidate)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return ''
    }
    if (!parsed.hostname) {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

export function compactFragment(html: string): string {
  return html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function minifyEmailHtml(html: string): string {
  return html
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n+/g, '')
    .trim()
}

export function bodyContainsCidImage(bodyHtml: string, cid: string | undefined): boolean {
  const cleanCid = String(cid ?? '').trim()
  if (!cleanCid) {
    return false
  }
  const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, 'i').test(bodyHtml)
}

export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  let html = template
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g')
    html = html.replace(regex, String(value ?? ''))
  }
  return html
}

export function buildTemplateVariables(
  campaign: TemplateCampaignContext,
  recipient: TemplateRecipientContext,
  extraVariables: Record<string, unknown> = {}
): Record<string, unknown> {
  const customFields = recipient.customFields ?? {}
  return {
    name: recipient.name ?? '',
    email: recipient.email,
    company_name: campaign.companyName ?? '',
    header_company_name: campaign.headerCompanyName ?? campaign.companyName ?? '',
    footer_company_name: campaign.footerCompanyName ?? campaign.companyName ?? '',
    cta_url: campaign.ctaUrl ?? '',
    company_address: campaign.companyAddress ?? '',
    company_contact: campaign.companyContact ?? '',
    contact_number: campaign.contactNumber ?? '',
    whatsapp_url: campaign.whatsappUrl ?? '',
    youtube_url: campaign.youtubeUrl ?? '',
    offer_code: customFields.offer_code ?? '',
    unsubscribe_url: customFields.unsubscribe_url ?? '#',
    ...customFields,
    ...extraVariables
  }
}

export function buildInterpolatedTextFallback(
  template: string,
  data: Record<string, unknown>,
  htmlFallbackSource?: string
): string {
  const fallback = template || String(htmlFallbackSource ?? '').replace(/<[^>]+>/g, ' ')
  return interpolateTemplate(fallback, data).replace(/\s{2,}/g, ' ').trim()
}

export function buildWrappedEmailHtml(options: WrappedEmailOptions): string {
  return minifyEmailHtml(`
    <html lang="en" style="color-scheme:light; supported-color-schemes:light;">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>${options.subject}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f7f5ef;color:#1b1b1b;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f7f5ef;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:720px;background-color:#ffffff;border:1px solid #eadfcb;border-radius:16px;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;overflow:hidden;">
                ${options.newsletterBadgeHtml ? `<tr><td align="center" style="padding:24px 24px 0 24px;">${options.newsletterBadgeHtml}</td></tr>` : ''}
                ${options.logoHtml ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${options.logoHtml}</td></tr>` : ''}
                ${options.bannerHtml ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${options.bannerHtml}</td></tr>` : ''}
                ${options.inlineImageHtml ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${options.inlineImageHtml}</td></tr>` : ''}
                <tr>
                  <td align="center" style="padding:0 24px 18px 24px;line-height:1.6;font-size:15px;color:#1b1b1b;">${options.bodyHtml}${options.trackingPixelHtml ?? ''}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${options.footerContent}</td>
                </tr>
                ${options.footerCompanyName ? `<tr><td align="center" style="padding:8px 24px 0 24px;font-size:12px;line-height:1.5;color:#555;">${options.footerCompanyName}</td></tr>` : ''}
                ${options.companyAddress ? `<tr><td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${options.companyAddress}</td></tr>` : ''}
                ${options.companyContact ? `<tr><td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${options.companyContact}</td></tr>` : ''}
                ${options.contactNumberHtml ?? ''}
                ${options.socialRowHtml ? `<tr><td align="center" style="padding:14px 24px 0 24px;">${options.socialRowHtml}</td></tr>` : ''}
                <tr>
                  <td align="center" style="padding:14px 24px 24px 24px;">
                    <a href="${options.unsubscribeUrl}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#f5efea;border:1px solid #d9c9b7;color:#5f4936;font-size:12px;line-height:1;text-decoration:none;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `)
}
