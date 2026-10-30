/**
 * Gameplay sweep, P9 (playtest round 2): is the scoring loud for drafted all-star sides on Calibrated? Run with
 * GAMEPLAY_SWEEP=1 (`GAMEPLAY_N` scales the seed counts); the report is `.gameplay/scoring.txt` and `.json`.
 *
 * Two halves, so the drafted sides are judged against the engine's own reading of real football:
 * - Real sides: every league-season with a real table in the four leagues with tables, played fresh as an all-AI double
 *   round robin at full strength (Realistic, as `feel.sweep.test.ts` plays them). Each club's strength gap over its
 *   league's mean, its goals for and points a game, beside the real ones. Binned by gap, the engine's curve sits beside
 *   reality's where reality has data (the strongest real sides stand about 8 to 11 above their league).
 * - Drafted sides: the assistant's Season drafts managed by the assistant through a season (England 2025-26, Calibrated
 *   and Realistic), and the assistant's Quick Drafts (Calibrated), with the same gap, goals and points.
 * Display only, nothing asserted beyond the run completing: the numbers decide whether to calibrate.
 */
import { describe, it } from 'vitest'
import { loadTestUniverse } from '../../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { aiStrength, aiTeamInput, buildAiClubs, computeTable, generateFixtures, seasonTable, USER_TEAM } from '@engine/season'
import { simulateMatch } from '@engine/match'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { computeTeamStrength } from '@engine/ratings'
import { createGame, beginSeason } from '../../logic/setup'
import { playMatchweek } from '../../logic/week'
import { quickXI, runQuickSeason, toKickoff } from '../../logic/quick'
import { playerLookup } from '../../logic/players'
import { SWEEP, sweepN, writeReport } from './sweepSetup'

const LEAGUES = ['england', 'spain', 'italy', 'germany']
const BINS = [-Infinity, -4, 0, 3, 6, 9, 12, 15, Infinity]

