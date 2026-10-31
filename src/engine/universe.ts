/**
 * The universe: every real club-season and player-season the wheel can land on.
 * Data is produced by `scripts/import/build.mjs` from public datasets and
 * loaded here into typed, indexed structures.
 */
import type { Attributes, Club, ClubSeason, LeagueInfo, LeagueSeasonRow, PlayerSeason, Position, Traits, Universe } from './types'
import { overallOf } from './positions'
import { withDepth } from './depth'

export interface PlayersFile {
  version: number
  generatedAt: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export interface MetaFile {
  version: number
  league: { id: string; name: string; shortName: string; country?: string }
  clubs: Array<Omit<Club, 'leagueId'>>
  nations: Record<string, { name: string; flag: string }>
  seasons: Array<{
    season: number
    clubs: string[]
    complete: boolean
    hasTable?: boolean
    /** The title was stripped or never awarded: the club on top of the table is not champion. */
    titleVoid?: boolean
    /** A classic season: its rows are in `players-classic.json` and the wheel only lands on it when the rules opt in. */
    classic?: boolean
    /** Where the ratings come from: EA's (the default when missing) or TouchLine's estimate. */
    ratingsSource?: 'ea' | 'estimated'
    /** Share of the season's club-seasons whose appearances come from a validated table (the rest are estimated). */
    appsSource?: number
    /** `pts` is net of `deduction`, the points the league took off the club that season. */
    table: Array<{ clubId: string; position: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number; deduction?: number }>
  }>
  historicTables: Record<string, MetaFile['seasons'][number]['table']>
  /** Seasons of `historicTables` whose title was stripped or never awarded. */
  historicTitleVoid?: number[]
  sources: Array<{ credit: string; licence: string }>
}

export interface LeaguesFile {
  version: number
  generatedAt: string
  leagues: LeagueInfo[]
}

export interface LoadedUniverse extends Universe {
  nations: Record<string, { name: string; flag: string }>
  clubById: Record<string, Club>
  /** club-season lookup: `${clubId}@${season}` */
  clubSeasonByKey: Record<string, ClubSeason>
  sources: Array<{ credit: string; licence: string }>
  /** Season start year of the current, in-progress season (table incomplete), if any. */
  currentSeason: number | null
  /** Every league available in the data index, loaded or not. */
  available: LeagueInfo[]
  /** Date stamp (YYYY-MM-DD) of the data packs, from `leagues.json`; the pack's own date for a single league built offline. */
  generatedAt: string
  /** By league id, the seasons whose title was stripped or never awarded (no champion). */
  voidTitles: Record<string, number[]>
  /** First classic season loaded (opt-in, estimated ratings), when any is. */
  classicFirstSeason?: number
}

export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

/**
 * Build the structures for one league's data pack. `classic` is the optional
 * `players-classic.json` of the league's classic seasons: its club-seasons are
 * appended after every standard one and flagged `classic`, so the order and
 * indices of the standard club-seasons are the same with or without it.
 */
export function buildLeague(players: PlayersFile, meta: MetaFile, info?: LeagueInfo, classic?: PlayersFile): LoadedUniverse {
  const leagueId = meta.league.id
  const clubById: Record<string, Club> = {}
  const clubs: Club[] = meta.clubs.map((c) => ({ ...c, leagueId }))
  for (const c of clubs) clubById[c.id] = c

  const index: Record<string, PlayerSeason> = {}
  const squads: Record<string, PlayerSeason[]> = {}

  const files = classic ? [players, classic] : [players]
  // A classic row only loads for a season the meta marks classic: a stale meta.json (one service-worker
  // visit) or a classic row in a standard season must never add unflagged players or replace standard ones
  const classicSeasonSet = new Set(meta.seasons.filter((s) => s.classic).map((s) => s.season))
  for (const file of files) {
  // Each column's place, looked up once per file rather than once per field of every row (-1, which reads as
  // undefined, for a column this file does not have)
  const col = Object.fromEntries(file.columns.map((c, i) => [c, i])) as Record<string, number>
  const at = (key: string): number => (key in col ? col[key] : -1)
  const c = { season: at('season'), club: at('club'), pos: at('pos'), age: at('age'), height: at('height'), pac: at('pac'), sho: at('sho'), pas: at('pas'), dri: at('dri'), def: at('def'), phy: at('phy'), men: at('men'), gk: at('gk'), sta: at('sta'), str: at('str'), agg: at('agg'), jmp: at('jmp'), wr: at('wr'), cons: at('cons'), inj: at('inj'), big: at('big'), prof: at('prof'), id: at('id'), name: at('name'), nation: at('nation'), ovr: at('ovr'), value: at('value'), wage: at('wage'), foot: at('foot') }
  // A depth column missing from an older pack reads as undefined and is derived from the eight core attributes
  const depth = (row: Array<string | number>, i: number): number | undefined => (i >= 0 ? Number(row[i]) : undefined)
  // A missing trait column reads as an average player, never as NaN
  const trait = (raw: string | number | undefined): number => {
    if (raw === '' || raw === null || raw === undefined) return 0.5
    const v = Number(raw)
    return Number.isFinite(v) ? v / 100 : 0.5
  }
  for (const row of file.rows) {
    const season = Number(row[c.season])
    if (file !== players && !classicSeasonSet.has(season)) continue
    const clubId = String(row[c.club])
    const positions = String(row[c.pos]).split('|') as Position[]
    const age = Number(row[c.age])
    const height = Number(row[c.height]) || 0
    const attributes: Attributes = withDepth(
      {
        pace: Number(row[c.pac]),
        shooting: Number(row[c.sho]),
        passing: Number(row[c.pas]),
        dribbling: Number(row[c.dri]),
        defending: Number(row[c.def]),
        physical: Number(row[c.phy]),
        mentality: Number(row[c.men]),
        goalkeeping: Number(row[c.gk]),
        stamina: depth(row, c.sta),
        strength: depth(row, c.str),
        aggression: depth(row, c.agg),
        jumping: depth(row, c.jmp),
        workRate: depth(row, c.wr),
      },
      age,
      height,
    )
    const traits: Traits = {
      consistency: trait(row[c.cons]),
      injuryProneness: trait(row[c.inj]),
      bigMatch: trait(row[c.big]),
      professionalism: trait(row[c.prof]),
    }
    const playerId = String(row[c.id])
    // A player can appear for two clubs in one season (a mid-season move), so
    // the club is part of the player-season id.
    const id = `${playerId}@${season}@${clubId}`
    const ps: PlayerSeason = {
      id,
      playerId,
      name: String(row[c.name]),
      nationality: String(row[c.nation]),
      age,
      clubId,
      season,
      positions,
      attributes,
      traits,
      overall: Number(row[c.ovr]),
      value: Number(row[c.value]),
      wage: Number(row[c.wage]),
      foot: String(row[c.foot]) === 'L' ? 'L' : 'R',
      height,
      accolades: [],
    }
    if (!Number.isFinite(ps.overall) || ps.overall <= 0) ps.overall = overallOf(ps)
    index[id] = ps
    const key = `${clubId}@${season}`
    if (!squads[key]) squads[key] = []
    squads[key].push(ps)
  }
  }

  const tables: Record<number, LeagueSeasonRow[]> = {}
  const clubSeasons: ClubSeason[] = []
  const clubSeasonByKey: Record<string, ClubSeason> = {}
  let currentSeason: number | null = null
  // Classic seasons only count when their rows were loaded; they come after every standard season
  const standard = meta.seasons.filter((s) => !s.classic)
  const classicSeasons = classic ? meta.seasons.filter((s) => s.classic) : []
  const newestSeason = Math.max(...standard.map((s) => s.season))
  const toRows = (table: MetaFile['seasons'][number]['table']): LeagueSeasonRow[] =>
    table.map((r) => ({ clubId: r.clubId, position: r.position, points: r.pts, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.gf, goalsAgainst: r.ga, ...(r.deduction ? { deduction: r.deduction } : {}) }))
  const voidTitles = new Set<number>(meta.historicTitleVoid ?? [])
  for (const s of [...standard, ...classicSeasons]) {
    const rows = toRows(s.table)
    if (rows.length) tables[s.season] = rows
    const hasTable = s.hasTable ?? rows.length > 0
    // Without a results table the newest season in the pack is the one still being played
    const complete = hasTable ? s.complete : s.season < newestSeason
    if (!complete && currentSeason === null) currentSeason = s.season
    const byClub = Object.fromEntries(rows.map((r) => [r.clubId, r]))
    if (s.titleVoid) voidTitles.add(s.season)
    for (const clubId of s.clubs) {
      const squad = (squads[`${clubId}@${s.season}`] ?? []).sort((a, b) => b.overall - a.overall)
      const t = byClub[clubId]
      // A stripped or unawarded title makes nobody champion, though the table keeps its order
      const champions = s.complete && t?.position === 1 && !s.titleVoid
      const cs: ClubSeason = {
        clubId,
        leagueId,
        season: s.season,
        position: t?.position ?? 0,
        points: t?.points ?? 0,
        won: t?.won ?? 0,
        drawn: t?.drawn ?? 0,
        lost: t?.lost ?? 0,
        goalsFor: t?.goalsFor ?? 0,
        goalsAgainst: t?.goalsAgainst ?? 0,
        champions,
        complete,
        squad,
        ...(s.classic ? { classic: true } : {}),
        ...(s.ratingsSource === 'estimated' ? { estimated: true } : {}),
      }
      if (champions) for (const p of squad) p.accolades.push('Champion')
      clubSeasons.push(cs)
      clubSeasonByKey[`${clubId}@${s.season}`] = cs
    }
  }
  for (const [season, table] of Object.entries(meta.historicTables)) tables[Number(season)] = toRows(table)
  // A classic season's table stays readable (records, Explore) even when its rows were not loaded
  for (const s of meta.seasons) if (s.classic && !tables[s.season] && s.table.length) tables[s.season] = toRows(s.table)
  const seasons = standard.map((s) => s.season)
  const leagueInfo: LeagueInfo = info ?? { id: leagueId, name: meta.league.name, shortName: meta.league.shortName, country: meta.league.country ?? '', firstSeason: Math.min(...seasons), lastSeason: Math.max(...seasons), playerSeasons: players.rows.length, players: new Set(playerIds(players)).size, clubs: clubs.length }
  return {
    seed: `${leagueId}-v${players.version}-${players.generatedAt}`,
    leagues: [leagueInfo],
    clubs,
    clubSeasons,
    tables: { [leagueId]: tables },
    firstSeason: Math.min(...seasons),
    lastSeason: Math.max(...seasons),
    index,
    nations: meta.nations,
    clubById,
    clubSeasonByKey,
    sources: meta.sources,
    currentSeason,
    available: [leagueInfo],
    generatedAt: players.generatedAt,
    voidTitles: { [leagueId]: [...voidTitles].sort((a, b) => a - b) },
    ...(classicSeasons.length ? { classicFirstSeason: Math.min(...classicSeasons.map((s) => s.season)) } : {}),
  }
}

/** Every row's player id, as the column map reads it (the last column of a name wins). */
function playerIds(players: PlayersFile): string[] {
  const col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>
  const i = 'id' in col ? col.id : -1
  return players.rows.map((r) => String(r[i]))
}

/**
 * Merge several league packs into one universe (the wheel can span them all).
 *
 * Parts are concatenated in the order of the data index (`available`), never in
 * the order they were loaded: `spin()` picks among `clubSeasons` by weighted
 * index, so a European Nights seed must see the same club-season order whether
 * Spain or Germany was opened first. Leagues missing from the index keep their
 * given order after the indexed ones.
 */
export function mergeUniverses(parts: LoadedUniverse[], available: LeagueInfo[], generatedAt?: string): LoadedUniverse {
  const rank = (u: LoadedUniverse): number => {
    const i = available.findIndex((l) => l.id === u.leagues[0]?.id)
    return i < 0 ? available.length : i
  }
  const ordered = parts.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map((x) => x.u)
  const [first, ...rest] = ordered
  // Every standard club-season first, in league order, then every classic one: a seed's wheel indices never move
  const clubSeasons = [...ordered.flatMap((u) => u.clubSeasons.filter((cs) => !cs.classic)), ...ordered.flatMap((u) => u.clubSeasons.filter((cs) => cs.classic))]
  const classicFrom = ordered.map((u) => u.classicFirstSeason).filter((s): s is number => s !== undefined)
  const out: LoadedUniverse = {
    ...first,
    leagues: [...first.leagues],
    clubs: [...first.clubs],
    clubSeasons,
    tables: { ...first.tables },
    index: { ...first.index },
    nations: { ...first.nations },
    clubById: { ...first.clubById },
    clubSeasonByKey: { ...first.clubSeasonByKey },
    sources: [...first.sources],
    voidTitles: { ...first.voidTitles },
    available,
    generatedAt: generatedAt ?? ordered.map((u) => u.generatedAt).sort().at(-1) ?? first.generatedAt,
  }
  for (const u of rest) {
    out.leagues.push(...u.leagues)
    out.clubs.push(...u.clubs)
    Object.assign(out.tables, u.tables)
    Object.assign(out.index, u.index)
    Object.assign(out.nations, u.nations)
    Object.assign(out.clubById, u.clubById)
    Object.assign(out.clubSeasonByKey, u.clubSeasonByKey)
    Object.assign(out.voidTitles, u.voidTitles)
    out.firstSeason = Math.min(out.firstSeason, u.firstSeason)
    out.lastSeason = Math.max(out.lastSeason, u.lastSeason)
    if (u.currentSeason && !out.currentSeason) out.currentSeason = u.currentSeason
  }
  out.seed = out.leagues.map((l) => l.id).sort().join('+')
  if (classicFrom.length) out.classicFirstSeason = Math.min(...classicFrom)
  else delete out.classicFirstSeason
  return out
}

/** Keep the loaded universe stable across leagues. */
export const DEFAULT_LEAGUE = 'england'

const leagueCache = new Map<string, Promise<LoadedUniverse>>()
let indexCache: Promise<LeaguesFile> | null = null

function base(baseUrl?: string): string {
  const b = baseUrl ?? import.meta.env?.BASE_URL ?? '/'
  return b.endsWith('/') ? b : `${b}/`
}

/** The data index (`leagues.json`): every league pack and the date the packs were generated. */
export function fetchLeaguesIndex(baseUrl?: string): Promise<LeaguesFile> {
  if (!indexCache) {
    indexCache = fetch(`${base(baseUrl)}data/leagues.json`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`leagues.json ${r.status}`)
        return (await r.json()) as LeaguesFile
      })
      .catch((e: unknown) => {
        // A failed fetch is not cached: the next attempt retries the network
        indexCache = null
        throw e
      })
  }
  return indexCache
}

