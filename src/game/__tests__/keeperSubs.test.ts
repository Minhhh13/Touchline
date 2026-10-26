import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { Rng } from '@engine/rng'
import type { MatchResult, PlayerSeason } from '@engine/types'
import { beginArena, closeArenaMatch, cupGameSettings, gauntletGameSettings, playArenaStep, type ArenaChoices } from '../logic/arena'
import { playerLookup } from '../logic/players'
import { fieldXI } from '../logic/quickBench'
import { createGame } from '../logic/setup'
import type { Game } from '../types'
import { seasonGame } from './seasonGame'
// The arena reaches the store's helpers, which persist through localStorage; an in-memory stand-in keeps Node quiet
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})

/**
 * TL-01 through the game: no automatic change in an arena run or a Season brings a keeper on for an outfielder, and
 * the quick season's injury cover never stands one in an outfield slot. The playtest's Gauntlet seed 3NVT-9VDF, drafted
 * by the assistant, brought Ederson on for Mbabu (RB, 61') and De Gea for Fletcher (ST, 88') on ENGINE_VERSION 4.
 */
const u = loadTestUniverse(['england'])
const keeperOnly = (p: Pick<PlayerSeason, 'positions'>) => p.positions.every((x) => x === 'GK')

function keeperForOutfielder(g: Game, r: MatchResult): string[] {
  const get = playerLookup(g, u)
  return r.events.flatMap((e) => {
    if (e.type !== 'substitution' || !e.playerId || !e.secondaryId) return []
    const off = get(e.playerId)
    const on = get(e.secondaryId)
    return off && on && keeperOnly(on) && !off.positions.includes('GK') ? [`${e.minute}' ${on.name} for ${off.name}`] : []
  })
}

/** An arena run drafted and played by the assistant; every keeper-for-outfielder change of every match. */
function arenaRun(seed: string, format: 'cup' | 'gauntlet'): string[] {
  const c: ArenaChoices = { teamName: 'Cup Test XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, size: 16 }
  const g = createGame(format === 'cup' ? cupGameSettings(u, c, 'CTX') : gauntletGameSettings(u, c, 'CTX'))
  const out: string[] = []
  for (let guard = 0; guard < 80 && g.phase !== 'summary'; guard++) {
    if (g.phase === 'draft') {
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginArena(g, u)
      continue
    }
    if (g.phase === 'week' && !g.arena!.over) playArenaStep(g, u, false)
    if (g.lastMatch) out.push(...keeperForOutfielder(g, g.lastMatch))
    closeArenaMatch(g)
    if (g.arena!.pending) break
  }
  return out
}

describe('keepers and automatic changes (TL-01)', { timeout: 300_000 }, () => {
  it('the playtest seeds and 40 more arena runs bring no keeper on outfield', () => {
    expect(arenaRun('3NVT-9VDF', 'gauntlet')).toEqual([])
    expect(arenaRun('QPD2-39NX', 'cup')).toEqual([])
    for (let i = 0; i < 20; i++) for (const f of ['cup', 'gauntlet'] as const) expect(arenaRun(`gk-${f}-${i}`, f)).toEqual([])
  })

  it('a Season brings none on in any match of the league, the AI sides’ included', () => {
    for (let i = 0; i < 2; i++) {
      const g = seasonGame(u, `gk-season-${i}`, 38)
      for (const f of g.season!.fixtures) if (f.result) expect(keeperForOutfielder(g, f.result)).toEqual([])
    }
  })

  it('the quick season’s injury cover never stands a keeper in an outfield slot, even when the position rule allows it', () => {
    const formation = getFormation('4-3-3')
    const squad = u.clubSeasonByKey['arsenal@2025'].squad
    const keeper = squad.find((p) => keeperOnly(p))!
    const spareKeeper = squad.filter((p) => keeperOnly(p))[1]!
    const outfield = squad.filter((p) => !keeperOnly(p))
    const chosen: Record<string, string> = {}
    formation.slots.forEach((s, i) => (chosen[s.id] = s.position === 'GK' ? keeper.id : outfield[i].id))
    const get = (id: string) => u.index[id]
    const cmSlot = formation.slots.find((s) => s.position === 'CM')!
    // Only a keeper on the bench: the injured midfielder plays on uncovered
    const one = fieldXI(formation, chosen, [spareKeeper.id], (id) => id === chosen[cmSlot.id], get, () => true)
    expect(one.covers).toEqual([])
    // The keeper hurt and only outfielders on the bench: one goes in goal, the emergency keeper
    const gkSlot = formation.slots.find((s) => s.position === 'GK')!
    const two = fieldXI(formation, chosen, [outfield[12].id], (id) => id === keeper.id, get, () => true)
    expect(two.covers).toEqual([{ slotId: gkSlot.id, outId: keeper.id, inId: outfield[12].id }])
  })
})
