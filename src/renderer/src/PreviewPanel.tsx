import React from 'react'

type PreviewPanelProps = {
  previewMode: 'desktop' | 'mobile'
  setPreviewMode: (value: 'desktop' | 'mobile') => void
  generateReceiverPreview: () => void
  previewGeneratedAt: string
  previewHtml: string
}

const EMPTY_PREVIEW_HTML = '<div style="padding:20px;font-family:Arial,sans-serif;color:#555;">No preview generated yet.</div>'

export function PreviewPanel(props: PreviewPanelProps) {
  return (
    <div className="card">
      <h3>Receiver POV Preview</h3>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button className={`button ${props.previewMode === 'desktop' ? '' : 'secondary'}`} onClick={() => props.setPreviewMode('desktop')}>Desktop</button>
        <button className={`button ${props.previewMode === 'mobile' ? '' : 'secondary'}`} onClick={() => props.setPreviewMode('mobile')}>Mobile</button>
        <button className="button" onClick={props.generateReceiverPreview}>Generate preview</button>
      </div>
      {props.previewGeneratedAt ? (
        <div className="muted" style={{ marginBottom: 8 }}>Generated: {props.previewGeneratedAt}</div>
      ) : (
        <div className="muted" style={{ marginBottom: 8 }}>Click Generate preview to see exactly how receiver will view this email.</div>
      )}
      <div className="preview"><iframe title="preview" srcDoc={props.previewHtml || EMPTY_PREVIEW_HTML} /></div>
    </div>
  )
}
