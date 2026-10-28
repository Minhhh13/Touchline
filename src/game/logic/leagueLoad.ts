/**
 * Whether the league packs a start button needs are here, on their way or could not be fetched (O-10 in docs/QA.md):
 * offline, a league whose pack never loaded used to leave Start on "Loading league data…" for good. The store
 * remembers the leagues (and the classic seasons) whose last load failed; a screen asks here what its button says.
 * Pure, no RNG.
 */

export type LeagueGate = 'ready' | 'loading' | 'missing'

export interface LeagueLoadState {
  loadedLeagues: string[]
  /** Leagues whose last load failed (transient, never saved). */
  failedLeagues: string[]
  loadingLeagues: boolean
  classicLoaded: boolean
  /** The classic seasons' last load failed (transient, never saved). */
  classicFailed: boolean
}

export const LEAGUE_LOADING_LABEL = 'Loading league data…'
export const LEAGUE_MISSING_LABEL = 'Not downloaded: connect to load it'
export const LEAGUE_MISSING_LINE = 'This league is not on this device yet. Connect to the internet, then retry.'

/** Ready when every league needed (and the classic seasons, when needed) is loaded; missing when one is not and its last load failed; loading otherwise. */
export function leagueGate(needs: string[], s: LeagueLoadState, classic = false): LeagueGate {
  const absent = needs.filter((id) => !s.loadedLeagues.includes(id))
  const classicAbsent = classic && !s.classicLoaded
  if (!absent.length && !classicAbsent) return 'ready'
  if (s.loadingLeagues) return 'loading'
  if (absent.some((id) => s.failedLeagues.includes(id)) || (classicAbsent && s.classicFailed)) return 'missing'
  return 'loading'
}

/** The start button's words: its own once ready, the loading line while the packs come, the offline line when they cannot. */
export function gateLabel(gate: LeagueGate, readyLabel: string): string {
  return gate === 'ready' ? readyLabel : gate === 'missing' ? LEAGUE_MISSING_LABEL : LEAGUE_LOADING_LABEL
}

/** The failed list after a load of `ids`: a failure adds them, a success clears them. */
export function nextFailed(failed: string[], ids: string[], ok: boolean): string[] {
  if (ok) return failed.filter((id) => !ids.includes(id))
  return [...new Set([...failed, ...ids])]
}

/** The leagues a finished Dynasty season needs before its summer: the new job's league, and every league when it qualified for Europe. */
export function nextSeasonLeagues(game: { pendingMove?: { leagueId: string } | null; qualifiedContinental?: boolean } | null, available: string[]): string[] {
  return [game?.pendingMove?.leagueId, ...(game?.qualifiedContinental ? available : [])].filter((x): x is string => !!x)
}
