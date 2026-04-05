import type { Campaign, EmailRecipient } from '../types'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  normalizeLinkUrl,
  compactFragment,
  bodyContainsCidImage,
  buildWrappedEmailHtml,
  interpolateTemplate,
  buildTemplateVariables,
  buildInterpolatedTextFallback
} from '../../../backend/src/shared/email-layout'

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

function buildSocialIconLink(href: string | undefined, label: string, cidRef: string, iconSize: number): string {
  if (!href || !href.trim()) {
    return ''
  }
  return `<a href="${href}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 2px;vertical-align:middle;"><img src="cid:${cidRef}" alt="${label}" style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;display:block;border:none;" /></a>`
}

export function renderTemplate(content: string, recipient: EmailRecipient, campaign: Campaign): string {
  return interpolateTemplate(content, buildTemplateVariables(
    {
      name: campaign.name,
      companyName: campaign.companyName,
      headerCompanyName: campaign.headerCompanyName,
      footerCompanyName: campaign.footerCompanyName,
      companyAddress: campaign.companyAddress,
      companyContact: campaign.companyContact,
      contactNumber: campaign.contactNumber,
      ctaUrl: campaign.ctaUrl,
      whatsappUrl: campaign.whatsappUrl,
      youtubeUrl: campaign.youtubeUrl
    },
    recipient,
    {
      campaign_name: campaign.name
    }
  ))
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
  return buildWrappedEmailHtml({
    subject: campaign.subject,
    bodyHtml: body,
    newsletterBadgeHtml: newsletterBadge,
    logoHtml: logo.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, ''),
    bannerHtml: banner.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, ''),
    inlineImageHtml: inlineImage.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, ''),
    footerContent: campaign.footerContent,
    footerCompanyName: campaign.footerCompanyName || campaign.companyName,
    companyAddress: campaign.companyAddress,
    companyContact: campaign.companyContact,
    contactNumberHtml: contactNumber,
    socialRowHtml: socialLabelRow,
    unsubscribeUrl
  })
}

export function buildTextFallback(campaign: Campaign, recipient: EmailRecipient): string {
  return buildInterpolatedTextFallback(
    campaign.textBody,
    buildTemplateVariables(
      {
        name: campaign.name,
        companyName: campaign.companyName,
        headerCompanyName: campaign.headerCompanyName,
        footerCompanyName: campaign.footerCompanyName,
        companyAddress: campaign.companyAddress,
        companyContact: campaign.companyContact,
        contactNumber: campaign.contactNumber,
        ctaUrl: campaign.ctaUrl,
        whatsappUrl: campaign.whatsappUrl,
        youtubeUrl: campaign.youtubeUrl
      },
      recipient,
      {
        campaign_name: campaign.name
      }
    ),
    campaign.htmlBody
  )
}

export function getSocialIconCidAssets(): Array<{ cid: string; filePath: string; fileName: string }> {
  return Object.entries(SOCIAL_ICON_PATHS).map(([key, filePath]) => ({
    cid: SOCIAL_ICON_CID[key],
    filePath,
    fileName: `${key}.png`
  }))
}
