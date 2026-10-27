import { describe, expect, it, vi } from 'vitest'
// Every arena shoot-out goes through this wrapper, which notes the keepers' ratings and the takers it was handed
vi.mock('@engine/knockout', async (importOriginal) => {
  const m = await importOriginal<typeof import('@engine/knockout')>()
  const seen = ((globalThis as { __shootouts?: unknown[] }).__shootouts ??= [])
  return {
    ...m,
    penaltyShootout: (...args: Parameters<typeof m.penaltyShootout>) => {
      seen.push({ takers: args[1], keepers: args[2] })
      return m.penaltyShootout(...args)
    },
  }
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { beginArena, finalGameSettings, playArenaStep, type ArenaChoices } from '../logic/arena'
import { autoDraft } from '@engine/draft'
import { isReserveKeeperId, reserveKeeperById } from '@engine/reserve'
import type { Taker } from '@engine/knockout'
import { Rng } from '@engine/rng'

const u = loadTestUniverse(['england'])
const seen = () => (globalThis as { __shootouts?: Array<{ takers: { home: Taker[]; away: Taker[] }; keepers: { home: number; away: number } }> }).__shootouts ?? []

function choices(seed: string): ArenaChoices {
  return { teamName: 'Arena XI', formationId: '4-3-3', field: 'giants', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: false }
}

describe('an arena shoot-out against a reserve keeper (engine 6, E6-5)', () => {
  it('rates him and his side by the keeper who played, never as an unknown man', () => {
    let checked = 0
    for (let i = 0; i < 300 && checked < 3; i++) {
      const g = createGame(finalGameSettings(u, choices(`reserve-pens-${i}`), 'AXI'))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginArena(g, u)
      // The final's opponent has no fit keeper (his keepers banned): he fields his reserve keeper
      const a = g.arena!
      const club = a.clubs[a.next!]
      for (const id of club.squad) if (u.index[id]?.positions.includes('GK')) club.state[id].suspension = 1
      const before = seen().length
      playArenaStep(g, u, false)
      const res = g.lastMatch!
      const theirs = res.homeTeamId === 'user' ? res.awayStats : res.homeStats
      const reserve = theirs.find((s) => isReserveKeeperId(s.playerSeasonId))
      expect(reserve, `seed ${i}`).toBeDefined()
      if (res.homeGoals !== res.awayGoals) continue
      // Level at 90: the shoot-out was kicked with him in goal
      expect(seen().length).toBe(before + 1)
      const so = seen()[seen().length - 1]
      const rating = reserveKeeperById(u, reserve!.playerSeasonId)!.attributes.goalkeeping
      expect(rating).toBeGreaterThanOrEqual(40)
      expect([so.keepers.home, so.keepers.away]).toContain(rating)
      // He is on their list of takers at his own shooting and mentality, not an unknown man's 50 and 50
      const his = [...so.takers.home, ...so.takers.away].find((t) => isReserveKeeperId(t.id))
      expect(his).toBeDefined()
      expect(his!.shooting).toBe(reserveKeeperById(u, his!.id)!.attributes.shooting)
      expect(his!.mentality).toBe(reserveKeeperById(u, his!.id)!.attributes.mentality)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  }, 300_000)
})
