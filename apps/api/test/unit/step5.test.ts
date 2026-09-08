import { describe, expect, it } from 'vitest'
import { RULE_MATRIX } from '@avroleva/contracts'
import { listNotificationTemplates } from '@avroleva/domain-data'
import {
  channelFallbacks,
  defaultRules,
  matchRules,
  renderText,
  textToHtml,
  validateTemplate,
} from '../../src/modules/notifications/index.js'
import { buildViberLink, viberDigits } from '../../src/platform/adapters/notifications/viberLink.js'
import { retentionCutoff } from '../../src/modules/documents/index.js'
import { orphanCutoff } from '../../src/modules/documents/domain/retention.js'
import {
  canCancelDeletion,
  canRequestDeletion,
  daysUntilDeletion,
  deletionDate,
  isDueForPurge,
} from '../../src/modules/tenancy/domain/deletion.js'
import { CSV_BOM, csvCell, csvLine } from '../../src/modules/reporting/index.js'
import { dateOnly } from '../../src/modules/reporting/domain/csv.js'
import { events } from '../../src/platform/events/bus.js'

const rule = (over: Partial<Parameters<typeof matchRules>[0][number]> = {}) => ({
  id: 'r',
  eventType: 'VisitRecorded',
  channel: 'email' as const,
  recipientKind: 'building_contact' as const,
  enabled: true,
  config: {},
  ...over,
})

describe('notification rules (pure)', () => {
  it('matches only enabled rules of the event type', () => {
    const rules = [
      rule({ id: 'a' }),
      rule({ id: 'b', enabled: false }),
      rule({ id: 'c', eventType: 'CallbackOpened' }),
    ]
    expect(matchRules(rules, 'VisitRecorded').map((r) => r.id)).toEqual(['a'])
    expect(matchRules(rules, 'CallbackOpened').map((r) => r.id)).toEqual(['c'])
    expect(matchRules(rules, 'Nothing')).toEqual([])
  })

  it('InspectionDueSoon rules fire only on the alert steps in their config', () => {
    const rules = [
      rule({ id: 'thirty', eventType: 'InspectionDueSoon', config: { days: [30] } }),
      rule({ id: 'any', eventType: 'InspectionDueSoon', config: {} }),
    ]
    expect(matchRules(rules, 'InspectionDueSoon', { inDays: 30 }).map((r) => r.id)).toEqual([
      'thirty',
      'any',
    ])
    expect(matchRules(rules, 'InspectionDueSoon', { inDays: 7 }).map((r) => r.id)).toEqual(['any'])
  })

  it('default rules cover the whole matrix, SMS off, building e-mails with the Viber fallback', () => {
    const d = defaultRules()
    expect(d).toHaveLength(RULE_MATRIX.length)
    for (const r of d) {
      expect(r.enabled).toBe(r.channel !== 'sms')
      if (r.channel === 'email' && r.recipientKind === 'building_contact')
        expect(r.config.fallbackViberLink).toBe(true)
      if (r.eventType === 'InspectionDueSoon') expect(r.config.days).toContain(30)
    }
    const on = d
      .filter((r) => r.enabled)
      .map((r) => `${r.eventType}/${r.channel}/${r.recipientKind}`)
    expect(on).toContain('VisitRecorded/email/building_contact')
    expect(on).toContain('CallbackOpened/in_app/owner')
    expect(on).toContain('CheckOverdue/in_app/office')
  })
})

describe('templates (Handlebars + i18n helpers)', () => {
  it('ships bg and en for every key and channel', () => {
    const all = listNotificationTemplates()
    const keys = new Set(all.map((t) => t.key))
    expect(keys.size).toBeGreaterThanOrEqual(16)
    for (const key of keys) {
      for (const channel of ['email', 'sms', 'in_app'] as const) {
        for (const locale of ['bg', 'en']) {
          const t = all.find((x) => x.key === key && x.channel === channel && x.locale === locale)
          expect(t, `${key}/${channel}/${locale}`).toBeDefined()
          expect(validateTemplate(t!.body), `${key}/${channel}/${locale}`).toBeNull()
          if (channel === 'email') expect(t!.subject, `${key} email subject`).toBeTruthy()
        }
      }
    }
  })

  it('renders dates and money per locale, conditionals and nested data', () => {
    const tpl = {
      subject: '{{tenant.name}}: {{date when}}',
      body: '{{money cents}}{{#if extra}} · {{extra}}{{/if}} · {{datetime when}}',
    }
    const data = {
      tenant: { name: 'Демо' },
      when: '2026-09-08T10:30:00Z',
      cents: 123456,
      extra: '',
    }
    const bg = renderText(tpl, data, 'bg')
    const en = renderText(tpl, data, 'en')
    expect(bg.subject).toContain('Демо: 8.09.2026')
    expect(en.subject).toContain('Sep 8, 2026')
    expect(bg.body).toMatch(/1\s?234,56\s?€/)
    expect(en.body).toMatch(/€1,234\.56/)
    expect(bg.body).not.toContain('·  ·')
    expect(bg.body).toContain('13:30')
  })

  it('does not HTML-escape plain text and converts text to HTML paragraphs separately', () => {
    const r = renderText({ subject: null, body: 'A & B <x>' }, {}, 'bg')
    expect(r.body).toBe('A & B <x>')
    expect(textToHtml('Здравей,\nсвят\n\nВтори')).toBe('<p>Здравей,<br>свят</p>\n<p>Втори</p>')
  })

  it('rejects a broken template and falls back across channels', () => {
    expect(validateTemplate('{{#if x}} no end')).not.toBeNull()
    expect(channelFallbacks('viber_link')[0]).toBe('viber_link')
    expect(channelFallbacks('viber_link')).toContain('sms')
    expect(channelFallbacks('email')).toEqual(['email', 'in_app'])
  })
})

