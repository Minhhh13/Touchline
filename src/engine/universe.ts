/**
 * The universe: every real club-season and player-season the wheel can land on.
 * Data is produced by `scripts/import/build.mjs` from public datasets and
 * loaded here into typed, indexed structures.
 */
import type { Attributes, Club, ClubSeason, LeagueSeasonRow, PlayerSeason, Position, Traits, Universe } from './types'
import { overallOf } from './positions'

export interface PlayersFile {
  version: number
  generatedAt: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export interface MetaFile {
  version: number
  league: { id: string; name: string; shortName: string }
  clubs: Club[]
  nations: Record<string, { name: string; flag: string }>
  seasons: Array<{
    season: number
    clubs: string[]
    complete: boolean
    table: Array<{ clubId: string; position: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number }>
  }>
  historicTables: Record<string, MetaFile['seasons'][number]['table']>
  sources: Array<{ credit: string; licence: string }>
}

export interface LoadedUniverse extends Universe {
  nations: Record<string, { name: string; flag: string }>
  clubById: Record<string, Club>
  /** club-season lookup: `${clubId}@${season}` */
  clubSeasonByKey: Record<string, ClubSeason>
  sources: Array<{ credit: string; licence: string }>
  /** Season start year of the current, in-progress season (table incomplete), if any. */
  currentSeason: number | null
}

export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

export function buildUniverse(players: PlayersFile, meta: MetaFile): LoadedUniverse {
  const col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>
  const get = (row: Array<string | number>, key: string) => row[col[key]]

  const clubById: Record<string, Club> = {}
  for (const c of meta.clubs) clubById[c.id] = c

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
    const traits: Traits = {
      consistency: Number(get(row, 'cons')) / 100,
      injuryProneness: Number(get(row, 'inj')) / 100,
      bigMatch: Number(get(row, 'big')) / 100,
      professionalism: Number(get(row, 'prof')) / 100,
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
    // Guard against data rows whose derived overall is wildly off (shouldn't happen).
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
  for (const s of meta.seasons) {
    const rows: LeagueSeasonRow[] = s.table.map((r) => ({
      clubId: r.clubId,
      position: r.position,
      points: r.pts,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.gf,
      goalsAgainst: r.ga,
    }))
    tables[s.season] = rows
    if (!s.complete) currentSeason = s.season
    const byClub = Object.fromEntries(rows.map((r) => [r.clubId, r]))
    for (const clubId of s.clubs) {
      const squad = (squads[`${clubId}@${s.season}`] ?? []).sort((a, b) => b.overall - a.overall)
      const t = byClub[clubId]
      const champions = s.complete && t?.position === 1
      const cs: ClubSeason = {
        clubId,
        season: s.season,
        position: t?.position ?? 0,
        points: t?.points ?? 0,
        won: t?.won ?? 0,
        drawn: t?.drawn ?? 0,
        lost: t?.lost ?? 0,
        goalsFor: t?.goalsFor ?? 0,
        goalsAgainst: t?.goalsAgainst ?? 0,
        champions,
        complete: s.complete,
        squad,
      }
      if (champions) for (const p of squad) p.accolades.push('Champion')
      clubSeasons.push(cs)
      clubSeasonByKey[`${clubId}@${s.season}`] = cs
    }
  }
  for (const [season, table] of Object.entries(meta.historicTables)) {
    tables[Number(season)] = table.map((r) => ({
      clubId: r.clubId,
      position: r.position,
      points: r.pts,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.gf,
      goalsAgainst: r.ga,
    }))
  }
  const seasons = meta.seasons.map((s) => s.season)
  return {
    seed: `england-v${players.version}-${players.generatedAt}`,
    clubs: meta.clubs,
    clubSeasons,
    tables,
    firstSeason: Math.min(...seasons),
    lastSeason: Math.max(...seasons),
    index,
    nations: meta.nations,
    clubById,
    clubSeasonByKey,
    sources: meta.sources,
    currentSeason,
  }
}

let cached: Promise<LoadedUniverse> | null = null

/** Browser loader: fetch the JSON files from /data/england. */
export function loadUniverse(baseUrl = import.meta.env?.BASE_URL ?? '/'): Promise<LoadedUniverse> {
  if (!cached) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    cached = Promise.all([
      fetch(`${base}data/england/players.json`).then((r) => {
        if (!r.ok) throw new Error(`players.json ${r.status}`)
        return r.json() as Promise<PlayersFile>
      }),
      fetch(`${base}data/england/meta.json`).then((r) => {
        if (!r.ok) throw new Error(`meta.json ${r.status}`)
        return r.json() as Promise<MetaFile>
      }),
    ]).then(([p, m]) => buildUniverse(p, m))
  }
  return cached
}

export function clubName(u: LoadedUniverse, clubId: string): string {
  return u.clubById[clubId]?.name ?? clubId
}

export function flagOf(u: LoadedUniverse, nation: string): string {
  return u.nations[nation]?.flag ?? '🏳️'
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
