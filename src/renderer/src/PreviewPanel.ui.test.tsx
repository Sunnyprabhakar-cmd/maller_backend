import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PreviewPanel } from './PreviewPanel'

afterEach(() => {
  cleanup()
})

describe('PreviewPanel', () => {
  it('shows empty preview guidance before generation', () => {
    render(
      <PreviewPanel
        previewMode="desktop"
        setPreviewMode={mock.fn()}
        generateReceiverPreview={mock.fn()}
        previewGeneratedAt=""
        previewHtml=""
      />
    )

    assert.ok(screen.getByText('Click Generate preview to see exactly how receiver will view this email.'))
    assert.match(screen.getByTitle('preview').getAttribute('srcdoc') ?? '', /No preview generated yet\./)
  })

  it('switches modes and triggers preview generation', () => {
    const setPreviewMode = mock.fn()
    const generateReceiverPreview = mock.fn()

    render(
      <PreviewPanel
        previewMode="mobile"
        setPreviewMode={setPreviewMode}
        generateReceiverPreview={generateReceiverPreview}
        previewGeneratedAt="2026-04-05 10:00 AM"
        previewHtml="<p>Rendered preview</p>"
      />
    )

    assert.ok(screen.getByText('Generated: 2026-04-05 10:00 AM'))
    assert.equal(screen.getByTitle('preview').getAttribute('srcdoc'), '<p>Rendered preview</p>')

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }))

    assert.deepEqual(setPreviewMode.mock.calls[0]?.arguments, ['desktop'])
    assert.equal(generateReceiverPreview.mock.callCount(), 1)
  })
})
