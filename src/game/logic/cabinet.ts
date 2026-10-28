/**
 * The Trophy Room's cabinet: one set of counts every mode credits as its
 * result lands (`recordResult`), rebuilt once from an older profile. Pure: no
 * React, no store, no RNG.
 */
import type { SeasonTier } from '@engine/types'
import type { Cabinet, Game, HonourEntry, LeaderboardEntry, Mode, Profile } from '../types'

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
    h2hOnline: { played: 0, won: 0 },
    runIns: { played: 0, met: 0 },
    honours: [],
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
    ...(Array.isArray(c.recent) ? { recent: c.recent } : {}),
    nationsTitled: Array.isArray(c.nationsTitled) ? c.nationsTitled : [],
    byMode: { ...(c.byMode ?? {}) },
    gauntlet: { ...e.gauntlet, ...(c.gauntlet ?? {}) },
    cups: { ...e.cups, ...(c.cups ?? {}), bySize: { ...(c.cups?.bySize ?? {}) } },
    h2h: { ...e.h2h, ...(c.h2h ?? {}) },
    h2hOnline: { played: 0, won: 0, ...(c.h2hOnline ?? {}) },
    runIns: { ...e.runIns, ...(c.runIns ?? {}) },
    honours: Array.isArray(c.honours) ? c.honours.filter(isHonour).slice(0, HONOURS_CAP) : [],
  }
}

/** Seasons the honours board keeps, newest first. */
export const HONOURS_CAP = 30

function isHonour(h: unknown): h is HonourEntry {
  const x = h as Partial<HonourEntry> | null
  return !!x && typeof x === 'object' && typeof x.id === 'string' && (x.kind === 'treble' || x.kind === 'double') && Array.isArray(x.cups) && typeof x.teamName === 'string'
}

/** What a season's trophies make: the Treble (league, Cup and Continental Cup), a Double (the league and one cup), or nothing. */
export function honourOf(league: boolean, cup: boolean, continental: boolean): 'treble' | 'double' | null {
  if (league && cup && continental) return 'treble'
  return league && (cup || continental) ? 'double' : null
}

/** The honours board entry a season earns, or null: a title and at least one cup. Pure. */
export function honourEntry(game: Pick<Game, 'id' | 'year' | 'settings' | 'history'>, won: { league: boolean; cup: boolean; continental: boolean }, date?: string): HonourEntry | null {
  const kind = honourOf(won.league, won.cup, won.continental)
  if (!kind) return null
  return {
    id: resultId(game),
    kind,
    cups: [...(won.cup ? (['cup'] as const) : []), ...(won.continental ? (['continental'] as const) : [])],
    teamName: game.settings.teamName,
    mode: game.settings.mode,
    leagueId: game.history.at(-1)?.leagueId ?? game.settings.leagueId,
    leagueSeason: game.settings.leagueSeason,
    ...(game.settings.mode === 'quick' && game.settings.rules.superLeague === true ? { superLeague: true as const } : {}),
    ...(date ? { date } : {}),
  }
}

/** The honour's name on the summary and the honours board: "The Treble", "The Double" (league and Cup), "League and Continental double". */
export function honourLabel(kind: 'treble' | 'double', cups: ReadonlyArray<'cup' | 'continental'>): string {
  if (kind === 'treble') return 'The Treble'
  return cups.includes('cup') ? 'The Double' : 'League and Continental double'
}

/** What the honour is made of: "League, Cup and Continental Cup", "League and Cup". */
export function honourDetail(cups: ReadonlyArray<'cup' | 'continental'>): string {
  const names = ['League', ...(cups.includes('cup') ? ['Cup'] : []), ...(cups.includes('continental') ? ['Continental Cup'] : [])]
  return names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : names.join(' and ')
}

/** The share text's line: "👑 The Treble: League, Cup and Continental Cup", "🏆 The Double: League and Cup". */
export function honourLine(kind: 'treble' | 'double', cups: ReadonlyArray<'cup' | 'continental'>): string {
  return `${kind === 'treble' ? '👑' : '🏆'} ${kind === 'treble' ? 'The Treble' : 'The Double'}: ${honourDetail(cups)}`
}

