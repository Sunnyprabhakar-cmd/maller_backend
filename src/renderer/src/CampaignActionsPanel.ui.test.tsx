import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CampaignActionsPanel } from './CampaignActionsPanel'

afterEach(() => {
  cleanup()
})

function renderCampaignActions(overrides: Partial<React.ComponentProps<typeof CampaignActionsPanel>> = {}) {
  return render(
    <CampaignActionsPanel
      current={{}}
      validationError=""
      createCampaign={mock.fn(async () => undefined)}
      saveCampaign={mock.fn(async () => undefined)}
      removeImage={mock.fn()}
      testEmail=""
      setTestEmail={mock.fn()}
      sendTest={mock.fn(async () => undefined)}
      recentTestEmails={[]}
      {...overrides}
    />
  )
}

describe('CampaignActionsPanel', () => {
  it('wires create, save, test email input, and send test actions', () => {
    const createCampaign = mock.fn(async () => undefined)
    const saveCampaign = mock.fn(async () => undefined)
    const setTestEmail = mock.fn()
    const sendTest = mock.fn(async () => undefined)

    renderCampaignActions({
      createCampaign,
      saveCampaign,
      setTestEmail,
      sendTest,
      testEmail: 'test@example.com'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }))
    fireEvent.change(screen.getByDisplayValue('test@example.com'), { target: { value: 'next@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }))

    assert.equal(createCampaign.mock.callCount(), 1)
    assert.equal(saveCampaign.mock.callCount(), 1)
    assert.equal(setTestEmail.mock.callCount() > 0, true)
    assert.equal(sendTest.mock.callCount(), 1)
  })

  it('shows validation error and image removal buttons when assets are present', () => {
    const removeImage = mock.fn()

    renderCampaignActions({
      current: {
        logoUrl: 'https://cdn.example.com/logo.png',
        bannerCid: 'banner-1',
        inlineImagePath: '/tmp/feature.png'
      },
      validationError: 'Campaign name is required.',
      removeImage
    })

    assert.ok(screen.getByText('Campaign name is required.'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove banner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove featured body image' }))

    assert.deepEqual(removeImage.mock.calls[0]?.arguments, ['logoUrl'])
    assert.deepEqual(removeImage.mock.calls[1]?.arguments, ['bannerUrl'])
    assert.deepEqual(removeImage.mock.calls[2]?.arguments, ['inlineImageUrl'])
  })

  it('renders recent test email shortcuts and reuses them', () => {
    const setTestEmail = mock.fn()

    renderCampaignActions({
      recentTestEmails: ['first@example.com', 'second@example.com'],
      setTestEmail
    })

    fireEvent.click(screen.getByRole('button', { name: 'first@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'second@example.com' }))

    assert.deepEqual(setTestEmail.mock.calls[0]?.arguments, ['first@example.com'])
    assert.deepEqual(setTestEmail.mock.calls[1]?.arguments, ['second@example.com'])
  })
})
