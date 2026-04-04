import Papa from 'papaparse'
import type { EmailRecipient, UploadSummary } from '../types'

const BLOCKED_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'tempmail.com',
  'guerrillamail.com',
  'yopmail.com'
])

function isValidDomain(domain: string): boolean {
  if (!domain || domain.length < 4) return false
  if (!domain.includes('.')) return false
  if (domain.startsWith('.') || domain.endsWith('.')) return false
  if (/\.\./.test(domain)) return false
  return /^[a-z0-9.-]+$/i.test(domain)
}

function isValidEmail(email: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)
}

export function parseRecipientsCsv(csvText: string): UploadSummary {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const rows = parsed.data ?? []
  const seen = new Set<string>()
  const validRows: EmailRecipient[] = []
  const invalidRows: UploadSummary['invalidRows'] = []
  let duplicateCount = 0

  rows.forEach((row, index) => {
    const email = String(row.email ?? '').trim().toLowerCase()
    if (!email || !isValidEmail(email)) {
      invalidRows.push({ row: index + 2, reason: 'Invalid or missing email' })
      return
    }
    const domain = email.split('@')[1] ?? ''
    if (!isValidDomain(domain)) {
      invalidRows.push({ row: index + 2, reason: 'Invalid email domain' })
      return
    }
    if (BLOCKED_DOMAINS.has(domain)) {
      invalidRows.push({ row: index + 2, reason: 'Disposable email domain is blocked' })
      return
    }
    if (seen.has(email)) {
      duplicateCount += 1
      invalidRows.push({ row: index + 2, reason: 'Duplicate email' })
      return
    }
    seen.add(email)
    const { email: _email, name, ...rest } = row
    const customFields = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined && String(value).trim() !== '')
    )
    validRows.push({
      email,
      name: name?.trim() || undefined,
      customFields
    })
  })

  return {
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    duplicateCount,
    totalCount: rows.length,
    rows: validRows,
    invalidRows
  }
}