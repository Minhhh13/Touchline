import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { REAL_PLACES, TEAM_NAME_MAX, TEAM_PLACES, TEAM_SAINTS, TEAM_SUFFIXES, generateTeamName, generatedTeamCode } from '../logic/teamNames'

const england = loadTestUniverse()
const all = loadTestUniverse(england.available.map((l) => l.id))
const lower = (s: string) => s.trim().toLowerCase()
const realNames = new Set(all.clubs.flatMap((c) => [c.name, c.shortName]).map(lower))
/** Every word of every club name in the packs ("Blackburn", "Rovers", "Sporting"...). */
const realWords = new Set(all.clubs.flatMap((c) => [c.name, c.shortName]).flatMap((n) => n.split(/[\s.-]+/)).map(lower))

const seeded = (seed: string) => {
  const rng = new Rng(seed)
  return () => rng.next()
}

describe('the invented team names', () => {
  it('is deterministic for a seeded source: the same seed gives the same names', () => {
    const a = seeded('team-names-1')
    const b = seeded('team-names-1')
    const c = seeded('team-names-2')
    const one = Array.from({ length: 50 }, () => generateTeamName(a))
    expect(Array.from({ length: 50 }, () => generateTeamName(b))).toEqual(one)
    expect(Array.from({ length: 50 }, () => generateTeamName(c))).not.toEqual(one)
  })

  it('never yields a club in the packs over 10,000 draws, and each code is three capital letters', () => {
    expect(all.clubs.length).toBeGreaterThan(200)
    const random = seeded('team-names-10k')
    const seen = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      const { name, code } = generateTeamName(random)
      expect(realNames.has(lower(name))).toBe(false)
      expect(name).not.toBe('Touchline XI')
      expect(name.length).toBeLessThanOrEqual(TEAM_NAME_MAX)
      expect(code).toMatch(/^[A-Z]{3}$/)
      // The screens read the code back from the name alone
      expect(generatedTeamCode(name)).toBe(code)
      seen.add(name)
    }
    // Plenty of variety, every place reached
    expect(seen.size).toBeGreaterThan(1000)
    expect(TEAM_PLACES.every((p) => [...seen].some((n) => n.includes(p)))).toBe(true)
  })

  it('builds every name from invented places: none is a word of a real club, none a real town with a club of note', () => {
    expect(new Set(TEAM_PLACES).size).toBe(TEAM_PLACES.length)
    for (const place of TEAM_PLACES) {
      for (const word of place.split(' ')) expect(realWords.has(lower(word)), place).toBe(false)
      expect(REAL_PLACES.map(lower)).not.toContain(lower(place))
      // Letters and spaces only, every word capitalised (no slang, nothing to translate)
      expect(place).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/)
      // The longest shape still fits a challenge link's 24 characters
      for (const s of TEAM_SUFFIXES) expect(`${place} ${s}`.length).toBeLessThanOrEqual(TEAM_NAME_MAX)
    }
    for (const saint of TEAM_SAINTS) expect(REAL_PLACES).not.toContain(`St ${saint}`)
    for (const w of [...TEAM_SUFFIXES, ...TEAM_SAINTS]) expect(w).toMatch(/^[A-Z][a-z]+$/)
  })

  it('never lands on the name in the field or the other manager\'s, whatever the case or spacing', () => {
    const random = seeded('team-names-avoid')
    for (let i = 0; i < 2000; i++) {
      const mine = generateTeamName(random).name
      const other = generateTeamName(random).name
      const next = generateTeamName(random, [mine, `  ${other.toUpperCase()} `]).name
      expect(next).not.toBe(mine)
      expect(next).not.toBe(other)
    }
  })

  it('stays in range at the edges of the source', () => {
    for (const r of [0, 0.9999999, 1]) {
      const { name, code } = generateTeamName(() => r)
      expect(generatedTeamCode(name)).toBe(code)
    }
  })

  it('gives no invented code to a typed name, so it keeps the initials it always had', () => {
    for (const typed of ['Touchline XI', 'QA XI', 'Arsenal', 'Ashvale', 'Ashvale Hotspur', 'St Ives Town', 'AFC Bournemouth', 'Real Ashvale', '']) expect(generatedTeamCode(typed)).toBeNull()
    expect(generatedTeamCode('Ashvale United')).toBe('ASH')
    expect(generatedTeamCode('  AFC Lowfield ')).toBe('LOW')
    expect(generatedTeamCode('St Oswin Town')).toBe('STO')
    expect(generatedTeamCode('Lantern Hill Rovers')).toBe('LAN')
  })
})
