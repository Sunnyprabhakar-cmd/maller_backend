import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { apiClient } from './api-client'
import { wsClient } from './ws-client'
import { CsvPanel } from './CsvPanel'
import { CampaignActionsPanel } from './CampaignActionsPanel'
import { SettingsPanel } from './SettingsPanel'
import { PreviewPanel } from './PreviewPanel'
import { AuthGate } from './AuthGate'
import { parseCsvPreview, buildMappedCsv as mapCsvText } from './csv-utils'
import { buildReceiverPreview } from './preview-utils'
import {
  buildRecipientEmailSet,
  canonicalEventType,
  fetchCampaignProgressMap,
  fetchRecoveredHostedEventsForRecipients,
  fetchRemoteCampaignEvents,
  hasRealWebhookEvent,
  isWebhookMetricEvent,
  mergeCampaignLists,
  mergeEventsUnique,
  normalizeEmail,
  normalizeRemoteEvent,
  normalizeSocketWebhookEvent
} from './dashboard-sync'
import {
  syncCampaignToHosted,
  syncRecipientsToHosted,
  ensureHostedCampaignReady
} from './hosted-sync'
import type {
  Campaign,
  CampaignEvent,
  HostedSendResult,
  LocalSendResult,
  Progress,
  Settings,
  SocialIconUrls,
  SocketWebhookPayload,
  UploadSummary
} from './types'
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
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null)
  const [csvText, setCsvText] = useState('email,name,offer_code,unsubscribe_url\nuser@example.com,User,ABC123,https://example.com/unsub')
  const [events, setEvents] = useState<CampaignEvent[]>([])
  const [allEvents, setAllEvents] = useState<CampaignEvent[]>([])
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
  const [socialIconUrls, setSocialIconUrls] = useState<SocialIconUrls>(DEFAULT_SOCIAL_ICON_URLS)
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

  const activeCampaign = useMemo(() => campaigns.find((entry) => entry.id === selectedCampaignId) ?? null, [campaigns, selectedCampaignId])
  const workingCampaign = useMemo(() => {
    if (!selectedCampaignId) {
      return current
    }
    return { ...(activeCampaign ?? current), ...current, id: selectedCampaignId }
  }, [activeCampaign, current, selectedCampaignId])

  function generateReceiverPreview() {
    setPreviewHtml(buildReceiverPreview({
      campaign: workingCampaign,
      previewMode,
      socialIconUrls,
      emptyHtmlBody: emptyCampaign.htmlBody,
      imageMissingDataUri: IMAGE_MISSING_DATA_URI,
      cidImageMissingDataUri: CID_IMAGE_MISSING_DATA_URI
    }))
    setPreviewGeneratedAt(new Date().toLocaleString())
  }

  useEffect(() => {
    if (!previewGeneratedAt) {
      return
    }
    setPreviewHtml(buildReceiverPreview({
      campaign: workingCampaign,
      previewMode,
      socialIconUrls,
      emptyHtmlBody: emptyCampaign.htmlBody,
      imageMissingDataUri: IMAGE_MISSING_DATA_URI,
      cidImageMissingDataUri: CID_IMAGE_MISSING_DATA_URI
    }))
    setPreviewGeneratedAt(new Date().toLocaleString())
  }, [workingCampaign, previewMode, socialIconUrls])

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
          .map((entry) => normalizeEmail(entry?.email))
          .filter(Boolean)
      )

      let remoteEventRows: CampaignEvent[] = []
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

    const unsubscribe = wsClient.on('webhook:event', async (payload) => {
      try {
        const livePayload = (payload ?? {}) as SocketWebhookPayload
        const campaignId = String(livePayload.campaignId ?? '')
        const liveSocketEvent = normalizeSocketWebhookEvent(livePayload)
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

          const selectedRecipientEmails = buildRecipientEmailSet(Array.isArray(selectedRecipients) ? selectedRecipients : [])

          let remoteEventRows: CampaignEvent[] = []
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

        const flatRemoteEvents = await fetchRemoteCampaignEvents(remoteCampaignList)

        if (!isActive) {
          return
        }

        setCampaigns((prev) => mergeCampaignLists(prev, remoteCampaignList))
        setAllEvents((prev) => {
          const merged = mergeEventsUnique(prev, flatRemoteEvents)
          if (selectedCampaignId) {
            setEvents(merged.filter((entry) => String(entry?.campaignId ?? '') === selectedCampaignId))
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

      let remoteCampaignList: Array<Partial<Campaign>> = []
      let remoteEventList: CampaignEvent[] = []
      try {
        remoteCampaignList = await apiClient.getCampaigns()
        if (Array.isArray(remoteCampaignList) && remoteCampaignList.length > 0) {
          remoteEventList = await fetchRemoteCampaignEvents(remoteCampaignList)
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
        const selectedRecipientEmails = buildRecipientEmailSet(Array.isArray(selectedRecipients) ? selectedRecipients : [])
        const selectedEvents = mergedEvents.filter((entry) => {
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
      setCampaignProgressMap(await fetchCampaignProgressMap(mergedCampaigns))
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
    const hostedSync = await syncCampaignToHosted(created)
    setActionMessage(hostedSync.ok ? 'Campaign created successfully.' : `Campaign created locally. Hosted sync failed: ${hostedSync.error}`)
    await refresh()
  }

  async function saveCampaign() {
    if (!selectedCampaignId || !validateCampaignForm()) return
    const toSave = { ...(activeCampaign ?? current), ...current, id: selectedCampaignId }
    await window.maigun.saveCampaign(toSave)
    await window.maigun.saveDraft(toSave)
    const hostedSync = await syncCampaignToHosted(toSave)
    setActionMessage(hostedSync.ok ? 'Campaign saved.' : `Campaign saved locally. Hosted sync failed: ${hostedSync.error}`)
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
    const campaignForSync = { ...(activeCampaign ?? current), ...current, id: selectedCampaignId }
    const hostedCampaignSync = await syncCampaignToHosted(campaignForSync)
    if (!hostedCampaignSync.ok) {
      setActionMessage(`CSV imported locally. Hosted campaign sync failed: ${hostedCampaignSync.error}`)
      await refresh()
      return
    }

    const hostedRecipientSync = await syncRecipientsToHosted(selectedCampaignId, Array.isArray(summary?.rows) ? summary.rows : [])
    setActionMessage(hostedRecipientSync.ok ? 'CSV imported successfully.' : `CSV imported locally. Hosted recipient sync failed: ${hostedRecipientSync.error}`)
    await refresh()
  }

  async function previewCsv() {
    setUploadSummary(await window.maigun.parseCsv(buildMappedCsv()))
  }

  function buildMappedCsv(): string {
    return mapCsvText(csvText, fieldMap)
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
    const hostedCampaign = { ...(workingCampaign ?? current), id: campaignId }
    const hostedReady = await ensureHostedCampaignReady(hostedCampaign, false)
    let sentViaHosted = false
    let hostedError = ''
    let result: LocalSendResult | HostedSendResult | null = null

    if (hostedReady.ok) {
      try {
        result = await apiClient.sendTestEmail(campaignId, candidate)
        sentViaHosted = Boolean(result?.sent)
      } catch (error) {
        hostedError = (error as Error)?.message || 'Unknown hosted send-test error'
      }
    } else {
      hostedError = hostedReady.error
    }

    if (!sentViaHosted) {
      result = await window.maigun.sendTestEmail(campaignId, candidate, workingCampaign)
    }

    if (result?.ok || result?.sent) {
      const nextRecent = [candidate, ...(settings.recentTestEmails ?? []).filter((email) => email.toLowerCase() !== candidate.toLowerCase())].slice(0, 5)
      const nextSettings = { ...settings, recentTestEmails: nextRecent }
      setSettings(nextSettings)
      await window.maigun.saveSettings(nextSettings)
      setActionMessage(sentViaHosted ? 'Test email sent via hosted backend.' : hostedError ? `Test email sent locally. Hosted send failed: ${hostedError}` : 'Test email sent locally.')
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
    const hostedReady = await ensureHostedCampaignReady(candidateCampaign, true)
    let sentViaHosted = false
    let hostedError = ''
    let result: LocalSendResult | HostedSendResult | null = null

    if (hostedReady.ok) {
      try {
        result = await apiClient.sendCampaign(selectedCampaignId)
        sentViaHosted = typeof result?.total === 'number'
      } catch (error) {
        hostedError = (error as Error)?.message || 'Unknown hosted send error'
      }
    } else {
      hostedError = hostedReady.error
    }

    if (!sentViaHosted) {
      result = await window.maigun.sendCampaign(selectedCampaignId, candidateCampaign)
    }

    setShowConfirm(false)
    if (!sentViaHosted && result?.noRecipients) {
      setActionMessage('No recipients found. Please import CSV recipients first, then send campaign.')
      return
    }
    if (!sentViaHosted && result?.noDeliverableRecipients) {
      setActionMessage('All recipients are suppressed or non-deliverable. Update recipient list and try again.')
      return
    }
    if (!sentViaHosted && result?.scheduled) {
      const when = activeCampaign?.scheduledAt ? new Date(activeCampaign.scheduledAt).toLocaleString() : 'selected time'
      setActionMessage(`Campaign scheduled. It will start automatically at ${when}.`)
    } else if (sentViaHosted) {
      setActionMessage(`Campaign sent via hosted backend. Sent ${result?.sent ?? 0} of ${result?.total ?? 0} recipients${result?.failed ? `, ${result.failed} failed` : ''}.`)
    } else {
      setActionMessage(hostedError ? `Campaign queued locally. Hosted send failed: ${hostedError}` : 'Campaign queued for sending now.')
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

  if (!isAuthenticated) {
    return (
      <AuthGate
        mode={authMode}
        authError={authError}
        authBusy={authBusy}
        setupUsername={setupUsername}
        setSetupUsername={setSetupUsername}
        setupPassword={setupPassword}
        setSetupPassword={setSetupPassword}
        setupConfirmPassword={setupConfirmPassword}
        setSetupConfirmPassword={setSetupConfirmPassword}
        loginUsername={loginUsername}
        setLoginUsername={setLoginUsername}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        onCreateAccount={async () => {
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
        }}
        onSignIn={() => {
          if (loginUsername.trim() === settings.appUsername && loginPassword === settings.appPassword) {
            setIsAuthenticated(true)
            setAuthError('')
          } else {
            setAuthError('Invalid username or password')
          }
        }}
      />
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

              <CampaignActionsPanel
                current={current}
                validationError={validationError}
                createCampaign={createCampaign}
                saveCampaign={saveCampaign}
                removeImage={removeImage}
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                sendTest={sendTest}
                recentTestEmails={settings.recentTestEmails ?? []}
              />

            </div>

            <PreviewPanel
              previewMode={previewMode}
              setPreviewMode={setPreviewMode}
              generateReceiverPreview={generateReceiverPreview}
              previewGeneratedAt={previewGeneratedAt}
              previewHtml={previewHtml}
            />
            <div className="card">
              <h3>{docForTab('campaign').title}</h3>
              {docForTab('campaign').lines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
            </div>
          </section>
        )}

        {tab === 'csv' && (
          <CsvPanel
            csvFileName={csvFileName}
            csvText={csvText}
            setCsvText={setCsvText}
            loadCsvFile={loadCsvFile}
            fieldMap={fieldMap}
            setFieldMap={setFieldMap}
            csvPreview={csvPreview}
            previewCsv={previewCsv}
            importCsv={importCsv}
            uploadSummary={uploadSummary}
            docTitle={docForTab('csv').title}
            docLines={docForTab('csv').lines}
          />
        )}

        {tab === 'settings' && (
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            newSender={newSender}
            setNewSender={setNewSender}
            setActionMessage={setActionMessage}
            saveSettings={async () => {
              const saved = await window.maigun.saveSettings(settings)
              setSettings(saved)
              setActionMessage('Settings saved successfully.')
            }}
            docTitle={docForTab('settings').title}
            docLines={docForTab('settings').lines}
          />
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