export function fetchAvailableLeagues(baseUrl?: string): Promise<LeagueInfo[]> {
  return fetchLeaguesIndex(baseUrl).then((j) => j.leagues)
}

/** Browser loader for one league pack, cached. */
export function fetchLeague(leagueId: string, baseUrl?: string): Promise<LoadedUniverse> {
  if (!leagueCache.has(leagueId)) {
    const b = base(baseUrl)
    leagueCache.set(
      leagueId,
      Promise.all([
        fetch(`${b}data/${leagueId}/players.json`).then((r) => {
          if (!r.ok) throw new Error(`${leagueId}/players.json ${r.status}`)
          return r.json() as Promise<PlayersFile>
        }),
        fetch(`${b}data/${leagueId}/meta.json`).then((r) => {
          if (!r.ok) throw new Error(`${leagueId}/meta.json ${r.status}`)
          return r.json() as Promise<MetaFile>
        }),
        fetchAvailableLeagues(baseUrl).then(async (avail) => {
          const info = avail.find((l) => l.id === leagueId)
          // The classic pack is optional: a league without one, or a failed fetch, loads its standard seasons only
          const classic = info?.classicFrom === undefined ? undefined : await fetch(`${b}data/${leagueId}/players-classic.json`).then((r) => (r.ok ? (r.json() as Promise<PlayersFile>) : undefined)).catch(() => undefined)
          return { avail, classic }
        }),
      ])
        .then(([p, m, { avail, classic }]) => buildLeague(p, m, avail.find((l) => l.id === leagueId), classic))
        .catch((e: unknown) => {
          leagueCache.delete(leagueId)
          throw e
        }),
    )
  }
  return leagueCache.get(leagueId)!
}

