import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { advanceDay, closedWindowLine } from '../logic/marketOps'
import { playMatchweek } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { beginSeason } from '../logic/setup'
import { SQUAD_CAP } from '../logic/marketOps'
import { autoDraft } from '@engine/draft'
import { Rng } from '@engine/rng'
import { newSquadPlayer } from '@engine/season'
import { seasonRecords } from '../logic/seasonRecords'
import { USER_TEAM, type SeasonState } from '@engine/season'
import { seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])

describe('Season polish', () => {
  it('the closed market says January before the halfway point, then the summer or nothing', () => {
    const g = seasonGame(u, 'polish-window')
    expect(closedWindowLine(g)).toContain('January opens')
    for (let i = 0; i < 19; i++) {
      playMatchweek(g, u, true)
      if (g.phase === 'match') g.phase = 'week'
    }
    expect(g.window?.kind).toBe('january')
    while (g.window) advanceDay(g, u)
    expect(closedWindowLine(g)).toBe('Window closed: no more windows this season.')
    g.settings.mode = 'dynasty'
    expect(closedWindowLine(g)).toContain('summer window opens after the last matchweek')
  })
  it('a Dynasty summer never drafts the squad past the cap', () => {
    for (const seed of ['polish-cap-a', 'polish-cap-b', 'polish-cap-c']) {
      const g = seasonGame(u, seed)
      g.settings.mode = 'dynasty'
      while (g.phase !== 'summary') {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
      }
      // Fill the squad to the cap with young men on long deals, so few leave in the summer
      const owned = new Set(Object.keys(g.squad).map((id) => u.index[id]?.playerId))
      for (const p of u.clubSeasons.flatMap((cs) => cs.squad)) {
        if (Object.keys(g.squad).length >= SQUAD_CAP) break
        if (p.age > 24 || owned.has(p.playerId)) continue
        owned.add(p.playerId)
        g.squad[p.id] = newSquadPlayer(p.id, { morale: 80 })
        g.contracts[p.id] = { years: 4 }
      }
      g.bonusSpins = 1
      expect(Object.keys(g.squad).length).toBe(SQUAD_CAP)
      advanceToNextSeason(g, u)
      expect(Object.keys(g.squad).length + g.bonusSpins).toBeLessThanOrEqual(SQUAD_CAP)
      expect(g.draft!.rules.squadSize).toBeLessThanOrEqual(SQUAD_CAP)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      expect(Object.keys(g.squad).length).toBeLessThanOrEqual(SQUAD_CAP)
    }
  })
  it('season records give our score first, away wins included', () => {
    const g = seasonGame(u, 'polish-records', 12)
    const r = seasonRecords(g.season!, (id) => u.clubById[id]?.name ?? id)!
    expect(r.played).toBe(12)
    const mine = g.season!.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
    const margins = mine.map((f) => (f.homeTeamId === USER_TEAM ? 1 : -1) * (f.result!.homeGoals - f.result!.awayGoals))
    if (Math.max(...margins) > 0) {
      const [gf, ga] = r.bigWin.split(' ')[0].split('-').map(Number)
      expect(gf - ga).toBe(Math.max(...margins))
    }
    // An away win written as the fixture reads (home goals first) would show a loss's score
    const away = { ...g.season!, fixtures: [{ matchweek: 1, homeTeamId: 'nottingham-forest', awayTeamId: USER_TEAM, result: { homeGoals: 0, awayGoals: 9 } }] } as unknown as SeasonState
    expect(seasonRecords(away, () => 'Forest')!.bigWin).toBe('9-0 at Forest (MW 1)')
    expect(seasonRecords(away, () => 'Forest')!.bigLoss).toBe('–')
  })
})
