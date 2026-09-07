import type {
  Address,
  CustomerKind,
  DoorType,
  DriveType,
  ImportPreviewRow,
  ImportRowIssue,
} from '@avroleva/contracts'
import { IMPORT_COLUMNS } from '@avroleva/contracts'
import { parseCsv } from './csv.js'
import { addressKey, buildAddressText, normalizePhone, normalizeRegNo } from './address.js'

type Col = (typeof IMPORT_COLUMNS)[number]

const norm = (s: string) => s.toLowerCase().replace(/[\s.№()€/-]/g, '')

/** Header aliases so a customer's slightly different Excel still maps (MVP-PLAN section 3). */
const ALIASES: Record<string, Col> = {
  ползвател: 'Ползвател',
  клиент: 'Ползвател',
  типползвател: 'Тип ползвател',
  домоуправител: 'Домоуправител',
  контакт: 'Домоуправител',
  телефон: 'Телефон',
  viber: 'Viber',
  email: 'E-mail',
  имейл: 'E-mail',
  град: 'Град',
  област: 'Област',
  районжк: 'Район/ж.к.',
  район: 'Район/ж.к.',
  жк: 'Район/ж.к.',
  улицаи: 'Улица и №',
  улица: 'Улица и №',
  адрес: 'Улица и №',
  блок: 'Блок',
  вход: 'Вход',
  асансьор: 'Асансьор №',
  асансьорвътрешен: 'Асансьор №',
  рег: 'Рег. №',
  регнадзоренорган: 'Рег. №',
  регистрационен: 'Рег. №',
  надзоренорган: 'Надзорен орган',
  производител: 'Производител',
  година: 'Година',
  вид: 'Вид',
  тип: 'Вид',
  врати: 'Врати',
  спирки: 'Спирки',
  товаркг: 'Товар (кг)',
  товар: 'Товар (кг)',
  месечнацена: 'Месечна цена (€)',
  цена: 'Месечна цена (€)',
  договорот: 'Договор от',
  последнапроверка: 'Последна проверка',
  последентехническипреглед: 'Последен технически преглед',
  следващтехническипреглед: 'Следващ технически преглед',
  телефоннааварийнотоустройство: 'Телефон на аварийното устройство',
  аварийнотелефон: 'Телефон на аварийното устройство',
  операторнаsim: 'Оператор на SIM',
  оператор: 'Оператор на SIM',
  ширина: 'Ширина',
  lat: 'Ширина',
  дължина: 'Дължина',
  lng: 'Дължина',
  lon: 'Дължина',
}

export function mapHeaders(headers: string[]): { map: Map<Col, number>; unknown: string[] } {
  const map = new Map<Col, number>()
  const unknown: string[] = []
  headers.forEach((h, i) => {
    const key = norm(h)
    const exact = IMPORT_COLUMNS.find((c) => norm(c) === key)
    const col = exact ?? ALIASES[key]
    if (col && !map.has(col)) map.set(col, i)
    else if (h.trim()) unknown.push(h.trim())
  })
  return { map, unknown }
}

const CUSTOMER_KINDS: Array<[RegExp, CustomerKind]> = [
  [/етажн|ес\b|собствен/i, 'etazhna_sobstvenost'],
  [/професион|домоуправ|мениджър|manager/i, 'professional_manager'],
  [/фирма|еоод|оод|ад\b|company/i, 'company'],
  [/институц|община|училищ|болниц|държав|institution/i, 'institution'],
]
const DRIVE_TYPES: Array<[RegExp, DriveType]> = [
  [/хидр|hydr/i, 'hydraulic'],
  [/mrl|безмашин/i, 'mrl'],
  [/електр|elec/i, 'electric'],
]
const DOOR_TYPES: Array<[RegExp, DoorType]> = [
  [/полу|semi/i, 'semi_auto'],
  [/автомат|auto/i, 'auto'],
  [/ръчн|manual/i, 'manual'],
]

function pick<T>(table: Array<[RegExp, T]>, value: string, fallback: T): T {
  for (const [re, v] of table) if (re.test(value)) return v
  return fallback
}

