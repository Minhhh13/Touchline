import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import type { LeaguesFile, MetaFile, PlayersFile } from '../universe'

/**
 * The classic Premier League pack (1992-93 to 2007-08): real squads and
 * tables with TouchLine's estimated ratings. These are the feel checks of
 * plan item 8 over the shipped file.
 */
const DATA = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(DATA, rel), 'utf8')) as T
const pack = read<PlayersFile>('england/players-classic.json')
const standard = read<PlayersFile>('england/players.json')
const meta = read<MetaFile>('england/meta.json')
const index = read<LeaguesFile>('leagues.json')
const col = Object.fromEntries(pack.columns.map((c, i) => [c, i]))
type Row = Record<string, string | number>
const rows: Row[] = pack.rows.map((r) => Object.fromEntries(pack.columns.map((c) => [c, r[col[c]]])))
const SEASONS = Array.from({ length: 16 }, (_, i) => 1992 + i)
const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'men', 'gk', 'sta', 'str', 'agg', 'jmp', 'wr', 'cons', 'inj', 'big', 'prof']

describe('classic pack', () => {
  const u = loadTestUniverse()

  it('ships 16 seasons in the standard format, every club of every table with 20 to 32 men and two keepers (plan item 7)', () => {
    expect(pack.columns).toEqual(standard.columns)
    expect(pack.version).toBe(standard.version)
    expect(pack.generatedAt).toBe(standard.generatedAt)
    const classic = meta.seasons.filter((s) => s.classic)
    expect(classic.map((s) => s.season)).toEqual(SEASONS)
    expect(index.leagues.find((l) => l.id === 'england')?.classicFrom).toBe(1992)
    for (const s of classic) {
      expect(s.ratingsSource).toBe('estimated')
      expect(s.clubs.length).toBe(s.table.length)
      for (const club of s.clubs) {
        const squad = rows.filter((r) => r.season === s.season && r.club === club)
        expect(squad.length, `${s.season} ${club}`).toBeGreaterThanOrEqual(20)
        expect(squad.length, `${s.season} ${club}`).toBeLessThanOrEqual(32)
        expect(squad.filter((r) => String(r.pos).startsWith('GK')).length, `${s.season} ${club}`).toBeGreaterThanOrEqual(2)
      }
    }
    expect(Object.keys(meta.historicTables).map(Number).filter((s) => s >= 1992 && s <= 2007)).toEqual([])
  })

  it('has no duplicate player in a club-season, no missing value and believable ages', () => {
    const keys = new Set<string>()
    for (const r of rows) {
      const k = `${r.season}|${r.club}|${r.id}`
      expect(keys.has(k), k).toBe(false)
      keys.add(k)
      for (const a of ATTRS) expect(Number.isFinite(r[a]) && (r[a] as number) >= 0 && (r[a] as number) <= 100, `${r.id} ${a}`).toBe(true)
      expect(r.age as number).toBeGreaterThanOrEqual(15)
      expect(r.age as number).toBeLessThanOrEqual(42)
      expect(String(r.id)).toMatch(/^(s\d+|e\d+|wQ\d+)$/)
    }
  })

  it('loads as classic, estimated club-seasons with the real champions', () => {
    const classic = u.clubSeasons.filter((cs) => cs.classic)
    expect(classic.length).toBe(meta.seasons.filter((s) => s.classic).reduce((a, s) => a + s.clubs.length, 0))
    expect(classic.every((cs) => cs.estimated && cs.season <= 2007)).toBe(true)
    expect(u.clubSeasons.findIndex((cs) => cs.classic)).toBe(u.clubSeasons.filter((cs) => !cs.classic).length)
    expect(u.classicFirstSeason).toBe(1992)
    expect(u.firstSeason).toBe(2008)
    const united = u.clubSeasonByKey['manchester-united@1992']
    expect(united.champions).toBe(true)
    expect(united.squad.every((p) => p.accolades.includes('Champion'))).toBe(true)
    expect(u.clubSeasonByKey['arsenal@2003'].champions).toBe(true)
    expect(u.clubSeasonByKey['blackburn-rovers@1994'].champions).toBe(true)
  })

  it('feels right: no club owns the top 15, champions lead at 85-89, the bottom club still has a man in the 70s', () => {
    for (const ms of meta.seasons.filter((s) => s.classic)) {
      const R = rows.filter((r) => r.season === ms.season).sort((a, b) => (b.ovr as number) - (a.ovr as number))
      const per: Record<string, number> = {}
      for (const r of R.slice(0, 15)) per[r.club as string] = (per[r.club as string] ?? 0) + 1
      expect(Math.max(...Object.values(per)), `${ms.season} top 15`).toBeLessThanOrEqual(6)
      const champ = R.filter((r) => r.club === ms.table[0].clubId).slice(0, 3)
      const avg = champ.reduce((a, r) => a + (r.ovr as number), 0) / 3
      expect(avg, `${ms.season} champion top 3`).toBeGreaterThanOrEqual(85)
      expect(avg, `${ms.season} champion top 3`).toBeLessThanOrEqual(89)
      const lastBest = R.find((r) => r.club === ms.table.at(-1)!.clubId)!.ovr as number
      expect(lastBest, `${ms.season} bottom club's best`).toBeGreaterThanOrEqual(74)
      expect(lastBest, `${ms.season} bottom club's best`).toBeLessThanOrEqual(80)
      for (const r of R) if ((r.ovr as number) < 85) for (const a of ATTRS.slice(0, 13)) expect(r[a] as number, `${r.name} ${a}`).toBeLessThanOrEqual(94)
    }
  })

  it('takes a guessed position from the same man\'s first standard season when it is close', () => {
    // the facts list these men only as a midfielder or a defender; their 2008-09 rows say where they played
    const pos = (season: number, club: string, name: string) => String(rows.find((r) => r.season === season && r.club === club && r.name === name)?.pos)
    expect(pos(2007, 'manchester-united', 'C. Ronaldo').split('|')[0]).toBe('RW')
    expect(pos(2006, 'manchester-united', 'C. Ronaldo').split('|')[0]).toBe('RW')
    expect(pos(2007, 'tottenham-hotspur', 'G. Bale').split('|')[0]).toBe('LB')
    expect(pos(2007, 'bolton-wanderers', 'G. Cahill').split('|')[0]).toBe('CB')
  })

  it('stronger clubs carry stronger squads (club strength against final position)', () => {
    for (const ms of meta.seasons.filter((s) => s.classic)) {
      const strength = ms.table.map((t) => {
        const v = rows.filter((r) => r.season === ms.season && r.club === t.clubId).map((r) => r.ovr as number).sort((a, b) => b - a).slice(0, 14)
        return v.reduce((a, x) => a + x, 0) / v.length
      })
      const top = strength.slice(0, 4).reduce((a, x) => a + x, 0) / 4
      const bottom = strength.slice(-3).reduce((a, x) => a + x, 0) / 3
      expect(top - bottom, String(ms.season)).toBeGreaterThan(2)
    }
  })
})
