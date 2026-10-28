import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, type DraftRules } from '@engine/draft'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import { primeOf } from '@engine/prime'
import { wheelSeasons } from '@engine/era'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { createGame, dailyGameSettings } from '../logic/setup'
import { tierTable } from '../logic/rarity'
import type { Game, GameSettings } from '../types'

/**
 * The release line's features that came after the classic gate (Prime ratings, the bench, Position First, the
 * quick season's January window and Europe, the reel's tiers, the era slider) must give a standard game exactly
 * what they gave before the classic pack existed: the same game on England's standard pack alone and on the
 * pack with the sixteen classic seasons loaded beside it.
 */

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', rel), 'utf8')) as T

function standardOnly(): LoadedUniverse {
  const players = read<PlayersFile>('england/players.json')
  const meta = read<MetaFile>('england/meta.json')
  const index = read<LeaguesFile>('leagues.json')
  return mergeUniverses([buildLeague(players, { ...meta, seasons: meta.seasons.filter((s) => !s.classic) })], index.leagues, index.generatedAt)
}

const standard = standardOnly()
const full = loadTestUniverse()

function settings(seed: string, rules: Partial<DraftRules>, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Gate XI', shortName: 'GAT', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated', january: true, continental: false, ...partial }
}

/** A whole quick season: the assistant drafts, the season kicks off, the first January listing is taken. */
function play(u: LoadedUniverse, s: GameSettings): unknown {
  const g: Game = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  if (g.phase === 'january') closeJanuary(g, u, g.quickJanuary?.listings.length ? 0 : null)
  return { lineup: g.lineup, bench: g.draft?.bench, history: g.draft?.history, january: g.quickJanuary, result: g.quickResult, rng: g.rngState, custom: g.customPlayers }
}

describe('the classic pack moves no standard game on the release line', { timeout: 180_000 }, () => {
  it('loads the classic seasons only beside the standard ones', () => {
    expect(standard.classicFirstSeason).toBeUndefined()
    expect(full.classicFirstSeason).toBe(1992)
    expect(full.clubSeasons.filter((cs) => !cs.classic).map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(standard.clubSeasons.map((cs) => `${cs.clubId}@${cs.season}`))
  })

  it('Prime ratings ignore classic seasons unless the game opts in', () => {
    let lifted = 0
    for (const cs of standard.clubSeasons) {
      for (const p of cs.squad) {
        expect(primeOf(full, p.playerId, ['england'])!.id).toBe(primeOf(standard, p.playerId, ['england'])!.id)
        // Opted in, a classic season can be his best
        if (primeOf(full, p.playerId, ['england'], true)!.overall > primeOf(standard, p.playerId, ['england'])!.overall) lifted++
      }
    }
    expect(lifted).toBeGreaterThan(0)
  })

  it('the reel tiers of every standard club-season and the era slider are unchanged', () => {
    const before = tierTable(standard, ['england'])
    const after = tierTable(full, ['england'])
    for (const [key, tier] of Object.entries(before)) expect(after[key]).toBe(tier)
    expect(Object.keys(after).length).toBe(full.clubSeasons.length)
    expect(wheelSeasons(full, ['england'])).toEqual(wheelSeasons(standard, ['england']))
  })

  it('seeded quick seasons with Prime, the bench, Position First, January and Europe play identically', () => {
    const cases: Array<[string, Partial<DraftRules>, Partial<GameSettings>]> = [
      ['gate-plain', {}, {}],
      ['gate-prime', { ratings: 'prime' }, {}],
      ['gate-bench', { benchPicks: 5 }, {}],
      ['gate-position', { draftMode: 'position' }, {}],
      ['gate-hard', { difficulty: 'hard', hardMode: true, respins: 0, showRatings: false }, {}],
      ['gate-europe', { benchPicks: 3, ratings: 'prime' }, { continental: true, leagueSeason: 2015, hostClubId: 'chelsea' }],
      ['gate-era', { fromSeason: 2008, toSeason: 2012 }, {}],
    ]
    for (const [seed, rules, partial] of cases) {
      for (let i = 0; i < 3; i++) expect(play(full, settings(`${seed}-${i}`, rules, partial))).toEqual(play(standard, settings(`${seed}-${i}`, rules, partial)))
    }
  })

  it('the Daily is the same game on both, settings and season', () => {
    // 2026-10-30 is the rotation's first day, a Premier League one (DAILY_EPOCHS); its other leagues have no classic pack
    for (const date of ['2026-10-25', '2026-01-01', '2026-10-30', '2025-07-14']) {
      const seed = `daily-${date}`
      const a = dailyGameSettings(full, seed)
      expect(a).toEqual(dailyGameSettings(standard, seed))
      expect(a.rules.classic).toBeUndefined()
      expect(play(full, a)).toEqual(play(standard, a))
    }
  })
})
