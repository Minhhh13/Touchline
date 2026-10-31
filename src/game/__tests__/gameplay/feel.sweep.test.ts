/**
 * Gameplay sweep, the feel against real football (run with GAMEPLAY_SWEEP=1): every league-season with a real table
 * played as an all-AI double round robin (fresh squads, summary detail, as the AI fixtures of a season are), and set
 * beside the real table. Writes per league-season numbers to the report directory.
 */
import { describe, it, vi } from 'vitest'
vi.mock('@engine/match', async (importOriginal) => {
  const m = await importOriginal<typeof import('@engine/match')>()
  const r = await import('./recorder')
  return { ...m, ...r.wrap(m) }
})
import { loadTestUniverse } from '../../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { aiTeamInput, buildAiClubs, CALIBRATED_LEAGUE_AVERAGE, aiStrength, computeTable, generateFixtures } from '@engine/season'
import { simulateMatch } from '@engine/match'
import { autoDraft, QUICK_RULES, withDifficulty } from '@engine/draft'
import { createGame } from '../../logic/setup'
import { runQuickSeason, toKickoff } from '../../logic/quick'
import { report, setBucket, setContext } from './recorder'
import { SWEEP, sweepN, writeReport } from './sweepSetup'

const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']

function spearman(a: number[], b: number[]): number {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(x.length)
    idx.forEach(([, i], k) => (r[i] = k))
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const d2 = ra.reduce((s, v, i) => s + (v - rb[i]) ** 2, 0)
  return 1 - (6 * d2) / (n * (n * n - 1))
}

describe.runIf(SWEEP)('gameplay sweep: feel', () => {
  it('every league-season against its real table', () => {
    const u = loadTestUniverse(LEAGUES)
    const rows: Array<Record<string, number | string>> = []
    const reps = sweepN(3)
    for (const leagueId of LEAGUES) {
      setBucket(leagueId)
      const tables = u.tables[leagueId] ?? {}
      for (const [season, real] of Object.entries(tables)) {
        const s = Number(season)
        if (s < 2008 || !real.length) continue
        for (const difficulty of ['realistic', 'calibrated'] as const) {
          for (let rep = 0; rep < reps; rep++) {
            setContext(`${leagueId} ${s} ${difficulty} ${rep}`)
            const ai = buildAiClubs(u, leagueId, s, '')
            const ids = Object.keys(ai)
            if (ids.length < 10) continue
            const strengths = Object.fromEntries(ids.map((id) => [id, aiStrength(u, ai[id])]))
            const avg = ids.reduce((t, id) => t + strengths[id], 0) / ids.length
            const offset = difficulty === 'realistic' ? 0 : Math.max(0, Math.round((avg - CALIBRATED_LEAGUE_AVERAGE) * 10) / 10)
            const rng = new Rng(`feel:${leagueId}:${s}:${rep}`)
            const fixtures = generateFixtures(ids, rng)
            const inputs = Object.fromEntries(ids.map((id) => [id, aiTeamInput(u, ai[id], offset)]))
            for (const f of fixtures) {
              if (f.homeTeamId === 'bye' || f.awayTeamId === 'bye') continue
              f.result = simulateMatch({ rng, home: inputs[f.homeTeamId], away: inputs[f.awayTeamId], detail: 'summary' })
            }
            const table = computeTable(fixtures.filter((f) => f.result), ids)
            const games = table.reduce((t, r) => t + r.played, 0) / 2
            const goals = table.reduce((t, r) => t + r.goalsFor, 0)
            const realGames = real.reduce((t, r) => t + r.won + r.drawn + r.lost, 0) / 2
            const realGoals = real.reduce((t, r) => t + r.goalsFor, 0)
            const realDraws = real.reduce((t, r) => t + r.drawn, 0) / 2
            const draws = table.reduce((t, r) => t + r.drawn, 0) / 2
            const byId = new Map(table.map((r) => [r.teamId, r]))
            const both = real.filter((r) => byId.has(r.clubId))
            const spread = Math.max(...ids.map((id) => strengths[id])) - Math.min(...ids.map((id) => strengths[id]))
            rows.push({
              league: leagueId,
              season: s,
              difficulty,
              rep,
              clubs: ids.length,
              spread: Math.round(spread * 10) / 10,
              gpg: Math.round((goals / games) * 100) / 100,
              realGpg: Math.round((realGoals / realGames) * 100) / 100,
              drawPct: Math.round((1000 * draws) / games) / 10,
              realDrawPct: Math.round((1000 * realDraws) / realGames) / 10,
              top: table[0].points,
              realTop: real[0].points,
              bottom: table.at(-1)!.points,
              realBottom: real.at(-1)!.points,
              maxGoals: Math.max(...fixtures.filter((f) => f.result).map((f) => Math.max(f.result!.homeGoals, f.result!.awayGoals))),
              rho: Math.round(spearman(both.map((r) => r.points), both.map((r) => byId.get(r.clubId)!.points)) * 100) / 100,
            })
          }
        }
      }
    }
    writeReport('feel', report(), { rows })
  }, 3_600_000)

  it('the 38-0 chase with the assistant draft', () => {
    const u = loadTestUniverse(['england'])
    setBucket('assistant-quick')
    const out: Record<string, { n: number; perfect: number; unbeaten: number; titles: number; wins: number[]; points: number[] }> = {}
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const o = (out[difficulty] = { n: 0, perfect: 0, unbeaten: 0, titles: 0, wins: [] as number[], points: [] as number[] })
      for (let i = 0; i < sweepN(300); i++) {
        const seed = `assist-${difficulty}-${i}`
        setContext(seed)
        const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Auto XI', shortName: 'AUT', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: withDifficulty({ ...QUICK_RULES, leagues: ['england'], managers: false }, difficulty), jobSecurity: false, difficulty: 'calibrated', january: false })
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        g.rngState = rng.getState()
        toKickoff(g, u)
        runQuickSeason(g, u)
        const q = g.quickResult!
        o.n++
        if (q.won === q.won + q.drawn + q.lost) o.perfect++
        if (q.lost === 0) o.unbeaten++
        if (q.position === 1) o.titles++
        o.wins.push(q.won)
        o.points.push(q.points)
      }
    }
    writeReport('assistant-quick', report(), out)
  }, 3_600_000)
})
