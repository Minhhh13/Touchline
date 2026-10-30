import type { Formation, Lineup, PlayerSeason, Position } from '@engine/types'
import { canCover, ratingAt } from '@engine/positions'
import { benchPlaces } from '@engine/draft'
import { eligibleReplacement } from '@engine/match'
import type { Game, QuickChange, QuickCover, QuickGameResult } from '../types'

/**
 * The Quick Draft bench in the quick season, the pure half: the XI fielded around injuries, a change applied, who is
 * out when. Nothing here draws from the RNG.
 */

/** Voluntary changes a quick season allows: three, whatever the bench size. Injury cover never counts. */
export const QUICK_CHANGES = 3

/** Whether this game drafts a Quick Draft bench (its rules give bench places). */
export function quickBenchRule(game: Pick<Game, 'settings'>): boolean {
  return benchPlaces(game.settings.rules) > 0
}

/**
 * The XI that takes the field: every chosen starter who is out injured is covered by the best fit on the bench (his
 * rating at the slot's position; bench order breaks ties) who can play there (`canPlay`, the draft's position rule),
 * is fit and is not already covering, slots in formation order. A keeper-only man never covers an outfield slot
 * (`eligibleReplacement`), whatever the position rule allows. A starter nobody can cover plays on, as a quick season
 * without a bench always has him do.
 */
export function fieldXI(formation: Formation, chosen: Lineup, bench: string[], isOut: (id: string) => boolean, get: (id: string) => PlayerSeason | undefined, canPlay: (p: PlayerSeason, position: Position) => boolean = () => true): { lineup: Lineup; covers: QuickCover[] } {
  const lineup: Lineup = { ...chosen }
  const covers: QuickCover[] = []
  const used = new Set<string>()
  for (const slot of formation.slots) {
    const outId = chosen[slot.id]
    if (!outId || !isOut(outId)) continue
    let best: { id: string; r: number } | null = null
    for (const id of bench) {
      if (used.has(id) || isOut(id)) continue
      const p = get(id)
      if (!p || !eligibleReplacement(p, slot.position) || !canPlay(p, slot.position)) continue
      const r = ratingAt(p, slot.position)
      if (!best || r > best.r) best = { id, r }
    }
    if (!best) continue
    used.add(best.id)
    lineup[slot.id] = best.id
    covers.push({ slotId: slot.id, outId, inId: best.id })
  }
  return { lineup, covers }
}

/**
 * The XI at kick-off (engine 9, playtest round 2's P2): a bench man starts in a slot where his rating at its position
 * beats the starter's, who takes his place on the bench. The playtest's assistant benched David Raya (88) and started
 * Dúbravka (83) in goal, because the bench is drafted once the XI is full. The largest gain goes first (bench order,
 * then formation order, break ties), under the same rules as injury cover (`canPlay`, the draft's position rule; never a
 * keeper-only man outfield), until no bench man outrates a starter; every swap strictly raises the XI's total, so it
 * ends. New objects, no RNG.
 */
export function startBetterBench(formation: Formation, chosen: Lineup, chosenBench: string[], get: (id: string) => PlayerSeason | undefined, canPlay: (p: PlayerSeason, position: Position) => boolean = () => true): { lineup: Lineup; bench: string[] } {
  const lineup: Lineup = { ...chosen }
  const bench = [...chosenBench]
  for (let guard = 0; guard < formation.slots.length * Math.max(1, bench.length); guard++) {
    let best: { at: number; slotId: string; gain: number } | null = null
    bench.forEach((id, at) => {
      const p = get(id)
      if (!p) return
      for (const slot of formation.slots) {
        const starter = get(lineup[slot.id])
        if (!starter || !eligibleReplacement(p, slot.position) || !canPlay(p, slot.position)) continue
        const gain = ratingAt(p, slot.position) - ratingAt(starter, slot.position)
        if (gain > 1e-9 && (!best || gain > best.gain + 1e-9)) best = { at, slotId: slot.id, gain }
      }
    })
    if (!best) break
    const { at, slotId } = best
    const outId = lineup[slotId]
    lineup[slotId] = bench[at]
    bench[at] = outId
  }
  return { lineup, bench }
}

/**
 * One change applied to an XI and its bench: the bench player into the slot, the starter there onto the bench in the
 * bench player's place. New objects; throws when the slot is empty or the player is not on the bench.
 */
export function applyChange(lineup: Lineup, bench: string[], c: QuickChange): { lineup: Lineup; bench: string[]; outId: string } {
  const outId = lineup[c.slotId]
  if (!outId) throw new Error(`No starter in slot ${c.slotId}`)
  const at = bench.indexOf(c.inId)
  if (at < 0) throw new Error('That player is not on the bench')
  const nextBench = [...bench]
  nextBench[at] = outId
  return { lineup: { ...lineup, [c.slotId]: c.inId }, bench: nextBench, outId }
}

/** The last matchweek each player misses, from the injuries of the first `upTo` games (a player is out while it is at least the matchweek). */
export function injuredThrough(results: QuickGameResult[], upTo = results.length): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of results.slice(0, Math.max(0, upTo))) for (const i of r.injuries ?? []) out[i.id] = Math.max(out[i.id] ?? 0, r.matchweek + i.out)
  return out
}

/** The draft's position rule for a game: whether a player may take a slot of this position (the draft's minimum fit). */
export function canPlayFor(game: Pick<Game, 'settings'>): (p: PlayerSeason, position: Position) => boolean {
  const fit = game.settings.rules.minFit
  return (p, position) => canCover(p, position, fit)
}

/** Games in which at least one injured starter was covered from the bench. */
export function coveredGames(results: QuickGameResult[] | undefined): number {
  return (results ?? []).filter((r) => r.covers?.length).length
}

/** "Bench: Rice for Fernandes (MW 12), Saka for Martinelli (MW 25)" for the share text, or null without a change. */
export function changesLine(changes: Array<{ from: number; inId: string; outId: string }> | undefined, nameOf: (id: string) => string): string | null {
  if (!changes?.length) return null
  return `🔁 Bench: ${changes.map((c) => `${nameOf(c.inId)} for ${nameOf(c.outId)} (MW ${c.from})`).join(', ')}`
}