/** Accepts dd.mm.yyyy, d.m.yyyy, yyyy-mm-dd, dd/mm/yyyy; returns YYYY-MM-DD or null. */
export function parseBgDate(raw: string): string | null | 'invalid' {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s)
  let y: number, mo: number, d: number
  if (m) {
    d = Number(m[1])
    mo = Number(m[2])
    y = Number(m[3])
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (!m) return 'invalid'
    y = Number(m[1])
    mo = Number(m[2])
    d = Number(m[3])
  }
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
    return 'invalid'
  return date.toISOString().slice(0, 10)
}

function parseNumber(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : 'invalid'
}

export interface ParsedImport {
  headers: string[]
  unknownHeaders: string[]
  rows: ImportPreviewRow[]
  issues: ImportRowIssue[]
}

/** Pure parse + validate of the import template. Row numbers are 1-based data rows (header = row 0). */
export function parseImport(csvText: string): ParsedImport {
  const table = parseCsv(csvText)
  const issues: ImportRowIssue[] = []
  const rows: ImportPreviewRow[] = []
  const headerRow = table[0]
  if (!headerRow) {
    issues.push({
      row: 0,
      column: '',
      code: 'import.emptyFile',
      message: 'import.emptyFile',
      level: 'error',
    })
    return { headers: [], unknownHeaders: [], rows, issues }
  }
  const { map, unknown } = mapHeaders(headerRow)
  const required: Col[] = ['Град', 'Асансьор №']
  for (const c of required) {
    if (!map.has(c)) {
      issues.push({
        row: 0,
        column: c,
        code: 'import.missingColumn',
        message: 'import.missingColumn',
        level: 'error',
      })
    }
  }
  if (issues.length) return { headers: headerRow, unknownHeaders: unknown, rows, issues }

  const seenAddress = new Map<string, number>()
  const seenRegNo = new Map<string, number>()

  for (let r = 1; r < table.length; r++) {
    const line = table[r]!
    const get = (c: Col) => (map.has(c) ? (line[map.get(c)!] ?? '').trim() : '')
    const err = (column: Col, code: string, level: 'error' | 'warning' = 'error') =>
      issues.push({ row: r, column, code, message: code, level })

    const city = get('Град')
    const internalNo = get('Асансьор №')
    const street = get('Улица и №')
    const block = get('Блок')
    if (!city) err('Град', 'import.required')
    if (!internalNo) err('Асансьор №', 'import.required')
    if (!street && !block) err('Улица и №', 'import.addressRequired')

    const address: Address = {
      city,
      postcode: undefined,
      oblast: get('Област') || undefined,
      district: get('Район/ж.к.') || undefined,
      street: undefined,
      number: undefined,
      block: block || undefined,
      entrance: get('Вход') || undefined,
    }
    const sm = /^(.*?)(?:\s+№?\s*(\d+[А-Яа-яA-Za-z]?))?$/.exec(street)
    if (sm) {
      address.street = (sm[1] ?? street).trim() || undefined
      address.number = sm[2]?.trim() || undefined
    }

    const stopsRaw = parseNumber(get('Спирки'))
    let stops = 2
    if (stopsRaw === 'invalid') err('Спирки', 'import.invalidNumber')
    else if (stopsRaw == null) err('Спирки', 'import.stopsDefaulted', 'warning')
    else if (stopsRaw < 2 || stopsRaw > 40) err('Спирки', 'import.stopsRange')
    else stops = Math.round(stopsRaw)

    const yearRaw = parseNumber(get('Година'))
    let year: number | null = null
    if (yearRaw === 'invalid') err('Година', 'import.invalidNumber')
    else if (yearRaw != null) {
      if (yearRaw < 1900 || yearRaw > 2100) err('Година', 'import.invalidYear')
      else year = Math.round(yearRaw)
    }

    const loadRaw = parseNumber(get('Товар (кг)'))
    let loadKg: number | null = null
    if (loadRaw === 'invalid') err('Товар (кг)', 'import.invalidNumber')
    else if (loadRaw != null) loadKg = Math.round(loadRaw)

    const priceRaw = parseNumber(get('Месечна цена (€)'))
    let monthlyPriceCents: number | null = null
    if (priceRaw === 'invalid') err('Месечна цена (€)', 'import.invalidNumber')
    else if (priceRaw != null) monthlyPriceCents = Math.round(priceRaw * 100)

    const dateOf = (c: Col): string | null => {
      const v = parseBgDate(get(c))
      if (v === 'invalid') {
        err(c, 'import.invalidDate')
        return null
      }
      return v
    }
    const contractStart = dateOf('Договор от')
    const lastCheckAt = dateOf('Последна проверка')
    const lastInspectionAt = dateOf('Последен технически преглед')
    const nextInspectionAt = dateOf('Следващ технически преглед')

    const latRaw = parseNumber(get('Ширина'))
    const lngRaw = parseNumber(get('Дължина'))
    let lat: number | null = null
    let lng: number | null = null
    if (latRaw === 'invalid' || lngRaw === 'invalid') err('Ширина', 'import.invalidNumber')
    else if (latRaw != null && lngRaw != null) {
      if (latRaw < -90 || latRaw > 90 || lngRaw < -180 || lngRaw > 180)
        err('Ширина', 'import.invalidCoordinates')
      else {
        lat = latRaw
        lng = lngRaw
      }
    }

    const regNo = get('Рег. №') || null
    const regKey = normalizeRegNo(regNo)
    if (regKey) {
      const prev = seenRegNo.get(regKey)
      if (prev) err('Рег. №', 'import.duplicateRegNo', 'warning')
      else seenRegNo.set(regKey, r)
    } else err('Рег. №', 'import.missingRegNo', 'warning')

    const dupKey = addressKey(address) + '|' + internalNo.toLowerCase()
    if (seenAddress.has(dupKey)) err('Асансьор №', 'import.duplicateElevator')
    else seenAddress.set(dupKey, r)

    const customerName = get('Ползвател') || buildAddressText(address)
    const phone = normalizePhone(get('Телефон'))
    if (get('Телефон') && !phone) err('Телефон', 'import.invalidPhone', 'warning')
    if (!lastCheckAt) err('Последна проверка', 'import.missingLastCheck', 'warning')

    rows.push({
      row: r,
      customerName,
      customerKind: pick(CUSTOMER_KINDS, get('Тип ползвател'), 'etazhna_sobstvenost'),
      contactName: get('Домоуправител') || null,
      contactPhone: phone,
      contactViber: /^(да|yes|y|1|true|x)$/i.test(get('Viber')),
      contactEmail: get('E-mail') || null,
      address,
      addressText: buildAddressText(address),
      lat,
      lng,
      internalNo,
      regNo,
      inspectionBody: get('Надзорен орган') || null,
      manufacturer: get('Производител') || null,
      year,
      driveType: pick(DRIVE_TYPES, get('Вид'), 'electric'),
      doorType: pick(DOOR_TYPES, get('Врати'), 'manual'),
      stops,
      loadKg,
      monthlyPriceCents,
      contractStart,
      lastCheckAt,
      lastInspectionAt,
      nextInspectionAt,
      alarmDevicePhone: normalizePhone(get('Телефон на аварийното устройство')),
      alarmSimOperator: get('Оператор на SIM') || null,
    })
  }
  if (rows.length === 0) {
    issues.push({
      row: 0,
      column: '',
      code: 'import.noRows',
      message: 'import.noRows',
      level: 'error',
    })
  }
  return { headers: headerRow, unknownHeaders: unknown, rows, issues }
}

export const templateExampleRows: string[][] = [
  [
    'ЕС „Младост 1, бл. 25“',
    'етажна собственост',
    'Мария Петрова',
    '0888 123 456',
    'да',
    'petrova@example.com',
    'София',
    'София-град',
    'ж.к. Младост 1',
    '',
    '25',
    'А',
    'вх. А',
    'СФ-1234',
    'ТЕХНОТЕСТ',
    'Schindler',
    '1978',
    'електрически',
    'ръчни',
    '9',
    '320',
    '55',
    '01.01.2025',
    '15.08.2026',
    '10.03.2026',
    '10.03.2027',
    '0899 000 111',
    'A1',
    '42.6501',
    '23.3766',
  ],
]
