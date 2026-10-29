import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { buildAiClubs } from '@engine/season'
import { reserveKeeperId } from '@engine/reserve'
import { createGame } from '../logic/setup'
import { scoutOpposition, SCOUT_NOTES } from '../logic/oppositionReport'
import { opponentInput } from '../logic/squadDisplay'
import { getFormation } from '@engine/formations'
import { SEASON_RULES } from '@engine/draft'
import type { Game } from '../types'

const u = loadTestUniverse(['england', 'portugal'])

function aGame(seed: string): Game {
  return createGame({ mode: 'season', seed, formationId: '4-3-3', teamName: 'Scouts XI', shortName: 'SCX', leagueId: 'portugal', wheelLeagues: ['portugal'], hostClubId: 'benfica', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['portugal'] }, jobSecurity: false, difficulty: 'calibrated', continental: false })
}

describe('the opposition report (r8 audit: worked out in logic, the reserve keeper counted)', () => {
  it('reads a side fielding its reserve keeper with all eleven men', () => {
    // Tondela 2025-26 lists no keeper at all, so it always fields its reserve keeper (engine 6, E6-5)
    const game = aGame('r8-scout-tondela')
    const tondela = buildAiClubs(u, 'portugal', 2025, 'benfica').tondela
    expect(tondela).toBeTruthy()
    const scout = scoutOpposition(game, u, tondela, 0)
    expect(scout.xi).toHaveLength(11)
    expect(scout.xi.map((p) => p.id)).toContain(reserveKeeperId('tondela', 2025))
    // The screen used to read `u.index` and drop him: ten men, and no keeper among them
    expect(u.index[reserveKeeperId('tondela', 2025)]).toBeUndefined()
  })

  it('names the weak link only with a good scout, and never a keeper', () => {
    const game = aGame('r8-scout-weak')
    const clubs = buildAiClubs(u, 'portugal', 2025, 'benfica')
    for (const club of Object.values(clubs)) {
      game.staff = { ...game.staff, scout: 0 }
      const none = scoutOpposition(game, u, club, 0)
      expect(none.weak).toBeUndefined()
      expect(none.tips).not.toContain('weakLink')
      game.staff = { ...game.staff, scout: SCOUT_NOTES.weakLinkTier }
      const seen = scoutOpposition(game, u, club, 0)
      expect(seen.weak?.positions[0]).not.toBe('GK')
      expect(seen.tips.at(-1)).toBe('weakLink')
      expect(seen.stars).toHaveLength(3)
      expect(seen.stars[0].overall).toBeGreaterThanOrEqual(seen.stars[2].overall)
      // Composed and nervy never both
      expect(seen.tips.includes('nervy') && seen.tips.includes('composed')).toBe(false)
    }
  })

  it('draws nothing: the game is untouched', () => {
    const game = aGame('r8-scout-pure')
    const before = JSON.stringify(game)
    for (const club of Object.values(buildAiClubs(u, 'portugal', 2025, 'benfica'))) scoutOpposition(game, u, club, 2)
    expect(JSON.stringify(game)).toBe(before)
  })

  it('reads the centre-backs from the CB slots: a side with every natural CB injured is not "slow at the back" by default (r9 audit)', () => {
    const game = aGame('r9-scout-cbs')
    let checked = 0
    for (const club of Object.values(buildAiClubs(u, 'portugal', 2025, 'benfica'))) {
      const cbs = club.squad.filter((id) => u.index[id]?.positions[0] === 'CB')
      if (!cbs.length) continue
      const state = { ...club.state }
      for (const id of cbs) state[id] = { ...state[id], injury: { description: 'Knock', weeksOut: 4 } }
      const hurt = { ...club, state }
      const scout = scoutOpposition(game, u, hurt, 0)
      // The men covering at centre-back are who the note reads; before, a mean over nobody was 0 and every such side was "slow"
      const atCb = getFormation(hurt.tactics.formationId).slots.filter((sl) => sl.position === 'CB').map((sl) => scout.xi.find((p) => p.id === opponentInput(game, u, hurt, 0).lineup[sl.id])!)
      expect(atCb.length).toBeGreaterThan(0)
      const pace = atCb.reduce((a, p) => a + p.attributes.pace, 0) / atCb.length
      expect(scout.tips.includes('slowCbs')).toBe(pace < SCOUT_NOTES.slowCbs)
      if (pace >= SCOUT_NOTES.slowCbs) checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})
