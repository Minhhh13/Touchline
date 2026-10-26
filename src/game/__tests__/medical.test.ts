import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { USER_TEAM } from '@engine/season'
import { playerLookup } from '../logic/players'
import { conditionFactor, injuryRiskOf, medicalReport, type RiskBand } from '../logic/medical'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Physio XI', shortName: 'PHY', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function seeded(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('the medical view', () => {
  it('over 600 seeded matches, high-risk starters are injured at least 1.5 times as often as low-risk ones', () => {
    const starts: Record<RiskBand, number> = { low: 0, medium: 0, high: 0 }
    const injuries: Record<RiskBand, number> = { low: 0, medium: 0, high: 0 }
    let matches = 0
    for (let i = 0; matches < 600; i++) {
      const g = seeded(`medical-${i}`)
      const get = playerLookup(g, u)
      // The test's own stream spreads the squad's condition over the engine's bands, so every risk band gets starts
      const spread = new Rng(`medical-spread-${i}`)
      while (g.phase !== 'summary') {
        const bands = new Map<string, RiskBand>()
        for (const [id, s] of Object.entries(g.squad)) {
          s.condition = spread.int(50, 100)
          const p = get(id)
          if (p && !s.injury) bands.set(id, injuryRiskOf(g, p, s).band)
        }
        const mw = g.season!.matchweek + 1
        playMatchweek(g, u, true)
        const res = g.lastMatch
        if (!res || g.lastMatchContext?.matchweek !== mw) continue
        matches++
        const mine = res.homeTeamId === USER_TEAM ? res.homeStats : res.awayStats
        const hurt = new Set(res.events.filter((e) => e.type === 'injury' && e.playerId).map((e) => e.playerId!))
        for (const st of mine) {
          const band = bands.get(st.playerSeasonId)
          if (!band || (st.minutes < 60 && !hurt.has(st.playerSeasonId))) continue
          starts[band]++
          if (hurt.has(st.playerSeasonId)) injuries[band]++
        }
      }
    }
    const rate = (b: RiskBand) => injuries[b] / Math.max(1, starts[b])
    expect(starts.high).toBeGreaterThan(200)
    expect(starts.low).toBeGreaterThan(200)
    expect(rate('high')).toBeGreaterThanOrEqual(1.5 * rate('low'))
    expect(rate('medium')).toBeGreaterThan(rate('low'))
  }, 300_000)

  it('mirrors the engine terms and names the reasons', () => {
    const g = seeded('medical-reasons')
    const get = playerLookup(g, u)
    const id = Object.keys(g.squad).find((x) => get(x)!.positions[0] !== 'GK')!
    const p = { ...get(id)!, traits: { ...get(id)!.traits, injuryProneness: 0.7 }, attributes: { ...get(id)!.attributes, stamina: 40 } }
    const s = { ...g.squad[id], condition: 60, recentMinutes: [90, 90, 90] }
    const r = injuryRiskOf(g, p, s)
    // (0.5 + 0.7) × 1.45 × (1 + 0.3 × 0.75 × 0.5)
    expect(r.index).toBeCloseTo(1.2 * 1.45 * 1.1125, 2)
    expect(r.band).toBe('high')
    expect(r.reasons).toEqual(['Very injury-prone', 'Condition 60', 'Low stamina (40) on tired legs', '270 minutes in three weeks'])
    expect(r.matchPct).toBeCloseTo(2.1 * r.index, 0)
    expect(conditionFactor(54)).toBe(2)
    expect(conditionFactor(80)).toBe(1)
    const fresh = injuryRiskOf(g, { ...p, traits: { ...p.traits, injuryProneness: 0.1 }, attributes: { ...p.attributes, stamina: 80 } }, { ...s, condition: 95, recentMinutes: [] })
    expect(fresh.band).toBe('low')
    expect(fresh.reasons).toEqual([])
    // Fitness training raises the training risk and says so; a physio cuts it
    g.training = 'fitness'
    const fit = injuryRiskOf(g, p, s)
    expect(fit.reasons).toContain('Fitness training')
    g.staff = { ...(g.staff ?? {}), physio: 2 } as Game['staff']
    expect(injuryRiskOf(g, p, s).trainingPct).toBeLessThan(fit.trainingPct)
  })

  it('lists the injured apart, longest out first, and leaves the game untouched', () => {
    const g = seeded('medical-out')
    const [a, b] = Object.keys(g.squad)
    g.squad[a].injury = { description: 'Hamstring', weeksOut: 2 }
    g.squad[b].injury = { description: 'Knee', weeksOut: 6 }
    const before = JSON.stringify(g)
    const m = medicalReport(g, u)
    expect(m.out.map((x) => x.id)).toEqual([b, a])
    expect(m.risks.some((r) => r.id === a || r.id === b)).toBe(false)
    expect(m.risks.length + m.out.length).toBe(Object.keys(g.squad).length)
    expect(m.risks.map((r) => r.index)).toEqual([...m.risks.map((r) => r.index)].sort((x, y) => y - x))
    expect(JSON.stringify(g)).toBe(before)
  })
})
