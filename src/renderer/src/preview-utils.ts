import type { Campaign, SocialIconUrls } from './types'

function socialIconLink(href: string | undefined, label: string, iconUrl: string, iconSize: number) {
  if (!href || !href.trim() || !iconUrl || !iconUrl.trim()) {
    return ''
  }
  return `<a href="${href}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 2px;vertical-align:middle;"><img src="${iconUrl}" alt="${label}" style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;display:block;border:none;" /></a>`
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

export function renderTemplateForPreview(content: string, campaign: Partial<Campaign>): string {
  const replacements: Record<string, string> = {
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    offer_code: 'OFFER-2026',
    unsubscribe_url: 'https://example.com/unsubscribe',
    cta_url: String(campaign.ctaUrl ?? 'https://example.com'),
    company_name: String(campaign.companyName ?? ''),
    header_company_name: String(campaign.headerCompanyName ?? campaign.companyName ?? ''),
    footer_company_name: String(campaign.footerCompanyName ?? campaign.companyName ?? ''),
    company_address: String(campaign.companyAddress ?? ''),
    company_contact: String(campaign.companyContact ?? ''),
    contact_number: String(campaign.contactNumber ?? ''),
    whatsapp_url: String(campaign.whatsappUrl ?? ''),
    youtube_url: String(campaign.youtubeUrl ?? '')
  }
  return String(content ?? '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => replacements[key] ?? '')
}

export function resolveCampaignImageSrc(
  campaign: Partial<Campaign>,
  url: string | undefined,
  sourceType: 'url' | 'cid' | undefined,
  cid: string | undefined,
  imageMissingDataUri: string,
  cidImageMissingDataUri: string
): string {
  if (sourceType === 'cid' && cid?.trim()) {
    const cleanCid = cid.trim()
    const cidFromAssets = (campaign.cidAssets ?? []).find((asset) => String(asset.cid ?? '').trim() === cleanCid)?.filePath
    const slotPath = (campaign.logoCid === cleanCid ? campaign.logoPath : '')
      || (campaign.bannerCid === cleanCid ? campaign.bannerPath : '')
      || (campaign.inlineImageCid === cleanCid ? campaign.inlineImagePath : '')
    const filePath = String(cidFromAssets || slotPath || '').trim()
    if (filePath) {
      return filePath.startsWith('file://') ? filePath : `file://${filePath}`
    }
    return cidImageMissingDataUri
  }
  const cleanUrl = url?.trim() ?? ''
  if (!cleanUrl) {
    return imageMissingDataUri
  }
  if (cleanUrl.startsWith('data:') || cleanUrl.startsWith('file:')) {
    return cleanUrl
  }
  return cleanUrl
}

export function resolvePreviewBodyCidImages(bodyHtml: string, campaign: Partial<Campaign>, cidImageMissingDataUri: string): string {
  return String(bodyHtml ?? '')
    .replace(/(<img\b[^>]*src=["'])cid:([^"']+)(["'][^>]*>)/gi, (_match, start, cidValue, end) => {
      const cleanCid = String(cidValue ?? '').trim()
      const cidFromAssets = (campaign.cidAssets ?? []).find((asset) => String(asset.cid ?? '').trim() === cleanCid)?.filePath
      const slotPath = (campaign.logoCid === cleanCid ? campaign.logoPath : '')
        || (campaign.bannerCid === cleanCid ? campaign.bannerPath : '')
        || (campaign.inlineImageCid === cleanCid ? campaign.inlineImagePath : '')
      const filePath = String(cidFromAssets || slotPath || '').trim()
      const resolvedSrc = filePath
        ? (filePath.startsWith('file://') ? filePath : `file://${filePath}`)
        : cidImageMissingDataUri
      return `${start}${resolvedSrc}${end}`
    })
}

export function bodyContainsCidImage(bodyHtml: string, cid: string | undefined): boolean {
  const cleanCid = (cid ?? '').trim()
  if (!cleanCid) {
    return false
  }
  const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, 'i').test(bodyHtml)
}

export function buildReceiverPreview(options: {
  campaign: Partial<Campaign>
  previewMode: 'desktop' | 'mobile'
  socialIconUrls: SocialIconUrls
  emptyHtmlBody: string
  imageMissingDataUri: string
  cidImageMissingDataUri: string
}): string {
  const { campaign, previewMode, socialIconUrls, emptyHtmlBody, imageMissingDataUri, cidImageMissingDataUri } = options
  const maxWidth = previewMode === 'mobile' ? '390px' : '720px'
  const socialIconSize = [28, 32, 36].includes(Number(campaign.socialIconSize)) ? Number(campaign.socialIconSize) : 32
  const body = renderTemplateForPreview(String(campaign.htmlBody ?? emptyHtmlBody), campaign)
  const previewBody = resolvePreviewBodyCidImages(body, campaign, cidImageMissingDataUri)
  const bodyHasLogoCid = bodyContainsCidImage(body, campaign.logoSourceType === 'cid' ? campaign.logoCid : undefined)
  const bodyHasBannerCid = bodyContainsCidImage(body, campaign.bannerSourceType === 'cid' ? campaign.bannerCid : undefined)
  const bodyHasFeaturedCid = bodyContainsCidImage(body, campaign.inlineImageSourceType === 'cid' ? campaign.inlineImageCid : undefined)
  const social = [
    socialIconLink(campaign.facebookUrl, 'Facebook', socialIconUrls.facebook || '', socialIconSize),
    socialIconLink(campaign.instagramUrl, 'Instagram', socialIconUrls.instagram || '', socialIconSize),
    socialIconLink(campaign.xUrl, 'X', socialIconUrls.x || '', socialIconSize),
    socialIconLink(campaign.linkedinUrl, 'LinkedIn', socialIconUrls.linkedin || '', socialIconSize),
    socialIconLink(campaign.whatsappUrl, 'WhatsApp', socialIconUrls.whatsapp || '', socialIconSize),
    socialIconLink(campaign.youtubeUrl, 'YouTube', socialIconUrls.youtube || '', socialIconSize)
  ].filter(Boolean).join('')
  const sender = campaign.senderEmail ?? 'sender@example.com'
  const subject = renderTemplateForPreview(String(campaign.subject ?? ''), campaign)
  const logoSrc = resolveCampaignImageSrc(campaign, campaign.logoUrl, campaign.logoSourceType, campaign.logoCid, imageMissingDataUri, cidImageMissingDataUri)
  const logoLink = normalizeLinkUrl(campaign.logoLinkUrl)
  const bannerSrc = resolveCampaignImageSrc(campaign, campaign.bannerUrl, campaign.bannerSourceType, campaign.bannerCid, imageMissingDataUri, cidImageMissingDataUri)
  const bannerLink = normalizeLinkUrl(campaign.bannerLinkUrl ?? campaign.ctaUrl)
  const featuredSrc = resolveCampaignImageSrc(campaign, campaign.inlineImageUrl, campaign.inlineImageSourceType, campaign.inlineImageCid, imageMissingDataUri, cidImageMissingDataUri)
  const featuredLink = normalizeLinkUrl(campaign.inlineImageLinkUrl)
  const logoMarkup = logoSrc && !bodyHasLogoCid && (campaign.logoSourceType !== 'cid' || campaign.logoCid?.trim() || campaign.logoPath?.trim())
    ? (logoLink
        ? `<a href="${logoLink}" style="display:inline-block;text-decoration:none;"><img src="${logoSrc}" style="max-height:36px;max-width:84px;display:block;margin:0 auto 12px;" /></a>`
        : `<img src="${logoSrc}" style="max-height:36px;max-width:84px;display:block;margin:0 auto 12px;" />`)
    : ''
  const bannerMarkup = bannerSrc && !bodyHasBannerCid && (campaign.bannerSourceType !== 'cid' || campaign.bannerCid?.trim() || campaign.bannerPath?.trim())
    ? (bannerLink
        ? `<a href="${bannerLink}" style="display:block;text-decoration:none;"><img src="${bannerSrc}" style="width:100%;border-radius:12px;display:block;margin:0 auto 14px;" /></a>`
        : `<img src="${bannerSrc}" style="width:100%;border-radius:12px;display:block;margin:0 auto 14px;" />`)
    : ''
  const featuredMarkup = featuredSrc && !bodyHasFeaturedCid && (campaign.inlineImageSourceType !== 'cid' || campaign.inlineImageCid?.trim() || campaign.inlineImagePath?.trim())
    ? (featuredLink
        ? `<a href="${featuredLink}" style="display:block;text-decoration:none;"><img src="${featuredSrc}" style="width:100%;border-radius:12px;display:block;margin:0 auto 14px;" /></a>`
        : `<img src="${featuredSrc}" style="width:100%;border-radius:12px;display:block;margin:0 auto 14px;" />`)
    : ''
  return `
    <div style="font-family:Arial,sans-serif;background:#f7f5ef;padding:20px;color:#1b1b1b;">
      <div style="max-width:${maxWidth};margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #eadfcb;overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid #eee;background:#faf9f6;">
          <div style="font-size:12px;color:#666;">From: ${sender}</div>
          <div style="font-size:12px;color:#666;">To: jordan@example.com</div>
          <div style="font-size:13px;color:#222;margin-top:6px;"><strong>Subject:</strong> ${subject || '(no subject)'}</div>
        </div>
        <div style="padding:24px;text-align:center;line-height:1.6;">
          <h2 style="margin-top:0;">${campaign.headerCompanyName || campaign.companyName || 'Company'}</h2>
          ${logoMarkup}
          ${bannerMarkup}
          ${featuredMarkup}
          ${previewBody}
          <p style="margin-top:16px;color:#666;font-size:12px;">${campaign.footerCompanyName || campaign.companyName || ''}</p>
          <p style="margin:2px 0;color:#666;font-size:12px;">${campaign.companyAddress ?? ''}</p>
          <p style="margin:2px 0;color:#666;font-size:12px;">${campaign.companyContact ?? ''}</p>
          ${campaign.contactNumber ? `<p style="margin:2px 0;color:#666;font-size:12px;"><a href="tel:${campaign.contactNumber}" style="color:#666;text-decoration:none;">${campaign.contactNumber}</a></p>` : ''}
          <div style="margin-top:10px;">${social}</div>
          <p style="margin-top:12px;"><a href="https://example.com/unsubscribe">Unsubscribe</a></p>
        </div>
      </div>
    </div>
  `
}
