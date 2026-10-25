/**
 * The Trophy Room's cabinet: one set of counts every mode credits as its
 * result lands (`recordResult`), rebuilt once from an older profile. Pure: no
 * React, no store, no RNG.
 */
import type { SeasonTier } from '@engine/types'
import type { Cabinet, Game, LeaderboardEntry, Mode, Profile } from '../types'

export function emptyCabinet(): Cabinet {
  return {
    v: 1,
    league: 0,
    cup: 0,
    continental: 0,
    doubles: 0,
    trebles: 0,
    perfect: 0,
    invincible: 0,
    centurions: 0,
    hostsTitled: [],
    nationsTitled: [],
    byMode: {},
    dailies: 0,
    weeklies: 0,
    arenaDailies: 0,
    gauntlet: { runs: 0, best: 0, complete: 0 },
    cups: { runs: 0, won: 0, bySize: {} },
    giantKills: 0,
    h2h: { played: 0 },
    runIns: { played: 0, met: 0 },
  }
}

/** A cabinet with every field present (an imported or hand-edited save may lack some). */
export function normaliseCabinet(c: Partial<Cabinet>): Cabinet {
  const e = emptyCabinet()
  return {
    ...e,
    ...c,
    v: 1,
    hostsTitled: Array.isArray(c.hostsTitled) ? c.hostsTitled : [],
    nationsTitled: Array.isArray(c.nationsTitled) ? c.nationsTitled : [],
    byMode: { ...(c.byMode ?? {}) },
    gauntlet: { ...e.gauntlet, ...(c.gauntlet ?? {}) },
    cups: { ...e.cups, ...(c.cups ?? {}), bySize: { ...(c.cups?.bySize ?? {}) } },
    h2h: { ...e.h2h, ...(c.h2h ?? {}) },
    runIns: { ...e.runIns, ...(c.runIns ?? {}) },
  }
}

/**
 * Modes whose result is a full league season, so a first place is a league
 * title. Exhaustive: a new mode (the arena's one-tie and nine-game formats, a
 * projected run-in) must say no here and credit its own shelf instead.
 */
export function countsAsLeagueSeason(mode: Mode): boolean {
  switch (mode) {
    case 'quick':
    case 'daily':
    case 'season':
    case 'dynasty':
      return true
    default: {
      const never: never = mode
      return never
    }
  }
}

/** A first place that is a title: a sacked season is filed RELEGATED whatever the table said. */
export function isTitle(position: number, tier: SeasonTier): boolean {
  return position === 1 && tier !== 'RELEGATED'
}

/** The result `recordResult` files for a finished game: the quick result, or the last season of the history. */
export function finishedRecord(game: Game): { points: number; won: number; drawn: number; lost: number; position: number; tier: SeasonTier } | null {
  if (game.quickResult) return game.quickResult
  const last = game.history.at(-1)
  return last ? { points: last.points, won: last.won, drawn: last.drawn, lost: last.lost, position: last.position, tier: last.tier } : null
}

function addOnce(list: string[], id: string | undefined): string[] {
  return id && !list.includes(id) ? [...list, id] : list
}

/**
 * Credit one finished game. Called once per result (the leaderboard's id
 * dedupe), `newDaily` when the result filed a daily day for the first time.
 */
export function creditGame(cabinet: Cabinet, game: Game, opts: { newDaily?: boolean } = {}): Cabinet {
  const rec = finishedRecord(game)
  if (!rec) return cabinet
  const mode = game.settings.mode
  const last = game.history.at(-1)
  const c = normaliseCabinet(cabinet)
  c.byMode[mode] = (c.byMode[mode] ?? 0) + 1
  if (opts.newDaily) c.dailies += 1
  if (!countsAsLeagueSeason(mode)) return c
  const title = isTitle(rec.position, rec.tier)
  const cup = !!last?.cupWon
  const euro = !!last?.continentalWon
  if (title) c.league += 1
  if (cup) c.cup += 1
  if (euro) c.continental += 1
  if (title && cup) c.doubles += 1
  if (title && cup && euro) c.trebles += 1
  if (rec.tier === 'PERFECT') c.perfect += 1
  if (rec.tier === 'PERFECT' || rec.tier === 'INVINCIBLE') c.invincible += 1
  if (rec.points >= 100 && rec.tier !== 'RELEGATED') c.centurions += 1
  if (title) {
    c.hostsTitled = addOnce(c.hostsTitled, last?.hostClubId ?? game.settings.hostClubId)
    c.nationsTitled = addOnce(c.nationsTitled, game.settings.rules.onlyNation)
  }
  return c
}

