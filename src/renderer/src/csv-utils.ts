import Papa from 'papaparse'

export function parseCsvPreview(text: string): { headers: string[]; rows: string[][] } {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const parsedRows = Array.isArray(parsed.data) ? parsed.data : []
  if (parsedRows.length === 0) return { headers: [], rows: [] }

  const [headerRow, ...dataRows] = parsedRows
  const headers = (Array.isArray(headerRow) ? headerRow : []).map((entry) => String(entry ?? '').trim())
  const rows = dataRows
    .slice(0, 6)
    .map((row) => (Array.isArray(row) ? row.map((entry) => String(entry ?? '').trim()) : []))
  return { headers, rows }
}

export function buildMappedCsv(
  csvText: string,
  fieldMap: Record<string, string>
): string {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true })
  const parsedRows = Array.isArray(parsed.data) ? parsed.data : []
  if (parsedRows.length === 0) return csvText

  const [headerRow, ...dataRows] = parsedRows
  const headers = (Array.isArray(headerRow) ? headerRow : []).map((entry) => String(entry ?? '').trim())
  if (headers.length === 0) return csvText

  const mappedHeaders = ['email', 'name', 'offer_code', 'unsubscribe_url']
  const transformed = dataRows.map((row) => {
    const values = Array.isArray(row) ? row : []
    const rowMap = Object.fromEntries(headers.map((header, idx) => [header, String(values[idx] ?? '')]))
    return mappedHeaders.map((target) => rowMap[fieldMap[target] ?? ''] ?? '')
  })
  return Papa.unparse([mappedHeaders, ...transformed])
}
