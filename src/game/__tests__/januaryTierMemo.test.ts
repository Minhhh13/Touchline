import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import { januarySpinPool } from '../logic/januaryGamble'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function drafted(seed: string): Game {
  const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Memo XI', shortName: 'MEM', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: true }
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

/** The same game with the Player Upgrader's result on its weakest starter: a big boost, so he climbs the wheel's tiers. */
function upgraded(seed: string): Game {
  const g = drafted(seed)
  const get = playerLookup(g, u)
  const id = Object.values(g.draft!.lineup).sort((a, b) => get(a)!.overall - get(b)!.overall || a.localeCompare(b))[0]
  g.draft!.upgrade = { id, boost: 10, chance: 50, roll: 0, won: true, delta: 30 }
  return g
}

const pool = (g: Game, uu: LoadedUniverse) => januarySpinPool(g, uu, g.draft!.lineup, g.draft!.bench, playerLookup(g, uu))
const ids = (p: ReturnType<typeof pool>) => Object.fromEntries(Object.entries(p).map(([t, list]) => [t, list.map((c) => c.p.id)]))

describe('the January spin pool', { timeout: 120_000 }, () => {
  it('is the same whatever game filled the tier memo first (the draft boosts are part of its key)', () => {
    for (const seed of ['memo-1', 'memo-2']) {
      const plain = drafted(seed)
      const boosted = upgraded(seed)
      // A universe object of its own is a fresh memo: the pool as a page that played only this game computes it
      const fresh = ids(pool(boosted, { ...u }))
      // The same data after another game with the same rules filled the memo
      const shared: LoadedUniverse = { ...u }
      pool(plain, shared)
      expect(ids(pool(boosted, shared))).toEqual(fresh)
      // And the other way round: the plain game is not read through the boosted game's tiers
      const shared2: LoadedUniverse = { ...u }
      pool(boosted, shared2)
      expect(ids(pool(plain, shared2))).toEqual(ids(pool(plain, { ...u })))
    }
  })
})
