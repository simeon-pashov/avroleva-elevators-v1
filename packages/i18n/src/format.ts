/**
 * Minimal ICU-like message formatter.
 * Supports `{name}`, `{n, plural, =0 {…} one {…} other {…}}` (with `#` for the number)
 * and `{x, select, a {…} b {…} other {…}}`. Options may nest placeholders.
 */
export type Params = Record<string, string | number | boolean | null | undefined | Date>

export function formatMessage(message: string, params: Params | undefined, locale: string): string {
  if (!params || message.indexOf('{') === -1) return message
  let out = ''
  let i = 0
  while (i < message.length) {
    const open = message.indexOf('{', i)
    if (open === -1) {
      out += message.slice(i)
      break
    }
    out += message.slice(i, open)
    const close = findClosing(message, open)
    if (close === -1) {
      out += message.slice(open)
      break
    }
    out += formatPlaceholder(message.slice(open + 1, close), params, locale)
    i = close + 1
  }
  return out
}

function findClosing(s: string, open: number): number {
  let depth = 0
  for (let j = open; j < s.length; j++) {
    const c = s[j]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function formatPlaceholder(body: string, params: Params, locale: string): string {
  const comma = body.indexOf(',')
  if (comma === -1) return stringify(params[body.trim()], locale)
  const name = body.slice(0, comma).trim()
  const rest = body.slice(comma + 1)
  const comma2 = rest.indexOf(',')
  const kind = (comma2 === -1 ? rest : rest.slice(0, comma2)).trim()
  const optionsSrc = comma2 === -1 ? '' : rest.slice(comma2 + 1)
  const options = parseOptions(optionsSrc)
  const value = params[name]

  if (kind === 'plural') {
    const n = typeof value === 'number' ? value : Number(value ?? 0)
    const exact = options.get(`=${n}`)
    const category = new Intl.PluralRules(locale).select(n)
    const chosen = exact ?? options.get(category) ?? options.get('other') ?? ''
    return formatMessage(
      chosen.replace(/#/g, new Intl.NumberFormat(locale).format(n)),
      params,
      locale,
    )
  }
  if (kind === 'select') {
    const key = String(value ?? 'other')
    const chosen = options.get(key) ?? options.get('other') ?? ''
    return formatMessage(chosen, params, locale)
  }
  return stringify(value, locale)
}

/** Parses `key {text} key2 {text2}` into a map; text may contain nested braces. */
function parseOptions(src: string): Map<string, string> {
  const map = new Map<string, string>()
  let i = 0
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++
    const start = i
    while (i < src.length && src[i] !== '{' && !/\s/.test(src[i]!)) i++
    const key = src.slice(start, i)
    while (i < src.length && /\s/.test(src[i]!)) i++
    if (src[i] !== '{') break
    const close = findClosing(src, i)
    if (close === -1) break
    map.set(key, src.slice(i + 1, close))
    i = close + 1
  }
  return map
}

function stringify(v: Params[string], locale: string): string {
  if (v == null) return ''
  if (typeof v === 'number') return new Intl.NumberFormat(locale).format(v)
  if (v instanceof Date) return new Intl.DateTimeFormat(locale).format(v)
  return String(v)
}
