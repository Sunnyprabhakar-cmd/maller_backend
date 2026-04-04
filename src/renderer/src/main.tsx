// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { apiClient } from './api-client'
import { wsClient } from './ws-client'
import './styles.css'

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function placeholderDataUri(text: string): string {
  return svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220" role="img" aria-label="${text}">
      <rect width="640" height="220" rx="12" fill="#f2ece2"/>
      <text x="320" y="112" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#7b6756">${text}</text>
    </svg>
  `)
}

const IMAGE_MISSING_DATA_URI = placeholderDataUri('Image Missing')
const CID_IMAGE_MISSING_DATA_URI = placeholderDataUri('CID Image Missing')

function socialFallbackDataUri(label: string): string {
  return svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${label}">
      <circle cx="32" cy="32" r="30" fill="#3e3325"/>
      <text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff">${label}</text>
    </svg>
  `)
}

const DEFAULT_SOCIAL_ICON_URLS: Record<string, string> = {
  facebook: socialFallbackDataUri('f'),
  instagram: socialFallbackDataUri('ig'),
  x: socialFallbackDataUri('x'),
  linkedin: socialFallbackDataUri('in'),
  whatsapp: socialFallbackDataUri('wa'),
  youtube: socialFallbackDataUri('yt')
}

const DEFAULT_API_URL = process.env.REACT_APP_API_URL || 'https://maller-backend-1.onrender.com/api'

function deriveBackendWebhookEndpoint(apiUrl: string): string {
  const trimmed = String(apiUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    return '/api/webhooks'
  }
  if (trimmed.endsWith('/api')) {
    return `${trimmed}/webhooks`
  }
  return `${trimmed}/api/webhooks`
}

type Campaign = {
  id: string
  name: string
  isNewsletter: boolean
  newsletterEdition: string
  subject: string
  htmlBody: string
  textBody: string
  senderEmail: string
  replyToEmail: string
  companyName: string
  headerCompanyName: string
  footerCompanyName: string
  companyAddress: string
  companyContact: string
  contactNumber: string
  footerContent: string
  logoUrl?: string
  logoLinkUrl?: string
  logoSourceType?: 'url' | 'cid'
  logoCid?: string
  logoPath?: string
  bannerUrl?: string
  bannerLinkUrl?: string
  bannerSourceType?: 'url' | 'cid'
  bannerCid?: string
  bannerPath?: string
  inlineImageUrl?: string
  inlineImageLinkUrl?: string
  inlineImageSourceType?: 'url' | 'cid'
  inlineImageCid?: string
  inlineImagePath?: string
  cidAssets?: Array<{ cid: string; filePath: string; fileName: string }>
  ctaUrl?: string
  ctaImageUrl?: string
  facebookUrl?: string
  instagramUrl?: string
  xUrl?: string
  linkedinUrl?: string
  whatsappUrl?: string
  youtubeUrl?: string
  socialIconSize?: 28 | 32 | 36
  scheduledAt?: string
  status: string
}

type Settings = {
  mailgunApiKey: string
  mailgunDomain: string
  senderEmails: string[]
  recentTestEmails: string[]
  defaultReplyTo: string
  webhookSecret: string
  throttlePerMinute: number
  retryAttempts: number
  autoWatchFolder: string
  imageUploadProvider: 'none' | 'imgbb'
  imageUploadApiKey: string
  googleDriveEnabled: boolean
  googleDriveClientId: string
  googleDriveClientSecret: string
  googleDriveRefreshToken: string
  googleDriveFolderId: string
  appUsername: string
  appPassword: string
}

type Progress = {
  total: number
  queued: number
  sent: number
  failed: number
  suppressed: number
  inProgress: number
  percent: number
}

function deriveCampaignStatus(baseStatus: string | undefined, progress: Progress | undefined): string {
  if (!progress || progress.total <= 0) {
    return String(baseStatus ?? 'draft')
  }

  const processed = progress.sent + progress.failed + progress.suppressed
  if (processed >= progress.total) {
    if (progress.failed > 0 && progress.sent === 0) {
      return 'failed'
    }
    return 'sent'
  }

  if (progress.inProgress > 0 || processed > 0) {
    return 'sending'
  }

  if (progress.queued > 0) {
    return 'queued'
  }

  return String(baseStatus ?? 'draft')
}

function normalizeRemoteEvent(event: any): any {
  const rawType = String(event?.event ?? event?.type ?? 'failed').toLowerCase()
  const normalizedType = rawType === 'open'
    ? 'opened'
    : rawType === 'click'
      ? 'clicked'
      : rawType === 'bounce'
        ? 'bounced'
        : rawType

  return {
    id: String(event?.id ?? ''),
    campaignId: String(event?.campaignId ?? ''),
    recipientEmail: String(event?.email ?? event?.recipientEmail ?? event?.recipient ?? ''),
    type: normalizedType,
    payload: {
      ...(event?.data ?? event?.payload ?? {}),
      _source: 'mailgun-webhook'
    },
    createdAt: event?.timestamp ?? event?.createdAt ?? new Date().toISOString()
  }
}

function normalizeSocketWebhookEvent(event: any): any {
  return {
    id: '',
    campaignId: String(event?.campaignId ?? ''),
    recipientEmail: String(event?.email ?? event?.recipientEmail ?? event?.recipient ?? ''),
    type: canonicalEventType(event?.event ?? event?.type ?? 'failed'),
    payload: {
      _source: 'mailgun-webhook'
    },
    createdAt: event?.timestamp ?? new Date().toISOString()
  }
}

function normalizeEmail(input: any): string {
  return String(input ?? '').trim().toLowerCase()
}

function hasRealWebhookEvent(rows: any[]): boolean {
  return rows.some((event) => event?.payload?._source === 'mailgun-webhook' && event?.payload?._simulated !== true)
}

async function fetchRecoveredHostedEventsForRecipients(recipientEmails: Set<string>): Promise<any[]> {
  if (recipientEmails.size === 0) {
    return []
  }

  try {
    const campaigns = await apiClient.getCampaigns()
    const recoveredCampaignIds = (Array.isArray(campaigns) ? campaigns : [])
      .map((entry: any) => String(entry?.id ?? ''))
      .filter((id: string) => id.startsWith('recovered-'))

    if (recoveredCampaignIds.length === 0) {
      return []
    }

    const rows = await Promise.all(recoveredCampaignIds.map(async (id: string) => {
      try {
        const events = await apiClient.getCampaignEvents(id)
        return Array.isArray(events) ? events.map(normalizeRemoteEvent) : []
      } catch {
        return []
      }
    }))

    return rows
      .flat()
      .filter((event) => recipientEmails.has(normalizeEmail(event?.recipientEmail)))
  } catch {
    return []
  }
}

function mergeEventsUnique(localEvents: any[], remoteEvents: any[]) {
  const merged = new Map<string, any>()
  const keyFor = (event: any) => {
    const idPart = String(event?.id ?? '')
    if (idPart) {
      return `id:${idPart}`
    }
    return [
      String(event?.campaignId ?? ''),
      String(event?.recipientEmail ?? event?.email ?? ''),
      String(event?.type ?? event?.event ?? ''),
      String(event?.createdAt ?? event?.timestamp ?? '')
    ].join('|')
  }

  for (const event of [...localEvents, ...remoteEvents]) {
    merged.set(keyFor(event), event)
  }

  return [...merged.values()].sort((left, right) => {
    const a = new Date(String(left?.createdAt ?? left?.timestamp ?? 0)).getTime()
    const b = new Date(String(right?.createdAt ?? right?.timestamp ?? 0)).getTime()
    return b - a
  })
}

function canonicalEventType(value: any): string {
  const raw = String(value ?? '').toLowerCase()
  if (raw === 'open') return 'opened'
  if (raw === 'click') return 'clicked'
  if (raw === 'bounce') return 'bounced'
  return raw
}

function isWebhookMetricEvent(event: any): boolean {
  const type = canonicalEventType(event?.type ?? event?.event)
  return type === 'delivered' || type === 'opened' || type === 'clicked' || type === 'bounced' || type === 'failed' || type === 'accepted'
}

function mergeCampaignLists(localCampaigns: Campaign[], remoteCampaigns: any[]) {
  const merged = new Map<string, Campaign>()
  for (const campaign of localCampaigns) {
    merged.set(campaign.id, campaign)
  }
  for (const campaign of remoteCampaigns) {
    const existing = merged.get(String(campaign?.id ?? ''))
    if (existing) {
      merged.set(existing.id, {
        ...existing,
        name: campaign?.name ?? existing.name,
        subject: campaign?.subject ?? existing.subject,
        status: campaign?.status ?? existing.status,
        updatedAt: campaign?.updatedAt ? String(campaign.updatedAt) : existing.updatedAt,
        createdAt: campaign?.createdAt ? String(campaign.createdAt) : existing.createdAt
      })
    } else if (campaign?.id) {
      merged.set(String(campaign.id), {
        id: String(campaign.id),
        name: String(campaign.name ?? 'Recovered campaign'),
        isNewsletter: false,
        newsletterEdition: '',
        subject: String(campaign.subject ?? ''),
        htmlBody: '<p>Recovered campaign.</p>',
        textBody: 'Recovered campaign.',
        senderEmail: '',
        replyToEmail: '',
        companyName: 'Mailgun',
        headerCompanyName: 'Mailgun',
        footerCompanyName: 'Mailgun',
        companyAddress: '',
        companyContact: '',
        contactNumber: '',
        footerContent: '',
        cidAssets: [],
        status: String(campaign.status ?? 'sent'),
        createdAt: campaign.createdAt ? String(campaign.createdAt) : new Date().toISOString(),
        updatedAt: campaign.updatedAt ? String(campaign.updatedAt) : new Date().toISOString()
      })
    }
  }
  return [...merged.values()]
}

const emptyCampaign: Partial<Campaign> = {
  name: 'Spring Launch',
  isNewsletter: false,
  newsletterEdition: '',
  subject: 'A fresh update for {{name}}',
  htmlBody: '<h1>Hi {{name}},</h1><p>Your offer code is <strong>{{offer_code}}</strong>.</p><p><a href="{{cta_url}}">Open offer</a></p>',
  textBody: 'Hi {{name}}, your offer code is {{offer_code}}.',
  senderEmail: 'sales@domain.com',
  replyToEmail: 'support@domain.com',
  companyName: 'Acme Studio',
  headerCompanyName: 'Acme Studio',
  footerCompanyName: 'Acme Studio',
  companyAddress: '123 Market Street, San Francisco, CA',
  companyContact: 'support@acmestudio.com',
  contactNumber: '+1 (555) 123-4567',
  footerContent: 'You are receiving this email because you opted in.',
  logoSourceType: 'url',
  bannerSourceType: 'url',
  inlineImageSourceType: 'url',
  logoLinkUrl: '',
  bannerLinkUrl: '',
  inlineImageLinkUrl: '',
  cidAssets: [],
  ctaUrl: 'https://example.com',
  facebookUrl: '',
  instagramUrl: '',
  xUrl: '',
  linkedinUrl: '',
  whatsappUrl: '',
  youtubeUrl: '',
  socialIconSize: 32
}

