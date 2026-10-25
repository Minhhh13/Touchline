import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type MatchTeamInput } from '@engine/match'
import { aiRatingOffset, buildAiClubs, computeTable, generateFixtures, matchweeksFor, positionOf, seasonTier, aiTeamInput } from '@engine/season'
import { autoPickLineup, computeTeamStrength } from '@engine/ratings'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { DraftState } from '@engine/draft'
import type { Fixture, SeasonTier, TableRow } from '@engine/types'
import type { QuickGameResult } from '../types'
import { recordUserGames } from './gameByGame'

export interface H2HManager {
  name: string
  shortName: string
  formationId: string
  hostClubId: string
}

export interface H2HResult {
  table: TableRow[]
  rows: [TableRow, TableRow]
  tiers: [SeasonTier, SeasonTier]
  positions: [number, number]
  strengths: [number, number]
  /** The two league meetings between the managers. */
  derbies: Array<{ homeIdx: 0 | 1; homeGoals: number; awayGoals: number; matchweek: number }>
  winner: 0 | 1 | null
  topScorers: [{ playerSeasonId: string; goals: number } | null, { playerSeasonId: string; goals: number } | null]
  /** Each manager's season game by game (absent on results stored before it was recorded). */
  results?: [QuickGameResult[], QuickGameResult[]]
}

export const H2H_IDS = ['h2h-1', 'h2h-2'] as const

/** Both drafted XIs enter the same league season, replacing two real clubs. */
export function runH2HSeason(u: LoadedUniverse, rng: Rng, managers: [H2HManager, H2HManager], drafts: [DraftState, DraftState], leagueId: string, leagueSeason: number, difficulty: 'calibrated' | 'realistic'): H2HResult {
  const aiAll = buildAiClubs(u, leagueId, leagueSeason, managers[0].hostClubId)
  delete aiAll[managers[1].hostClubId]
  const offset = aiRatingOffset(u, aiAll, difficulty)
  const inputs = managers.map((m, i) => {
    const d = drafts[i]
    const formation = getFormation(m.formationId)
    const tactics = defaultTactics(m.formationId)
    const pool = [...Object.values(d.lineup), ...d.bench].map((id) => u.index[id]).filter(Boolean)
    const lineup = { ...d.lineup }
    if (Object.keys(lineup).length < formation.slots.length) Object.assign(lineup, autoPickLineup(formation, pool, tactics).lineup)
    const input: MatchTeamInput = { teamId: H2H_IDS[i], teamName: m.name, shortName: m.shortName, tactics, lineup, bench: [...d.bench], getPlayer: (id) => u.index[id], getState: () => undefined }
    const strength = computeTeamStrength(tactics, lineup, input.getPlayer, input.getState).overall
    return { input, strength }
  }) as [{ input: MatchTeamInput; strength: number }, { input: MatchTeamInput; strength: number }]
  const ids = [H2H_IDS[0], H2H_IDS[1], ...Object.keys(aiAll)]
  const fixtures: Fixture[] = generateFixtures(ids, rng)
  const goals: [Record<string, number>, Record<string, number>] = [{}, {}]
  const derbies: H2HResult['derbies'] = []
  const teamFor = (id: string): MatchTeamInput => (id === H2H_IDS[0] ? inputs[0].input : id === H2H_IDS[1] ? inputs[1].input : aiTeamInput(u, aiAll[id], offset))
  for (const f of fixtures) {
    const res = simulateMatch({ rng, home: teamFor(f.homeTeamId), away: teamFor(f.awayTeamId), detail: 'summary', importance: f.homeTeamId.startsWith('h2h') && f.awayTeamId.startsWith('h2h') ? 1.25 : 1 })
    f.result = res
    for (const [idx, id] of [[0, H2H_IDS[0]], [1, H2H_IDS[1]]] as Array<[0 | 1, string]>) {
      const stats = f.homeTeamId === id ? res.homeStats : f.awayTeamId === id ? res.awayStats : null
      if (stats) for (const st of stats) goals[idx][st.playerSeasonId] = (goals[idx][st.playerSeasonId] ?? 0) + st.goals
    }
    if (f.homeTeamId.startsWith('h2h') && f.awayTeamId.startsWith('h2h')) derbies.push({ homeIdx: f.homeTeamId === H2H_IDS[0] ? 0 : 1, homeGoals: res.homeGoals, awayGoals: res.awayGoals, matchweek: f.matchweek })
  }
  const table = computeTable(fixtures, ids)
  const rows = [table.find((r) => r.teamId === H2H_IDS[0])!, table.find((r) => r.teamId === H2H_IDS[1])!] as [TableRow, TableRow]
  const positions = [positionOf(table, H2H_IDS[0]), positionOf(table, H2H_IDS[1])] as [number, number]
  const mw = matchweeksFor(ids.length)
  const tiers = [seasonTier(table, H2H_IDS[0], false, mw), seasonTier(table, H2H_IDS[1], false, mw)] as [SeasonTier, SeasonTier]
  const winner: 0 | 1 | null = positions[0] < positions[1] ? 0 : positions[1] < positions[0] ? 1 : null
  const top = (g: Record<string, number>) => {
    const e = Object.entries(g).sort((a, b) => b[1] - a[1])[0]
    return e && e[1] > 0 ? { playerSeasonId: e[0], goals: e[1] } : null
  }
  const nameOf = (id: string) => u.index[id]?.name
  const results: [QuickGameResult[], QuickGameResult[]] = [recordUserGames(fixtures, ids, H2H_IDS[0], nameOf), recordUserGames(fixtures, ids, H2H_IDS[1], nameOf)]
  return { table, rows, tiers, positions, strengths: [inputs[0].strength, inputs[1].strength], derbies, winner, topScorers: [top(goals[0]), top(goals[1])], results }
}
