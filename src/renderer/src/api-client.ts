// API Client for Electron app to communicate with backend
const DEFAULT_API_URL = process.env.REACT_APP_API_URL || 'https://maller-backend-1.onrender.com/api'
const API_TOKEN = process.env.REACT_APP_API_TOKEN || 'dev-token-12345'

interface ApiOptions {
  method?: string
  body?: any
}

export class ApiClient {
  private apiUrl: string
  private apiToken: string

  constructor(apiUrl: string = DEFAULT_API_URL, apiToken: string = API_TOKEN) {
    this.apiUrl = apiUrl
    this.apiToken = apiToken
  }

  private async request(endpoint: string, options: ApiOptions = {}) {
    const url = `${this.apiUrl}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiToken}`
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `API error: ${response.status}`)
    }

    return response.json()
  }

  // Campaigns
  async createCampaign(campaign: any) {
    return this.request('/campaigns', {
      method: 'POST',
      body: campaign
    })
  }

  async getCampaigns() {
    return this.request('/campaigns')
  }

  async getCampaign(id: string) {
    return this.request(`/campaigns/${id}`)
  }

  async addRecipients(campaignId: string, recipients: any[]) {
    return this.request(`/campaigns/${campaignId}/recipients`, {
      method: 'POST',
      body: { recipients }
    })
  }

  async sendTestEmail(campaignId: string, testEmail: string) {
    return this.request(`/campaigns/${campaignId}/send-test`, {
      method: 'POST',
      body: { testEmail }
    })
  }

  async sendCampaign(campaignId: string) {
    return this.request(`/campaigns/${campaignId}/send`, {
      method: 'POST'
    })
  }

  async getCampaignEvents(campaignId: string) {
    return this.request(`/campaigns/${campaignId}/events`)
  }

  // Tokens
  async generateToken(name: string) {
    return this.request('/tokens/generate', {
      method: 'POST',
      body: { name }
    })
  }

  async getTokens() {
    return this.request('/tokens')
  }

  async revokeToken(id: string) {
    return this.request(`/tokens/${id}`, {
      method: 'DELETE'
    })
  }
}

export const apiClient = new ApiClient()
