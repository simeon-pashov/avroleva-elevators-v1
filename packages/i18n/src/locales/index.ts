// Registering a language = add `<code>.json` next to this file and one line below.
// bg.json is the source of truth; every other file must contain every key of bg.json
// (enforced by test/completeness.test.ts, which runs in `npm test` and `npm run lint`).
import bg from './bg.json' with { type: 'json' }
import en from './en.json' with { type: 'json' }

export type Messages = Record<string, string>

export const locales: Record<string, Messages> = {
  bg: bg as Messages,
  en: en as Messages,
}

export const sourceLocale = 'bg'
