/** Shared by the room tests: the assistant's pick read off a copy, a room played through the server's steps, the same game hot-seat. */
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft, type H2HDraft } from '@engine/h2h'
import { getFormation } from '@engine/formations'
import { Rng } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import { h2hRules, runH2HSeason, type H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomPick, roomStart, type RoomEvent, type RoomSettings } from '@game/logic/h2hRoom'

/** What the assistant would pick for the seat to move: its pick, read off a copy. */
export function autoChoice(uu: LoadedUniverse, h: H2HDraft): { seat: 0 | 1; p: string; k: string } {
  const seat = h.picking as 0 | 1
  const copy = structuredClone(h)
  h2hAutoPick(uu, copy)
  const before = h.drafts[seat]
  const after = copy.drafts[seat]
  const slot = Object.keys(after.lineup).find((k) => !before.lineup[k])
  if (slot) return { seat, p: after.lineup[slot], k: slot }
  return { seat, p: after.bench[after.bench.length - 1], k: 'bench' }
}

/** A whole room played with the assistant's picks through the server's own steps. */
export function playRoom(uu: LoadedUniverse, seed: string, s: RoomSettings, m: [H2HManager, H2HManager]) {
  let step = roomStart(uu, seed, s, m)
  const events: RoomEvent[] = [...step.events]
  let guard = 0
  while (step.turn !== null && guard++ < 100) {
    const h = draftFromEvents(uu, s, m, events)
    const c = autoChoice(uu, h)
    step = roomPick(uu, seed, s, m, events, c.seat, c.p, c.k)
    events.push(...step.events)
  }
  return { events, result: step.result }
}

/** The same game hot-seat, as the store plays it: spin, the assistant picks, then the season. */
export function playHotSeat(uu: LoadedUniverse, seed: string, s: RoomSettings, m: [H2HManager, H2HManager]) {
  const rng = new Rng(seed)
  const h = newH2HDraft([getFormation(m[0].formationId), getFormation(m[1].formationId)], h2hRules(s.wheelLeagues, s.hardMode))
  let guard = 0
  while (!h2hComplete(h) && guard++ < 200) {
    if (h.picking === null) h2hSpin(uu, h, rng)
    else h2hAutoPick(uu, h)
  }
  return { draft: h, result: runH2HSeason(uu, rng, m, h.drafts, s.leagueId, s.leagueSeason, s.difficulty) }
}

