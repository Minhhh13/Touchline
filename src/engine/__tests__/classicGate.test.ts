import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, newDraft, QUICK_RULES, SEASON_RULES, spin, wheelPool } from '../draft'
import { getFormation } from '../formations'
import { openWindow } from '../market'
import { nationCover } from '../nations'
import { buildContinentalClubs } from '../season'
import { isRulesDiff } from '../challenge'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'
import { dailySettings } from '../../game/logic/setup'

/**
 * Classic seasons are opt-in and sit after every standard club-season, so
 * loading them must not change any existing seed: the Daily, a seeded draft,
 * the market, the One-Nation scan and the Continental Cup field.
 */

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', rel), 'utf8')) as T
const index = read<LeaguesFile>('leagues.json')

/** A league's standard pack only (no classic rows, no classic seasons). */
function standardPack(id: string): { players: PlayersFile; meta: MetaFile } {
  const players = read<PlayersFile>(`${id}/players.json`)
  const meta = read<MetaFile>(`${id}/meta.json`)
  return { players, meta: { ...meta, seasons: meta.seasons.filter((s) => !s.classic) } }
}

/** The standard pack plus a synthetic classic 2007-08: the 2008-09 squads and table relabelled one season earlier. */
function withSyntheticClassic(id: string): { players: PlayersFile; meta: MetaFile; classic: PlayersFile } {
  const { players, meta } = standardPack(id)
  const si = players.columns.indexOf('season')
  const src = meta.seasons.find((s) => s.season === 2008)!
  const classic: PlayersFile = { ...players, rows: players.rows.filter((r) => r[si] === 2008).map((r) => r.map((v, i) => (i === si ? 2007 : v))) }
  const historicTables = Object.fromEntries(Object.entries(meta.historicTables).filter(([s]) => s !== '2007'))
  return { players, classic, meta: { ...meta, historicTables, seasons: [...meta.seasons, { ...src, season: 2007, classic: true, ratingsSource: 'estimated' }] } }
}

function universe(ids: string[], classic: boolean): LoadedUniverse {
  const parts = ids.map((id) => {
    if (!classic) { const p = standardPack(id); return buildLeague(p.players, p.meta) }
    const p = withSyntheticClassic(id)
    return id === 'england' ? buildLeague(p.players, p.meta, undefined, p.classic) : buildLeague(p.players, standardPack(id).meta)
  })
  return mergeUniverses(parts, index.leagues, index.generatedAt)
}

const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const dailySeeds = Array.from({ length: 60 }, (_, i) => `daily-2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`)
function drafts(u: LoadedUniverse, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => {
    const d = newDraft(getFormation('4-3-3'), QUICK_RULES)
    autoDraft(u, d, new Rng(`classic-gate-${i}`))
    return [d.lineup, d.usedClubSeasons]
  })
}

// Captured on the preview build before the gate existed (commit faba5a6, no classic data): every seed below
// must keep giving exactly these results whatever classic data is loaded.
const DAILY_BASELINE = '864bd1f65ca018e5dc3a7b668d391936d7207c3d395c2b34f40ad4501ff4bede'
const DRAFTS_BASELINE = 'c1e73264fda4f0fb39b3063747f964a47dcc80ec3f6bca5727a6447e37fc994d'

