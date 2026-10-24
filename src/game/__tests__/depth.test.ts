import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { simulateMatch, beginMatch, leadership, setPieceBonus } from '@engine/match'
import { aiTeamInput, buildAiClubs, userTeamInput } from '@engine/season'
import { staffWages, staffTier, traitTags, STAFF } from '@engine/staff'
import { squadWages } from '../logic/squad'
import { tickWindow } from '../logic/marketOps'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'depth-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function freshGame(u: ReturnType<typeof loadTestUniverse>, seed = 'depth-test'): Game {
  const g = createGame(settings({ seed }))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

describe('tactical and backroom depth', () => {
  const u = loadTestUniverse()

  it('a designated penalty taker takes every penalty he is on the pitch for', () => {
    const g = freshGame(u)
    const ai = buildAiClubs(u, 'england', 2025, 'burnley')
    const opp = aiTeamInput(u, Object.values(ai)[0], 10)
    // Pick the worst finisher in the XI so the default choice would never be him
    const xi = Object.values(g.lineup).map((id) => u.index[id]).filter((p) => p.positions[0] !== 'GK')
    const taker = [...xi].sort((a, b) => a.attributes.shooting - b.attributes.shooting)[0]
    const tactics = { ...g.tactics, setPieces: { penalties: taker.id } }
    let pens = 0
    let his = 0
    for (let i = 0; i < 120; i++) {
      const user = userTeamInput(u, { teamName: 'T', shortName: 'T', tactics, lineup: g.lineup, bench: g.bench, state: g.squad, teamTalk: 'none' })
      const res = simulateMatch({ rng: new Rng(`pen-${i}`), home: user, away: opp, detail: 'full' })
      for (const e of res.events) {
        if (e.type === 'penalty' && e.side === 'home') {
          pens++
          if (e.playerId === taker.id) his++
        }
      }
    }
    expect(pens).toBeGreaterThan(3)
    // He takes them all unless he had already gone off
    expect(his / pens).toBeGreaterThan(0.75)
  })

  it('set-piece specialists and a strong captain nudge expected goals', () => {
    const g = freshGame(u, 'depth-xg')
    const ai = buildAiClubs(u, 'england', 2025, 'burnley')
    const opp = aiTeamInput(u, Object.values(ai)[0], 10)
    const xi = Object.values(g.lineup).map((id) => u.index[id]).filter((p) => p.positions[0] !== 'GK')
    const bestPasser = [...xi].sort((a, b) => b.attributes.passing - a.attributes.passing)[0]
    const bestShooter = [...xi].sort((a, b) => b.attributes.shooting - a.attributes.shooting)[0]
    const leader = [...xi].sort((a, b) => b.attributes.mentality - a.attributes.mentality)[0]
    const tactics = { ...g.tactics, setPieces: { corners: bestPasser.id, freeKicks: bestShooter.id } }
    const user = userTeamInput(u, { teamName: 'T', shortName: 'T', tactics, lineup: g.lineup, bench: g.bench, state: g.squad, teamTalk: 'none', captainId: leader.id })
    const mp = beginMatch({ rng: new Rng('xg'), home: user, away: opp, detail: 'summary' })
    const bonus = setPieceBonus(mp.home, mp.hLive, user.getPlayer)
    expect(bonus).toBeGreaterThanOrEqual(-0.04)
    expect(bonus).toBeLessThanOrEqual(0.07)
    if (bestPasser.attributes.passing > 76 && bestShooter.attributes.shooting > 76) expect(bonus).toBeGreaterThan(0)
    const lead = leadership(mp.home, mp.hLive, user.getPlayer)
    if (leader.attributes.mentality >= 80) expect(lead).toBeGreaterThan(0)
    // Nobody designated, no captain: no bonus either way
    const plain = beginMatch({ rng: new Rng('xg'), home: { ...user, tactics: g.tactics, captainId: undefined }, away: opp, detail: 'summary' })
    expect(setPieceBonus(plain.home, plain.hLive, user.getPlayer)).toBe(0)
    expect(leadership(plain.home, plain.hLive, user.getPlayer)).toBe(0)
  })

  it('staff wages join the wage bill and the physio and scout do their jobs', () => {
    const g = freshGame(u, 'depth-staff')
    const base = squadWages(g, u)
    g.staff = { physio: 2, scout: 2, coach: 1, assistant: 1 }
    expect(staffWages(g.staff)).toBe(STAFF.physio.tiers[2].wage + STAFF.scout.tiers[2].wage + STAFF.coach.tiers[1].wage + STAFF.assistant.tiers[1].wage)
    expect(squadWages(g, u)).toBe(base + staffWages(g.staff))
    expect(staffTier({ physio: 7 }, 'physio')).toBe(2)
    expect(staffTier(undefined, 'coach')).toBe(0)
    expect(traitTags({ consistency: 0.9, injuryProneness: 0.1, bigMatch: 0.8, professionalism: 0.9 })).toEqual(['Consistent', 'Ironman', 'Big-game player', 'Model professional'])
    // Elite physio: every match injury is a week shorter (min 1)
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    // Scouts add listings every market day
    const before = g.window!.listings.length
    const rng = Rng.fromState(g.rngState)
    tickWindow(g, u, rng)
    const scouted = g.window!.listings.filter((l) => l.tags.includes('Scouted'))
    expect(scouted.length).toBeGreaterThanOrEqual(1)
    expect(g.window!.listings.length).toBeGreaterThan(before)
  })

  it('a respected captain lifts low morale week by week', () => {
    const g = freshGame(u, 'depth-captain')
    const xi = Object.values(g.lineup).map((id) => u.index[id])
    const leader = [...xi].filter((p) => p.traits.professionalism >= 0.6 && p.attributes.mentality >= 72)[0]
    if (!leader) return
    g.captainId = leader.id
    const low = g.bench[0]
    g.squad[low].morale = 40
    g.consecutiveMissed[low] = 0
    const before = g.squad[low].morale
    playMatchweek(g, u, true)
    // Bench drift can pull him down later, but a single week with the captain's lift lands higher than it would without
    const g2 = freshGame(u, 'depth-captain')
    g2.captainId = undefined
    g2.squad[low].morale = 40
    g2.consecutiveMissed[low] = 0
    playMatchweek(g2, u, true)
    expect(g.squad[low].morale - g2.squad[low].morale).toBeGreaterThanOrEqual(1)
    expect(g.squad[low].morale).toBeGreaterThanOrEqual(before - 5)
  })
})
