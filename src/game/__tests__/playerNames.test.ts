import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import { closeJanuary, kickOff, replayUserMatch, toKickoff } from '../logic/quick'
import { createGame } from '../logic/setup'
import { tidyPlayerName, tidyUniverseNames } from '../logic/playerNames'
import type { Game, GameSettings } from '../types'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const STRAY = /,\d+$/

describe('player names as the game shows them', { timeout: 180_000 }, () => {
  it('drops the source\'s stray ",NN" and leaves every other name alone', () => {
    expect(tidyPlayerName('D. Cousin,20')).toBe('D. Cousin')
    expect(tidyPlayerName('B. McCarthy,27')).toBe('B. McCarthy')
    expect(tidyPlayerName('P. da Silva Moutinho,28')).toBe('P. da Silva Moutinho')
    expect(tidyPlayerName('D. Cousin , 20 ')).toBe('D. Cousin')
    for (const name of ['C. Fabregas', 'R. van Persie', 'Pepe', 'N. Kanté', "S. O'Neil", 'J. Smith-Rowe', ',12']) expect(tidyPlayerName(name)).toBe(name)
  })

  it('cleans every faulty name in the seven packs, in the index and in every squad, and nothing else', () => {
    const raw = loadTestUniverse(ALL)
    const u = loadTestUniverse(ALL)
    // 54 league-and-name pairs, 53 names: J. Inamoto,20 is in the German and the French pack
    const faulty = new Set(Object.values(raw.index).filter((p) => STRAY.test(p.name)).map((p) => p.name))
    expect(faulty.size).toBe(53)
    const { universe, tidied } = tidyUniverseNames(u)
    expect(universe).toBe(u)
    expect(tidied).toBe(Object.values(raw.index).filter((p) => STRAY.test(p.name)).length)
    for (const cs of u.clubSeasons) for (const p of cs.squad) expect(p.name).not.toMatch(STRAY)
    // Ids, ratings and every other field are untouched; only those names changed
    expect(Object.keys(u.index)).toEqual(Object.keys(raw.index))
    for (const [id, p] of Object.entries(raw.index)) {
      const q = u.index[id]
      expect({ ...q, name: '' }).toEqual({ ...p, name: '' })
      expect(q.name).toBe(STRAY.test(p.name) ? p.name.replace(STRAY, '') : p.name)
    }
    // Idempotent: a cached pack merged again is safe
    expect(tidyUniverseNames(u).tidied).toBe(0)
  })

  it('moves no seeded game: quick seasons on a raw and a tidied universe differ only by those names', () => {
    const raw = loadTestUniverse(['england', 'portugal'])
    const tidy = tidyUniverseNames(loadTestUniverse(['england', 'portugal'])).universe
    const renames = Object.values(raw.index).filter((p) => STRAY.test(p.name)).map((p) => [p.name, p.name.replace(STRAY, '')] as const)
    const settings = (seed: string, leagueId: string, hostClubId: string, leagueSeason: number): GameSettings => ({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Names XI', shortName: 'NAM', leagueId, wheelLeagues: [leagueId], hostClubId, leagueSeason, rules: { ...QUICK_RULES, leagues: [leagueId] }, jobSecurity: false, difficulty: 'calibrated', january: true, continental: false })
    const fix = (text: string): string => {
      for (const [from, to] of renames) text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1))
      return text
    }
    // The clubs whose squads hold a faulty name, by club-season
    const faultyClubs = new Set(Object.values(raw.index).filter((p) => STRAY.test(p.name)).map((p) => `${p.clubId}@${p.season}`))
    const play = (u: LoadedUniverse, s: GameSettings): { game: string; matches: string[] } => {
      const g: Game = createGame(s)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, u)
      kickOff(g, u)
      if (g.phase === 'january') closeJanuary(g, u, g.quickJanuary?.listings.length ? 0 : null)
      // Every match against a side holding a faulty name, replayed event by event (the texts carry the names)
      const weeks = (g.quickResult?.results ?? []).filter((r) => faultyClubs.has(`${r.opponentId}@${s.leagueSeason}`)).map((r) => r.matchweek).slice(0, 2)
      const matches = weeks.map((w) => JSON.stringify(replayUserMatch(g, u, w)?.result.events ?? null))
      // Everything but the game's id and creation time (a clock, not the seed)
      const { id: _id, createdAt: _at, ...rest } = g
      void _id
      void _at
      return { game: JSON.stringify(rest), matches }
    }
    let named = 0
    // Seasons whose AI sides hold the faulty names (Hull, Blackburn, Middlesbrough in 2008-09; Académica, Naval, Rio Ave in Portugal)
    const cases: Array<[string, string, number]> = [['england', 'arsenal', 2008], ['england', 'everton', 2009], ['england', 'fulham', 2011], ['portugal', 'benfica', 2008], ['portugal', 'fc-porto', 2009]]
    for (const [leagueId, host, season] of cases) {
      const s = settings(`names-${leagueId}-${season}`, leagueId, host, season)
      const before = play(raw, s)
      const after = play(tidy, s)
      expect(after.game).toBe(fix(before.game))
      expect(after.matches).toEqual(before.matches.map(fix))
      for (const m of before.matches) if (renames.some(([from]) => m.includes(from))) named++
      for (const m of after.matches) expect(m).not.toMatch(/[A-Za-z],\d+[ .!:']/)
    }
    // The faulty names really were in play, so the comparison proved something
    expect(named).toBeGreaterThan(0)
  })
})
