import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CsvPanel } from './CsvPanel'

afterEach(() => {
  cleanup()
})

function renderCsvPanel(overrides: Partial<React.ComponentProps<typeof CsvPanel>> = {}) {
  return render(
    <CsvPanel
      csvFileName=""
      csvText="email,name"
      setCsvText={mock.fn()}
      loadCsvFile={mock.fn(async () => undefined)}
      fieldMap={{ email: 'email', name: 'name', offer_code: '', unsubscribe_url: '' }}
      setFieldMap={mock.fn()}
      csvPreview={{ headers: ['email', 'name', 'offer_code'], rows: [['user@example.com', 'User', 'ABC123']] }}
      previewCsv={mock.fn(async () => undefined)}
      importCsv={mock.fn(async () => undefined)}
      uploadSummary={null}
      docTitle="CSV help"
      docLines={['Line one', 'Line two']}
      {...overrides}
    />
  )
}

describe('CsvPanel', () => {
  it('renders file state, updates textarea, remaps fields, and triggers actions', () => {
    const setCsvText = mock.fn()
    const setFieldMap = mock.fn()
    const previewCsv = mock.fn(async () => undefined)
    const importCsv = mock.fn(async () => undefined)

    renderCsvPanel({
      csvFileName: 'recipients.csv',
      setCsvText,
      setFieldMap,
      previewCsv,
      importCsv
    })

    assert.ok(screen.getByText('Loaded recipients.csv'))

    fireEvent.change(screen.getByDisplayValue('email,name'), { target: { value: 'email,name,offer_code' } })
    fireEvent.change(screen.getByDisplayValue('email'), { target: { value: 'offer_code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    assert.equal(setCsvText.mock.callCount() > 0, true)
    assert.equal(setFieldMap.mock.callCount() > 0, true)
    assert.equal(previewCsv.mock.callCount(), 1)
    assert.equal(importCsv.mock.callCount(), 1)
  })

  it('passes chosen file to loader', () => {
    const loadCsvFile = mock.fn(async () => undefined)
    const view = renderCsvPanel({ loadCsvFile })

    const input = view.container.querySelector('input[type="file"]')
    const file = new File(['email,name\nuser@example.com,User'], 'contacts.csv', { type: 'text/csv' })

    assert.ok(input)
    fireEvent.change(input, { target: { files: [file] } })

    assert.equal(loadCsvFile.mock.callCount(), 1)
    assert.equal(loadCsvFile.mock.calls[0]?.arguments[0]?.name, 'contacts.csv')
  })

  it('shows validation summary and docs when provided', () => {
    renderCsvPanel({
      uploadSummary: {
        validCount: 12,
        invalidCount: 2,
        duplicateCount: 1
      }
    })

    assert.ok(screen.getByText('Validation summary'))
    assert.ok(screen.getByText('12'))
    assert.ok(screen.getByText('2'))
    assert.ok(screen.getByText('1'))
    assert.ok(screen.getByText('CSV help'))
    assert.ok(screen.getByText('Line one'))
  })
})