function socialIconLink(href: string | undefined, label: string, iconUrl: string, iconSize: number) {
  if (!href || !href.trim() || !iconUrl || !iconUrl.trim()) {
    return ''
  }
  return `<a href="${href}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 2px;vertical-align:middle;"><img src="${iconUrl}" alt="${label}" style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;display:block;border:none;" /></a>`
}

function parseCsvPreview(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map((entry) => entry.trim())
  const rows = lines.slice(1, 6).map((line) => line.split(',').map((entry) => entry.trim()))
  return { headers, rows }
}

function App() {
  const [tab, setTab] = useState<'dashboard' | 'campaign' | 'csv' | 'settings' | 'events'>('dashboard')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [current, setCurrent] = useState<Partial<Campaign>>(emptyCampaign)
  const [settings, setSettings] = useState<Settings>({
    mailgunApiKey: '',
    mailgunDomain: '',
    senderEmails: ['sales@domain.com', 'support@domain.com'],
    recentTestEmails: [],
    defaultReplyTo: 'support@domain.com',
    webhookSecret: '',
    throttlePerMinute: 60,
    retryAttempts: 3,
    autoWatchFolder: '',
    imageUploadProvider: 'none',
    imageUploadApiKey: '',
    googleDriveEnabled: false,
    googleDriveClientId: '',
    googleDriveClientSecret: '',
    googleDriveRefreshToken: '',
    googleDriveFolderId: '',
    appUsername: '',
    appPassword: ''
  })
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [uploadSummary, setUploadSummary] = useState<any | null>(null)
  const [csvText, setCsvText] = useState('email,name,offer_code,unsubscribe_url\nuser@example.com,User,ABC123,https://example.com/unsub')
  const [events, setEvents] = useState<any[]>([])
  const [allEvents, setAllEvents] = useState<any[]>([])
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [csvFileName, setCsvFileName] = useState('')
  const [newSender, setNewSender] = useState('')
  const [plainContent, setPlainContent] = useState('')
  const [imageLinkUrl, setImageLinkUrl] = useState('')
  const [progress, setProgress] = useState<Progress>({ total: 0, queued: 0, sent: 0, failed: 0, suppressed: 0, inProgress: 0, percent: 0 })
  const [campaignProgressMap, setCampaignProgressMap] = useState<Record<string, Progress>>({})
  const [showConfirm, setShowConfirm] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMode, setAuthMode] = useState<'loading' | 'setup' | 'login'>('loading')
  const [authBusy, setAuthBusy] = useState(false)
  const [setupUsername, setSetupUsername] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('')
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({
    email: 'email',
    name: 'name',
    offer_code: 'offer_code',
    unsubscribe_url: 'unsubscribe_url'
  })
  const [validationError, setValidationError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState('')
  const [socialIconUrls, setSocialIconUrls] = useState<Record<string, string>>(DEFAULT_SOCIAL_ICON_URLS)
  const [webhookEndpoint, setWebhookEndpoint] = useState<string>(deriveBackendWebhookEndpoint(DEFAULT_API_URL))
  const htmlBodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastInsertRef = useRef<{ body: string; snippet: string; cursor: number; at: number } | null>(null)

  function newCid(prefix: string): string {
    const safe = prefix.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'image'
    const rand = Math.random().toString(36).slice(2, 10)
    return `${safe}-${rand}`
  }

  useEffect(() => {
    const load = async () => {
      try {
        const resolver = window.maigun?.getSocialIconDataUris
        if (!resolver) {
          return
        }
        const loaded = await resolver()
        if (loaded && typeof loaded === 'object') {
          setSocialIconUrls((prev) => ({ ...prev, ...loaded }))
        }
      } catch (err) {
        console.error('Failed to load social icons:', err)
      }
    }
    void load()
  }, [])

  function escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function insertHtmlAtCursor(snippet: string) {
    const body = current.htmlBody ?? ''
    const input = htmlBodyRef.current
    const cursor = input ? input.selectionStart : body.length
    const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.min(cursor, body.length)) : body.length
    const now = Date.now()
    const last = lastInsertRef.current
    if (last && last.body === body && last.snippet === snippet && last.cursor === safeCursor && now - last.at < 600) {
      return
    }
    lastInsertRef.current = { body, snippet, cursor: safeCursor, at: now }
    setCurrent({
      ...current,
      htmlBody: `${body.slice(0, safeCursor)}${snippet}${body.slice(safeCursor)}`
    })
  }

  function resolveCampaignImageSrc(url: string | undefined, sourceType: 'url' | 'cid' | undefined, cid: string | undefined): string {
    if (sourceType === 'cid' && cid?.trim()) {
      const cleanCid = cid.trim()
      const cidFromAssets = (current.cidAssets ?? []).find((asset) => String(asset.cid ?? '').trim() === cleanCid)?.filePath
      const slotPath = (current.logoCid === cleanCid ? current.logoPath : '')
        || (current.bannerCid === cleanCid ? current.bannerPath : '')
        || (current.inlineImageCid === cleanCid ? current.inlineImagePath : '')
      const filePath = String(cidFromAssets || slotPath || '').trim()
      if (filePath) {
        return filePath.startsWith('file://') ? filePath : `file://${filePath}`
      }
      return CID_IMAGE_MISSING_DATA_URI
    }
    const cleanUrl = url?.trim() ?? ''
    if (!cleanUrl) {
      return IMAGE_MISSING_DATA_URI
    }
    if (cleanUrl.startsWith('data:') || cleanUrl.startsWith('file:')) {
      return cleanUrl
    }
    return cleanUrl
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

  function resolvePreviewBodyCidImages(bodyHtml: string, campaign: Partial<Campaign>): string {
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
          : CID_IMAGE_MISSING_DATA_URI
        return `${start}${resolvedSrc}${end}`
      })
  }

  function setImageSourceType(field: 'logo' | 'banner' | 'inlineImage', sourceType: 'url' | 'cid') {
    setCurrent((prev) => {
      if (field === 'logo') {
        return { ...prev, logoSourceType: sourceType }
      }
      if (field === 'banner') {
        return { ...prev, bannerSourceType: sourceType }
      }
      return { ...prev, inlineImageSourceType: sourceType }
    })
  }

  async function pickCidImage(field: 'logo' | 'banner' | 'inlineImage') {
    const result = await window.maigun.pickLocalImage()
    if (result?.canceled) return
    setCurrent((prev) => {
      if (field === 'logo') {
        return {
          ...prev,
          logoSourceType: 'cid',
          logoPath: result.filePath,
          logoCid: prev.logoCid || result.cid
        }
      }
      if (field === 'banner') {
        return {
          ...prev,
          bannerSourceType: 'cid',
          bannerPath: result.filePath,
          bannerCid: prev.bannerCid || result.cid
        }
      }
      return {
        ...prev,
        inlineImageSourceType: 'cid',
        inlineImagePath: result.filePath,
        inlineImageCid: prev.inlineImageCid || result.cid
      }
    })
    setActionMessage(`CID image selected: ${result.fileName}`)
  }

  async function addBodyCidImageAsset() {
    const result = await window.maigun.pickLocalImage()
    if (result?.canceled) return
    const cid = result.cid || newCid('body')
    setCurrent((prev) => {
      const list = [...(prev.cidAssets ?? [])]
      const existing = list.findIndex((entry) => entry.cid === cid)
      const next = { cid, filePath: result.filePath, fileName: result.fileName }
      if (existing >= 0) {
        list[existing] = next
      } else {
        list.push(next)
      }
      return { ...prev, cidAssets: list }
    })
    insertHtmlAtCursor(`\n<img src="cid:${escapeHtml(cid)}" alt="${escapeHtml(result.fileName)}" style="display:block;max-width:100%;margin:12px auto;border-radius:12px;" />\n`)
    setActionMessage(`CID body image added: ${cid}`)
  }

  function removeBodyCidAsset(cid: string) {
    clearBodyCidTags(cid)
    setCurrent((prev) => ({ ...prev, cidAssets: (prev.cidAssets ?? []).filter((entry) => entry.cid !== cid) }))
    setActionMessage(`Removed CID asset: ${cid}`)
  }

  function insertCidTag(cid: string, altLabel = 'CID image', variant: 'logo' | 'banner' | 'featured' | 'body' = 'body') {
    const cleanCid = cid.trim()
    if (!cleanCid) {
      setActionMessage('CID is empty. Generate or paste CID first.')
      return
    }
    const style =
      variant === 'logo'
        ? 'display:block;width:84px;max-width:84px;height:auto;margin:12px auto;border-radius:8px;'
        : variant === 'banner' || variant === 'featured'
          ? 'display:block;width:100%;max-width:640px;height:auto;margin:12px auto;border-radius:12px;'
          : 'display:block;max-width:100%;margin:12px auto;border-radius:12px;'
    insertHtmlAtCursor(`\n<img src="cid:${escapeHtml(cleanCid)}" alt="${escapeHtml(altLabel)}" style="${style}" />\n`)
    setActionMessage(`Inserted cid:${cleanCid} at cursor.`)
  }

  function removeAllBodyImages() {
    setCurrent((prev) => ({ ...prev, htmlBody: String(prev.htmlBody ?? '').replace(/<img\b[^>]*>/gi, ''), cidAssets: [] }))
    setActionMessage('Removed all body image tags from HTML body.')
  }

  function getCidValidationIssues(campaign: Partial<Campaign>): string[] {
    const issues: string[] = []
    const usedCids = new Set<string>()
    const checkCid = (label: string, sourceType: 'url' | 'cid' | undefined, cid: string | undefined, filePath: string | undefined) => {
      if (sourceType !== 'cid') {
        return
      }
      const cleanCid = (cid ?? '').trim()
      const cleanPath = (filePath ?? '').trim()
      if (!cleanCid && !cleanPath) {
        return
      }
      if (!cleanCid || !cleanPath) {
        issues.push(`${label}: CID and local file path both are required.`)
        return
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(cleanCid)) {
        issues.push(`${label}: CID contains invalid characters.`)
      }
      const key = cleanCid.toLowerCase()
      if (usedCids.has(key)) {
        issues.push(`${label}: duplicate CID detected (${cleanCid}).`)
      } else {
        usedCids.add(key)
      }
    }

    checkCid('Logo', campaign.logoSourceType, campaign.logoCid, campaign.logoPath)
    checkCid('Banner', campaign.bannerSourceType, campaign.bannerCid, campaign.bannerPath)
    checkCid('Featured image', campaign.inlineImageSourceType, campaign.inlineImageCid, campaign.inlineImagePath)

    for (const asset of campaign.cidAssets ?? []) {
      const cleanCid = (asset.cid ?? '').trim()
      const cleanPath = (asset.filePath ?? '').trim()
      if (!cleanCid && !cleanPath) {
        continue
      }
      if (!cleanCid || !cleanPath) {
        issues.push('Additional CID asset: CID and local file path both are required.')
        continue
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(cleanCid)) {
        issues.push(`Additional CID asset: invalid CID (${cleanCid}).`)
      }
      const key = cleanCid.toLowerCase()
      if (usedCids.has(key)) {
        issues.push(`Additional CID asset: duplicate CID detected (${cleanCid}).`)
      } else {
        usedCids.add(key)
      }
    }
    return issues
  }

  function getCidHealthItems(campaign: Partial<Campaign>): Array<{ label: string; status: string; tone: 'ok' | 'warn' | 'muted' }> {
    const items: Array<{ label: string; status: string; tone: 'ok' | 'warn' | 'muted' }> = []
    const seen = new Set<string>()

    const addSlot = (label: string, sourceType: 'url' | 'cid' | undefined, cid: string | undefined, filePath: string | undefined) => {
      if (sourceType !== 'cid') {
        if ((cid ?? '').trim() || (filePath ?? '').trim()) {
          items.push({ label, status: 'Public URL mode', tone: 'muted' })
        } else {
          items.push({ label, status: 'Not set', tone: 'muted' })
        }
        return
      }

      const cleanCid = (cid ?? '').trim()
      const cleanPath = (filePath ?? '').trim()
      if (!cleanCid && !cleanPath) {
        items.push({ label, status: 'Not set', tone: 'muted' })
        return
      }
      if (!cleanCid) {
        items.push({ label, status: 'Missing CID', tone: 'warn' })
        return
      }
      if (!cleanPath) {
        items.push({ label, status: 'Missing file', tone: 'warn' })
        return
      }
      const key = cleanCid.toLowerCase()
      if (seen.has(key)) {
        items.push({ label, status: 'Duplicate CID', tone: 'warn' })
        return
      }
      seen.add(key)
      items.push({ label, status: 'CID ready', tone: 'ok' })
    }

    addSlot('Logo', campaign.logoSourceType, campaign.logoCid, campaign.logoPath)
    addSlot('Banner', campaign.bannerSourceType, campaign.bannerCid, campaign.bannerPath)
    addSlot('Featured image', campaign.inlineImageSourceType, campaign.inlineImageCid, campaign.inlineImagePath)

    for (const [index, asset] of (campaign.cidAssets ?? []).entries()) {
      const label = `Body image ${index + 1}`
      const cleanCid = (asset.cid ?? '').trim()
      const cleanPath = (asset.filePath ?? '').trim()
      if (!cleanCid && !cleanPath) {
        items.push({ label, status: 'Not set', tone: 'muted' })
        continue
      }
      if (!cleanCid) {
        items.push({ label, status: 'Missing CID', tone: 'warn' })
        continue
      }
      if (!cleanPath) {
        items.push({ label, status: 'Missing file', tone: 'warn' })
        continue
      }
      const key = cleanCid.toLowerCase()
      if (seen.has(key)) {
        items.push({ label, status: 'Duplicate CID', tone: 'warn' })
      } else {
        seen.add(key)
        items.push({ label, status: 'CID ready', tone: 'ok' })
      }
    }

    return items
  }

  function ensureCidReadyForSend(campaign: Partial<Campaign>): boolean {
    const issues = getCidValidationIssues(campaign)
    if (issues.length === 0) {
      return true
    }
    const message = `CID validation failed:\n- ${issues.join('\n- ')}`
    setActionMessage(message)
    window.alert(message)
    return false
  }

  function clearBodyCidTags(cid?: string) {
    const cleanCid = cid?.trim()
    if (!cleanCid) {
      return
    }
    const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    setCurrent((prev) => ({
      ...prev,
      htmlBody: String(prev.htmlBody ?? '').replace(new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, 'gi'), '')
    }))
  }

  function renderTemplateForPreview(content: string, campaign: Partial<Campaign>): string {
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

  function bodyContainsCidImage(bodyHtml: string, cid: string | undefined): boolean {
    const cleanCid = (cid ?? '').trim()
    if (!cleanCid) {
      return false
    }
    const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, 'i').test(bodyHtml)
  }

  function buildReceiverPreview(campaign: Partial<Campaign>): string {
    const maxWidth = previewMode === 'mobile' ? '390px' : '720px'
    const socialIconSize = [28, 32, 36].includes(Number(campaign.socialIconSize)) ? Number(campaign.socialIconSize) : 32
    const body = renderTemplateForPreview(String(campaign.htmlBody ?? emptyCampaign.htmlBody), campaign)
    const previewBody = resolvePreviewBodyCidImages(body, campaign)
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
    const logoSrc = resolveCampaignImageSrc(campaign.logoUrl, campaign.logoSourceType, campaign.logoCid)
    const logoLink = normalizeLinkUrl(campaign.logoLinkUrl)
    const bannerSrc = resolveCampaignImageSrc(campaign.bannerUrl, campaign.bannerSourceType, campaign.bannerCid)
    const bannerLink = normalizeLinkUrl(campaign.bannerLinkUrl ?? campaign.ctaUrl)
    const featuredSrc = resolveCampaignImageSrc(campaign.inlineImageUrl, campaign.inlineImageSourceType, campaign.inlineImageCid)
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

  const activeCampaign = useMemo(() => campaigns.find((entry) => entry.id === selectedCampaignId) ?? null, [campaigns, selectedCampaignId])
  const workingCampaign = useMemo(() => {
    if (!selectedCampaignId) {
      return current
    }
    return { ...(activeCampaign ?? current), ...current, id: selectedCampaignId }
  }, [activeCampaign, current, selectedCampaignId])

  function generateReceiverPreview() {
    setPreviewHtml(buildReceiverPreview(workingCampaign))
    setPreviewGeneratedAt(new Date().toLocaleString())
  }

  useEffect(() => {
    if (!previewGeneratedAt) {
      return
    }
    setPreviewHtml(buildReceiverPreview(workingCampaign))
    setPreviewGeneratedAt(new Date().toLocaleString())
  }, [workingCampaign, previewMode])

  const csvPreview = useMemo(() => parseCsvPreview(csvText), [csvText])

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    setWebhookEndpoint(deriveBackendWebhookEndpoint(DEFAULT_API_URL))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.maigun?.saveDraft) {
        void window.maigun.saveDraft(current)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [current])

  useEffect(() => {
    if (!window.maigun) return
    if (!selectedCampaignId) return
    const tick = async () => {
      const [eventRows, allEventRows, pg, selectedRecipients] = await Promise.all([
        window.maigun.listEvents(selectedCampaignId),
        window.maigun.listEvents(),
        window.maigun.getCampaignProgress(selectedCampaignId),
        window.maigun.listRecipients(selectedCampaignId)
      ])

      const selectedRecipientEmails = new Set(
        (Array.isArray(selectedRecipients) ? selectedRecipients : [])
          .map((entry: any) => normalizeEmail(entry?.email))
          .filter(Boolean)
      )

      let remoteEventRows: any[] = []
      try {
        const remote = await apiClient.getCampaignEvents(selectedCampaignId)
        remoteEventRows = Array.isArray(remote) ? remote.map(normalizeRemoteEvent) : []
        if (!hasRealWebhookEvent(remoteEventRows) && selectedRecipientEmails.size > 0) {
          const recoveredRows = await fetchRecoveredHostedEventsForRecipients(selectedRecipientEmails)
          remoteEventRows = mergeEventsUnique(remoteEventRows, recoveredRows)
        }
      } catch {
        remoteEventRows = []
      }

      const mergedSelectedEvents = mergeEventsUnique(Array.isArray(eventRows) ? eventRows : [], remoteEventRows)
      const mergedAllEvents = mergeEventsUnique(Array.isArray(allEventRows) ? allEventRows : [], remoteEventRows)

      setEvents((prev) => mergeEventsUnique(prev, mergedSelectedEvents))
      setAllEvents((prev) => mergeEventsUnique(prev, mergedAllEvents))
      setProgress(pg)
      setCampaignProgressMap((prev) => ({ ...prev, [selectedCampaignId]: pg }))
      setCampaigns((prev) => prev.map((campaign) => campaign.id === selectedCampaignId
        ? { ...campaign, status: deriveCampaignStatus(campaign.status, pg) }
        : campaign
      ))
      setCurrent((prev) => {
        if (String(prev.id ?? '') !== selectedCampaignId) {
          return prev
        }
        return { ...prev, status: deriveCampaignStatus(String(prev.status ?? ''), pg) }
      })
    }
    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 1500)
    return () => clearInterval(timer)
  }, [selectedCampaignId])

  useEffect(() => {
    wsClient.connect()

    const unsubscribe = wsClient.on('webhook:event', async (payload: any) => {
      try {
        const campaignId = String(payload?.campaignId ?? '')
        const liveSocketEvent = normalizeSocketWebhookEvent(payload)
        if (campaignId) {
          setAllEvents((prev) => mergeEventsUnique(prev, [liveSocketEvent]))
        }

        if (campaignId && campaignId === selectedCampaignId) {
          setEvents((prev) => mergeEventsUnique(prev, [liveSocketEvent]))

          const [eventRows, pg, selectedRecipients] = await Promise.all([
            window.maigun.listEvents(selectedCampaignId),
            window.maigun.getCampaignProgress(selectedCampaignId),
            window.maigun.listRecipients(selectedCampaignId)
          ])

          const selectedRecipientEmails = new Set(
            (Array.isArray(selectedRecipients) ? selectedRecipients : [])
              .map((entry: any) => normalizeEmail(entry?.email))
              .filter(Boolean)
          )

          let remoteEventRows: any[] = []
          try {
            const remote = await apiClient.getCampaignEvents(selectedCampaignId)
            remoteEventRows = Array.isArray(remote) ? remote.map(normalizeRemoteEvent) : []
            if (!hasRealWebhookEvent(remoteEventRows) && selectedRecipientEmails.size > 0) {
              const recoveredRows = await fetchRecoveredHostedEventsForRecipients(selectedRecipientEmails)
              remoteEventRows = mergeEventsUnique(remoteEventRows, recoveredRows)
            }
          } catch {
            remoteEventRows = []
          }

          setEvents((prev) => mergeEventsUnique(prev, mergeEventsUnique(Array.isArray(eventRows) ? eventRows : [], remoteEventRows)))
          setProgress(pg)
          setCampaignProgressMap((prev) => ({ ...prev, [selectedCampaignId]: pg }))
          setCampaigns((prev) => prev.map((campaign) => campaign.id === selectedCampaignId
            ? { ...campaign, status: deriveCampaignStatus(campaign.status, pg) }
            : campaign
          ))
          setCurrent((prev) => {
            if (String(prev.id ?? '') !== selectedCampaignId) {
              return prev
            }
            return { ...prev, status: deriveCampaignStatus(String(prev.status ?? ''), pg) }
          })
        }
        const allEventRows = await window.maigun.listEvents()
        setAllEvents((prev) => mergeEventsUnique(prev, Array.isArray(allEventRows) ? allEventRows : []))
      } catch {
        // polling remains as a fallback
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [selectedCampaignId])

  useEffect(() => {
    let isActive = true

    const syncAllCampaignAnalytics = async () => {
      try {
        const remoteCampaignList = await apiClient.getCampaigns()
        if (!Array.isArray(remoteCampaignList) || remoteCampaignList.length === 0 || !isActive) {
          return
        }

        const remoteEventRows = await Promise.all(remoteCampaignList.map(async (entry: any) => {
          const campaignId = String(entry?.id ?? '')
          if (!campaignId) {
            return []
          }
          try {
            const events = await apiClient.getCampaignEvents(campaignId)
            return Array.isArray(events) ? events.map(normalizeRemoteEvent) : []
          } catch {
            return []
          }
        }))

        if (!isActive) {
          return
        }

        const flatRemoteEvents = remoteEventRows.flat()
        setCampaigns((prev) => mergeCampaignLists(prev, remoteCampaignList))
        setAllEvents((prev) => {
          const merged = mergeEventsUnique(prev, flatRemoteEvents)
          if (selectedCampaignId) {
            setEvents(merged.filter((entry: any) => String(entry?.campaignId ?? '') === selectedCampaignId))
          }
          return merged
        })
      } catch {
        // periodic sync is best-effort
      }
    }

    void syncAllCampaignAnalytics()
    const timer = setInterval(() => {
      void syncAllCampaignAnalytics()
    }, 8000)

    return () => {
      isActive = false
      clearInterval(timer)
    }
  }, [selectedCampaignId])

  async function refresh() {
    try {
      if (!window.maigun) {
        setTimeout(() => {
          void refresh()
        }, 300)
        return
      }
      const [loadedCampaigns, loadedSettings, loadedDraft, loadedAllEvents] = await Promise.all([
        window.maigun.listCampaigns(),
        window.maigun.getSettings(),
        window.maigun.getDraft(),
        window.maigun.listEvents()
      ])
      const localCampaignList = Array.isArray(loadedCampaigns) ? loadedCampaigns : []
      const localEventList = Array.isArray(loadedAllEvents) ? loadedAllEvents : []

      let remoteCampaignList: any[] = []
      let remoteEventList: any[] = []
      try {
        remoteCampaignList = await apiClient.getCampaigns()
        if (Array.isArray(remoteCampaignList) && remoteCampaignList.length > 0) {
          const remoteEventRows = await Promise.all(remoteCampaignList.map(async (entry: any) => {
            const events = await apiClient.getCampaignEvents(String(entry.id))
            return Array.isArray(events) ? events.map(normalizeRemoteEvent) : []
          }))
          remoteEventList = remoteEventRows.flat()
        }
      } catch {
        remoteCampaignList = []
        remoteEventList = []
      }

      const mergedCampaigns = mergeCampaignLists(localCampaignList, remoteCampaignList)
      const mergedEvents = mergeEventsUnique(localEventList, remoteEventList)

      setCampaigns(mergedCampaigns)
      setAllEvents(mergedEvents)
      if (selectedCampaignId) {
        const selectedRecipients = await window.maigun.listRecipients(selectedCampaignId)
        const selectedRecipientEmails = new Set(
          (Array.isArray(selectedRecipients) ? selectedRecipients : [])
            .map((entry: any) => normalizeEmail(entry?.email))
            .filter(Boolean)
        )
        const selectedEvents = mergedEvents.filter((entry: any) => {
          const entryCampaignId = String(entry?.campaignId ?? '')
          if (entryCampaignId === selectedCampaignId) {
            return true
          }
          if (entryCampaignId.startsWith('recovered-')) {
            return selectedRecipientEmails.has(normalizeEmail(entry?.recipientEmail))
          }
          return false
        })
        setEvents(selectedEvents)
      }
      const progressRows = await Promise.all(mergedCampaigns.map(async (entry: any) => {
        const pg = await window.maigun.getCampaignProgress(entry.id)
        return [entry.id, pg] as const
      }))
      setCampaignProgressMap(Object.fromEntries(progressRows))
      setSettings(loadedSettings)
      if (loadedSettings.appUsername && loadedSettings.appPassword) {
        setAuthMode('login')
        setLoginUsername(loadedSettings.appUsername)
      } else {
        setAuthMode('setup')
      }
      setCurrent({ ...emptyCampaign, ...(loadedDraft ?? {}) })
      if (mergedCampaigns?.[0] && !selectedCampaignId) {
        setSelectedCampaignId(mergedCampaigns[0].id)
      }
    } catch (error) {
      setAuthError(`Unable to load configuration: ${(error as Error).message}`)
      setAuthMode('setup')
    }
  }

  function validateCampaignForm(): boolean {
    if (!current.name?.trim() || !current.subject?.trim() || !current.senderEmail?.trim()) {
      setValidationError('Campaign name, subject, and sender email are required.')
      return false
    }
    setValidationError('')
    return true
  }

  async function createCampaign() {
    if (!validateCampaignForm()) return
    const created = await window.maigun.createCampaign(current)
    setSelectedCampaignId(created.id)
    setCurrent(created)
    await window.maigun.saveDraft(created)
    setActionMessage('Campaign created successfully.')
    await refresh()
  }

  async function saveCampaign() {
    if (!selectedCampaignId || !validateCampaignForm()) return
    const toSave = { ...(activeCampaign ?? current), ...current, id: selectedCampaignId }
    await window.maigun.saveCampaign(toSave)
    await window.maigun.saveDraft(toSave)
    setActionMessage('Campaign saved.')
    await refresh()
  }

  async function duplicateCampaign(campaignId: string) {
    const duplicated = await window.maigun.duplicateCampaign(campaignId)
    setSelectedCampaignId(duplicated.id)
    setCurrent(duplicated)
    setActionMessage('Campaign duplicated.')
    await refresh()
  }

  async function deleteCampaign(campaignId: string) {
    await window.maigun.deleteCampaign(campaignId)
    if (selectedCampaignId === campaignId) {
      setSelectedCampaignId('')
    }
    setActionMessage('Campaign deleted.')
    await refresh()
  }

  async function importCsv() {
    if (!selectedCampaignId) return
    const summary = await window.maigun.importCsv(selectedCampaignId, buildMappedCsv())
    setUploadSummary(summary)
    setActionMessage('CSV imported successfully.')
    await refresh()
  }

  async function previewCsv() {
    setUploadSummary(await window.maigun.parseCsv(buildMappedCsv()))
  }

  function buildMappedCsv(): string {
    const { headers, rows } = csvPreview
    if (headers.length === 0) return csvText
    const mappedHeaders = ['email', 'name', 'offer_code', 'unsubscribe_url']
    const mappedRows = rows.map((row) => {
      const rowMap = Object.fromEntries(headers.map((header, idx) => [header, row[idx] ?? '']))
      return mappedHeaders.map((target) => rowMap[fieldMap[target] ?? ''] ?? '')
    })
    const fullRows = csvText.split(/\r?\n/).slice(1).filter((line) => line.trim() !== '')
    const transformed = fullRows.map((line) => {
      const values = line.split(',').map((entry) => entry.trim())
      const rowMap = Object.fromEntries(headers.map((header, idx) => [header, values[idx] ?? '']))
      return mappedHeaders.map((target) => rowMap[fieldMap[target] ?? ''] ?? '').join(',')
    })
    return [mappedHeaders.join(','), ...transformed].join('\n')
  }

  async function loadCsvFile(file: File) {
    const text = await file.text()
    setCsvText(text)
    setCsvFileName(file.name)
  }

  async function sendTest() {
    const candidate = testEmail.trim()
    if (!candidate) {
      setActionMessage('Please enter test email.')
      return
    }
    let campaignId = selectedCampaignId
    if (!campaignId) {
      if (!validateCampaignForm()) {
        setActionMessage('Create/select a valid campaign first (name, subject, sender).')
        return
      }
      const created = await window.maigun.createCampaign(current)
      campaignId = created.id
      setSelectedCampaignId(created.id)
      setCurrent(created)
      if (!ensureCidReadyForSend(created)) {
        return
      }
    } else {
      const candidateCampaign = workingCampaign
      if (!ensureCidReadyForSend(candidateCampaign)) {
        return
      }
    }
    const result = await window.maigun.sendTestEmail(campaignId, candidate, workingCampaign)
    if (result?.ok) {
      const nextRecent = [candidate, ...(settings.recentTestEmails ?? []).filter((email) => email.toLowerCase() !== candidate.toLowerCase())].slice(0, 5)
      const nextSettings = { ...settings, recentTestEmails: nextRecent }
      setSettings(nextSettings)
      await window.maigun.saveSettings(nextSettings)
      setActionMessage('Test email sent.')
    } else {
      setActionMessage(`Test email failed: ${result?.error ?? 'Unknown error'}`)
    }
  }

  async function sendNow() {
    if (!selectedCampaignId) return
    const candidateCampaign = workingCampaign
    if (!ensureCidReadyForSend(candidateCampaign)) {
      return
    }
    const result = await window.maigun.sendCampaign(selectedCampaignId, candidateCampaign)
    setShowConfirm(false)
    if (result?.noRecipients) {
      setActionMessage('No recipients found. Please import CSV recipients first, then send campaign.')
      return
    }
    if (result?.noDeliverableRecipients) {
      setActionMessage('All recipients are suppressed or non-deliverable. Update recipient list and try again.')
      return
    }
    if (result?.scheduled) {
      const when = activeCampaign?.scheduledAt ? new Date(activeCampaign.scheduledAt).toLocaleString() : 'selected time'
      setActionMessage(`Campaign scheduled. It will start automatically at ${when}.`)
    } else {
      setActionMessage('Campaign queued for sending now.')
    }
    await refresh()
  }

  async function pause() {
    if (!selectedCampaignId) return
    await window.maigun.pauseCampaign(selectedCampaignId)
    setActionMessage('Campaign paused.')
    await refresh()
  }

  async function resume() {
    if (!selectedCampaignId) return
    await window.maigun.resumeCampaign(selectedCampaignId)
    setActionMessage('Campaign resumed.')
    await refresh()
  }

  async function simulateWebhookEvent() {
    if (!selectedCampaignId) {
      setActionMessage('Select a campaign first to simulate webhook.')
      return
    }
    const result = await window.maigun.simulateWebhookEvent(selectedCampaignId, 'opened')
    if (!result?.ok) {
      setActionMessage('Unable to simulate webhook: no recipients found for selected campaign.')
      return
    }
    // Force a full sync so analytics cards update immediately after simulation.
    await refresh()
    const [eventRows, campaignProgress] = await Promise.all([
      window.maigun.listEvents(selectedCampaignId),
      window.maigun.getCampaignProgress(selectedCampaignId)
    ])
    setEvents(eventRows)
    setProgress(campaignProgress)
    setActionMessage(`Simulated webhook events added for ${result.recipientEmail} (delivered + ${result.eventType}).`)
  }

  function requestSendConfirmation() {
    if (!selectedCampaignId) {
      return
    }
    const candidateCampaign = workingCampaign
    if (!ensureCidReadyForSend(candidateCampaign)) {
      return
    }
    setShowConfirm(true)
  }

  function appendBlock(kind: 'text' | 'image' | 'button') {
    const text = plainContent.trim()
    let snippet = ''
    if (kind === 'text') {
      snippet = `\n<p style="text-align:center;">${escapeHtml(text || 'Write your newsletter text here.')}</p>\n`
    }
    if (kind === 'image') {
      let source = text || IMAGE_MISSING_DATA_URI
      if (text && !/^https?:\/\//i.test(text) && !/^cid:/i.test(text)) {
        if (/^[a-zA-Z0-9._-]+$/.test(text)) {
          source = `cid:${text}`
        } else {
          setActionMessage('Use a public image URL (https://...), cid:your-cid, or raw CID value for image block.')
          return
        }
      }
      const imageTag = `<img src="${escapeHtml(source)}" alt="Content image" style="display:block;max-width:100%;margin:12px auto;border-radius:12px;" />`
      const link = imageLinkUrl.trim()
      snippet = link
        ? `\n<a href="${escapeHtml(link)}" style="display:block;text-decoration:none;">${imageTag}</a>\n`
        : `\n${imageTag}\n`
    }
    if (kind === 'button') {
      const label = escapeHtml(text || 'Read more')
      snippet = `\n<p style="text-align:center;"><a href="{{cta_url}}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ba5d2e;color:#fff;text-decoration:none;">${label}</a></p>\n`
    }
    insertHtmlAtCursor(snippet)
    setActionMessage(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} block inserted at cursor.`)
  }

  function appendPlainContent() {
    if (!plainContent.trim()) {
      setActionMessage('Plain content is empty.')
      return
    }
    const escaped = escapeHtml(plainContent)
    setCurrent((prev) => {
      const body = prev.htmlBody ?? ''
      const withoutPrevious = body.replace(/<p[^>]*data-plain-content-block="1"[^>]*>[\s\S]*?<\/p>/gi, '').trim()
      return {
        ...prev,
        htmlBody: `${withoutPrevious}\n<p data-plain-content-block="1" style="text-align:center;">${escaped}</p>`
      }
    })
    setPlainContent('')
    setActionMessage('Plain content added to HTML body.')
  }

  function removeImage(field: 'logoUrl' | 'bannerUrl' | 'inlineImageUrl') {
    setCurrent((prev) => {
      if (field === 'logoUrl') {
        return { ...prev, logoUrl: '', logoPath: '', logoCid: '', logoSourceType: 'url' }
      }
      if (field === 'bannerUrl') {
        return { ...prev, bannerUrl: '', bannerPath: '', bannerCid: '', bannerLinkUrl: '', bannerSourceType: 'url' }
      }
      return { ...prev, inlineImageUrl: '', inlineImagePath: '', inlineImageCid: '', inlineImageLinkUrl: '', inlineImageSourceType: 'url' }
    })
    setActionMessage('Image removed.')
  }

  function docForTab(currentTab: typeof tab): { title: string; lines: string[] } {
    if (currentTab === 'dashboard') {
      return {
        title: 'How To Use Dashboard',
        lines: [
          'Select or create a campaign first.',
          'Use Send campaign for bulk queue, Pause/Resume to control processing.',
          'Track queued/sent/failed counters in real time.'
        ]
      }
    }
    if (currentTab === 'campaign') {
      return {
        title: 'How To Use Campaign Editor',
        lines: [
          'Fill Basic section: name, subject, sender.',
          'Use Add text/image/button or Plain content quick-add for body.',
          'Use Test Email before sending bulk campaign.'
        ]
      }
    }
    if (currentTab === 'csv') {
      return {
        title: 'How To Use CSV Upload',
        lines: [
          'Upload CSV and map required fields.',
          'Validate first, then import.',
          'Check first 5-row preview before import.'
        ]
      }
    }
    if (currentTab === 'settings') {
      return {
        title: 'How To Use Settings',
        lines: [
          'Use this page for app login credentials and sender profiles only.',
          'Backend credentials (Mailgun/webhook) are managed on Render.',
          'Click Save settings and verify success message.'
        ]
      }
    }
    return {
      title: 'How To Use Events',
      lines: [
        'View Mailgun/webhook event history for diagnostics.',
        'Use this data for delivery analysis and troubleshooting.'
      ]
    }
  }

  useEffect(() => {
    if (!previewGeneratedAt) {
      return
    }
    generateReceiverPreview()
    // Regenerate rendered view for selected device mode only after preview has been requested.
  }, [previewMode])

  const campaignPerformanceRows = useMemo(() => {
    return campaigns.map((campaign) => {
      const pg = campaignProgressMap[campaign.id] ?? { total: 0, queued: 0, sent: 0, failed: 0, suppressed: 0, inProgress: 0, percent: 0 }
      const webhookEvents = allEvents
        .filter((event) => event.campaignId === campaign.id)
        .filter((event) => event?.payload?._source === 'mailgun-webhook')
        .filter((event) => event?.payload?._simulated !== true)

      const delivered = new Set(webhookEvents.filter((event) => canonicalEventType(event.type) === 'delivered').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
      const opened = new Set(webhookEvents.filter((event) => canonicalEventType(event.type) === 'opened').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
      const clicked = new Set(webhookEvents.filter((event) => canonicalEventType(event.type) === 'clicked').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
      const bounced = new Set(webhookEvents.filter((event) => canonicalEventType(event.type) === 'bounced').map((event) => String(event.recipientEmail ?? '').toLowerCase())).size
      const base = Math.max(delivered, pg.sent)

      return {
        id: campaign.id,
        name: campaign.name,
        status: deriveCampaignStatus(campaign.status, pg),
        updatedAt: campaign.updatedAt,
        total: pg.total,
        sent: pg.sent,
        opened,
        clicked,
        bounced,
        openRate: base ? Math.min(100, Math.floor((opened / base) * 100)) : 0,
        clickRate: base ? Math.min(100, Math.floor((clicked / base) * 100)) : 0,
        bounceRate: base ? Math.min(100, Math.floor((bounced / base) * 100)) : 0
      }
    })
  }, [allEvents, campaignProgressMap, campaigns])

  const recentCampaignRows = useMemo(() => {
    return [...campaignPerformanceRows]
      .sort((left, right) => new Date(String(right.updatedAt ?? '')).getTime() - new Date(String(left.updatedAt ?? '')).getTime())
      .slice(0, 5)
  }, [campaignPerformanceRows])

  async function exportCampaignReport() {
    const result = await window.maigun.exportCampaignReport()
    if (result?.ok) {
      setActionMessage(`Campaign report saved to ${result.filePath}`)
      return
    }
    if (result?.canceled) {
      setActionMessage('Campaign report export canceled.')
      return
    }
    setActionMessage('Unable to export campaign report.')
  }

  const analytics = useMemo(() => {
    const selectedCampaignEventsFromAll = allEvents.filter((event) => String(event?.campaignId ?? '').trim() === String(selectedCampaignId ?? '').trim())
    const effectiveEvents = events.length > 0 ? events : selectedCampaignEventsFromAll

    const webhookEventsStrict = effectiveEvents.filter((event) => event?.payload?._source === 'mailgun-webhook')
    const webhookEvents = webhookEventsStrict.length > 0
      ? webhookEventsStrict
      : effectiveEvents.filter((event) => isWebhookMetricEvent(event))

    const realWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated !== true)
    const simulatedWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated === true)
    const sourceEvents = realWebhookEvents.length > 0 ? realWebhookEvents : simulatedWebhookEvents

    const deliveredRecipients = new Set(sourceEvents.filter((event) => canonicalEventType(event.type) === 'delivered').map((event) => String(event.recipientEmail ?? '').toLowerCase()))
    const openedRecipients = new Set(sourceEvents.filter((event) => canonicalEventType(event.type) === 'opened').map((event) => String(event.recipientEmail ?? '').toLowerCase()))
    const clickedRecipients = new Set(sourceEvents.filter((event) => canonicalEventType(event.type) === 'clicked').map((event) => String(event.recipientEmail ?? '').toLowerCase()))
    const bouncedRecipients = new Set(sourceEvents.filter((event) => canonicalEventType(event.type) === 'bounced').map((event) => String(event.recipientEmail ?? '').toLowerCase()))
    const delivered = Math.max(deliveredRecipients.size, progress.sent)
    const openRate = delivered ? Math.min(100, Math.floor((openedRecipients.size / delivered) * 100)) : 0
    const clickRate = delivered ? Math.min(100, Math.floor((clickedRecipients.size / delivered) * 100)) : 0
    const bounceRate = delivered ? Math.min(100, Math.floor((bouncedRecipients.size / delivered) * 100)) : 0
    return { openRate, clickRate, bounceRate }
  }, [events, allEvents, selectedCampaignId, progress.sent])

  const webhookStatus = useMemo(() => {
    const selectedCampaignEventsFromAll = allEvents.filter((event) => String(event?.campaignId ?? '').trim() === String(selectedCampaignId ?? '').trim())
    const effectiveEvents = events.length > 0 ? events : selectedCampaignEventsFromAll

    const webhookEventsStrict = effectiveEvents.filter((event) => event?.payload?._source === 'mailgun-webhook')
    const webhookEvents = webhookEventsStrict.length > 0
      ? webhookEventsStrict
      : effectiveEvents.filter((event) => isWebhookMetricEvent(event))

    const realWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated !== true)
    const simulatedWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated === true)
    const last = realWebhookEvents[0] ?? webhookEvents[0]
    return {
      receivedCount: realWebhookEvents.length,
      simulatedCount: simulatedWebhookEvents.length,
      lastAt: last?.createdAt ? new Date(last.createdAt).toLocaleString() : '',
      lastType: last?.type ? String(last.type) : '',
      lastRecipient: last?.recipientEmail ? String(last.recipientEmail) : ''
    }
  }, [events, allEvents, selectedCampaignId])

  if (!isAuthenticated && authMode === 'loading') {
    return (
      <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <section className="card" style={{ width: 460 }}>
          <h2>Loading</h2>
          <div className="muted">Checking account configuration...</div>
        </section>
      </main>
    )
  }

  if (!isAuthenticated && authMode === 'setup') {
    return (
      <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <section className="card" style={{ width: 460 }}>
          <h2>Create Admin Account</h2>
          <label>Username</label>
          <input value={setupUsername} onChange={(event) => setSetupUsername(event.target.value)} />
          <label>Password</label>
          <input type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} />
          <label>Confirm password</label>
          <input type="password" value={setupConfirmPassword} onChange={(event) => setSetupConfirmPassword(event.target.value)} />
          {authError ? <div className="danger" style={{ marginTop: 8 }}>{authError}</div> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="button" disabled={authBusy} onClick={async () => {
              if (!window.maigun?.saveSettings) {
                setAuthError('App bridge is unavailable. Please close and reopen the app.')
                return
              }
              if (!setupUsername.trim() || !setupPassword.trim()) {
                setAuthError('Username and password are required.')
                return
              }
              if (setupPassword !== setupConfirmPassword) {
                setAuthError('Passwords do not match.')
                return
              }
              setAuthBusy(true)
              try {
                const next = {
                  ...settings,
                  appUsername: setupUsername.trim(),
                  appPassword: setupPassword
                }
                const saved = await window.maigun.saveSettings(next)
                setSettings(saved)
                setLoginUsername(saved.appUsername)
                setLoginPassword('')
                setSetupPassword('')
                setSetupConfirmPassword('')
                setAuthError('Account created. Please sign in.')
                setAuthMode('login')
              } catch (error) {
                setAuthError(`Unable to create account: ${(error as Error).message}`)
              } finally {
                setAuthBusy(false)
              }
            }}>{authBusy ? 'Creating...' : 'Create account'}</button>
          </div>
        </section>
      </main>
    )
  }

  if (!isAuthenticated && authMode === 'login') {
    return (
      <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <section className="card" style={{ width: 460 }}>
          <h2>Login</h2>
          <label>Username</label>
          <input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} />
          <label>App password</label>
          <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
          {authError ? <div className="danger" style={{ marginTop: 8 }}>{authError}</div> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="button" onClick={() => {
              if (loginUsername.trim() === settings.appUsername && loginPassword === settings.appPassword) {
                setIsAuthenticated(true)
                setAuthError('')
              } else {
                setAuthError('Invalid username or password')
              }
            }}>Sign in</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">Maigun Studio</h1>
        <div className="subtitle">Safe campaign operations with local persistence.</div>
        <button className={`navButton ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`navButton ${tab === 'campaign' ? 'active' : ''}`} onClick={() => setTab('campaign')}>Campaign editor</button>
        <button className={`navButton ${tab === 'csv' ? 'active' : ''}`} onClick={() => setTab('csv')}>CSV upload</button>
        <button className={`navButton ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
        <button className={`navButton ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>Events</button>
      </aside>
      <main className="main">
        {actionMessage ? (
          <section className="card" style={{ marginBottom: 12 }}>
            <div className="pill">{actionMessage}</div>
          </section>
        ) : null}
        {showConfirm && activeCampaign ? (
          <section className="card" style={{ marginBottom: 16 }}>
            <h3>Confirm sending</h3>
            <div className="muted">Subject: {activeCampaign.subject}</div>
            <div className="muted">Sender: {activeCampaign.senderEmail}</div>
            <div className="muted">Total emails: {progress.total}</div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="button" onClick={() => void sendNow()}>Yes, send</button>
              <button className="button secondary" onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </section>
        ) : null}

        {tab === 'dashboard' && (
          <>
            <section className="hero">
              <div className="card">
                <h2>Sending progress</h2>
                <div style={{ width: '100%', background: '#eadfcb', borderRadius: 999, height: 12, overflow: 'hidden' }}>
                  <div style={{ width: `${progress.percent}%`, height: '100%', background: '#2a6f97' }} />
                </div>
                <div className="grid three" style={{ marginTop: 14 }}>
                  <div className="stat"><strong>{progress.queued}</strong><span>Queued</span></div>
                  <div className="stat"><strong>{progress.sent}</strong><span>Sent</span></div>
                  <div className="stat"><strong>{progress.failed}</strong><span>Failed</span></div>
                </div>
                <div className="row wrap" style={{ marginTop: 12 }}>
                  <button className="button" onClick={requestSendConfirmation} disabled={!selectedCampaignId}>Send campaign</button>
                  <button className="button secondary" onClick={() => void pause()} disabled={!selectedCampaignId}>Pause</button>
                  <button className="button secondary" onClick={() => void resume()} disabled={!selectedCampaignId}>Resume</button>
                </div>
              </div>
              <div className="card">
                <h3>Analytics</h3>
                <div className="grid">
                  <div className="stat"><strong>{analytics.openRate}%</strong><span>Open rate</span></div>
                  <div className="stat"><strong>{analytics.clickRate}%</strong><span>Click rate</span></div>
                  <div className="stat"><strong>{analytics.bounceRate}%</strong><span>Bounce rate</span></div>
                </div>
                <div style={{ marginTop: 12, borderTop: '1px solid #eadfcb', paddingTop: 10 }}>
                  <div className="muted" style={{ fontWeight: 700 }}>Webhook status</div>
                  {webhookStatus.receivedCount > 0 ? (
                    <>
                      <div className="muted">Last event: {webhookStatus.lastType} at {webhookStatus.lastAt}</div>
                      <div className="muted">Recipient: {webhookStatus.lastRecipient}</div>
                      <div className="muted">Total webhook events: {webhookStatus.receivedCount}</div>
                    </>
                  ) : (
                    <div className="muted">No Mailgun webhook received yet. Configure Mailgun webhook URL to this app endpoint.</div>
                  )}
                  {webhookStatus.simulatedCount > 0 ? <div className="muted">Simulated events: {webhookStatus.simulatedCount} (excluded from analytics)</div> : null}
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    <button className="button secondary" onClick={() => void simulateWebhookEvent()} disabled={!selectedCampaignId}>Simulate webhook event</button>
                    <span className="muted">Endpoint: {webhookEndpoint}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="card" style={{ marginTop: 14 }}>
              <div className="row between wrap">
                <h3 style={{ margin: 0 }}>All campaigns performance</h3>
                <button className="button secondary" onClick={() => void exportCampaignReport()}>Save full report (CSV)</button>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #eadfcb' }}>
                      <th style={{ padding: '8px 6px' }}>Campaign</th>
                      <th style={{ padding: '8px 6px' }}>Status</th>
                      <th style={{ padding: '8px 6px' }}>Total</th>
                      <th style={{ padding: '8px 6px' }}>Sent</th>
                      <th style={{ padding: '8px 6px' }}>Opened</th>
                      <th style={{ padding: '8px 6px' }}>Clicked</th>
                      <th style={{ padding: '8px 6px' }}>Bounced</th>
                      <th style={{ padding: '8px 6px' }}>Open %</th>
                      <th style={{ padding: '8px 6px' }}>Click %</th>
                      <th style={{ padding: '8px 6px' }}>Bounce %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignPerformanceRows.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #f1e8db' }}>
                        <td style={{ padding: '8px 6px' }}>{row.name}</td>
                        <td style={{ padding: '8px 6px', textTransform: 'capitalize' }}>{row.status}</td>
                        <td style={{ padding: '8px 6px' }}>{row.total}</td>
                        <td style={{ padding: '8px 6px' }}>{row.sent}</td>
                        <td style={{ padding: '8px 6px' }}>{row.opened}</td>
                        <td style={{ padding: '8px 6px' }}>{row.clicked}</td>
                        <td style={{ padding: '8px 6px' }}>{row.bounced}</td>
                        <td style={{ padding: '8px 6px' }}>{row.openRate}%</td>
                        <td style={{ padding: '8px 6px' }}>{row.clickRate}%</td>
                        <td style={{ padding: '8px 6px' }}>{row.bounceRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #eadfcb' }}>
                  <h4 style={{ margin: '0 0 12px 0' }}>Recent 5 campaigns</h4>
                  <div className="grid" style={{ gap: 10 }}>
                    {recentCampaignRows.map((row) => (
                      <div key={row.id} style={{ border: '1px solid #eadfcb', borderRadius: 12, padding: 12, background: '#fffdf9' }}>
                        <div className="row between wrap">
                          <strong>{row.name}</strong>
                          <span className="muted" style={{ textTransform: 'capitalize' }}>{row.status}</span>
                        </div>
                        <div className="muted" style={{ marginTop: 6 }}>Updated: {new Date(String(row.updatedAt ?? '')).toLocaleString()}</div>
                        <div className="row wrap" style={{ marginTop: 8, gap: 12 }}>
                          <span className="muted">Sent: {row.sent}</span>
                          <span className="muted">Opened: {row.opened}</span>
                          <span className="muted">Clicked: {row.clicked}</span>
                          <span className="muted">Bounced: {row.bounced}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            </div>
          </section>
          </>
        )}

        {tab === 'campaign' && (
          <section className="grid">
            <div className="card">
              <h2>Campaign management</h2>
              <div className="row wrap" style={{ marginBottom: 12 }}>
                {campaigns.map((campaign) => (
                  <button key={campaign.id} className={`button ${selectedCampaignId === campaign.id ? '' : 'secondary'}`} onClick={() => {
                    setSelectedCampaignId(campaign.id)
                    setCurrent(campaign)
                  }}>{campaign.name} ({campaign.status})</button>
                ))}
              </div>
              <div className="row wrap">
                <button className="button secondary" onClick={() => selectedCampaignId && void duplicateCampaign(selectedCampaignId)}>Duplicate</button>
                <button className="button secondary" onClick={() => selectedCampaignId && void deleteCampaign(selectedCampaignId)}>Delete</button>
              </div>

              <h3 style={{ marginTop: 20 }}>Basic</h3>
              <div className="grid">
                <div>
                  <label>Campaign name *</label>
                  <input value={current.name ?? ''} style={!current.name?.trim() ? { borderColor: '#b83c3c' } : undefined} onChange={(event) => setCurrent({ ...current, name: event.target.value })} />
                </div>
                <div>
                  <label>Subject *</label>
                  <input value={current.subject ?? ''} style={!current.subject?.trim() ? { borderColor: '#b83c3c' } : undefined} onChange={(event) => setCurrent({ ...current, subject: event.target.value })} />
                </div>
                <div>
                  <label>Sender *</label>
                  <select value={current.senderEmail ?? ''} style={!current.senderEmail?.trim() ? { borderColor: '#b83c3c' } : undefined} onChange={(event) => setCurrent({ ...current, senderEmail: event.target.value })}>
                    <option value="">Select sender</option>
                    {settings.senderEmails.map((sender) => <option key={sender} value={sender}>{sender}</option>)}
                  </select>
                </div>
                <div>
                  <label>Reply-to</label>
                  <input value={current.replyToEmail ?? ''} onChange={(event) => setCurrent({ ...current, replyToEmail: event.target.value })} />
                </div>
                <div>
                  <label>Send later (optional)</label>
                  <input type="datetime-local" value={current.scheduledAt ?? ''} onChange={(event) => setCurrent({ ...current, scheduledAt: event.target.value })} />
                  <div className="muted" style={{ marginTop: 6 }}>If this time is in the future, clicking Send campaign will schedule it and auto-start at that time.</div>
                </div>
                <div>
                  <label>Newsletter edition</label>
                  <input value={current.newsletterEdition ?? ''} onChange={(event) => setCurrent({ ...current, isNewsletter: Boolean(event.target.value), newsletterEdition: event.target.value })} />
                </div>
              </div>

              <h3 style={{ marginTop: 20 }}>Content</h3>
              <div className="row wrap" style={{ marginBottom: 8 }}>
                <button className="button secondary" onClick={() => appendBlock('text')}>Insert text block from input</button>
                <button className="button secondary" onClick={() => appendBlock('image')}>Insert image block from input</button>
                <button className="button secondary" onClick={() => appendBlock('button')}>Insert button block from input</button>
                <button className="button secondary" onClick={() => setCurrent((prev) => ({ ...prev, htmlBody: `${prev.htmlBody ?? ''}\n<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>` }))}>Add unsubscribe link</button>
              </div>
              <div className="row wrap" style={{ marginBottom: 8 }}>
                <input placeholder="Type text/button label/image URL or CID, then click an insert button" value={plainContent} onChange={(event) => setPlainContent(event.target.value)} />
                <button className="button secondary" onClick={appendPlainContent}>Add plain content</button>
              </div>
              <div className="row wrap" style={{ marginBottom: 8 }}>
                <input placeholder="Optional image link URL (used for Insert image block)" value={imageLinkUrl} onChange={(event) => setImageLinkUrl(event.target.value)} />
              </div>
              <div className="muted" style={{ marginBottom: 8 }}>
                For image insert: paste `https://...`, `cid:your-cid`, or raw CID like `your-cid`. Add optional image link URL to make inserted body image clickable.
              </div>
              <label>HTML body</label>
              <textarea ref={htmlBodyRef} value={current.htmlBody ?? ''} onChange={(event) => setCurrent({ ...current, htmlBody: event.target.value })} />
              <div className="muted" style={{ marginTop: 6 }}>Place cursor in HTML body, then use insert buttons or choose a CID image for inline delivery.</div>
              <label>Text fallback</label>
              <textarea value={current.textBody ?? ''} onChange={(event) => setCurrent({ ...current, textBody: event.target.value })} />

              <h3 style={{ marginTop: 20 }}>Advanced footer</h3>
              <div className="grid">
                <div><label>Header company name</label><input value={current.headerCompanyName ?? ''} onChange={(event) => setCurrent({ ...current, headerCompanyName: event.target.value })} /></div>
                <div><label>Footer company name</label><input value={current.footerCompanyName ?? ''} onChange={(event) => setCurrent({ ...current, footerCompanyName: event.target.value })} /></div>
                <div><label>Company name</label><input value={current.companyName ?? ''} onChange={(event) => setCurrent({ ...current, companyName: event.target.value, headerCompanyName: event.target.value, footerCompanyName: event.target.value })} /></div>
                <div><label>Company address</label><input value={current.companyAddress ?? ''} onChange={(event) => setCurrent({ ...current, companyAddress: event.target.value })} /></div>
                <div><label>Company contact</label><input value={current.companyContact ?? ''} onChange={(event) => setCurrent({ ...current, companyContact: event.target.value })} /></div>
                <div><label>Contact number</label><input value={current.contactNumber ?? ''} onChange={(event) => setCurrent({ ...current, contactNumber: event.target.value })} /></div>
                <div><label>Facebook URL</label><input value={current.facebookUrl ?? ''} onChange={(event) => setCurrent({ ...current, facebookUrl: event.target.value })} /></div>
                <div><label>Instagram URL</label><input value={current.instagramUrl ?? ''} onChange={(event) => setCurrent({ ...current, instagramUrl: event.target.value })} /></div>
                <div><label>X URL</label><input value={current.xUrl ?? ''} onChange={(event) => setCurrent({ ...current, xUrl: event.target.value })} /></div>
                <div><label>LinkedIn URL</label><input value={current.linkedinUrl ?? ''} onChange={(event) => setCurrent({ ...current, linkedinUrl: event.target.value })} /></div>
                <div><label>WhatsApp URL</label><input value={current.whatsappUrl ?? ''} onChange={(event) => setCurrent({ ...current, whatsappUrl: event.target.value })} /></div>
                <div><label>YouTube URL</label><input value={current.youtubeUrl ?? ''} onChange={(event) => setCurrent({ ...current, youtubeUrl: event.target.value })} /></div>
                <div>
                  <label>Social icon size</label>
                  <select value={String(current.socialIconSize ?? 32)} onChange={(event) => setCurrent({ ...current, socialIconSize: Number(event.target.value) as 28 | 32 | 36 })}>
                    <option value="28">28 px</option>
                    <option value="32">32 px</option>
                    <option value="36">36 px</option>
                  </select>
                </div>
              </div>

              <h3 style={{ marginTop: 20 }}>Image Delivery and CID</h3>
              <div className="muted" style={{ marginBottom: 8 }}>
                Use Generate or Pick file, then Copy or Insert tag directly into HTML body.
              </div>
              <div className="grid">
                <div>
                  <label>Logo source</label>
                  <select value={current.logoSourceType ?? 'url'} onChange={(event) => setImageSourceType('logo', event.target.value as 'url' | 'cid')}>
                    <option value="url">Public URL</option>
                    <option value="cid">Mailgun CID inline</option>
                  </select>
                </div>
                <div>
                  <label>Banner source</label>
                  <select value={current.bannerSourceType ?? 'url'} onChange={(event) => setImageSourceType('banner', event.target.value as 'url' | 'cid')}>
                    <option value="url">Public URL</option>
                    <option value="cid">Mailgun CID inline</option>
                  </select>
                </div>
                <div>
                  <label>Featured body image source</label>
                  <select value={current.inlineImageSourceType ?? 'url'} onChange={(event) => setImageSourceType('inlineImage', event.target.value as 'url' | 'cid')}>
                    <option value="url">Public URL</option>
                    <option value="cid">Mailgun CID inline</option>
                  </select>
                </div>
              </div>

              {(current.logoSourceType ?? 'url') === 'cid' ? (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div>
                    <label>Logo CID</label>
                    <input value={current.logoCid ?? ''} onChange={(event) => setCurrent({ ...current, logoCid: event.target.value })} placeholder="logo-main" />
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <button className="button secondary" onClick={() => setCurrent((prev) => ({ ...prev, logoCid: newCid('logo') }))}>Generate CID</button>
                      {current.logoCid ? <button className="button secondary" onClick={() => void navigator.clipboard.writeText(current.logoCid ?? '')}>Copy CID</button> : null}
                      {current.logoCid ? <button className="button secondary" onClick={() => insertCidTag(current.logoCid ?? '', 'Logo', 'logo')}>Insert tag</button> : null}
                    </div>
                  </div>
                  <div><label>Logo local file</label><input value={current.logoPath ?? ''} readOnly placeholder="Select local logo file" /></div>
                  <div><label>Logo click URL</label><input value={current.logoLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, logoLinkUrl: event.target.value })} placeholder="https://company.com" /></div>
                  <div style={{ alignSelf: 'end' }}><button className="button secondary" onClick={() => void pickCidImage('logo')}>Pick logo file</button></div>
                </div>
              ) : (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div><label>Logo public URL</label><input value={current.logoUrl ?? ''} onChange={(event) => setCurrent({ ...current, logoSourceType: 'url', logoUrl: event.target.value })} placeholder="https://cdn.example.com/logo.png" /></div>
                  <div><label>Logo click URL</label><input value={current.logoLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, logoLinkUrl: event.target.value })} placeholder="https://company.com" /></div>
                </div>
              )}
              {(current.bannerSourceType ?? 'url') === 'cid' ? (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div>
                    <label>Banner CID</label>
                    <input value={current.bannerCid ?? ''} onChange={(event) => setCurrent({ ...current, bannerCid: event.target.value })} placeholder="banner-main" />
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <button className="button secondary" onClick={() => setCurrent((prev) => ({ ...prev, bannerCid: newCid('banner') }))}>Generate CID</button>
                      {current.bannerCid ? <button className="button secondary" onClick={() => void navigator.clipboard.writeText(current.bannerCid ?? '')}>Copy CID</button> : null}
                      {current.bannerCid ? <button className="button secondary" onClick={() => insertCidTag(current.bannerCid ?? '', 'Banner', 'banner')}>Insert tag</button> : null}
                    </div>
                  </div>
                  <div><label>Banner local file</label><input value={current.bannerPath ?? ''} readOnly placeholder="Select local banner file" /></div>
                  <div><label>Banner click URL</label><input value={current.bannerLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, bannerLinkUrl: event.target.value })} placeholder="https://example.com/offer" /></div>
                  <div style={{ alignSelf: 'end' }}><button className="button secondary" onClick={() => void pickCidImage('banner')}>Pick banner file</button></div>
                </div>
              ) : (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div><label>Banner public URL</label><input value={current.bannerUrl ?? ''} onChange={(event) => setCurrent({ ...current, bannerSourceType: 'url', bannerUrl: event.target.value })} placeholder="https://cdn.example.com/banner.jpg" /></div>
                  <div><label>Banner click URL</label><input value={current.bannerLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, bannerLinkUrl: event.target.value })} placeholder="https://example.com/offer" /></div>
                </div>
              )}
              {(current.inlineImageSourceType ?? 'url') === 'cid' ? (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div>
                    <label>Featured image CID</label>
                    <input value={current.inlineImageCid ?? ''} onChange={(event) => setCurrent({ ...current, inlineImageCid: event.target.value })} placeholder="featured-body" />
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <button className="button secondary" onClick={() => setCurrent((prev) => ({ ...prev, inlineImageCid: newCid('featured') }))}>Generate CID</button>
                      {current.inlineImageCid ? <button className="button secondary" onClick={() => void navigator.clipboard.writeText(current.inlineImageCid ?? '')}>Copy CID</button> : null}
                      {current.inlineImageCid ? <button className="button secondary" onClick={() => insertCidTag(current.inlineImageCid ?? '', 'Featured image', 'featured')}>Insert tag</button> : null}
                    </div>
                  </div>
                  <div><label>Featured image local file</label><input value={current.inlineImagePath ?? ''} readOnly placeholder="Select local featured image file" /></div>
                  <div><label>Featured image click URL</label><input value={current.inlineImageLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, inlineImageLinkUrl: event.target.value })} placeholder="https://example.com/featured" /></div>
                  <div style={{ alignSelf: 'end' }}><button className="button secondary" onClick={() => void pickCidImage('inlineImage')}>Pick featured image file</button></div>
                </div>
              ) : (
                <div className="grid" style={{ marginTop: 8 }}>
                  <div><label>Featured image public URL</label><input value={current.inlineImageUrl ?? ''} onChange={(event) => setCurrent({ ...current, inlineImageSourceType: 'url', inlineImageUrl: event.target.value })} placeholder="https://cdn.example.com/hero.jpg" /></div>
                  <div><label>Featured image click URL</label><input value={current.inlineImageLinkUrl ?? ''} onChange={(event) => setCurrent({ ...current, inlineImageLinkUrl: event.target.value })} placeholder="https://example.com/featured" /></div>
                </div>
              )}

              <h4 style={{ marginTop: 14 }}>Additional CID body images (multiple)</h4>
              <div className="row wrap">
                <button className="button secondary" onClick={() => void addBodyCidImageAsset()}>Add body CID image</button>
                <button className="button secondary" onClick={removeAllBodyImages}>Remove all body images</button>
              </div>
              {(current.cidAssets ?? []).length > 0 ? (
                <div className="grid" style={{ marginTop: 8 }}>
                  {(current.cidAssets ?? []).map((asset) => (
                    <div key={asset.cid} className="row wrap" style={{ border: '1px solid #e5d9c7', borderRadius: 10, padding: 8 }}>
                      <span className="muted">{asset.fileName} • cid:{asset.cid}</span>
                      <button className="button secondary" onClick={() => insertCidTag(asset.cid)}>Insert tag</button>
                      <button className="button secondary" onClick={() => void navigator.clipboard.writeText(asset.cid)}>Copy CID</button>
                      <button className="button secondary" onClick={() => removeBodyCidAsset(asset.cid)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div style={{ marginTop: 14, border: '1px solid #e5d9c7', borderRadius: 12, padding: 12, background: '#fbf7f0' }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>CID health</h4>
                  <span className="muted">{getCidValidationIssues(workingCampaign).length === 0 ? 'Ready to send' : 'Needs attention'}</span>
                </div>
                <div className="grid" style={{ gap: 8 }}>
                  {getCidHealthItems(workingCampaign).map((item) => (
                    <div key={`${item.label}-${item.status}`} className="row between" style={{ borderTop: '1px solid #eee3d4', paddingTop: 8 }}>
                      <span>{item.label}</span>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: '4px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          background: item.tone === 'ok' ? '#e6f5ea' : item.tone === 'warn' ? '#fff0e0' : '#eef1f4',
                          color: item.tone === 'ok' ? '#176b2c' : item.tone === 'warn' ? '#9c4b00' : '#4d5560'
                        }}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="row wrap" style={{ marginTop: 12 }}>
                <button className="button" onClick={() => void createCampaign()}>Create campaign</button>
                <button className="button secondary" onClick={() => void saveCampaign()}>Save campaign</button>
                {(current.logoUrl || current.logoPath || current.logoCid) ? <button className="button secondary" onClick={() => removeImage('logoUrl')}>Remove logo</button> : null}
                {(current.bannerUrl || current.bannerPath || current.bannerCid) ? <button className="button secondary" onClick={() => removeImage('bannerUrl')}>Remove banner</button> : null}
                {(current.inlineImageUrl || current.inlineImagePath || current.inlineImageCid) ? <button className="button secondary" onClick={() => removeImage('inlineImageUrl')}>Remove featured body image</button> : null}
              </div>
              {validationError ? <div className="danger" style={{ marginTop: 8 }}>{validationError}</div> : null}

              <div className="row wrap" style={{ marginTop: 12 }}>
                <input placeholder="test@example.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} />
                <button className="button secondary" onClick={() => void sendTest()}>Send Test Email</button>
              </div>
              {(settings.recentTestEmails ?? []).length > 0 ? (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {(settings.recentTestEmails ?? []).map((email) => (
                    <button key={email} className="button secondary" onClick={() => setTestEmail(email)}>{email}</button>
                  ))}
                </div>
              ) : null}

            </div>

            <div className="card">
              <h3>Receiver POV Preview</h3>
              <div className="row wrap" style={{ marginBottom: 10 }}>
                <button className={`button ${previewMode === 'desktop' ? '' : 'secondary'}`} onClick={() => setPreviewMode('desktop')}>Desktop</button>
                <button className={`button ${previewMode === 'mobile' ? '' : 'secondary'}`} onClick={() => setPreviewMode('mobile')}>Mobile</button>
                <button className="button" onClick={generateReceiverPreview}>Generate preview</button>
              </div>
              {previewGeneratedAt ? <div className="muted" style={{ marginBottom: 8 }}>Generated: {previewGeneratedAt}</div> : <div className="muted" style={{ marginBottom: 8 }}>Click Generate preview to see exactly how receiver will view this email.</div>}
              <div className="preview"><iframe title="preview" srcDoc={previewHtml || '<div style="padding:20px;font-family:Arial,sans-serif;color:#555;">No preview generated yet.</div>'} /></div>
            </div>
            <div className="card">
              <h3>{docForTab('campaign').title}</h3>
              {docForTab('campaign').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
            </div>
          </section>
        )}

        {tab === 'csv' && (
          <section className="grid">
            <div className="card">
              <h2>CSV mapping and preview</h2>
              <input type="file" accept=".csv,text/csv" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void loadCsvFile(file)
              }} />
              <div className="muted" style={{ marginTop: 8 }}>{csvFileName ? `Loaded ${csvFileName}` : 'No file selected'}</div>
              <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} style={{ minHeight: 240 }} />

              <div className="grid" style={{ marginTop: 10 }}>
                {['email', 'name', 'offer_code', 'unsubscribe_url'].map((target) => (
                  <div key={target}>
                    <label>Map {target}</label>
                    <select value={fieldMap[target] ?? ''} onChange={(event) => setFieldMap({ ...fieldMap, [target]: event.target.value })}>
                      <option value="">None</option>
                      {csvPreview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="row wrap" style={{ marginTop: 12 }}>
                <button className="button secondary" onClick={() => void previewCsv()}>Validate</button>
                <button className="button" onClick={() => void importCsv()}>Import</button>
              </div>
            </div>

            <div className="card">
              <h3>First 5 rows</h3>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(csvPreview.rows, null, 2)}</pre>
              {uploadSummary ? (
                <>
                  <h3>Validation summary</h3>
                  <div className="grid three">
                    <div className="stat"><strong>{uploadSummary.validCount}</strong><span>Valid</span></div>
                    <div className="stat"><strong>{uploadSummary.invalidCount}</strong><span>Invalid</span></div>
                    <div className="stat"><strong>{uploadSummary.duplicateCount}</strong><span>Duplicates</span></div>
                  </div>
                </>
              ) : null}
            </div>
            <div className="card">
              <h3>{docForTab('csv').title}</h3>
              {docForTab('csv').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <section className="card">
            <h2>Settings</h2>
            <div className="grid">
              <div><label>App username</label><input value={settings.appUsername} onChange={(event) => setSettings({ ...settings, appUsername: event.target.value })} /></div>
              <div><label>App password</label><input type="password" value={settings.appPassword} onChange={(event) => setSettings({ ...settings, appPassword: event.target.value })} /></div>
              <div>
                <label>Add sender profile</label>
                <div className="row">
                  <input value={newSender} onChange={(event) => setNewSender(event.target.value)} placeholder="sales@domain.com" />
                  <button className="button secondary" onClick={() => {
                    const candidate = newSender.trim()
                    if (!candidate) {
                      setActionMessage('Please enter a sender email first.')
                      return
                    }
                    if (!settings.senderEmails.includes(candidate)) {
                      setSettings({ ...settings, senderEmails: [...settings.senderEmails, candidate] })
                      setActionMessage(`Sender added: ${candidate}`)
                    } else {
                      setActionMessage('Sender already exists.')
                    }
                    setNewSender('')
                  }}>Add</button>
                </div>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {settings.senderEmails.map((sender) => (
                    <button key={sender} className="button secondary" onClick={() => {
                      setSettings({ ...settings, senderEmails: settings.senderEmails.filter((item) => item !== sender) })
                      setActionMessage(`Sender removed: ${sender}`)
                    }}>{sender} x</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Hosted backend mode</h3>
              <div className="muted" style={{ marginBottom: 8 }}>Mailgun, webhook, and provider credentials are managed on the backend service (Render).</div>
              <div className="muted">Frontend only needs login fields and sender profile convenience values.</div>
            </div>
            <div className="row wrap" style={{ marginTop: 12 }}>
              <button className="button" onClick={async () => {
                const saved = await window.maigun.saveSettings(settings)
                setSettings(saved)
                setActionMessage('Settings saved successfully.')
              }}>Save settings</button>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>{docForTab('settings').title}</h3>
              {docForTab('settings').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
            </div>
          </section>
        )}

        {tab === 'events' && (
          <section className="card">
            <h2>Events</h2>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(events, null, 2)}</pre>
            <div className="card" style={{ marginTop: 12 }}>
              <h3>{docForTab('events').title}</h3>
              {docForTab('events').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
            </div>
          </section>
        )}

        {tab === 'dashboard' ? (
          <section className="card" style={{ marginTop: 12 }}>
            <h3>{docForTab('dashboard').title}</h3>
            {docForTab('dashboard').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
          </section>
        ) : null}
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
