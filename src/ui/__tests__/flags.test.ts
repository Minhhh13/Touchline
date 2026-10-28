import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import type { LeaguesFile } from '@engine/universe'
import { FALLBACK_FLAG, flagCodeFromEmoji, leagueFlagCode, nationFlagCode } from '../format'
import { COUNTRY_CODES } from '../online/countries'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const FLAGS = path.join(ROOT, 'public', 'flags')
const svg = (code: string) => path.join(FLAGS, `${code}.svg`)
const index = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'leagues.json'), 'utf8')) as LeaguesFile
const ALL = index.leagues.map((l) => l.id)

/** Every UI source file, outside the tests. */
function uiSources(dir = path.join(ROOT, 'src', 'ui')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : uiSources(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}

describe('drawn flags', () => {
  it('derives flag-icons codes from the emoji the data carries', () => {
    expect(flagCodeFromEmoji('🇧🇪')).toBe('be')
    expect(flagCodeFromEmoji('🇦🇷')).toBe('ar')
    expect(flagCodeFromEmoji('🏴󠁧󠁢󠁥󠁮󠁧󠁿')).toBe('gb-eng')
    expect(flagCodeFromEmoji('🏴󠁧󠁢󠁳󠁣󠁴󠁿')).toBe('gb-sct')
    expect(flagCodeFromEmoji('🏴󠁧󠁢󠁷󠁬󠁳󠁿')).toBe('gb-wls')
    expect(flagCodeFromEmoji('🏳️')).toBeNull()
    expect(flagCodeFromEmoji('')).toBeNull()
    expect(flagCodeFromEmoji('BE')).toBeNull()
  })

  it('gives every league, and Europe, a flag whose SVG ships in public/flags', () => {
    const want: Record<string, string> = { england: 'gb-eng', spain: 'es', italy: 'it', germany: 'de', france: 'fr', netherlands: 'nl', portugal: 'pt', europe: 'eu' }
    for (const id of [...ALL, 'europe']) {
      expect(leagueFlagCode(id), id).toBe(want[id])
      expect(existsSync(svg(leagueFlagCode(id))), `${id}: ${leagueFlagCode(id)}.svg`).toBe(true)
    }
  })

  it('maps every nation in all seven packs to a shipped SVG, with only Unknown on the fallback', () => {
    const u = loadTestUniverse(ALL)
    const onFallback: string[] = []
    for (const nation of Object.keys(u.nations)) {
      const code = nationFlagCode(u, nation)
      expect(existsSync(svg(code)), `${nation} (${u.nations[nation].name}) -> ${code}.svg`).toBe(true)
      if (code === FALLBACK_FLAG) onFallback.push(nation)
    }
    expect(Object.keys(u.nations).length).toBeGreaterThan(150)
    expect(onFallback).toEqual(['UNK'])
    // The home nations each get their own flag; Northern Ireland's emoji in the data is the UK's
    expect(['ENG', 'SCO', 'WAL', 'NIR'].map((n) => nationFlagCode(u, n))).toEqual(['gb-eng', 'gb-sct', 'gb-wls', 'gb-nir'])
    expect(nationFlagCode(u, 'BEL')).toBe('be')
    expect(nationFlagCode(null, 'BEL')).toBe(FALLBACK_FLAG)
  })

  it('draws every country an account may carry (the World boards, the account chip), never its two letters', () => {
    const missing = COUNTRY_CODES.map((c) => c.toLowerCase()).filter((c) => !existsSync(svg(c)))
    expect(COUNTRY_CODES.length).toBeGreaterThan(200)
    expect(missing).toEqual([])
  })

  it('ships no stray or active SVG, the fallback of our own and the MIT notice', () => {
    const u = loadTestUniverse(ALL)
    const needed = new Set([...Object.keys(u.nations).map((n) => nationFlagCode(u, n)), ...[...ALL, 'europe'].map(leagueFlagCode), ...COUNTRY_CODES.map((c) => c.toLowerCase()), FALLBACK_FLAG])
    const files = readdirSync(FLAGS)
    for (const f of files.filter((x) => x.endsWith('.svg'))) {
      expect(needed.has(f.replace(/\.svg$/, '')), `${f} is not needed by any nation, league or account country`).toBe(true)
      const text = readFileSync(path.join(FLAGS, f), 'utf8')
      expect(text.startsWith('<svg'), f).toBe(true)
      expect(/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(text), `${f} has active content`).toBe(false)
    }
    const licence = readFileSync(path.join(FLAGS, 'LICENSE.txt'), 'utf8')
    expect(licence).toMatch(/flag-icons 7\.6\.0/)
    expect(licence).toMatch(/MIT License/)
    expect(licence).toMatch(/Panayiotis Lipiridis/)
  })

  it('never renders an emoji flag: no UI source reads a nation\'s emoji or carries a flag emoji', () => {
    const ri = /[\u{1F1E6}-\u{1F1FF}]|\u{1F3F4}[\u{E0020}-\u{E007F}]/u
    for (const file of uiSources()) {
      const text = readFileSync(file, 'utf8')
      const rel = path.relative(ROOT, file)
      expect(ri.test(text), `${rel} contains a flag emoji`).toBe(false)
      // format.ts derives the drawn flag from the emoji; nothing else may print it
      if (rel !== path.join('src', 'ui', 'format.ts')) {
        expect(/\bflag\(u\b|\.flag\b(?!-)/.test(text.replace(/className="flag"/g, '')), `${rel} reads an emoji flag`).toBe(false)
      }
    }
  })
})
