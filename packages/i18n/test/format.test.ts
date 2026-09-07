import { describe, expect, it } from 'vitest'
import { createT, formatMessage, formatMoney, resolveLocale, translate } from '../src/index.js'

describe('formatMessage', () => {
  it('interpolates simple params', () => {
    expect(formatMessage('Здравей, {name}!', { name: 'Иван' }, 'bg')).toBe('Здравей, Иван!')
  })
  it('handles plural with exact and category options', () => {
    const msg = '{count, plural, =0 {няма асансьори} one {# асансьор} other {# асансьора}}'
    expect(formatMessage(msg, { count: 0 }, 'bg')).toBe('няма асансьори')
    expect(formatMessage(msg, { count: 1 }, 'bg')).toBe('1 асансьор')
    expect(formatMessage(msg, { count: 5 }, 'bg')).toBe('5 асансьора')
  })
  it('handles select and nested placeholders', () => {
    const msg = '{status, select, active {Активен ({n})} other {Друг}}'
    expect(formatMessage(msg, { status: 'active', n: 3 }, 'bg')).toBe('Активен (3)')
    expect(formatMessage(msg, { status: 'x' }, 'bg')).toBe('Друг')
  })
  it('leaves unknown params empty and unbalanced braces intact', () => {
    expect(formatMessage('{missing}x', { a: 1 }, 'bg')).toBe('x')
    expect(formatMessage('a {b', { b: 1 }, 'bg')).toBe('a {b')
  })
})

describe('translate / resolveLocale', () => {
  it('falls back to bg, then to the key', () => {
    expect(translate('en', 'nav.dashboard')).not.toBe('nav.dashboard')
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist')
    expect(translate('xx', 'nav.dashboard')).toBe(translate('bg', 'nav.dashboard'))
  })
  it('resolves user -> tenant -> bg', () => {
    expect(resolveLocale(null, 'en')).toBe('en')
    expect(resolveLocale('xx', undefined)).toBe('bg')
    expect(resolveLocale('en', 'bg')).toBe('en')
  })
  it('createT binds the locale', () => {
    expect(createT('en')('nav.dashboard')).toBe(translate('en', 'nav.dashboard'))
  })
  it('formats EUR money from cents', () => {
    expect(formatMoney(12345, 'en')).toBe('€123.45')
  })
})
