/** Existing season honours, grouped for display. No competition rules or random draws. */
import type { Cabinet, Game, LeaderboardEntry, LeagueTrophies } from '../types'

export const TROPHY_COUNTS = ['league', 'cup', 'continental', 'doubles', 'trebles'] as const
export const emptyLeagueTrophies = (): LeagueTrophies => ({ league: 0, cup: 0, continental: 0, doubles: 0, trebles: 0 })

export function normaliseLeagueShelves(value: unknown): Record<string, LeagueTrophies> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const shelves: Record<string, LeagueTrophies> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || id in Object.prototype) continue
    const counts = raw as Partial<LeagueTrophies>
    const shelf = emptyLeagueTrophies()
    for (const k of TROPHY_COUNTS) {
      const n = counts[k]
      shelf[k] = typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0
    }
    shelves[id] = shelf
  }
  return shelves
}

export function trophyLeague(game: Pick<Game, 'settings' | 'history'>): string {
  return game.settings.mode === 'quick' && game.settings.rules.superLeague ? 'super' : game.history.at(-1)?.leagueId ?? game.settings.leagueId
}

/** Backfill only wins with recorded attribution, deduplicating a title present on both boards. */
export function withLeagueShelves(cabinet: Cabinet, board: readonly LeaderboardEntry[]): Cabinet {
  const stored = normaliseLeagueShelves(cabinet.leagueShelves)
  if (stored) {
    const previous = cabinet.leagueShelves
    if (previous && Object.keys(stored).length === Object.keys(previous).length && Object.entries(stored).every(([id, shelf]) => TROPHY_COUNTS.every((k) => shelf[k] === previous[id]?.[k]))) return cabinet
    return { ...cabinet, leagueShelves: stored }
  }
  const evidence = new Map<string, { leagueId: string; counts: LeagueTrophies }>()
  for (const h of cabinet.honours ?? []) {
    if (!h.leagueId) continue
    evidence.set(h.id, { leagueId: h.superLeague ? 'super' : h.leagueId, counts: { league: 1, cup: Number(h.cups.includes('cup')), continental: Number(h.cups.includes('continental')), doubles: Number(h.cups.includes('cup')), trebles: Number(h.kind === 'treble') } })
  }
  for (const e of board) {
    if (e.mode === 'arena' || e.mode === 'runin' || e.position !== 1 || e.tier === 'RELEGATED' || !e.leagueId || evidence.has(e.id)) continue
    evidence.set(e.id, { leagueId: e.superLeague ? 'super' : e.leagueId, counts: { ...emptyLeagueTrophies(), league: 1 } })
  }
  const remaining: LeagueTrophies = { league: cabinet.league, cup: cabinet.cup, continental: cabinet.continental, doubles: cabinet.doubles, trebles: cabinet.trebles }
  const shelves: Record<string, LeagueTrophies> = {}
  for (const { leagueId, counts } of evidence.values()) {
    if (leagueId in Object.prototype) continue
    const shelf = shelves[leagueId] ?? emptyLeagueTrophies()
    for (const k of TROPHY_COUNTS) {
      const n = Math.min(Math.max(0, remaining[k]), counts[k])
      shelf[k] += n
      remaining[k] -= n
    }
    shelves[leagueId] = shelf
  }
  return { ...cabinet, leagueShelves: shelves }
}

/** Mirror precisely the trophy increments already credited to the aggregate. Never mutate a prior cabinet. */
export function addLeagueTrophies(cabinet: Cabinet, leagueId: string, added: LeagueTrophies): Cabinet {
  const c = withLeagueShelves(cabinet, [])
  const shelf = { ...(c.leagueShelves?.[leagueId] ?? emptyLeagueTrophies()) }
  for (const k of TROPHY_COUNTS) shelf[k] += added[k]
  return { ...c, leagueShelves: { ...c.leagueShelves, [leagueId]: shelf } }
}

/** Store-only bookkeeping after the existing credit action. Keep it outside the frozen challenge replay graph. */
export function creditTrophyShelf(before: Cabinet, after: Cabinet, game: Pick<Game, 'settings' | 'history'>): Cabinet {
  const base = withLeagueShelves(before, [])
  const delta = emptyLeagueTrophies()
  for (const k of TROPHY_COUNTS) delta[k] = Math.max(0, after[k] - before[k])
  const cabinet = { ...after, leagueShelves: base.leagueShelves }
  return TROPHY_COUNTS.some((k) => delta[k] > 0) ? addLeagueTrophies(cabinet, trophyLeague(game), delta) : cabinet
}

export function earlierTrophies(cabinet: Cabinet): LeagueTrophies {
  const earlier = { league: cabinet.league, cup: cabinet.cup, continental: cabinet.continental, doubles: cabinet.doubles, trebles: cabinet.trebles }
  for (const shelf of Object.values(cabinet.leagueShelves ?? {})) for (const k of TROPHY_COUNTS) earlier[k] = Math.max(0, earlier[k] - shelf[k])
  return earlier
}
