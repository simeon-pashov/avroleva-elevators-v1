import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, string>
const bg = load('bg.json')
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'bg.json')

describe('i18n completeness (bg.json is the source of truth)', () => {
  it('bg.json has no empty values', () => {
    const empty = Object.entries(bg).filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    expect(empty).toEqual([])
  })

  for (const file of files) {
    it(`${file} contains every key of bg.json`, () => {
      const other = load(file)
      const missing = Object.keys(bg).filter((k) => !(k in other) || other[k]?.trim() === '')
      expect(missing).toEqual([])
    })
    it(`${file} has no keys that bg.json lacks`, () => {
      const other = load(file)
      const extra = Object.keys(other).filter((k) => !(k in bg))
      expect(extra).toEqual([])
    })
  }

  it('every locale file is registered in locales/index.ts', () => {
    const index = readFileSync(join(dir, 'index.ts'), 'utf8')
    for (const f of ['bg.json', ...files]) expect(index).toContain(`./${f}`)
  })
})
