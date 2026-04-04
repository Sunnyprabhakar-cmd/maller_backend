"use strict";
const electron = require("electron");
const api = {
  getState: () => electron.ipcRenderer.invoke("app:get-state"),
  createCampaign: (input) => electron.ipcRenderer.invoke("campaign:create", input),
  saveCampaign: (campaign) => electron.ipcRenderer.invoke("campaign:save", campaign),
  listCampaigns: () => electron.ipcRenderer.invoke("campaign:list"),
  deleteCampaign: (campaignId) => electron.ipcRenderer.invoke("campaign:delete", campaignId),
  duplicateCampaign: (campaignId) => electron.ipcRenderer.invoke("campaign:duplicate", campaignId),
  getDraft: () => electron.ipcRenderer.invoke("draft:get"),
  saveDraft: (draft) => electron.ipcRenderer.invoke("draft:save", draft),
  parseCsv: (csvText) => electron.ipcRenderer.invoke("csv:parse", csvText),
  importCsv: (campaignId, csvText) => electron.ipcRenderer.invoke("csv:import", campaignId, csvText),
  listRecipients: (campaignId) => electron.ipcRenderer.invoke("recipients:list", campaignId),
  sendCampaign: (campaignId, campaignOverride) => electron.ipcRenderer.invoke("queue:send", campaignId, campaignOverride),
  pauseCampaign: (campaignId) => electron.ipcRenderer.invoke("queue:pause", campaignId),
  resumeCampaign: (campaignId) => electron.ipcRenderer.invoke("queue:resume", campaignId),
  getCampaignProgress: (campaignId) => electron.ipcRenderer.invoke("queue:progress", campaignId),
  sendTestEmail: (campaignId, testEmail, campaignOverride) => electron.ipcRenderer.invoke("queue:send-test", campaignId, testEmail, campaignOverride),
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => electron.ipcRenderer.invoke("settings:save", settings),
  listEvents: (campaignId) => electron.ipcRenderer.invoke("events:list", campaignId),
  exportCampaignReport: () => electron.ipcRenderer.invoke("report:export-campaigns"),
  simulateWebhookEvent: (campaignId, eventType) => electron.ipcRenderer.invoke("webhook:simulate", campaignId, eventType),
  getWebhookPort: () => electron.ipcRenderer.invoke("webhook:port"),
  onWebhookReceived: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("webhook:received", listener);
    return () => electron.ipcRenderer.removeListener("webhook:received", listener);
  },
  addSuppression: (email) => electron.ipcRenderer.invoke("suppression:add", email),
  pickCsvFile: () => electron.ipcRenderer.invoke("csv:pick"),
  pickLocalImage: () => electron.ipcRenderer.invoke("image:pick-local"),
  getSocialIconDataUris: () => electron.ipcRenderer.invoke("image:social-icons")
};
electron.contextBridge.exposeInMainWorld("maigun", api);
