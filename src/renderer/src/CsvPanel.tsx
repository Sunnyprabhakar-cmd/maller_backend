import React from 'react'
import type { UploadSummary } from './types'

type CsvPanelProps = {
  csvFileName: string
  csvText: string
  setCsvText: (value: string) => void
  loadCsvFile: (file: File) => Promise<void>
  fieldMap: Record<string, string>
  setFieldMap: (value: Record<string, string>) => void
  csvPreview: { headers: string[]; rows: string[][] }
  previewCsv: () => Promise<void>
  importCsv: () => Promise<void>
  uploadSummary: UploadSummary | null
  docTitle: string
  docLines: string[]
}

export function CsvPanel(props: CsvPanelProps) {
  return (
    <section className="grid">
      <div className="card">
        <h2>CSV mapping and preview</h2>
        <input type="file" accept=".csv,text/csv" onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void props.loadCsvFile(file)
        }} />
        <div className="muted" style={{ marginTop: 8 }}>{props.csvFileName ? `Loaded ${props.csvFileName}` : 'No file selected'}</div>
        <textarea value={props.csvText} onChange={(event) => props.setCsvText(event.target.value)} style={{ minHeight: 240 }} />

        <div className="grid" style={{ marginTop: 10 }}>
          {['email', 'name', 'offer_code', 'unsubscribe_url'].map((target) => (
            <div key={target}>
              <label>Map {target}</label>
              <select value={props.fieldMap[target] ?? ''} onChange={(event) => props.setFieldMap({ ...props.fieldMap, [target]: event.target.value })}>
                <option value="">None</option>
                {props.csvPreview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="button secondary" onClick={() => void props.previewCsv()}>Validate</button>
          <button className="button" onClick={() => void props.importCsv()}>Import</button>
        </div>
      </div>

      <div className="card">
        <h3>First 5 rows</h3>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(props.csvPreview.rows, null, 2)}</pre>
        {props.uploadSummary ? (
          <>
            <h3>Validation summary</h3>
            <div className="grid three">
              <div className="stat"><strong>{props.uploadSummary.validCount}</strong><span>Valid</span></div>
              <div className="stat"><strong>{props.uploadSummary.invalidCount}</strong><span>Invalid</span></div>
              <div className="stat"><strong>{props.uploadSummary.duplicateCount}</strong><span>Duplicates</span></div>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <h3>{props.docTitle}</h3>
        {props.docLines.map((line) => <div key={line} className="muted" style={{ marginBottom: 8 }}>{line}</div>)}
      </div>
    </section>
  )
}
