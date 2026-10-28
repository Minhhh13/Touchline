/*
 * The second sound pass's cues as plain data: what can be asked for, which switch each one follows, how close two of
 * the same may come, and the small pure decisions the screens make before asking (a pick's band, a toast's tone, the
 * Trophy Room's new badges). Their voices are in `voices.ts`, a chunk of its own loaded on the first gesture
 * (`synth.ts`), so the first download carries only this file. Nothing here touches audio, the DOM or the game.
 */
import type { SoundCategory } from './scores'

/** A pick's band, from the overall he lands with: rising with the rating, so a world-class pick sounds like one. */
export type PickBand = 'squad' | 'solid' | 'star' | 'world'

/** The lowest overall of each band, best first. */
export const PICK_BANDS: ReadonlyArray<readonly [PickBand, number]> = [
  ['world', 88],
  ['star', 83],
  ['solid', 77],
  ['squad', 0],
]

export function pickBand(overall: number): PickBand {
  for (const [band, min] of PICK_BANDS) if (overall >= min) return band
  return 'squad'
}

/** What can be asked for beside the palette in scores.ts. */
export type CueRequest =
  | { id: 'pick-band'; band: PickBand; reduced?: boolean }
  | { id: 'hindsight'; perfect: boolean; reduced?: boolean }
  | { id: 'squad-complete'; reduced?: boolean }
  | { id: 'manager-landed' }
  | { id: 'case-open' }
  | { id: 'bonus'; reduced?: boolean }
  | { id: 'turn'; mine: boolean }
  | { id: 'tab' }
  | { id: 'toast' }
  | { id: 'error' }
  | { id: 'confirm' }
  | { id: 'kick'; scored: boolean; ours: boolean }
  | { id: 'rung'; rung: number }
  | { id: 'bracket-tie'; user: boolean }
  | { id: 'badge'; reduced?: boolean }

export type CueId = CueRequest['id']

/**
 * Which switch each cue follows under the master: `draft` (Profile's Draft sounds), `ui` (Interface sounds), `match`
 * (Match sounds) or `reward` (only the master, as the fanfares).
 */
export const CUE_CATEGORY: Record<CueId, SoundCategory> = {
  'pick-band': 'draft',
  hindsight: 'draft',
  'squad-complete': 'draft',
  'manager-landed': 'draft',
  'case-open': 'draft',
  bonus: 'draft',
  turn: 'draft',
  tab: 'ui',
  toast: 'ui',
  error: 'ui',
  confirm: 'ui',
  kick: 'match',
  rung: 'reward',
  'bracket-tie': 'match',
  badge: 'reward',
}

export function isCue(id: string): id is CueId {
  return Object.prototype.hasOwnProperty.call(CUE_CATEGORY, id)
}

/**
 * The thinning: the least time, ms, between two plays of the same sound (any request with that id). A rapid repeat
 * inside it is dropped, so a run of tab presses or a burst of toasts never becomes a rattle. A sound not listed is
 * never thinned (the match's own cues have their throttle in match.ts).
 */
export const CUE_GAP_MS: Partial<Record<string, number>> = {
  click: 70,
  tab: 110,
  toast: 600,
  error: 600,
  confirm: 250,
  pick: 150,
  'pick-band': 150,
  turn: 400,
  'bracket-tie': 140,
  rung: 300,
  kick: 250,
  badge: 1500,
  bonus: 1000,
  'case-open': 800,
  'manager-landed': 800,
  'squad-complete': 1500,
  hindsight: 1500,
}

/** Remembers when each sound last played and answers whether another may play now (`now` in ms, any clock that only goes forward). */
export function makeThinner(gaps: Partial<Record<string, number>> = CUE_GAP_MS): (id: string, now: number) => boolean {
  const last = new Map<string, number>()
  return (id, now) => {
    const gap = gaps[id] ?? 0
    if (gap <= 0) return true
    const before = last.get(id)
    if (before !== undefined && now - before < gap && now >= before) return false
    last.set(id, now)
    return true
  }
}

/** A toast's tone: an error (something failed or was refused) or a plain note. Read from the words alone. */
export function toastTone(text: string): 'error' | 'toast' {
  return /^(could not|couldn't|something went wrong|not saving)|\b(cannot|can't|failed|refused|not possible|is full)\b/i.test(text) ? 'error' : 'toast'
}

/** The badges earned now that were not when the Trophy Room was last heard (ids with their tier, as `id:tier`). */
export function newlyEarned(heard: readonly string[] | null, now: readonly string[]): string[] {
  const before = new Set(heard ?? [])
  return now.filter((k) => !before.has(k))
}
