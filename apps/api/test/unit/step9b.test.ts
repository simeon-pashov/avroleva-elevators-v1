import { describe, expect, it } from 'vitest'
import { listNotificationTemplates } from '@avroleva/domain-data'
import { newAccessToken } from '../../src/platform/ids.js'
import {
  accessLinkExpiryFor,
  accessLinkIpHash,
  accessLinkRotatedExpiry,
  accessLinkState,
  isAccessTokenShape,
  viberForwardUrl,
} from '../../src/modules/billing/index.js'
import { renderText, sampleData, validateTemplate } from '../../src/modules/notifications/index.js'

const NOW = new Date('2026-09-10T10:00:00Z')

describe('building access links (step 9, pure)', () => {
  it('tokens are 32 hex chars (128 bits) and distinct', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const t = newAccessToken()
      expect(t).toMatch(/^[0-9a-f]{32}$/)
      expect(isAccessTokenShape(t)).toBe(true)
      tokens.add(t)
    }
    expect(tokens.size).toBe(100)
    expect(isAccessTokenShape('nope')).toBe(false)
    expect(isAccessTokenShape('0123456789ABCDEF0123456789ABCDEF')).toBe(false)
  })

  it('state is derived: active until revoked or expired', () => {
    const future = new Date('2027-09-10T10:00:00Z')
    expect(accessLinkState({ expiresAt: future, revokedAt: null }, NOW)).toBe('active')
    expect(accessLinkState({ expiresAt: future, revokedAt: NOW }, NOW)).toBe('revoked')
    expect(
      accessLinkState({ expiresAt: new Date('2026-09-10T09:59:59Z'), revokedAt: null }, NOW),
    ).toBe('expired')
    expect(accessLinkState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe('expired')
    // Revoked wins over expired.
    expect(
      accessLinkState({ expiresAt: new Date('2020-01-01T00:00:00Z'), revokedAt: NOW }, NOW),
    ).toBe('revoked')
  })

  it('expiry is 12 calendar months by default and clamps to the month end', () => {
    expect(accessLinkExpiryFor(NOW, 12).toISOString()).toBe('2027-09-10T10:00:00.000Z')
    expect(accessLinkExpiryFor(NOW, 1).toISOString()).toBe('2026-10-10T10:00:00.000Z')
    expect(accessLinkExpiryFor(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    )
    expect(accessLinkExpiryFor(new Date('2028-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T12:00:00.000Z',
    )
  })

  it('rotation keeps the longer of the remaining validity and 12 months', () => {
    const longer = new Date('2029-01-01T00:00:00Z')
    expect(accessLinkRotatedExpiry(longer, NOW, 12)).toEqual(longer)
    const shorter = new Date('2026-12-01T00:00:00Z')
    expect(accessLinkRotatedExpiry(shorter, NOW, 12).toISOString()).toBe('2027-09-10T10:00:00.000Z')
  })

  it('the IP hash is stable per secret, differs per secret / IP, and hides the IP', () => {
    const a = accessLinkIpHash('203.0.113.7', 'secret-one')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(accessLinkIpHash('203.0.113.7', 'secret-one')).toBe(a)
    expect(accessLinkIpHash('203.0.113.7', 'secret-two')).not.toBe(a)
    expect(accessLinkIpHash('203.0.113.8', 'secret-one')).not.toBe(a)
    expect(a).not.toContain('203')
    expect(accessLinkIpHash(undefined, 'secret-one')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('the Viber forward link carries the text URL-encoded', () => {
    const url = viberForwardUrl('Справка: https://example.com/s/abc — до 10.09.2027')
    expect(url.startsWith('viber://forward?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('viber://forward?text='.length))).toBe(
      'Справка: https://example.com/s/abc — до 10.09.2027',
    )
  })
})

describe('statement_link template and the link line in dunning / reports (step 9)', () => {
  const all = listNotificationTemplates()
  const find = (key: string, channel: string, locale: string) =>
    all.find((t) => t.key === key && t.channel === channel && t.locale === locale)

  it('ships statement_link for e-mail, SMS, Viber and in-app in bg and en', () => {
    for (const channel of ['email', 'sms', 'viber_link', 'in_app']) {
      for (const locale of ['bg', 'en']) {
        const t = find('statement_link', channel, locale)
        expect(t, `statement_link/${channel}/${locale}`).toBeDefined()
        expect(validateTemplate(t!.body)).toBeNull()
        // The in-app note is the office's confirmation; the URL goes to the building only.
        if (channel !== 'in_app') expect(t!.body).toContain('{{statementLink.url}}')
      }
    }
    expect(find('statement_link', 'email', 'bg')!.subject).toContain('{{building.addressText}}')
  })

  it('renders the e-mail with the sample data: subject with the address, body with the URL', () => {
    const t = find('statement_link', 'email', 'bg')!
    const data = { ...sampleData('bg'), statementLink: { url: 'https://x.example/s/abc123' } }
    const r = renderText({ subject: t.subject, body: t.body }, data, 'bg')
    expect(r.subject).toBe('Вашата справка — София, ж.к. Младост 1, бл. 25, вх. А')
    expect(r.body).toContain('https://x.example/s/abc123')
    expect(r.body).toContain('Демо Лифт Сервиз')
    const en = renderText(
      {
        subject: find('statement_link', 'email', 'en')!.subject,
        body: find('statement_link', 'email', 'en')!.body,
      },
      { ...sampleData('en'), statementLink: { url: 'https://x.example/s/abc123' } },
      'en',
    )
    expect(en.subject).toContain('Your statement')
    expect(en.body).toContain('https://x.example/s/abc123')
    const viber = renderText(
      { subject: null, body: find('statement_link', 'viber_link', 'bg')!.body },
      data,
      'bg',
    )
    expect(viber.body).toContain('https://x.example/s/abc123')
  })

  it('dunning, statement and report templates add the link line only when a URL is present', () => {
    for (const key of [
      'dunning_reminder',
      'dunning_second',
      'dunning_final',
      'statement_sent',
      'building_report',
    ]) {
      for (const channel of ['email', 'sms']) {
        const t = find(key, channel, 'bg')!
        expect(t, `${key}/${channel}`).toBeDefined()
        expect(validateTemplate(t.body)).toBeNull()
        const withLink = renderText(
          { subject: t.subject, body: t.body },
          { ...sampleData('bg'), statementLink: { url: 'https://x.example/s/abc123' } },
          'bg',
        )
        expect(withLink.body, `${key}/${channel}`).toContain('https://x.example/s/abc123')
        const without = renderText(
          { subject: t.subject, body: t.body },
          { ...sampleData('bg'), statementLink: { url: '' } },
          'bg',
        )
        expect(without.body, `${key}/${channel}`).not.toContain('справка')
        expect(without.body, `${key}/${channel}`).not.toContain('Справка:')
      }
    }
    // The e-mail line sits above the signature with one blank line on each side.
    const email = find('dunning_reminder', 'email', 'bg')!
    const r = renderText(
      { subject: email.subject, body: email.body },
      { ...sampleData('bg'), statementLink: { url: 'https://x.example/s/abc123' } },
      'bg',
    )
    expect(r.body).toContain(
      'неотправено.\n\nВашата справка онлайн: https://x.example/s/abc123\n\nДемо Лифт Сервиз',
    )
    expect(r.body).not.toContain('\n\n\n')
  })
})
