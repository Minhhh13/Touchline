/**
 * The assistant manager at the live match's two stops, and the three ways to
 * play a match (watch with stops, auto-play, sim result).
 *
 * `assistantCall` is pure and draws nothing: it reads the paused match and the
 * squad and returns the changes a manager could have typed at that stop. They
 * go through `advanceLiveMatch`, the same path a human's choices take, so the
 * engine sees nothing new and Auto-play and Sim result give the same result
 * for the same save (only the picture differs).
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { LiveChanges, LivePlayer, Shout, TeamTalk } from '@engine/match'
import { currentScore } from '@engine/match'
import { staminaCostFactor } from '@engine/depth'
import type { Position } from '@engine/types'
import { isAvailable, playerLookup } from './players'
import { advanceLiveMatch, closeLiveMatch, playMatchweek } from './week'
import { advanceArenaMatch } from './arena'

/** How the main play button plays the next match. */
export type MatchPlayMode = 'watch' | 'auto' | 'sim'

export const MATCH_PLAY_MODES: Array<{ id: MatchPlayMode; label: string; hint: string }> = [
  { id: 'watch', label: 'Watch', hint: 'Stops at half time and the 70th minute for your calls' },
  { id: 'auto', label: 'Auto-play', hint: 'Watch it all; the assistant makes the calls at the stops' },
  { id: 'sim', label: 'Sim result', hint: 'Straight to the result and the report' },
]

/** The saved preference: Season and Dynasty only, Watch when unset (every save written before the setting existed). */
export function matchPlayOf(game: Game): MatchPlayMode {
  if (game.settings.mode !== 'season' && game.settings.mode !== 'dynasty') return 'watch'
  return game.settings.matchPlay ?? 'watch'
}

/**
 * Whether the assistant takes the stops of the live match now on the screen when it opens fresh:
 * after a reload, or as the cup tie that follows a league match. Only the saved preference counts
 * ("Finish the match" and "Auto from here" were for the match they were asked in).
 */
export function assistantTakesStops(game: Game | null | undefined): boolean {
  return !!game?.live && matchPlayOf(game) === 'auto'
}

/** Below this estimated condition at the 70th minute a man is taken off; at half time only below the lower one. */
export const TIRED_AT_70 = 65
export const TIRED_AT_45 = 50
/** Morale (0..100, the XI's mean) at which the assistant trusts a fire-up talk when behind. */
export const FIRE_UP_MORALE = 65

/**
 * A man's condition now, estimated from his condition at kick-off and the
 * minutes he has run, with the same cost per ninety the engine charges after
 * the match (age, physique, tempo, stamina). Pure: nothing is drawn.
 */
export function estimatedCondition(game: Game, u: LoadedUniverse, p: LivePlayer, minute: number, tempoFast: boolean, fatigue: number): number {
  const ps = playerLookup(game, u)(p.psId)
  const start = game.squad[p.psId]?.condition ?? 90
  if (!ps) return start
  const minutes = Math.max(0, minute - p.onAt)
  const base = 26 + fatigue + (ps.age >= 33 ? 5 : ps.age >= 30 ? 2 : 0) + (100 - ps.attributes.physical) / 10 + (tempoFast ? 2 : 0)
  const loss = (base * (p.position === 'GK' ? 1 : staminaCostFactor(ps.attributes.stamina)) * minutes) / 90
  return start - loss
}

/**
 * What the assistant does at the stop the live match stands at.
 * - Half time: a talk from the score and the XI's morale (calm when ahead,
 *   encourage when level, fire up when behind and the dressing room is up for
 *   it, encourage otherwise), and a change only for a man hurt or out on his feet.
 * - 70 minutes: a shout from the score (shut up shop with a one- or two-goal
 *   lead, all-out attack when behind, keep shape when level or well clear) and
 *   changes for the injured and the tired (condition below `TIRED_AT_70`), the
 *   most tired first, each replaced by the best available natural fit for his slot.
 * Never more changes than are left (three at the break, five in all), never a
 * man who is injured, suspended or has already played, never the same man twice.
 * Instructions are left alone: a change there would be written into the saved tactics.
 */
