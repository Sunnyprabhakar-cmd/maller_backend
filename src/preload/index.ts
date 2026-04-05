import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, Campaign, DeliveryEvent, EmailRecipient, UploadSummary } from '../main/types'
import type { LocalImagePickResult, Progress, SocialIconUrls } from '../renderer/src/types'

type QueueSendResult =
  | { queued: true }
  | { queued: false; noRecipients: true }
  | { queued: false; noDeliverableRecipients: true }
  | { queued: false; scheduled: true }

type QueueActionResult = { paused: true } | { resumed: true }

type ReportExportResult =
  | { ok: true; filePath: string }
  | { ok: false; canceled: true }

type SimulatedWebhookResult = {
  ok: true
  campaignId: string
  recipientEmail: string
  eventType: string
}

type CsvPickResult =
  | { canceled: true }
  | { canceled: false; filePath: string }

const api = {
  getState: () => ipcRenderer.invoke('app:get-state') as Promise<unknown>,
  createCampaign: (input: Partial<Campaign>) => ipcRenderer.invoke('campaign:create', input) as Promise<Campaign>,
  saveCampaign: (campaign: Campaign) => ipcRenderer.invoke('campaign:save', campaign) as Promise<Campaign>,
  listCampaigns: () => ipcRenderer.invoke('campaign:list') as Promise<Campaign[]>,
  deleteCampaign: (campaignId: string) => ipcRenderer.invoke('campaign:delete', campaignId) as Promise<{ ok: true }>,
  duplicateCampaign: (campaignId: string) => ipcRenderer.invoke('campaign:duplicate', campaignId) as Promise<Campaign>,
  getDraft: () => ipcRenderer.invoke('draft:get') as Promise<Partial<Campaign>>,
  saveDraft: (draft: Partial<Campaign>) => ipcRenderer.invoke('draft:save', draft) as Promise<Partial<Campaign>>,
  parseCsv: (csvText: string) => ipcRenderer.invoke('csv:parse', csvText) as Promise<UploadSummary>,
  importCsv: (campaignId: string, csvText: string) => ipcRenderer.invoke('csv:import', campaignId, csvText) as Promise<UploadSummary>,
  listRecipients: (campaignId: string) => ipcRenderer.invoke('recipients:list', campaignId) as Promise<EmailRecipient[]>,
  sendCampaign: (campaignId: string, campaignOverride?: Partial<Campaign>) => ipcRenderer.invoke('queue:send', campaignId, campaignOverride) as Promise<QueueSendResult>,
  pauseCampaign: (campaignId: string) => ipcRenderer.invoke('queue:pause', campaignId) as Promise<QueueActionResult>,
  resumeCampaign: (campaignId: string) => ipcRenderer.invoke('queue:resume', campaignId) as Promise<QueueActionResult>,
  getCampaignProgress: (campaignId: string) => ipcRenderer.invoke('queue:progress', campaignId) as Promise<Progress>,
  sendTestEmail: (campaignId: string, testEmail: string, campaignOverride?: Partial<Campaign>) => ipcRenderer.invoke('queue:send-test', campaignId, testEmail, campaignOverride) as Promise<{ ok?: boolean; error?: string }>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>,
  listEvents: (campaignId?: string) => ipcRenderer.invoke('events:list', campaignId) as Promise<DeliveryEvent[]>,
  exportCampaignReport: () => ipcRenderer.invoke('report:export-campaigns') as Promise<ReportExportResult>,
  simulateWebhookEvent: (campaignId: string, eventType?: string) => ipcRenderer.invoke('webhook:simulate', campaignId, eventType) as Promise<SimulatedWebhookResult>,
  addSuppression: (email: string) => ipcRenderer.invoke('suppression:add', email) as Promise<{ ok: true }>,
  pickCsvFile: () => ipcRenderer.invoke('csv:pick') as Promise<CsvPickResult>,
  pickLocalImage: () => ipcRenderer.invoke('image:pick-local') as Promise<LocalImagePickResult>,
  getSocialIconDataUris: () => ipcRenderer.invoke('image:social-icons') as Promise<SocialIconUrls>
}

contextBridge.exposeInMainWorld('maigun', api)

export type MaigunApi = typeof api