describe('classic gate', () => {
  const base = universe(['england'], false)
  const synth = universe(['england'], true)

  it('appends classic club-seasons after every standard one, flagged and estimated', () => {
    const standard = synth.clubSeasons.filter((cs) => !cs.classic)
    expect(standard.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(base.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
    const firstClassic = synth.clubSeasons.findIndex((cs) => cs.classic)
    expect(firstClassic).toBe(base.clubSeasons.length)
    expect(synth.clubSeasons.slice(firstClassic).every((cs) => cs.classic && cs.estimated && cs.season === 2007)).toBe(true)
    expect(synth.firstSeason).toBe(base.firstSeason)
    expect(synth.classicFirstSeason).toBe(2007)
    expect(base.classicFirstSeason).toBeUndefined()
  })

  it('loads classic rows only for seasons the meta marks classic (a stale meta.json, or a stray standard-season row)', () => {
    const p = withSyntheticClassic('england')
    const sample = p.players.rows.find((r) => r[p.players.columns.indexOf('season')] === 2008)!
    // a row in the classic file for a standard season must not replace the standard player-season
    const stray = sample.map((v, i) => (p.players.columns[i] === 'ovr' ? 99 : v))
    const classic: PlayersFile = { ...p.classic, rows: [...p.classic.rows, stray] }
    const loaded = buildLeague(p.players, p.meta, undefined, classic)
    const strayId = `${sample[p.players.columns.indexOf('id')]}@2008@${sample[p.players.columns.indexOf('club')]}`
    expect(loaded.index[strayId].overall).toBe(base.index[strayId].overall)
    // the classic file with a meta.json from before the classic seasons: nothing classic loads at all
    const stale = buildLeague(p.players, standardPack('england').meta, undefined, classic)
    expect(Object.keys(stale.index)).toEqual(Object.keys(base.index))
    expect(stale.clubSeasons.some((cs) => cs.classic)).toBe(false)
  })

  it('keeps standard club-seasons first across merged leagues', () => {
    const merged = universe(['england', 'spain'], true)
    const firstClassic = merged.clubSeasons.findIndex((cs) => cs.classic)
    expect(merged.clubSeasons.slice(0, firstClassic).some((cs) => cs.leagueId === 'spain')).toBe(true)
    expect(merged.clubSeasons.slice(firstClassic).every((cs) => cs.classic)).toBe(true)
  })

  it('gives the first 60 Daily seeds the same settings with or without classic seasons, as before the gate', () => {
    const a = dailySeeds.map((s) => dailySettings(base, s))
    const b = dailySeeds.map((s) => dailySettings(synth, s))
    const c = dailySeeds.map((s) => dailySettings(loadTestUniverse(), s))
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(hash(a)).toBe(DAILY_BASELINE)
    expect(a.some((d) => d.season < 2008)).toBe(false)
  }, 60_000)

  it('spins 200 seeded drafts identically with classic seasons loaded and no classic rule', () => {
    const a = drafts(base, 200)
    expect(drafts(synth, 200)).toEqual(a)
    expect(hash(a)).toBe(DRAFTS_BASELINE)
    expect(hash(drafts(loadTestUniverse(), 200))).toBe(DRAFTS_BASELINE)
  }, 180_000)

  it('lands on a classic club-season once the rules opt in', () => {
    const off = newDraft(getFormation('4-4-2'), { ...QUICK_RULES, toSeason: 2007 })
    expect(wheelPool(synth, off).length).toBe(0)
    const on = newDraft(getFormation('4-4-2'), { ...QUICK_RULES, classic: true })
    expect(wheelPool(synth, on).some((cs) => cs.classic)).toBe(true)
    let hits = 0
    for (let i = 0; i < 200; i++) {
      const d = newDraft(getFormation('4-4-2'), { ...QUICK_RULES, classic: true, toSeason: 2007 })
      const cs = spin(synth, d, new Rng(`classic-on-${i}`))
      expect(cs.classic).toBe(true)
      hits++
    }
    expect(hits).toBe(200)
    expect(isRulesDiff({ classic: true })).toBe(true)
    expect(isRulesDiff({ classic: 'yes' })).toBe(false)
  })

  it('leaves the market, the One-Nation scan and the Continental Cup field unchanged without the opt-in', () => {
    const two = universe(['england', 'spain'], false)
    const twoClassic = universe(['england', 'spain'], true)
    for (let i = 0; i < 20; i++) {
      const ctx = (u: LoadedUniverse) => ({ u, rng: new Rng(`classic-market-${i}`), ownedPlayerIds: new Set<string>(), leagueSeason: 2008 + (i % 5), priceLevel: 1 })
      expect(openWindow(ctx(twoClassic), 'summer').listings).toEqual(openWindow(ctx(two), 'summer').listings)
    }
    expect(nationCover(twoClassic, ['england', 'spain'], {}, getFormation('4-3-3'))).toEqual(nationCover(two, ['england', 'spain'], {}, getFormation('4-3-3')))
    // Spain 2008-09 takes its top-up from seasons within one year: the classic 2007-08 must not enter it
    for (const [league, season, host] of [['spain', 2008, 'real-madrid'], ['england', 2008, 'chelsea']] as const) {
      expect(Object.keys(buildContinentalClubs(twoClassic, league, season, host))).toEqual(Object.keys(buildContinentalClubs(two, league, season, host)))
    }
    // With the opt-in the market may list classic players
    const listings = Array.from({ length: 10 }, (_, i) => openWindow({ u: synth, rng: new Rng(`classic-market-on-${i}`), ownedPlayerIds: new Set<string>(), leagueSeason: 2007, priceLevel: 1, classic: true }, 'summer').listings).flat()
    expect(listings.some((l) => synth.index[l.playerSeasonId]?.season === 2007)).toBe(true)
  }, 60_000)

  it('treats a season-squad draft the same way', () => {
    const run = (u: LoadedUniverse) => { const d = newDraft(getFormation('4-2-3-1'), SEASON_RULES); autoDraft(u, d, new Rng('classic-season-squad')); return [d.lineup, d.bench] }
    expect(run(synth)).toEqual(run(base))
  })
})
