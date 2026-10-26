/**
 * Small pure helpers for the Summary, Profile and Explore screens: the short
 * labels that replace their sentences. Presentation only; nothing here reads or
 * writes game state.
 */
import type { Mode } from '@game/types'

/** A mode as it is shown in a table cell or a chip. */
export function modeLabel(mode: Mode): string {
  const label: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily', season: 'Season', dynasty: 'Dynasty', arena: 'Arena', weekly: 'Weekly', runin: 'Run-in' }
  return label[mode]
}

/**
 * How the user's finish compares with the real club's in the same season.
 * `delta` is positive when the user finished higher (a smaller position).
 */
export function versusReal(ours: number, real: number): { delta: number; label: string } {
  const delta = real - ours
  if (delta === 0) return { delta, label: 'Same place' }
  const n = Math.abs(delta)
  return { delta, label: `${n} place${n === 1 ? '' : 's'} ${delta > 0 ? 'higher' : 'lower'}` }
}

/**
 * How many games a folded game-by-game list shows: everything revealed while
 * the replay runs or once unfolded, otherwise at most `fold`.
 */
export function shownGames(revealed: number, fold: number | undefined, expanded: boolean, playing: boolean): number {
  if (!fold || expanded || playing) return revealed
  return Math.min(revealed, fold)
}

/**
 * The weekly development report's body ("Improving: A. Name 71→72, B 70→71. Fading: C 80→79.") as two lists, so the
 * digest can show them one player a line; null when the body is in any other shape (it is then shown as it is).
 */
export function developmentLists(body: string): { improving: string[]; fading: string[] } | null {
  const part = (label: string) => {
    const m = body.match(new RegExp(`${label}: (.*?→\\d+)\\.(?:\\s|$)`))
    return m ? m[1].split(', ').filter(Boolean) : []
  }
  const improving = part('Improving')
  const fading = part('Fading')
  return improving.length || fading.length ? { improving, fading } : null
}

/**
 * A count and the plural phrase it counts ("league titles", "cups, season and arena"), with the phrase's first plural
 * word made singular for a count of one: "1 league title", "1 cup, season and arena", "1 run-in brief met".
 */
export function countPhrase(n: number, plural: string): string {
  if (n !== 1) return `${n} ${plural}`
  const words = plural.split(' ')
  const at = words.findIndex((w) => /[a-z]s[,.]?$/.test(w))
  if (at < 0) return `${n} ${plural}`
  words[at] = words[at].replace(/s([,.]?)$/, '$1')
  return `${n} ${words.join(' ')}`
}

/**
 * Chip labels with the repeats taken out, ignoring case: the arena hub's head says "Cup final" once, not "Cup Final"
 * (the format's name) beside "Cup final" (the match). Of two that differ only in case the sentence-case one stays, in
 * the first one's place; empty labels go.
 */
export function distinctLabels(labels: readonly string[]): string[] {
  const sentence = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() === x
  const out: string[] = []
  for (const l of labels) {
    if (!l.trim()) continue
    const i = out.findIndex((o) => o.toLowerCase() === l.toLowerCase())
    if (i < 0) out.push(l)
    else if (!sentence(out[i]) && sentence(l)) out[i] = l
  }
  return out
}


/**
 * The quick summary's runs line under the record: this season's runs (`runsLine`) and the Profile's longest perfect
 * start, named as such ("best perfect start 5-0": a bare "best run 1-0" read as a score). A best of one game says
 * nothing a player wants to hear, so it shows from two; null when there is nothing to say.
 */
export function runsSummary(runs: string | null, longestPerfectRun: number | undefined): string | null {
  const best = (longestPerfectRun ?? 0) >= 2 ? `${runs ? 'best' : 'Best'} perfect start ${longestPerfectRun}-0` : null
  const parts = [runs, best].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
