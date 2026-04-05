import DOMPurify from 'isomorphic-dompurify'
import {
  normalizeLinkUrl,
  compactFragment,
  bodyContainsCidImage,
  interpolateTemplate,
  buildWrappedEmailHtml,
  buildInterpolatedTextFallback
} from '../shared/email-layout.js'

interface BuildEmailHtmlOptions {
  template?: string
  htmlBody?: string
  textBody?: string
  data: Record<string, any>
  sourceType?: 'cid' | 'url'
  imageUrl?: string
  imageCid?: string
  logoSourceType?: 'cid' | 'url'
  logoUrl?: string
  logoCid?: string
  logoLinkUrl?: string
  bannerSourceType?: 'cid' | 'url'
  bannerUrl?: string
  bannerCid?: string
  bannerLinkUrl?: string
  inlineImageSourceType?: 'cid' | 'url'
  inlineImageUrl?: string
  inlineImageCid?: string
  inlineImageLinkUrl?: string
  companyName?: string
  headerCompanyName?: string
  footerCompanyName?: string
  companyAddress?: string
  companyContact?: string
  contactNumber?: string
  footerContent?: string
  ctaUrl?: string
  facebookUrl?: string
  instagramUrl?: string
  xUrl?: string
  linkedinUrl?: string
  whatsappUrl?: string
  youtubeUrl?: string
  socialIconSize?: number
  isNewsletter?: boolean
  newsletterEdition?: string
  webhookUrl?: string
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

function buildSocialLink(href: string | undefined, label: string, size: number): string {
  const url = normalizeLinkUrl(String(href || ''))
  if (!url) {
    return ''
  }
  return `<a href="${url}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 4px;padding:0 10px;height:${size}px;line-height:${size}px;border-radius:999px;background:#f5efea;border:1px solid #d9c9b7;color:#5f4936;font-size:12px;text-decoration:none;">${label}</a>`
}

export function buildEmailHtml(options: BuildEmailHtmlOptions): string {
  const bodyTemplate = String(options.htmlBody || options.template || '<p>Hello {{name}}</p>')
  const body = compactFragment(interpolateTemplate(bodyTemplate, {
    ...options.data,
    company_name: options.companyName || '',
    header_company_name: options.headerCompanyName || options.companyName || 'Maigun Campaign',
    footer_company_name: options.footerCompanyName || options.companyName || '',
    company_address: options.companyAddress || '',
    company_contact: options.companyContact || '',
    contact_number: options.contactNumber || '',
    cta_url: options.ctaUrl || '',
    whatsapp_url: options.whatsappUrl || '',
    youtube_url: options.youtubeUrl || ''
  }))
  const logoUrl = resolveImageSrc(options.logoSourceType || 'url', options.logoUrl, options.logoCid)
  const bannerUrl = resolveImageSrc(options.bannerSourceType || options.sourceType || 'url', options.bannerUrl || options.imageUrl, options.bannerCid || options.imageCid)
  const inlineImageUrl = resolveImageSrc(options.inlineImageSourceType || 'url', options.inlineImageUrl, options.inlineImageCid)
  const pixelBaseUrl = String(options.webhookUrl || '')
  const pixelSeparator = pixelBaseUrl.includes('?') ? '&' : '?'
  const headerCompanyName = String(options.headerCompanyName || options.companyName || 'Maigun Campaign')
  const footerCompanyName = String(options.footerCompanyName || options.companyName || '')
  const footerContent = String(options.footerContent || 'You are receiving this email because you opted in.')
  const companyAddress = String(options.companyAddress || '')
  const companyContact = String(options.companyContact || '')
  const contactNumber = String(options.contactNumber || '')
  const socialIconSize = [28, 32, 36].includes(Number(options.socialIconSize)) ? Number(options.socialIconSize) : 32
  const logoLinkUrl = normalizeLinkUrl(String(options.logoLinkUrl || ''))
  const bannerLinkUrl = normalizeLinkUrl(String(options.bannerLinkUrl || options.ctaUrl || ''))
  const inlineImageLinkUrl = normalizeLinkUrl(String(options.inlineImageLinkUrl || ''))
  const newsletterBadge = options.isNewsletter
    ? `<span style="display:inline-block;background:#f2ece2;border:1px solid #dcc8a6;padding:6px 10px;border-radius:999px;font-size:11px;line-height:1;color:#574935;">Newsletter ${String(options.newsletterEdition || 'Edition')}</span>`
    : ''
  const bodyHasLogoCid = bodyContainsCidImage(body, options.logoSourceType === 'cid' ? options.logoCid : undefined)
  const bodyHasBannerCid = bodyContainsCidImage(body, options.bannerSourceType === 'cid' ? options.bannerCid : undefined)
  const bodyHasInlineCid = bodyContainsCidImage(body, options.inlineImageSourceType === 'cid' ? options.inlineImageCid : undefined)
  const socialLinks = [
    buildSocialLink(options.facebookUrl, 'Facebook', socialIconSize),
    buildSocialLink(options.instagramUrl, 'Instagram', socialIconSize),
    buildSocialLink(options.xUrl, 'X', socialIconSize),
    buildSocialLink(options.linkedinUrl, 'LinkedIn', socialIconSize),
    buildSocialLink(options.whatsappUrl, 'WhatsApp', socialIconSize),
    buildSocialLink(options.youtubeUrl, 'YouTube', socialIconSize)
  ].filter(Boolean).join('')
  const unsubscribeUrl = interpolateTemplate('{{unsubscribe_url}}', {
    ...options.data,
    unsubscribe_url: options.data?.unsubscribe_url || '#'
  })

  // Build complete email wrapper
  const emailHtml = buildWrappedEmailHtml({
    subject: String(options.data?.campaign_name || 'Campaign'),
    bodyHtml: body,
    newsletterBadgeHtml: newsletterBadge,
    logoHtml: logoUrl && !bodyHasLogoCid
      ? `${logoLinkUrl ? `<a href="${logoLinkUrl}" style="text-decoration:none;">` : ''}<img src="${logoUrl}" alt="${headerCompanyName} logo" width="84" style="display:block;width:84px;max-width:84px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />${logoLinkUrl ? '</a>' : ''}`
      : '',
    bannerHtml: bannerUrl && !bodyHasBannerCid
      ? `${bannerLinkUrl ? `<a href="${bannerLinkUrl}" style="text-decoration:none;">` : ''}<img src="${bannerUrl}" alt="Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;" />${bannerLinkUrl ? '</a>' : ''}`
      : '',
    inlineImageHtml: inlineImageUrl && !bodyHasInlineCid
      ? `${inlineImageLinkUrl ? `<a href="${inlineImageLinkUrl}" style="text-decoration:none;">` : ''}<img src="${inlineImageUrl}" alt="Inline image" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" />${inlineImageLinkUrl ? '</a>' : ''}`
      : '',
    trackingPixelHtml: options.webhookUrl ? `<img src="${pixelBaseUrl}${pixelSeparator}campaign_id={{campaign_id}}&email={{email}}" width="1" height="1" alt="" style="border:0;" />` : '',
    footerContent,
    footerCompanyName,
    companyAddress,
    companyContact,
    contactNumberHtml: contactNumber ? `<tr><td align="center" style="padding:4px 0 0 0;font-size:12px;line-height:18px;color:#666;"><a href="tel:${contactNumber}" style="color:#666;text-decoration:none;">${contactNumber}</a></td></tr>` : '',
    socialRowHtml: socialLinks,
    unsubscribeUrl
  })

  return DOMPurify.sanitize(emailHtml, { ALLOWED_TAGS: ['*'], ALLOWED_ATTR: ['*'] })
}

export function buildTextFallback(options: BuildEmailHtmlOptions): string {
  return buildInterpolatedTextFallback(
    String(options.textBody || options.htmlBody || options.template || ''),
    options.data,
    String(options.htmlBody || options.template || '')
  )
}

export { resolveImageSrc, normalizeLinkUrl, interpolateTemplate }
