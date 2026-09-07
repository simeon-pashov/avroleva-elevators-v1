/** Tiny RFC 4180 parser: quotes, escaped quotes, CRLF, BOM; delimiter auto-detected (, or ;). */
export function parseCsv(text: string, delimiter?: ',' | ';' | '\t'): string[][] {
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  s = s.replace(/\r\n?/g, '\n')
  const delim = delimiter ?? detectDelimiter(s)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop fully empty trailing rows.
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

export function detectDelimiter(s: string): ',' | ';' | '\t' {
  const firstLine = s.split('\n', 1)[0] ?? ''
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
}

/** Serialises rows with a UTF-8 BOM so Excel opens Cyrillic correctly (ARCHITECTURE section 5). */
export function toCsv(
  rows: Array<Array<string | number | null | undefined>>,
  delimiter = ',',
): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",;\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n'
}
