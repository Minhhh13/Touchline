import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { aiTeamInput, buildAiClubs } from '../season'
import { eligibleReplacement, simulateMatch, type MatchTeamInput } from '../match'
import { getFormation } from '../formations'
import type { MatchResult, PlayerSeason, Position, SquadPlayer } from '../types'
import { newSquadPlayer } from '../season'

/**
 * TL-01: an automatic change never brings a keeper on for an outfielder (playtest: "A. Al-Habsi for L. Modric (70',
 * tactical)" while Henderson played 90). Only an injured keeper with no keeper left on the bench may be replaced by an
 * outfielder, the emergency case.
 */
const u = loadTestUniverse()
const ai = buildAiClubs(u, 'england', 2025, 'burnley')
const keeperOnly = (p: Pick<PlayerSeason, 'positions'>) => p.positions.every((x) => x === 'GK')

/** A side whose bench is `bench` and whose men are all at `condition`, so the routine changes want several men off. */
function side(clubId: string, pickBench: (squad: PlayerSeason[], lineup: Set<string>) => string[], condition: number): MatchTeamInput {
  const base = aiTeamInput(u, ai[clubId])
  const squad = ai[clubId].squad.map((id) => u.index[id])
  const states: Record<string, SquadPlayer> = {}
  for (const p of squad) states[p.id] = newSquadPlayer(p.id, { condition, sharpness: 85, familiarity: 70 })
  return { ...base, bench: pickBench(squad, new Set(Object.values(base.lineup))), getState: (id) => states[id] }
}

/** Each substitution of the home side with the position of the slot the man came on in. */
function homeChanges(r: MatchResult, input: MatchTeamInput): Array<{ on: PlayerSeason; position: Position; injury: boolean }> {
  const formation = getFormation(input.tactics.formationId)
  const slotOf = new Map<string, Position>()
  for (const s of formation.slots) if (input.lineup[s.id]) slotOf.set(input.lineup[s.id], s.position)
  const out: Array<{ on: PlayerSeason; position: Position; injury: boolean }> = []
  for (const e of r.events) {
    if (e.type !== 'substitution' || e.side !== 'home' || !e.playerId || !e.secondaryId) continue
    const position = slotOf.get(e.playerId)!
    slotOf.set(e.secondaryId, position)
    const injured = r.events.some((x) => x.type === 'injury' && x.playerId === e.playerId)
    out.push({ on: u.index[e.secondaryId], position, injury: injured })
  }
  return out
}

describe('automatic substitutions and keepers (TL-01)', () => {
  it('eligibleReplacement: a keeper-only man only in goal; any outfielder anywhere, in goal as the emergency keeper', () => {
    expect(eligibleReplacement({ positions: ['GK'] }, 'CM')).toBe(false)
    expect(eligibleReplacement({ positions: ['GK'] }, 'GK')).toBe(true)
    expect(eligibleReplacement({ positions: ['CB'] }, 'GK')).toBe(true)
    expect(eligibleReplacement({ positions: ['CM', 'DM'] }, 'ST')).toBe(true)
  })

  it('with only a keeper and one outfielder on the bench, the keeper never comes on outfield (300 seeds)', () => {
    let routine = 0
    for (let i = 0; i < 300; i++) {
      // Tired men: the routine changes want three off, and only one outfielder is there to come on
      const home = side('arsenal', (squad, xi) => [squad.find((p) => !xi.has(p.id) && keeperOnly(p))!.id, squad.find((p) => !xi.has(p.id) && !keeperOnly(p))!.id], 58)
      const away = aiTeamInput(u, ai['chelsea'])
      const r = simulateMatch({ rng: new Rng(`keeper-bench-${i}`), home, away, detail: 'summary' })
      for (const c of homeChanges(r, home)) {
        if (c.position !== 'GK') expect(keeperOnly(c.on)).toBe(false)
        if (!c.injury) routine++
      }
    }
    // The outfielder still comes on most matches
    expect(routine).toBeGreaterThan(200)
  })

  it('an injured keeper is replaced by the bench keeper, or by an outfielder in an emergency', () => {
    let withKeeper = 0
    let emergency = 0
    for (let i = 0; i < 800; i++) {
      for (const keeperOnBench of [true, false]) {
        const home = side('everton', (squad, xi) => squad.filter((p) => !xi.has(p.id) && keeperOnly(p) === keeperOnBench).slice(0, keeperOnBench ? 1 : 5).map((p) => p.id), 45)
        const r = simulateMatch({ rng: new Rng(`keeper-hurt-${i}`), home, away: aiTeamInput(u, ai['fulham']), detail: 'summary' })
        for (const c of homeChanges(r, home)) {
          if (c.position !== 'GK' || !c.injury) continue
          if (keeperOnBench) {
            expect(keeperOnly(c.on)).toBe(true)
            withKeeper++
          } else {
            expect(keeperOnly(c.on)).toBe(false)
            emergency++
          }
        }
      }
    }
    expect(withKeeper).toBeGreaterThan(0)
    expect(emergency).toBeGreaterThan(0)
  })
})
