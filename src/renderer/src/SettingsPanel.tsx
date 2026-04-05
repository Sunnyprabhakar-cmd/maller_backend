import React from 'react'
import type { Settings } from './types'

type SettingsPanelProps = {
  settings: Settings
  setSettings: (value: Settings) => void
  newSender: string
  setNewSender: (value: string) => void
  setActionMessage: (value: string) => void
  saveSettings: () => Promise<void>
  docTitle: string
  docLines: string[]
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section className="card">
      <h2>Settings</h2>
      <div className="grid">
        <div><label>App username</label><input value={props.settings.appUsername} onChange={(event) => props.setSettings({ ...props.settings, appUsername: event.target.value })} /></div>
        <div><label>App password</label><input type="password" value={props.settings.appPassword} onChange={(event) => props.setSettings({ ...props.settings, appPassword: event.target.value })} /></div>
        <div>
          <label>Add sender profile</label>
          <div className="row">
            <input value={props.newSender} onChange={(event) => props.setNewSender(event.target.value)} placeholder="sales@domain.com" />
            <button className="button secondary" onClick={() => {
              const candidate = props.newSender.trim()
              if (!candidate) {
                props.setActionMessage('Please enter a sender email first.')
                return
              }
              if (!props.settings.senderEmails.includes(candidate)) {
                props.setSettings({ ...props.settings, senderEmails: [...props.settings.senderEmails, candidate] })
                props.setActionMessage(`Sender added: ${candidate}`)
              } else {
                props.setActionMessage('Sender already exists.')
              }
              props.setNewSender('')
            }}>Add</button>
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {props.settings.senderEmails.map((sender: string) => (
              <button key={sender} className="button secondary" onClick={() => {
                props.setSettings({
                  ...props.settings,
                  senderEmails: props.settings.senderEmails.filter((item: string) => item !== sender)
                })
                props.setActionMessage(`Sender removed: ${sender}`)
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
        <button className="button" onClick={() => void props.saveSettings()}>Save settings</button>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3>{props.docTitle}</h3>
        {props.docLines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
      </div>
    </section>
  )
}