interface Row {
  kind: string
  gap: number
  gf: number
  ga: number
  pts: number
  realGf?: number
  realPts?: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')

function binOf(gap: number): string {
  for (let i = 0; i < BINS.length - 1; i++) if (gap >= BINS[i] && gap < BINS[i + 1]) return `${BINS[i] === -Infinity ? '<' : BINS[i]}..${BINS[i + 1] === Infinity ? '' : BINS[i + 1]}`
  return '?'
}

/** Least squares slope and intercept of y on x. */
function fit(xs: number[], ys: number[]): { slope: number; at0: number } {
  const mx = mean(xs)
  const my = mean(ys)
  const sxy = xs.reduce((t, x, i) => t + (x - mx) * (ys[i] - my), 0)
  const sxx = xs.reduce((t, x) => t + (x - mx) ** 2, 0)
  const slope = sxy / sxx
  return { slope, at0: my - slope * mx }
}

describe.runIf(SWEEP)('gameplay sweep: scoring (P9)', () => {
  it('real sides, then drafted sides, goals and points by strength gap', () => {
    const u = loadTestUniverse(LEAGUES)
    const rows: Row[] = []
    const reps = sweepN(1)
    // Real sides at full strength
    for (const leagueId of LEAGUES) {
      for (const [season, real] of Object.entries(u.tables[leagueId] ?? {})) {
        const s = Number(season)
        if (s < 2008 || !real.length) continue
        for (let rep = 0; rep < reps; rep++) {
          const ai = buildAiClubs(u, leagueId, s, '')
          const ids = Object.keys(ai)
          if (ids.length < 10) continue
          const strength = Object.fromEntries(ids.map((id) => [id, aiStrength(u, ai[id])]))
          const avg = mean(ids.map((id) => strength[id]))
          const rng = new Rng(`p9-real:${leagueId}:${s}:${rep}`)
          const fixtures = generateFixtures(ids, rng)
          const inputs = Object.fromEntries(ids.map((id) => [id, aiTeamInput(u, ai[id], 0)]))
          for (const f of fixtures) {
            if (f.homeTeamId === 'bye' || f.awayTeamId === 'bye') continue
            f.result = simulateMatch({ rng, home: inputs[f.homeTeamId], away: inputs[f.awayTeamId], detail: 'summary' })
          }
          const table = computeTable(fixtures.filter((f) => f.result), ids)
          const realOf = new Map(real.map((r) => [r.clubId, r]))
          for (const r of table) {
            const rr = realOf.get(r.teamId)
            if (!rr) continue
            const played = rr.won + rr.drawn + rr.lost
            rows.push({ kind: 'real', gap: strength[r.teamId] - avg, gf: r.goalsFor / r.played, ga: r.goalsAgainst / r.played, pts: r.points / r.played, realGf: rr.goalsFor / played, realPts: (3 * rr.won + rr.drawn) / played })
          }
        }
      }
    }
    // Drafted sides: the assistant's Season, managed by the assistant
    const uE = loadTestUniverse(['england'])
    for (const difficulty of ['calibrated', 'realistic'] as const) {
      for (let i = 0; i < sweepN(12); i++) {
        const g = createGame({ mode: 'season', seed: `p9-season-${difficulty}-${i}`, formationId: '4-3-3', teamName: 'P9 XI', shortName: 'P9X', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty })
        const rng = Rng.fromState(g.rngState)
        autoDraft(uE, g.draft!, rng)
        g.rngState = rng.getState()
        beginSeason(g, uE)
        const s = g.season!
        const get = playerLookup(g, uE)
        const mine = computeTeamStrength(g.tactics, g.lineup, get, (id) => g.squad[id]).overall
        const avg = mean(Object.values(s.ai).map((c) => aiStrength(uE, c) - s.aiOffset))
        let weeks = 0
        while (g.phase !== 'summary' && weeks++ < 60) playMatchweek(g, uE, true)
        const r = seasonTable(g.season!).find((x) => x.teamId === USER_TEAM)!
        rows.push({ kind: `season-${difficulty}`, gap: mine - avg, gf: r.goalsFor / r.played, ga: r.goalsAgainst / r.played, pts: r.points / r.played })
      }
    }
    // Drafted sides: the assistant's Quick Draft (no bench), Calibrated
    for (let i = 0; i < sweepN(40); i++) {
      const g = createGame({ mode: 'quick', seed: `p9-quick-${i}`, formationId: '4-3-3', teamName: 'P9 XI', shortName: 'P9X', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false }, jobSecurity: false, difficulty: 'calibrated', january: false })
      const rng = Rng.fromState(g.rngState)
      autoDraft(uE, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, uE)
      const get = playerLookup(g, uE)
      const { lineup } = quickXI(g, uE)
      const mine = computeTeamStrength(g.tactics, lineup, get, () => undefined).overall
      const ai = buildAiClubs(uE, 'england', 2025, 'burnley')
      const strengths = Object.values(ai).map((c) => aiStrength(uE, c))
      const offset = Math.max(0, Math.round((mean(strengths) - 75) * 10) / 10)
      runQuickSeason(g, uE)
      const q = g.quickResult!
      const played = q.won + q.drawn + q.lost
      const row = q.table.find((x) => x.teamId === USER_TEAM)!
      rows.push({ kind: 'quick-calibrated', gap: mine - (mean(strengths) - offset), gf: row.goalsFor / played, ga: row.goalsAgainst / played, pts: q.points / played })
    }

    // The report
    const lines: string[] = []
    const real = rows.filter((r) => r.kind === 'real')
    const simFit = fit(real.map((r) => r.gap), real.map((r) => r.gf))
    const realFit = fit(real.map((r) => r.gap), real.map((r) => r.realGf!))
    const simPts = fit(real.map((r) => r.gap), real.map((r) => r.pts))
    const realPts = fit(real.map((r) => r.gap), real.map((r) => r.realPts!))
    lines.push(`real sides: ${real.length} club-seasons (${LEAGUES.join(', ')}, 2008 on, Realistic, ${reps} rep)`)
    lines.push(`goals for a game against gap: engine ${f2(simFit.at0)} + ${simFit.slope.toFixed(3)} x gap, real ${f2(realFit.at0)} + ${realFit.slope.toFixed(3)} x gap`)
    lines.push(`points a game against gap: engine ${f2(simPts.at0)} + ${simPts.slope.toFixed(3)} x gap, real ${f2(realPts.at0)} + ${realPts.slope.toFixed(3)} x gap`)
    lines.push('gap bin | n | engine GF/g | real GF/g | engine GA/g | engine pts/g | real pts/g')
    const bins = new Map<string, Row[]>()
    for (const r of real) bins.set(binOf(r.gap), [...(bins.get(binOf(r.gap)) ?? []), r])
    for (const [b, rs] of [...bins].sort((a, c) => mean(a[1].map((r) => r.gap)) - mean(c[1].map((r) => r.gap)))) {
      lines.push(`${b} | ${rs.length} | ${f2(mean(rs.map((r) => r.gf)))} | ${f2(mean(rs.map((r) => r.realGf!)))} | ${f2(mean(rs.map((r) => r.ga)))} | ${f2(mean(rs.map((r) => r.pts)))} | ${f2(mean(rs.map((r) => r.realPts!)))}`)
    }
    const top = [...real].sort((a, b) => b.gap - a.gap).slice(0, 20)
    lines.push(`the 20 strongest real sides (gap ${f2(mean(top.map((r) => r.gap)))}): engine ${f2(mean(top.map((r) => r.gf)))} GF/g ${f2(mean(top.map((r) => r.pts * 38)))} pts/38, real ${f2(mean(top.map((r) => r.realGf!)))} GF/g ${f2(mean(top.map((r) => r.realPts! * 38)))} pts/38`)
    for (const kind of ['season-calibrated', 'season-realistic', 'quick-calibrated']) {
      const rs = rows.filter((r) => r.kind === kind)
      const g = mean(rs.map((r) => r.gap))
      lines.push(`${kind}: ${rs.length} sides, gap ${f2(g)} (min ${f2(Math.min(...rs.map((r) => r.gap)))}, max ${f2(Math.max(...rs.map((r) => r.gap)))}), GF/g ${f2(mean(rs.map((r) => r.gf)))} (engine's real-side line at that gap ${f2(simFit.at0 + simFit.slope * g)}, reality's ${f2(realFit.at0 + realFit.slope * g)}), GA/g ${f2(mean(rs.map((r) => r.ga)))}, pts/38 ${f2(mean(rs.map((r) => r.pts * 38)))}, goals/38 ${f2(mean(rs.map((r) => r.gf * 38)))}`)
    }
    writeReport('scoring', lines.join('\n') + '\n', { rows })
    console.log(lines.join('\n'))
  }, 3_600_000)
})
