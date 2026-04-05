import React from 'react'
import type { Campaign } from './types'

type CampaignActionsPanelProps = {
  current: Partial<Campaign>
  validationError: string
  createCampaign: () => Promise<void>
  saveCampaign: () => Promise<void>
  removeImage: (field: 'logoUrl' | 'bannerUrl' | 'inlineImageUrl') => void
  testEmail: string
  setTestEmail: (value: string) => void
  sendTest: () => Promise<void>
  recentTestEmails: string[]
}

export function CampaignActionsPanel(props: CampaignActionsPanelProps) {
  return (
    <>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="button" onClick={() => void props.createCampaign()}>Create campaign</button>
        <button className="button secondary" onClick={() => void props.saveCampaign()}>Save campaign</button>
        {(props.current.logoUrl || props.current.logoPath || props.current.logoCid) ? <button className="button secondary" onClick={() => props.removeImage('logoUrl')}>Remove logo</button> : null}
        {(props.current.bannerUrl || props.current.bannerPath || props.current.bannerCid) ? <button className="button secondary" onClick={() => props.removeImage('bannerUrl')}>Remove banner</button> : null}
        {(props.current.inlineImageUrl || props.current.inlineImagePath || props.current.inlineImageCid) ? <button className="button secondary" onClick={() => props.removeImage('inlineImageUrl')}>Remove featured body image</button> : null}
      </div>
      {props.validationError ? <div className="danger" style={{ marginTop: 8 }}>{props.validationError}</div> : null}

      <div className="row wrap" style={{ marginTop: 12 }}>
        <input placeholder="test@example.com" value={props.testEmail} onChange={(event) => props.setTestEmail(event.target.value)} />
        <button className="button secondary" onClick={() => void props.sendTest()}>Send Test Email</button>
      </div>
      {props.recentTestEmails.length > 0 ? (
        <div className="row wrap" style={{ marginTop: 8 }}>
          {props.recentTestEmails.map((email) => (
            <button key={email} className="button secondary" onClick={() => props.setTestEmail(email)}>{email}</button>
          ))}
        </div>
      ) : null}
    </>
  )
}
