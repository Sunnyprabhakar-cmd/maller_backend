import type { Campaign, EmailRecipient } from '../types'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const SOCIAL_ICON_CID: Record<string, string> = {
  facebook: 'social_facebook',
  instagram: 'social_instagram',
  x: 'social_x',
  linkedin: 'social_linkedin',
  whatsapp: 'social_whatsapp',
  youtube: 'social_youtube'
}

function resolveSocialIconPath(fileName: string): string {
  const candidates = [
    resolve(process.cwd(), 'src/shared/social-icons', fileName),
    resolve(process.cwd(), 'dist/shared/social-icons', fileName),
    resolve(__dirname, '../../shared/social-icons', fileName)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

const SOCIAL_ICON_PATHS: Record<string, string> = {
  facebook: resolveSocialIconPath('facebook.png'),
  instagram: resolveSocialIconPath('instagram.png'),
  x: resolveSocialIconPath('x.png'),
  linkedin: resolveSocialIconPath('linkedin.png'),
  whatsapp: resolveSocialIconPath('whatsapp.png'),
  youtube: resolveSocialIconPath('youtube.png')
}

function resolveImageSrc(url: string | undefined, sourceType: 'url' | 'cid' | undefined, cid: string | undefined): string {
  if (sourceType === 'cid' && cid?.trim()) {
    return `cid:${cid.trim()}`
  }
  return url?.trim() ?? ''
}

function normalizeLinkUrl(value: string | undefined): string {
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

function buildSocialIconLink(href: string | undefined, label: string, cidRef: string, iconSize: number): string {
  if (!href || !href.trim()) {
    return ''
  }
  return `<a href="${href}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 2px;vertical-align:middle;"><img src="cid:${cidRef}" alt="${label}" style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;display:block;border:none;" /></a>`
}

function compactFragment(html: string): string {
  return html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function minifyEmailHtml(html: string): string {
  return html
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n+/g, '')
    .trim()
}

function bodyContainsCidImage(bodyHtml: string, cid: string | undefined): boolean {
  const cleanCid = (cid ?? '').trim()
  if (!cleanCid) {
    return false
  }
  const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, 'i').test(bodyHtml)
}

export function renderTemplate(content: string, recipient: EmailRecipient, campaign: Campaign): string {
  const variables: Record<string, string> = {
    name: recipient.name ?? '',
    email: recipient.email,
    campaign_name: campaign.name,
    company_name: campaign.companyName,
    header_company_name: campaign.headerCompanyName || campaign.companyName,
    footer_company_name: campaign.footerCompanyName || campaign.companyName,
    cta_url: campaign.ctaUrl ?? '',
    company_address: campaign.companyAddress,
    company_contact: campaign.companyContact,
    contact_number: campaign.contactNumber,
    whatsapp_url: campaign.whatsappUrl ?? '',
    youtube_url: campaign.youtubeUrl ?? '',
    offer_code: recipient.customFields?.offer_code ?? '',
    unsubscribe_url: recipient.customFields?.unsubscribe_url ?? '#',
    ...Object.fromEntries(Object.entries(recipient.customFields ?? {}))
  }

  return content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => variables[key] ?? '')
}

export function renderCampaignSubject(campaign: Campaign, recipient: EmailRecipient): string {
  return compactFragment(renderTemplate(campaign.subject, recipient, campaign))
}

export function buildEmailHtml(campaign: Campaign, recipient: EmailRecipient): string {
  const body = compactFragment(renderTemplate(campaign.htmlBody, recipient, campaign))
  const bodyHasLogoCid = bodyContainsCidImage(body, campaign.logoSourceType === 'cid' ? campaign.logoCid : undefined)
  const bodyHasBannerCid = bodyContainsCidImage(body, campaign.bannerSourceType === 'cid' ? campaign.bannerCid : undefined)
  const bodyHasFeaturedCid = bodyContainsCidImage(body, campaign.inlineImageSourceType === 'cid' ? campaign.inlineImageCid : undefined)
  const logoSrc = resolveImageSrc(campaign.logoUrl, campaign.logoSourceType, campaign.logoCid)
  const logoLink = normalizeLinkUrl(campaign.logoLinkUrl)
  const logo = logoSrc && !bodyHasLogoCid
    ? `<tr><td align="center" style="padding:0 0 18px 0;">${logoLink ? `<a href="${logoLink}" style="text-decoration:none;"><img src="${logoSrc}" alt="${campaign.headerCompanyName || campaign.companyName} logo" width="84" style="display:block;width:84px;max-width:84px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" /></a>` : `<img src="${logoSrc}" alt="${campaign.headerCompanyName || campaign.companyName} logo" width="84" style="display:block;width:84px;max-width:84px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />`}</td></tr>`
    : ''
  const bannerSrc = resolveImageSrc(campaign.bannerUrl, campaign.bannerSourceType, campaign.bannerCid)
  const bannerLink = normalizeLinkUrl(campaign.bannerLinkUrl ?? campaign.ctaUrl)
  const banner = bannerSrc && !bodyHasBannerCid
    ? `<tr><td align="center" style="padding:0 0 18px 0;">${bannerLink ? `<a href="${bannerLink}" style="text-decoration:none;"><img src="${bannerSrc}" alt="Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;" /></a>` : `<img src="${bannerSrc}" alt="Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;" />`}</td></tr>`
    : ''
  const inlineImageSrc = resolveImageSrc(campaign.inlineImageUrl, campaign.inlineImageSourceType, campaign.inlineImageCid)
  const inlineImageLink = normalizeLinkUrl(campaign.inlineImageLinkUrl)
  const socialIconSize = [28, 32, 36].includes(Number(campaign.socialIconSize)) ? Number(campaign.socialIconSize) : 32
  const inlineImage = inlineImageSrc && !bodyHasFeaturedCid
    ? `<tr><td align="center" style="padding:0 0 18px 0;">${inlineImageLink ? `<a href="${inlineImageLink}" style="text-decoration:none;"><img src="${inlineImageSrc}" alt="Inline image" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" /></a>` : `<img src="${inlineImageSrc}" alt="Inline image" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" />`}</td></tr>`
    : ''
  const unsubscribeUrl = renderTemplate('{{unsubscribe_url}}', recipient, campaign)
  const socialLabelRow = [
    buildSocialIconLink(campaign.facebookUrl, 'Facebook', SOCIAL_ICON_CID.facebook, socialIconSize),
    buildSocialIconLink(campaign.instagramUrl, 'Instagram', SOCIAL_ICON_CID.instagram, socialIconSize),
    buildSocialIconLink(campaign.xUrl, 'X', SOCIAL_ICON_CID.x, socialIconSize),
    buildSocialIconLink(campaign.linkedinUrl, 'LinkedIn', SOCIAL_ICON_CID.linkedin, socialIconSize),
    buildSocialIconLink(campaign.whatsappUrl, 'WhatsApp', SOCIAL_ICON_CID.whatsapp, socialIconSize),
    buildSocialIconLink(campaign.youtubeUrl, 'YouTube', SOCIAL_ICON_CID.youtube, socialIconSize)
  ].filter(Boolean).join('')
  const newsletterBadge = campaign.isNewsletter
    ? `<span style="display:inline-block;background:#f2ece2;border:1px solid #dcc8a6;padding:6px 10px;border-radius:999px;font-size:11px;line-height:1;color:#574935;">Newsletter ${campaign.newsletterEdition || 'Edition'}</span>`
    : ''
  const contactNumber = campaign.contactNumber
    ? `<tr><td align="center" style="padding:4px 0 0 0;font-size:12px;line-height:18px;color:#666;"><a href="tel:${campaign.contactNumber}" style="color:#666;text-decoration:none;">${campaign.contactNumber}</a></td></tr>`
    : ''
  return minifyEmailHtml(`
    <html lang="en" style="color-scheme:light; supported-color-schemes:light;">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>${campaign.subject}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f7f5ef;color:#1b1b1b;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f7f5ef;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:720px;background-color:#ffffff;border:1px solid #eadfcb;border-radius:16px;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;overflow:hidden;">
                ${newsletterBadge ? `<tr><td align="center" style="padding:24px 24px 0 24px;">${newsletterBadge}</td></tr>` : ''}
                ${logo ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${logo.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, '')}</td></tr>` : ''}
                ${banner ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${banner.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, '')}</td></tr>` : ''}
                ${inlineImage ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${inlineImage.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, '')}</td></tr>` : ''}
                <tr>
                  <td align="center" style="padding:0 24px 18px 24px;line-height:1.6;font-size:15px;color:#1b1b1b;">${body}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.footerContent}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:8px 24px 0 24px;font-size:12px;line-height:1.5;color:#555;">${campaign.footerCompanyName || campaign.companyName}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.companyAddress}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.companyContact}</td>
                </tr>
                ${contactNumber}
                <tr>
                  <td align="center" style="padding:14px 24px 0 24px;">${socialLabelRow}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:14px 24px 24px 24px;">
                    <a href="${unsubscribeUrl}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#f5efea;border:1px solid #d9c9b7;color:#5f4936;font-size:12px;line-height:1;text-decoration:none;">Unsubscribe</a>
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

export function buildTextFallback(campaign: Campaign, recipient: EmailRecipient): string {
  const fallback = campaign.textBody || campaign.htmlBody.replace(/<[^>]+>/g, ' ')
  return renderTemplate(fallback, recipient, campaign).replace(/\s{2,}/g, ' ').trim()
}

export function getSocialIconCidAssets(): Array<{ cid: string; filePath: string; fileName: string }> {
  return Object.entries(SOCIAL_ICON_PATHS).map(([key, filePath]) => ({
    cid: SOCIAL_ICON_CID[key],
    filePath,
    fileName: `${key}.png`
  }))
}