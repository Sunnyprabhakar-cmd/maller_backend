import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CampaignActionsPanel } from './CampaignActionsPanel'

afterEach(() => {
  cleanup()
})

function CampaignActionsHarness() {
  const [testEmail, setTestEmail] = useState('')
  const [status, setStatus] = useState('Idle')
  const [current, setCurrent] = useState({
    logoUrl: 'https://cdn.example.com/logo.png'
  })

  return (
    <div>
      <CampaignActionsPanel
        current={current}
        validationError=""
        createCampaign={async () => {
          setStatus('Created')
        }}
        saveCampaign={async () => {
          setStatus('Saved')
        }}
        removeImage={(field) => {
          if (field === 'logoUrl') {
            setCurrent({})
            setStatus('Logo removed')
          }
        }}
        testEmail={testEmail}
        setTestEmail={setTestEmail}
        sendTest={async () => {
          setStatus(`Sent test to ${testEmail}`)
        }}
        recentTestEmails={['first@example.com', 'second@example.com']}
      />
      <div>Status: {status}</div>
    </div>
  )
}

describe('CampaignActionsPanel stateful flow', () => {
  it('updates parent state for create/save/remove/recent-email/send-test interactions', async () => {
    render(<CampaignActionsHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Status: Created'))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Status: Saved'))
    })

    fireEvent.click(screen.getByRole('button', { name: 'first@example.com' }))
    assert.equal((screen.getByDisplayValue('first@example.com') as HTMLInputElement).value, 'first@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Status: Sent test to first@example.com'))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Status: Logo removed'))
    })
  })
})