describe('Viber deep links (deep-link mode only)', () => {
  it('normalises Bulgarian numbers to international digits', () => {
    expect(viberDigits('+359 888 123 456')).toBe('359888123456')
    expect(viberDigits('0888123456')).toBe('359888123456')
    expect(viberDigits('00359 888-123-456')).toBe('359888123456')
    expect(viberDigits('359888123456')).toBe('359888123456')
  })

  it('builds chat, forward (prefilled text) and web links', () => {
    const l = buildViberLink('0888 123 456', 'Здравейте, посещение днес')
    expect(l.number).toBe('+359888123456')
    expect(l.chatUrl).toBe('viber://chat?number=%2B359888123456')
    expect(l.forwardUrl.startsWith('viber://forward?text=')).toBe(true)
    expect(decodeURIComponent(l.forwardUrl.slice('viber://forward?text='.length))).toBe(
      'Здравейте, посещение днес',
    )
    expect(l.webUrl).toBe('https://viber.click/359888123456')
    expect(l.text).toBe('Здравейте, посещение днес')
  })
})

describe('retention math', () => {
  const now = new Date('2026-09-08T10:00:00Z')
  it('null / invalid retention keeps everything', () => {
    expect(retentionCutoff(now, null)).toBeNull()
    expect(retentionCutoff(now, undefined)).toBeNull()
    expect(retentionCutoff(now, 0)).toBeNull()
  })
  it('N years back, whole years only', () => {
    expect(retentionCutoff(now, 2)!.toISOString()).toBe('2024-09-08T10:00:00.000Z')
    expect(retentionCutoff(now, 10.9)!.toISOString()).toBe('2016-09-08T10:00:00.000Z')
  })
  it('orphan grace is 7 days', () => {
    expect(orphanCutoff(now).toISOString()).toBe('2026-09-01T10:00:00.000Z')
  })
})

describe('delete-my-data state machine', () => {
  const now = new Date('2026-09-08T10:00:00Z')
  it('schedules 30 days out and counts the days', () => {
    const at = deletionDate(now)
    expect(at.toISOString()).toBe('2026-10-08T10:00:00.000Z')
    expect(daysUntilDeletion(at, now)).toBe(30)
    expect(daysUntilDeletion(at, new Date('2026-10-07T23:00:00Z'))).toBe(1)
    expect(daysUntilDeletion(at, new Date('2026-10-09T00:00:00Z'))).toBe(0)
  })
  it('active/read_only can request; scheduled cannot request again', () => {
    expect(canRequestDeletion('active')).toBe(true)
    expect(canRequestDeletion('read_only')).toBe(true)
    expect(canRequestDeletion('deletion_scheduled')).toBe(false)
    expect(canRequestDeletion('closed')).toBe(false)
  })
  it('cancellable until the date, due once the date has passed', () => {
    const at = deletionDate(now)
    expect(canCancelDeletion('deletion_scheduled', at, now)).toBe(true)
    expect(canCancelDeletion('deletion_scheduled', at, new Date(at.getTime() + 1))).toBe(false)
    expect(canCancelDeletion('active', null, now)).toBe(false)
    expect(isDueForPurge('deletion_scheduled', at, now)).toBe(false)
    expect(isDueForPurge('deletion_scheduled', at, at)).toBe(true)
    expect(isDueForPurge('active', at, at)).toBe(false)
  })
})

describe('CSV cells', () => {
  it('starts with a BOM and quotes what needs quoting', () => {
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff)
    expect(csvLine(['a', 'b,c', 'd"e', 'f\ng', null, 12, true])).toBe(
      'a,"b,c","d""e","f\ng",,12,true\r\n',
    )
  })
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-12.5')).toBe('-12.5')
    expect(csvCell('+359888')).toBe("'+359888")
  })
  it('serialises dates and JSON', () => {
    expect(csvCell(new Date('2026-09-08T10:00:00Z'))).toBe('2026-09-08T10:00:00.000Z')
    expect(dateOnly(new Date('2026-09-08T00:00:00Z'))).toBe('2026-09-08')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })
})

describe('event bus subscriptions', () => {
  it('handler names are stable keys: the same name twice on one type is refused', () => {
    const off = events.subscribe('UnitTestEvent', async () => undefined, 'unit.a')
    expect(() => events.subscribe('UnitTestEvent', async () => undefined, 'unit.a')).toThrow()
    off()
    const off2 = events.subscribe('UnitTestEvent', async () => undefined, 'unit.a')
    off2()
  })
})