/**
 * File a season on the honours board, newest first: once per season, so a Double that the second cup turns into a
 * Treble replaces its own entry (keeping its place) rather than adding one, and a lesser honour never replaces a better.
 */
export function fileHonour(cabinet: Cabinet, entry: HonourEntry): Cabinet {
  const list = cabinet.honours ?? []
  const have = list.find((h) => h.id === entry.id)
  if (have && (have.kind === 'treble' || entry.kind === 'double')) return cabinet
  const honours = have ? list.map((h) => (h.id === entry.id ? { ...entry, ...(have.date && !entry.date ? { date: have.date } : {}) } : h)) : [entry, ...list].slice(0, HONOURS_CAP)
  return { ...cabinet, honours }
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
    case 'weekly':
      return true
    case 'arena':
    case 'runin':
      return false
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

/** The id a finished game's result is filed under, on the leaderboard and in `Cabinet.recent`. */
export function resultId(game: Pick<Game, 'id' | 'year'>): string {
  return `${game.id}-${game.year}`
}

/** How many credited result ids the cabinet remembers beyond the leaderboard. */
export const RECENT_RESULTS = 20

/** True when this result is already on the leaderboard or was credited recently (it may have missed a full top 50). */
export function alreadyCredited(profile: Pick<Profile, 'leaderboard' | 'cabinet'>, id: string): boolean {
  return profile.leaderboard.some((e) => e.id === id) || !!profile.cabinet?.recent?.includes(id)
}

function addOnce(list: string[], id: string | undefined): string[] {
  return id && !list.includes(id) ? [...list, id] : list
}

/**
 * Credit one finished game. Called once per result (the leaderboard's id
 * dedupe), `newDaily` when the result filed a daily day for the first time,
 * `newWeekly` a Weekly Challenge week.
 */
export function creditGame(cabinet: Cabinet, game: Game, opts: { newDaily?: boolean; newWeekly?: boolean; date?: string } = {}): Cabinet {
  const rec = finishedRecord(game)
  if (!rec) return cabinet
  const mode = game.settings.mode
  const last = game.history.at(-1)
  const c = normaliseCabinet(cabinet)
  c.recent = [...(c.recent ?? []).filter((id) => id !== resultId(game)), resultId(game)].slice(-RECENT_RESULTS)
  c.byMode[mode] = (c.byMode[mode] ?? 0) + 1
  if (opts.newDaily) c.dailies += 1
  if (opts.newWeekly) c.weeklies += 1
  if (!countsAsLeagueSeason(mode)) return c
  const title = isTitle(rec.position, rec.tier)
  const cup = !!last?.cupWon
  // A quick season's Continental Cup run counts as the managed modes' trophy does
  const euro = !!last?.continentalWon || game.quickResult?.europe?.reached === 'W'
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
  // The honours board: a Treble or a Double this result already holds (a quick season's post-season cups file theirs as they are won)
  const honour = honourEntry(game, { league: title, cup, continental: euro }, opts.date)
  return honour ? fileHonour(c, honour) : c
}

/**
 * Credit one finished arena run, on the arena's own shelves: cups by size,
 * Gauntlet runs, best climb and completions, and a giant killed for every win on Realistic over a side whose real team
 * strength is 85 or more, and a Daily Arena day (`newArenaDaily`) the first time a day's run is filed. Never a league
 * title or a season cup.
 */
export function creditArena(cabinet: Cabinet, game: Game, opts: { newArenaDaily?: boolean } = {}): Cabinet {
  const a = game.arena
  if (!a?.over) return cabinet
  const c = normaliseCabinet(cabinet)
  c.recent = [...(c.recent ?? []).filter((id) => id !== resultId(game)), resultId(game)].slice(-RECENT_RESULTS)
  c.byMode.arena = (c.byMode.arena ?? 0) + 1
  if (opts.newArenaDaily) c.arenaDailies += 1
  if (a.format === 'cup') {
    c.cups.runs += 1
    if (a.won) {
      c.cups.won += 1
      const size = String(a.size ?? 2)
      c.cups.bySize[size] = (c.cups.bySize[size] ?? 0) + 1
    }
  }
  if (a.format === 'gauntlet') {
    // Rungs climbed: the score of the run, never a cup
    const rungs = a.log.filter((s) => s.gf > s.ga || (s.gf === s.ga && !!s.pens && s.pens.us > s.pens.them)).length
    c.gauntlet.runs += 1
    c.gauntlet.best = Math.max(c.gauntlet.best, rungs)
    if (a.won) c.gauntlet.complete += 1
  }
  if (game.settings.difficulty === 'realistic') c.giantKills += a.log.filter((s) => s.realStrength >= GIANT_STRENGTH && (s.gf > s.ga || (s.gf === s.ga && !!s.pens && s.pens.us > s.pens.them))).length
  return c
}

/** One finished run-in, on its own shelf: played, and the brief met. Never a league title. */
export function creditRunIn(cabinet: Cabinet, game: Game, met: boolean): Cabinet {
  const c = normaliseCabinet(cabinet)
  c.recent = [...(c.recent ?? []).filter((id) => id !== resultId(game)), resultId(game)].slice(-RECENT_RESULTS)
  c.byMode.runin = (c.byMode.runin ?? 0) + 1
  c.runIns.played += 1
  if (met) c.runIns.met += 1
  return c
}

/** The real team strength that makes an opponent a giant for the Giant Killer badge. */
export const GIANT_STRENGTH = 85

/** A head-to-head season played: the only mark a hot-seat game leaves. */
export function creditH2H(cabinet: Cabinet): Cabinet {
  const c = normaliseCabinet(cabinet)
  c.h2h.played += 1
  return c
}

/**
 * A finished online head-to-head room this device held a seat in: its own shelf, never the hot-seat's `h2h` nor the
 * league and cup counts (so `profile.trophies` is untouched). `won`: this device's manager finished higher.
 */
export function creditH2HOnline(cabinet: Cabinet, won: boolean): Cabinet {
  const c = normaliseCabinet(cabinet)
  const shelf = c.h2hOnline ?? { played: 0, won: 0 }
  c.h2hOnline = { played: shelf.played + 1, won: shelf.won + (won ? 1 : 0) }
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

/**
 * A cabinet caught up with `profile.trophies`: a build from before the Trophy
 * Room keeps the cabinet it finds but only advances `trophies`, so on load
 * each of the five counts takes the larger of the two.
 */
export function reconcileTrophies(c: Cabinet, t: Profile['trophies']): Cabinet {
  if (!t) return c
  return { ...c, league: Math.max(c.league, t.league ?? 0), cup: Math.max(c.cup, t.cup ?? 0), continental: Math.max(c.continental, t.continental ?? 0), doubles: Math.max(c.doubles, t.doubles ?? 0), trebles: Math.max(c.trebles, t.trebles ?? 0) }
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

/** The Record page's Best seasons filter. Arena and run-in results get their own tables. `budget` is every capped season, best value first. */
export type BoardFilter = 'all' | 'quick' | 'season' | 'dynasty' | 'budget'

export const BOARD_FILTERS: ReadonlyArray<{ value: BoardFilter; label: string; empty?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'quick', label: 'Quick and Daily' },
  { value: 'season', label: 'Season' },
  { value: 'dynasty', label: 'Dynasty' },
  { value: 'budget', label: 'Best on a budget', empty: 'No seasons on a salary cap yet. Set one under More options, Wheel rules.' },
]

/** Which filter a mode's entries fall under, null for a mode that never files a season (the arena has Best runs). Exhaustive over `Mode`. */
export function boardGroup(mode: Mode): Exclude<BoardFilter, 'all' | 'budget'> | null {
  switch (mode) {
    case 'quick':
    case 'daily':
    case 'weekly':
      return 'quick'
    case 'season':
      return 'season'
    case 'dynasty':
      return 'dynasty'
    case 'arena':
    case 'runin':
      return null
    default: {
      const never: never = mode
      return never
    }
  }
}

export function filterBoard(entries: LeaderboardEntry[], filter: BoardFilter): LeaderboardEntry[] {
  // Best on a budget: the seasons drafted under a salary cap, by points, then the smaller spend
  if (filter === 'budget') return entries.filter((e) => e.budget !== undefined).sort((a, b) => b.points - a.points || (a.spent ?? 0) - (b.spent ?? 0))
  return filter === 'all' ? entries : entries.filter((e) => boardGroup(e.mode) === filter)
}
