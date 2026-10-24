/**
 * The universe: every real club-season and player-season the wheel can land on.
 * Data is produced by `scripts/import/build.mjs` from public datasets and
 * loaded here into typed, indexed structures.
 */
import type { Attributes, Club, ClubSeason, LeagueInfo, LeagueSeasonRow, PlayerSeason, Position, Traits, Universe } from './types'
import { overallOf } from './positions'

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
    table: Array<{ clubId: string; position: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number }>
  }>
  historicTables: Record<string, MetaFile['seasons'][number]['table']>
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
}

export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

/** Build the structures for one league's data pack. */
export function buildLeague(players: PlayersFile, meta: MetaFile, info?: LeagueInfo): LoadedUniverse {
  const leagueId = meta.league.id
  const col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>
  const get = (row: Array<string | number>, key: string) => row[col[key]]

  const clubById: Record<string, Club> = {}
  const clubs: Club[] = meta.clubs.map((c) => ({ ...c, leagueId }))
  for (const c of clubs) clubById[c.id] = c

  const index: Record<string, PlayerSeason> = {}
  const squads: Record<string, PlayerSeason[]> = {}

  for (const row of players.rows) {
    const season = Number(get(row, 'season'))
    const clubId = String(get(row, 'club'))
    const positions = String(get(row, 'pos')).split('|') as Position[]
    const attributes: Attributes = {
      pace: Number(get(row, 'pac')),
      shooting: Number(get(row, 'sho')),
      passing: Number(get(row, 'pas')),
      dribbling: Number(get(row, 'dri')),
      defending: Number(get(row, 'def')),
      physical: Number(get(row, 'phy')),
      mentality: Number(get(row, 'men')),
      goalkeeping: Number(get(row, 'gk')),
    }
    // A missing trait column reads as an average player, never as NaN
    const trait = (col: string): number => {
      const raw = get(row, col)
      if (raw === '' || raw === null || raw === undefined) return 0.5
      const v = Number(raw)
      return Number.isFinite(v) ? v / 100 : 0.5
    }
    const traits: Traits = {
      consistency: trait('cons'),
      injuryProneness: trait('inj'),
      bigMatch: trait('big'),
      professionalism: trait('prof'),
    }
    const playerId = String(get(row, 'id'))
    // A player can appear for two clubs in one season (a mid-season move), so
    // the club is part of the player-season id.
    const id = `${playerId}@${season}@${clubId}`
    const ps: PlayerSeason = {
      id,
      playerId,
      name: String(get(row, 'name')),
      nationality: String(get(row, 'nation')),
      age: Number(get(row, 'age')),
      clubId,
      season,
      positions,
      attributes,
      traits,
      overall: Number(get(row, 'ovr')),
      value: Number(get(row, 'value')),
      wage: Number(get(row, 'wage')),
      foot: String(get(row, 'foot')) === 'L' ? 'L' : 'R',
      height: Number(get(row, 'height')) || 0,
      accolades: [],
    }
    if (!Number.isFinite(ps.overall) || ps.overall <= 0) ps.overall = overallOf(ps)
    index[id] = ps
    const key = `${clubId}@${season}`
    if (!squads[key]) squads[key] = []
    squads[key].push(ps)
  }

  const tables: Record<number, LeagueSeasonRow[]> = {}
  const clubSeasons: ClubSeason[] = []
  const clubSeasonByKey: Record<string, ClubSeason> = {}
  let currentSeason: number | null = null
  const newestSeason = Math.max(...meta.seasons.map((s) => s.season))
  const toRows = (table: MetaFile['seasons'][number]['table']): LeagueSeasonRow[] =>
    table.map((r) => ({ clubId: r.clubId, position: r.position, points: r.pts, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.gf, goalsAgainst: r.ga }))
  for (const s of meta.seasons) {
    const rows = toRows(s.table)
    if (rows.length) tables[s.season] = rows
    const hasTable = s.hasTable ?? rows.length > 0
    // Without a results table the newest season in the pack is the one still being played
    const complete = hasTable ? s.complete : s.season < newestSeason
    if (!complete && currentSeason === null) currentSeason = s.season
    const byClub = Object.fromEntries(rows.map((r) => [r.clubId, r]))
    for (const clubId of s.clubs) {
      const squad = (squads[`${clubId}@${s.season}`] ?? []).sort((a, b) => b.overall - a.overall)
      const t = byClub[clubId]
      const champions = s.complete && t?.position === 1
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
      }
      if (champions) for (const p of squad) p.accolades.push('Champion')
      clubSeasons.push(cs)
      clubSeasonByKey[`${clubId}@${s.season}`] = cs
    }
  }
  for (const [season, table] of Object.entries(meta.historicTables)) tables[Number(season)] = toRows(table)
  const seasons = meta.seasons.map((s) => s.season)
  const leagueInfo: LeagueInfo = info ?? { id: leagueId, name: meta.league.name, shortName: meta.league.shortName, country: meta.league.country ?? '', firstSeason: Math.min(...seasons), lastSeason: Math.max(...seasons), playerSeasons: players.rows.length, players: new Set(players.rows.map((r) => String(get(r, 'id')))).size, clubs: clubs.length }
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
  }
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
  const out: LoadedUniverse = {
    ...first,
    leagues: [...first.leagues],
    clubs: [...first.clubs],
    clubSeasons: [...first.clubSeasons],
    tables: { ...first.tables },
    index: { ...first.index },
    nations: { ...first.nations },
    clubById: { ...first.clubById },
    clubSeasonByKey: { ...first.clubSeasonByKey },
    sources: [...first.sources],
    available,
    generatedAt: generatedAt ?? ordered.map((u) => u.generatedAt).sort().at(-1) ?? first.generatedAt,
  }
  for (const u of rest) {
    out.leagues.push(...u.leagues)
    out.clubs.push(...u.clubs)
    out.clubSeasons.push(...u.clubSeasons)
    Object.assign(out.tables, u.tables)
    Object.assign(out.index, u.index)
    Object.assign(out.nations, u.nations)
    Object.assign(out.clubById, u.clubById)
    Object.assign(out.clubSeasonByKey, u.clubSeasonByKey)
    out.firstSeason = Math.min(out.firstSeason, u.firstSeason)
    out.lastSeason = Math.max(out.lastSeason, u.lastSeason)
    if (u.currentSeason && !out.currentSeason) out.currentSeason = u.currentSeason
  }
  out.seed = out.leagues.map((l) => l.id).sort().join('+')
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
        fetchAvailableLeagues(baseUrl),
      ])
        .then(([p, m, avail]) => buildLeague(p, m, avail.find((l) => l.id === leagueId)))
        .catch((e: unknown) => {
          leagueCache.delete(leagueId)
          throw e
        }),
    )
  }
  return leagueCache.get(leagueId)!
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

export function flagOf(u: LoadedUniverse, nation: string): string {
  return u.nations[nation]?.flag ?? '🏳️'
}

/** Club-seasons of one league in one season (the 18 or 20 clubs of that campaign). */
export function leagueSeasonClubs(u: LoadedUniverse, leagueId: string, season: number): ClubSeason[] {
  return u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season)
}

/** Short club-season label like "Leicester City 2015-16 · Champions". */
export function describeClubSeason(u: LoadedUniverse, cs: ClubSeason): string {
  const club = clubName(u, cs.clubId)
  let suffix = ''
  if (!cs.complete) suffix = ' · in progress'
  else if (cs.champions) suffix = ' · Champions'
  else if (cs.position > 0) suffix = ` · ${ordinal(cs.position)}`
  return `${club} ${seasonLabel(cs.season)}${suffix}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