/** A head-to-head season played: the only mark a hot-seat game leaves. */
export function creditH2H(cabinet: Cabinet): Cabinet {
  const c = normaliseCabinet(cabinet)
  c.h2h.played += 1
  return c
}

/**
 * The cabinet of a profile written before the Trophy Room: the five trophy
 * counts copied exactly, everything else counted from the 50-entry
 * leaderboard (so older counts are a floor) and the daily results.
 */
export function rebuildCabinet(profile: Pick<Profile, 'trophies' | 'leaderboard' | 'dailyResults'>): Cabinet {
  const c = emptyCabinet()
  const t = profile.trophies
  if (t) {
    c.league = t.league ?? 0
    c.cup = t.cup ?? 0
    c.continental = t.continental ?? 0
    c.doubles = t.doubles ?? 0
    c.trebles = t.trebles ?? 0
  }
  const board = Array.isArray(profile.leaderboard) ? profile.leaderboard : []
  for (const e of board) {
    c.byMode[e.mode] = (c.byMode[e.mode] ?? 0) + 1
    if (!countsAsLeagueSeason(e.mode)) continue
    if (e.tier === 'PERFECT') c.perfect += 1
    if (e.tier === 'PERFECT' || e.tier === 'INVINCIBLE') c.invincible += 1
    if (e.points >= 100 && e.tier !== 'RELEGATED') c.centurions += 1
    if (isTitle(e.position, e.tier)) {
      c.hostsTitled = addOnce(c.hostsTitled, e.hostClubId)
      c.nationsTitled = addOnce(c.nationsTitled, e.nation)
    }
  }
  c.dailies = Object.keys(profile.dailyResults ?? {}).length
  if (board.length) c.rebuilt = true
  return c
}

/** The five counts `profile.trophies` keeps for older builds. */
export function trophiesOf(c: Cabinet): NonNullable<Profile['trophies']> {
  return { league: c.league, cup: c.cup, continental: c.continental, doubles: c.doubles, trebles: c.trebles }
}

/**
 * Leagues won in, derived rather than stored: each titled host's league from
 * `leagueOf` (the loaded clubs, or the packs' club lists), and the league a
 * newer leaderboard entry names. `unresolved` lists hosts neither could place.
 */
export function leaguesWon(cabinet: Pick<Cabinet, 'hostsTitled'>, leaderboard: LeaderboardEntry[], leagueOf: (clubId: string) => string | undefined): { leagues: string[]; unresolved: string[] } {
  const leagues = new Set<string>()
  const placed = new Set<string>()
  for (const e of leaderboard) {
    if (e.leagueId && isTitle(e.position, e.tier)) {
      leagues.add(e.leagueId)
      placed.add(e.hostClubId)
    }
  }
  const unresolved: string[] = []
  for (const id of cabinet.hostsTitled) {
    const l = leagueOf(id)
    if (l) leagues.add(l)
    else if (!placed.has(id)) unresolved.push(id)
  }
  return { leagues: [...leagues].sort(), unresolved }
}

/** The Record page's Best seasons filter. Arena and run-in results get their own tables. */
export type BoardFilter = 'all' | 'quick' | 'season' | 'dynasty'

export const BOARD_FILTERS: ReadonlyArray<{ value: BoardFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'quick', label: 'Quick and Daily' },
  { value: 'season', label: 'Season' },
  { value: 'dynasty', label: 'Dynasty' },
]

/** Which filter a mode's entries fall under. Exhaustive over `Mode`. */
export function boardGroup(mode: Mode): Exclude<BoardFilter, 'all'> {
  switch (mode) {
    case 'quick':
    case 'daily':
      return 'quick'
    case 'season':
      return 'season'
    case 'dynasty':
      return 'dynasty'
    default: {
      const never: never = mode
      return never
    }
  }
}

export function filterBoard(entries: LeaderboardEntry[], filter: BoardFilter): LeaderboardEntry[] {
  return filter === 'all' ? entries : entries.filter((e) => boardGroup(e.mode) === filter)
}
