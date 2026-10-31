/**
 * The pace of a cup run's reveal in its bracket (`components/CupNight.tsx`): the store has already played every tie,
 * this only says how long each one waits before its score shows. The user's own tie gets its moment ("In play"), a
 * hold after it lands, and a short pause opens each new round (the draw); once the user is out the rest of the cup
 * runs through quickly. Presentation only, pure and tested; nothing here reads the game's RNG.
 */
import { USER_TEAM } from '@engine/season'
import { inTie, revealCount, tieAtStep, type BracketView } from '@game/logic/bracket'

/** Milliseconds: a tie of the field, one once the user is out, the user's tie in play, the hold after it, a new round's
 * draw, and the user's final in play (round 9: the last tie of the night waits longest). */
export const CUP_REVEAL = { step: 340, fast: 200, live: 1400, hold: 850, round: 650, final: 2200 } as const

function isMine(view: BracketView, at: { round: number; tie: number } | null, userId: string): boolean {
  return !!at && inTie(view.rounds[at.round].ties[at.tie], userId)
}

/** Whether a tie the user lost is among the first `n` revealed. */
export function userOutBy(view: BracketView, steps: number[][], n: number, userId: string = USER_TEAM): boolean {
  for (let i = 0; i < n; i++) {
    const at = tieAtStep(steps, i)
    if (!at) break
    const t = view.rounds[at.round].ties[at.tie]
    if (inTie(t, userId) && t.winner !== undefined && t.winner !== userId) return true
  }
  return false
}

/** How long step `n` waits before its tie is shown; 0 past the end. */
export function revealDelay(view: BracketView, steps: number[][], n: number, userId: string = USER_TEAM): number {
  const here = tieAtStep(steps, n)
  if (!here) return 0
  const prev = n > 0 ? tieAtStep(steps, n - 1) : null
  const ms = isMine(view, here, userId) ? (here.round === view.rounds.length - 1 ? CUP_REVEAL.final : CUP_REVEAL.live) : isMine(view, prev, userId) ? CUP_REVEAL.hold : userOutBy(view, steps, n, userId) ? CUP_REVEAL.fast : CUP_REVEAL.step
  return ms + (prev && prev.round !== here.round ? CUP_REVEAL.round : 0)
}

/** The whole reveal's length in ms (what Skip saves). */
export function revealLength(view: BracketView, steps: number[][], userId: string = USER_TEAM): number {
  let total = 0
  for (let n = 0; tieAtStep(steps, n); n++) total += revealDelay(view, steps, n, userId)
  return total
}

/** A group matchday's moment in the reveal (engine 7's Continental Cup: the draw, then one matchday a step). */
export const GROUP_STEP_MS = 900

/**
 * How long the cup night waits before its next step when `all` steps are shown: the `groupSteps` group steps first,
 * then the bracket's ties; null once everything is shown. The night counts one step at a time through all of them.
 */
export function nightStepDelay(view: BracketView, steps: number[][], all: number, groupSteps: number, userId: string = USER_TEAM): number | null {
  if (all >= groupSteps + revealCount(view)) return null
  return all < groupSteps ? GROUP_STEP_MS : revealDelay(view, steps, all - groupSteps, userId)
}

/** The user's tie in play at step `n` is the final. */
export function userFinalInPlay(view: BracketView, steps: number[][], n: number, userId: string = USER_TEAM): boolean {
  const here = tieAtStep(steps, n)
  return !!here && here.round === view.rounds.length - 1 && isMine(view, here, userId)
}

/** The user's tie is the one in play at step `n` (the moment before its score lands). */
export function userInPlay(view: BracketView, steps: number[][], n: number, userId: string = USER_TEAM): boolean {
  return isMine(view, tieAtStep(steps, n), userId)
}
