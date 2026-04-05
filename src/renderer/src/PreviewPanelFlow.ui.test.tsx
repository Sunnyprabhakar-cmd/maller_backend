import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PreviewPanel } from './PreviewPanel'

afterEach(() => {
  cleanup()
})

function PreviewPanelHarness() {
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')

  function generateReceiverPreview() {
    setPreviewGeneratedAt('2026-04-05 09:30 AM')
    setPreviewHtml(`<p>Preview for ${previewMode}</p>`)
  }

  return (
    <PreviewPanel
      previewMode={previewMode}
      setPreviewMode={setPreviewMode}
      generateReceiverPreview={generateReceiverPreview}
      previewGeneratedAt={previewGeneratedAt}
      previewHtml={previewHtml}
    />
  )
}

describe('PreviewPanel stateful flow', () => {
  it('updates mode in parent state and generates preview output from the harness', () => {
    render(<PreviewPanelHarness />)

    assert.ok(screen.getByText('Click Generate preview to see exactly how receiver will view this email.'))
    assert.match(screen.getByTitle('preview').getAttribute('srcdoc') ?? '', /No preview generated yet\./)

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }))

    assert.ok(screen.getByText('Generated: 2026-04-05 09:30 AM'))
    assert.equal(screen.getByTitle('preview').getAttribute('srcdoc'), '<p>Preview for mobile</p>')
  })
})
