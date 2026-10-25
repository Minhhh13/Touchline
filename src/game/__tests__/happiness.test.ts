import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import type { MoraleEntry } from '@engine/types'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { talkTo } from '../logic/talks'
import { setSquadStatus } from '../logic/squad'
import { describeMorale, happinessOf, logMorale, MORALE_LOG_CAP } from '../logic/happiness'
import { normaliseGame } from '../logic/save'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-4-2', teamName: 'Mood XI', shortName: 'MOO', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'fulham', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function seeded(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('the happiness log', () => {
  it('accounts for every morale change of a 10-week auto-managed season, capped at six entries', () => {
    let checked = 0
    for (const seed of ['mood-1', 'mood-2', 'mood-3']) {
      const g = seeded(seed)
      const ids = Object.keys(g.squad)
      for (let w = 0; w < 10; w++) {
        const before = new Map(ids.filter((id) => g.squad[id]).map((id) => [id, { morale: g.squad[id].morale, log: new Set<MoraleEntry>(g.squad[id].moraleLog ?? []) }]))
        // The manager's own levers move morale too: a word with one player and a status change for another
        const [a, b] = Object.keys(g.squad)
        talkTo(g, u, a, w % 2 ? 'praise' : 'reassure')
        if (w === 3) setSquadStatus(g, u, b, 'backup')
        playMatchweek(g, u, true)
        for (const [id, was] of before) {
          const s = g.squad[id]
          if (!s) continue
          const log = s.moraleLog ?? []
          expect(log.length).toBeLessThanOrEqual(MORALE_LOG_CAP)
          const added = log.filter((e) => !was.log.has(e))
          // A week with more changes than the cap keeps only the newest; nothing older to compare against
          if (added.length >= MORALE_LOG_CAP) continue
          const sum = added.reduce((t, e) => t + e.d, 0)
          expect(Math.abs(sum - (s.morale - was.morale))).toBeLessThanOrEqual(0.06 * (added.length + 1))
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  }, 120_000)

  it('names every cause in a short line', () => {
    const g = seeded('mood-lines')
    for (let w = 0; w < 6; w++) playMatchweek(g, u, true)
    const reasons = new Set<string>()
    for (const s of Object.values(g.squad)) {
      for (const e of s.moraleLog ?? []) {
        reasons.add(e.r)
        const text = describeMorale(e)
        expect(text.length).toBeGreaterThan(3)
        expect(text.length).toBeLessThanOrEqual(60)
      }
      const h = happinessOf(s)
      expect(h.lines.length).toBe((s.moraleLog ?? []).length)
      if (h.lines.length > 1) expect(h.lines[0].week).toBeGreaterThanOrEqual(h.lines[h.lines.length - 1].week)
    }
    expect(reasons.has('result')).toBe(true)
    expect(describeMorale({ w: 3, d: 4.2, r: 'result', n: 'W 7.4' })).toBe('Win, rated 7.4')
    expect(describeMorale({ w: 3, d: -2, r: 'minutes', n: '30/85' })).toBe('Playing time 30% (expects 85%)')
    expect(describeMorale({ w: 3, d: 6, r: 'talk', n: 'praise' })).toBe('Praise his form')
  }, 60_000)

  it('drops a change that rounds to nothing and keeps only the newest entries', () => {
    const s = seeded('mood-cap').squad
    const p = Object.values(s)[0]
    const m = p.morale
    logMorale(p, 1, m, 'captain')
    expect(p.moraleLog ?? []).toEqual([])
    for (let i = 0; i < 10; i++) {
      const before = p.morale
      p.morale += 1
      logMorale(p, i, before, 'captain')
    }
    expect(p.moraleLog!.length).toBe(MORALE_LOG_CAP)
    expect(p.moraleLog![MORALE_LOG_CAP - 1].w).toBe(9)
  })

  it('loads a save without the log, and trims or drops a bad one', () => {
    const g = seeded('mood-old')
    playMatchweek(g, u, true)
    const old = JSON.parse(JSON.stringify(g)) as Game
    for (const s of Object.values(old.squad)) delete s.moraleLog
    const n = normaliseGame(old)!
    expect(Object.values(n.squad).every((s) => s.moraleLog === undefined)).toBe(true)
    playMatchweek(n, u, true)
    expect(Object.values(n.squad).some((s) => (s.moraleLog?.length ?? 0) > 0)).toBe(true)
    const [x, y] = Object.keys(old.squad)
    old.squad[x].moraleLog = Array.from({ length: 9 }, (_, i) => ({ w: i, d: 1, r: 'captain' as const }))
    ;(old.squad[y] as unknown as Record<string, unknown>).moraleLog = 'junk'
    const t = normaliseGame(old)!
    expect(t.squad[x].moraleLog!.map((e) => e.w)).toEqual([3, 4, 5, 6, 7, 8])
    expect(t.squad[y].moraleLog).toBeUndefined()
  }, 60_000)
})
