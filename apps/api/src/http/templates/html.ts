/**
 * Tiny server-side HTML helpers for the printable documents and the public QR page. No template
 * engine: a handful of pages, every value escaped, Cyrillic-safe font stack, print CSS inline
 * (helmet allows inline styles, not inline scripts).
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Multi-line text -> escaped paragraphs. */
export function paragraphs(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export const BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", Roboto, "Noto Sans", "DejaVu Sans", Arial, Helvetica, sans-serif;
    color: #111; background: #fff; line-height: 1.45; font-size: 12pt;
  }
  h1, h2, h3 { margin: 0 0 .4em; line-height: 1.2; }
  p { margin: 0 0 .7em; }
  .muted { color: #555; }
  .small { font-size: .85em; }
  .screen-only { display: block; }
  .toolbar {
    position: sticky; top: 0; background: #f3f4f6; border-bottom: 1px solid #ddd;
    padding: 10px 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  }
  .btn {
    display: inline-block; padding: 8px 14px; border: 1px solid #1d4ed8; border-radius: 6px;
    background: #2563eb; color: #fff; text-decoration: none; font: inherit; cursor: pointer;
  }
  .btn.secondary { background: #fff; color: #1d4ed8; }
  @media print {
    .screen-only, .toolbar { display: none !important; }
    body { font-size: 11pt; }
    a { color: inherit; text-decoration: none; }
  }
`

export interface PageOptions {
  title: string
  lang?: string
  /** Extra CSS appended after the base. */
  css?: string
  /** Body HTML. */
  body: string
  /** Script URL (same-origin, CSP 'self'); never inline. */
  script?: string
  /** `<meta name="robots">` for public pages. */
  robots?: string
}

export function page(o: PageOptions): string {
  return `<!doctype html>
<html lang="${esc(o.lang ?? 'bg')}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
${o.robots ? `<meta name="robots" content="${esc(o.robots)}">` : ''}
<title>${esc(o.title)}</title>
<style>${BASE_CSS}${o.css ?? ''}</style>
</head>
<body>
${o.body}
${o.script ? `<script src="${esc(o.script)}" defer></script>` : ''}
</body>
</html>`
}

/** A4 document with a firm letterhead block; used by the notice and the inspection request. */
export const DOC_CSS = `
  @page { size: A4; margin: 18mm 18mm 20mm; }
  .doc { max-width: 190mm; margin: 0 auto; padding: 16mm 12mm; }
  @media screen { .doc { box-shadow: 0 0 0 1px #ddd; margin: 16px auto; background: #fff; } body { background: #e5e7eb; } }
  .letterhead { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 18px; }
  .letterhead .firm { font-size: 1.25em; font-weight: 700; }
  .to { margin: 0 0 18px 50%; }
  .subject { font-weight: 700; margin: 18px 0 12px; }
  table.kv { border-collapse: collapse; margin: 8px 0 14px; }
  table.kv th { text-align: left; font-weight: 600; padding: 3px 14px 3px 0; vertical-align: top; white-space: nowrap; }
  table.kv td { padding: 3px 0; }
  .box { border: 1px solid #111; padding: 10px 12px; margin: 10px 0 14px; }
  .warn { border-width: 2px; font-weight: 600; }
  .sign { display: flex; justify-content: space-between; gap: 24px; margin-top: 40px; }
  .sign div { flex: 1; }
  .sign .line { border-top: 1px solid #111; margin-top: 36px; padding-top: 4px; }
  .footer { margin-top: 24px; font-size: .8em; color: #555; }
`
