import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Attributes, Club, ClubSeason, LeagueInfo, LeagueSeasonRow, PlayerSeason, Position, Traits } from '../types'
import { overallOf } from '../positions'
import { withDepth } from '../depth'
import { buildLeague, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'

/**
 * `buildLeague` resolves each column's place once per file. The reference below is the build as it was before
 * (a keyed lookup for every field of every row), kept verbatim: every pack, England's classic pack included, must
 * build to the very same universe, key order and all.
 */
function legacyBuildLeague(players: PlayersFile, meta: MetaFile, info?: LeagueInfo, classic?: PlayersFile): LoadedUniverse {
  const leagueId = meta.league.id
  let col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>
  const get = (row: Array<string | number>, key: string) => row[col[key]]

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
  col = Object.fromEntries(file.columns.map((c, i) => [c, i])) as Record<string, number>
  for (const row of file.rows) {
    const season = Number(get(row, 'season'))
    if (file !== players && !classicSeasonSet.has(season)) continue
    const clubId = String(get(row, 'club'))
    const positions = String(get(row, 'pos')).split('|') as Position[]
    const age = Number(get(row, 'age'))
    const height = Number(get(row, 'height')) || 0
    // A depth column missing from an older pack reads as undefined and is derived from the eight core attributes
    const depth = (key: string): number | undefined => (key in col ? Number(get(row, key)) : undefined)
    const attributes: Attributes = withDepth(
      {
        pace: Number(get(row, 'pac')),
        shooting: Number(get(row, 'sho')),
        passing: Number(get(row, 'pas')),
        dribbling: Number(get(row, 'dri')),
        defending: Number(get(row, 'def')),
        physical: Number(get(row, 'phy')),
        mentality: Number(get(row, 'men')),
        goalkeeping: Number(get(row, 'gk')),
        stamina: depth('sta'),
        strength: depth('str'),
        aggression: depth('agg'),
        jumping: depth('jmp'),
        workRate: depth('wr'),
      },
      age,
      height,
    )
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
      age,
      clubId,
      season,
      positions,
      attributes,
      traits,
      overall: Number(get(row, 'ovr')),
      value: Number(get(row, 'value')),
      wage: Number(get(row, 'wage')),
      foot: String(get(row, 'foot')) === 'L' ? 'L' : 'R',
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
  col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>

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
    voidTitles: { [leagueId]: [...voidTitles].sort((a, b) => a - b) },
    ...(classicSeasons.length ? { classicFirstSeason: Math.min(...classicSeasons.map((s) => s.season)) } : {}),
  }
}

const root = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T
const digest = (u: LoadedUniverse) => createHash('sha256').update(JSON.stringify(u)).digest('hex')

describe('buildLeague, columns resolved once per file', () => {
  const index = read<LeaguesFile>('leagues.json')
  it.each(index.leagues.map((l) => l.id))('builds %s exactly as the per-field lookup did, with and without its classic pack', (id) => {
    const players = read<PlayersFile>(`${id}/players.json`)
    const meta = read<MetaFile>(`${id}/meta.json`)
    const info = index.leagues.find((l) => l.id === id)
    const now = buildLeague(players, meta, info)
    expect(digest(now)).toBe(digest(legacyBuildLeague(players, meta, info)))
    expect(Object.keys(now.index).length).toBeGreaterThan(1000)
    // And without the data index's entry (the league info is then worked out from the rows)
    expect(digest(buildLeague(players, meta))).toBe(digest(legacyBuildLeague(players, meta)))
    if (existsSync(path.join(root, id, 'players-classic.json'))) {
      const classic = read<PlayersFile>(`${id}/players-classic.json`)
      const withClassic = buildLeague(players, meta, info, classic)
      expect(withClassic.clubSeasons.some((cs) => cs.classic)).toBe(true)
      expect(digest(withClassic)).toBe(digest(legacyBuildLeague(players, meta, info, classic)))
    }
  }, 120_000)

  it('reads a pack missing the depth and trait columns (an older pack) as before', () => {
    const players = read<PlayersFile>('england/players.json')
    const meta = read<MetaFile>('england/meta.json')
    const drop = new Set(['sta', 'str', 'agg', 'jmp', 'wr', 'cons', 'inj', 'big', 'prof', 'height'])
    const keep = players.columns.map((c, i) => (drop.has(c) ? -1 : i)).filter((i) => i >= 0)
    const older: PlayersFile = { ...players, columns: keep.map((i) => players.columns[i]), rows: players.rows.slice(0, 3000).map((r) => keep.map((i) => r[i])) }
    expect(digest(buildLeague(older, meta))).toBe(digest(legacyBuildLeague(older, meta)))
  }, 120_000)
})
