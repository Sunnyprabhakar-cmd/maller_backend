/// <reference types="vite/client" />

declare global {
  interface Window {
    maigun: {
      getState: () => Promise<any>
      createCampaign: (input: unknown) => Promise<any>
      saveCampaign: (campaign: unknown) => Promise<any>
      listCampaigns: () => Promise<any[]>
      deleteCampaign: (campaignId: string) => Promise<any>
      duplicateCampaign: (campaignId: string) => Promise<any>
      getDraft: () => Promise<any>
      saveDraft: (draft: unknown) => Promise<any>
      parseCsv: (csvText: string) => Promise<any>
      importCsv: (campaignId: string, csvText: string) => Promise<any>
      listRecipients: (campaignId: string) => Promise<any[]>
      sendCampaign: (campaignId: string, campaignOverride?: unknown) => Promise<any>
      pauseCampaign: (campaignId: string) => Promise<any>
      resumeCampaign: (campaignId: string) => Promise<any>
      getCampaignProgress: (campaignId: string) => Promise<any>
      sendTestEmail: (campaignId: string, testEmail: string, campaignOverride?: unknown) => Promise<any>
      getSettings: () => Promise<any>
      saveSettings: (settings: unknown) => Promise<any>
      listEvents: (campaignId?: string) => Promise<any[]>
      exportCampaignReport: () => Promise<any>
      simulateWebhookEvent: (campaignId: string, eventType?: string) => Promise<any>
      getWebhookPort: () => Promise<number>
      onWebhookReceived: (callback: (payload: unknown) => void) => () => void
      addSuppression: (email: string) => Promise<any>
      pickCsvFile: () => Promise<any>
      pickLocalImage: () => Promise<any>
      getSocialIconDataUris: () => Promise<Record<string, string>>
    }
  }
}

export {}