export function assistantCall(game: Game, u: LoadedUniverse): LiveChanges {
  const live = game.live
  if (!live) return {}
  const mp = live.mp
  const stop = mp.clock ?? 45
  const atBreak = stop < 70
  const side = live.userIsHome ? mp.home : mp.away
  const appeared = live.userIsHome ? mp.hLive : mp.aLive
  const made = (live.userIsHome ? mp.hSubs : mp.aSubs).length
  const score = currentScore(mp)
  const diff = live.userIsHome ? score.home - score.away : score.away - score.home
  const onPitch = appeared.filter((p) => p.offAt >= 90 && !p.red)

  const cap = Math.max(0, atBreak ? Math.min(3, 5 - made) : 5 - made)
  const limit = atBreak ? TIRED_AT_45 : TIRED_AT_70
  const tempoFast = side.tactics.tempo === 'fast'
  const fatigue = side.modifiers?.fatigue ?? 0
  const needs = onPitch
    .map((p) => ({ p, cond: estimatedCondition(game, u, p, stop, tempoFast, fatigue), hurt: !!p.injury }))
    .filter((c) => c.hurt || (c.p.position !== 'GK' && c.cond < limit))
    .sort((a, b) => Number(b.hurt) - Number(a.hurt) || a.cond - b.cond || a.p.psId.localeCompare(b.p.psId))
  const used = new Set(appeared.map((p) => p.psId))
  const substitutions: Array<{ off: string; on: string }> = []
  for (const n of needs) {
    if (substitutions.length >= cap) break
    const on = bestBenchFit(game, u, n.p.position, used)
    if (!on) continue
    used.add(on)
    substitutions.push({ off: n.p.psId, on })
  }

  if (atBreak) {
    const morale = onPitch.length ? onPitch.reduce((s, p) => s + (game.squad[p.psId]?.morale ?? 60), 0) / onPitch.length : 60
    const talk: TeamTalk = diff > 0 ? 'calm' : diff === 0 ? 'encourage' : morale >= FIRE_UP_MORALE ? 'fire-up' : 'encourage'
    return { talk, substitutions }
  }
  const shout: Shout = diff < 0 ? 'all-out-attack' : diff === 1 || diff === 2 ? 'shut-up-shop' : 'keep-shape'
  return { shout, substitutions }
}

/** The best man on the bench for a slot: fit and unsuspended, not yet used, a natural fit before any other, then by rating in the slot and condition. */
export function bestBenchFit(game: Game, u: LoadedUniverse, position: Position, used: Set<string>): string | undefined {
  const get = playerLookup(game, u)
  let best: { id: string; natural: boolean; score: number } | undefined
  for (const id of game.bench) {
    if (used.has(id) || !isAvailable(game.squad[id])) continue
    const ps = get(id)
    if (!ps) continue
    // A keeper only for a keeper, and never a keeper outfield
    if (position === 'GK' ? !ps.positions.includes('GK') : ps.positions.every((x) => x === 'GK')) continue
    const natural = ps.positions.includes(position)
    const score = ps.overall * fitFactor(ps.positions, position) * ((game.squad[id]?.condition ?? 90) / 100 + 0.5)
    if (!best || (natural && !best.natural) || (natural === best.natural && (score > best.score || (score === best.score && id < best.id)))) best = { id, natural, score }
  }
  return best?.id
}

function fitFactor(positions: Position[], position: Position): number {
  return positions.includes(position) ? 1 : 0.85
}

/** Play on from the stop the live match stands at with the assistant's calls; `hold` keeps the last twenty minutes live for the dashboard to play (`advanceLiveMatch`). */
export function advanceWithAssistant(game: Game, u: LoadedUniverse, hold = false): void {
  if (!game.live) return
  // An arena match plays on through the arena's own path, the same calls made
  if (game.live.kind === 'arena') advanceArenaMatch(game, u, assistantCall(game, u), hold)
  else advanceLiveMatch(game, u, assistantCall(game, u), false, hold)
}

/** Which match a live match is (a cup tie that follows the league match is a different one). */
export function liveMatchKey(l: Game['live']): string | null {
  return l ? `${l.kind}-${l.comp ?? ''}-${l.ctx.matchweek}-${l.opponentId}-${l.cupTieIndex ?? ''}` : null
}

function liveKey(game: Game): string | null {
  return liveMatchKey(game.live)
}

/**
 * Play the live match to the final whistle with the assistant taking every
 * remaining call; `first`, when given, is the manager's own changes at the stop
 * the match stands at. A cup tie that follows stays live.
 */
export function finishWithAssistant(game: Game, u: LoadedUniverse, first?: LiveChanges): void {
  const key = liveKey(game)
  if (!key) return
  if (first) {
    if (game.live?.kind === 'arena') advanceArenaMatch(game, u, first)
    else advanceLiveMatch(game, u, first)
  }
  for (let i = 0; i < 3 && game.live && liveKey(game) === key; i++) advanceWithAssistant(game, u)
}

/** Every live match of the week to the whistle with the assistant: the league match, then any cup tie it leads to. */
export function simLiveMatches(game: Game, u: LoadedUniverse): void {
  for (let i = 0; i < 4 && game.live; i++) finishWithAssistant(game, u)
}

/**
 * Play the next matchweek the way `mode` says. Watch and Auto-play both leave
 * the user's match live at half time (the screen plays it; Auto-play answers
 * the stops with `advanceWithAssistant`); Sim result plays every live match of
 * the week to the whistle here, so the report is ready.
 */
export function playMatchweekAs(game: Game, u: LoadedUniverse, mode: MatchPlayMode): void {
  playMatchweek(game, u, false)
  if (mode === 'sim') simLiveMatches(game, u)
}

/** A whole matchweek with no stops, as Auto-play plays it on screen: kick-off, the assistant at both stops of every live match, then off the match screen. */
export function autoPlayMatchweek(game: Game, u: LoadedUniverse): void {
  playMatchweek(game, u, false)
  for (let i = 0; i < 8 && game.live; i++) advanceWithAssistant(game, u)
  closeLiveMatch(game, u)
}
