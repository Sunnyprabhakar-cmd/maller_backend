import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('app:get-state'),
  createCampaign: (input: unknown) => ipcRenderer.invoke('campaign:create', input),
  saveCampaign: (campaign: unknown) => ipcRenderer.invoke('campaign:save', campaign),
  listCampaigns: () => ipcRenderer.invoke('campaign:list'),
  deleteCampaign: (campaignId: string) => ipcRenderer.invoke('campaign:delete', campaignId),
  duplicateCampaign: (campaignId: string) => ipcRenderer.invoke('campaign:duplicate', campaignId),
  getDraft: () => ipcRenderer.invoke('draft:get'),
  saveDraft: (draft: unknown) => ipcRenderer.invoke('draft:save', draft),
  parseCsv: (csvText: string) => ipcRenderer.invoke('csv:parse', csvText),
  importCsv: (campaignId: string, csvText: string) => ipcRenderer.invoke('csv:import', campaignId, csvText),
  listRecipients: (campaignId: string) => ipcRenderer.invoke('recipients:list', campaignId),
  sendCampaign: (campaignId: string, campaignOverride?: unknown) => ipcRenderer.invoke('queue:send', campaignId, campaignOverride),
  pauseCampaign: (campaignId: string) => ipcRenderer.invoke('queue:pause', campaignId),
  resumeCampaign: (campaignId: string) => ipcRenderer.invoke('queue:resume', campaignId),
  getCampaignProgress: (campaignId: string) => ipcRenderer.invoke('queue:progress', campaignId),
  sendTestEmail: (campaignId: string, testEmail: string, campaignOverride?: unknown) => ipcRenderer.invoke('queue:send-test', campaignId, testEmail, campaignOverride),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  listEvents: (campaignId?: string) => ipcRenderer.invoke('events:list', campaignId),
  exportCampaignReport: () => ipcRenderer.invoke('report:export-campaigns'),
  simulateWebhookEvent: (campaignId: string, eventType?: string) => ipcRenderer.invoke('webhook:simulate', campaignId, eventType),
  getWebhookPort: () => ipcRenderer.invoke('webhook:port'),
  onWebhookReceived: (callback: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on('webhook:received', listener)
    return () => ipcRenderer.removeListener('webhook:received', listener)
  },
  addSuppression: (email: string) => ipcRenderer.invoke('suppression:add', email),
  pickCsvFile: () => ipcRenderer.invoke('csv:pick'),
  pickLocalImage: () => ipcRenderer.invoke('image:pick-local'),
  getSocialIconDataUris: () => ipcRenderer.invoke('image:social-icons')
}

contextBridge.exposeInMainWorld('maigun', api)

export type MaigunApi = typeof api