let clubLeaguesCache: Promise<Record<string, { leagueId: string; name: string }>> | null = null

/** Club id to its league and name for every pack, read from the small meta files only (the Record page places titled hosts without loading any players). Cached. */
export function fetchClubLeagues(baseUrl?: string): Promise<Record<string, { leagueId: string; name: string }>> {
  if (!clubLeaguesCache) {
    const b = base(baseUrl)
    clubLeaguesCache = fetchAvailableLeagues(baseUrl)
      .then((leagues) =>
        Promise.all(
          leagues.map((l) =>
            fetch(`${b}data/${l.id}/meta.json`).then(async (r) => {
              if (!r.ok) throw new Error(`${l.id}/meta.json ${r.status}`)
              return { id: l.id, meta: (await r.json()) as MetaFile }
            }),
          ),
        ),
      )
      .then((metas) => {
        const out: Record<string, { leagueId: string; name: string }> = {}
        for (const { id, meta } of metas) for (const c of meta.clubs) out[c.id] = { leagueId: id, name: c.name }
        return out
      })
      .catch((e: unknown) => {
        clubLeaguesCache = null
        throw e
      })
  }
  return clubLeaguesCache
}

/** Load and merge the given leagues (defaults to England). */
export async function loadUniverse(leagueIds: string[] = [DEFAULT_LEAGUE], baseUrl?: string): Promise<LoadedUniverse> {
  const ids = [...new Set(leagueIds)]
  const [index, ...parts] = await Promise.all([fetchLeaguesIndex(baseUrl), ...ids.map((id) => fetchLeague(id, baseUrl))])
  return mergeUniverses(parts, index.leagues, index.generatedAt)
}

export function clubName(u: LoadedUniverse, clubId: string): string {
  return u.clubById[clubId]?.name ?? clubId
}

/** Whether a player-season (or any `{ clubId, season }`) belongs to a classic club-season. */
export function isClassic(u: LoadedUniverse, p: { clubId: string; season: number }): boolean {
  return !!u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.classic
}

/** Whether a league season is a classic one (then season-scoped pools may use classic club-seasons). */
export function isClassicSeason(u: LoadedUniverse, leagueId: string, season: number): boolean {
  return u.clubSeasons.some((cs) => cs.classic && cs.leagueId === leagueId && cs.season === season)
}

/** The club-seasons an all-season pool may use: classic ones only when the game opted in. */
export function poolClubSeasons(u: LoadedUniverse, classic: boolean | undefined): ClubSeason[] {
  return classic ? u.clubSeasons : u.clubSeasons.filter((cs) => !cs.classic)
}

/** Club-seasons of one league in one season (the 18 or 20 clubs of that campaign). */
export function leagueSeasonClubs(u: LoadedUniverse, leagueId: string, season: number): ClubSeason[] {
  return u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season)
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
