import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { suggestedCaptain } from '../logic/briefing'
import { atmosphereOf, hierarchy, squadGroups, TIER_ORDER, TIER_SIZES } from '../logic/dynamics'
import { personalityOf, PERSONALITIES } from '../logic/personality'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Room XI', shortName: 'RMX', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2021, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function seeded(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  g.captainId = suggestedCaptain(g, u)
  return g
}

const SEEDS = Array.from({ length: 20 }, (_, i) => `room-${i}`)

describe('the dressing room view', () => {
  it('ranks every player exactly once, captain in the top two tiers, tiers of 3, 4, 6 and the rest', () => {
    for (const seed of SEEDS) {
      const g = seeded(seed)
      const rows = hierarchy(g, u)
      const ids = rows.map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(Object.keys(g.squad).sort())
      const cap = rows.find((r) => r.id === g.captainId)!
      expect(['leader', 'high']).toContain(cap.tier)
      const sizes = TIER_ORDER.map((t) => rows.filter((r) => r.tier === t).length)
      expect(sizes.slice(0, 3)).toEqual(TIER_SIZES)
      expect(sizes[3]).toBe(rows.length - 13)
      // Tiers run top to bottom down the list
      expect(rows.map((r) => TIER_ORDER.indexOf(r.tier))).toEqual([...rows.map((r) => TIER_ORDER.indexOf(r.tier))].sort((a, b) => a - b))
      expect(rows.every((r) => r.reasons.length <= 2)).toBe(true)
    }
  })

  it('forms the same groups for the same squad, every player in exactly one', () => {
    let clubSeasonGroups = 0
    for (const seed of SEEDS) {
      const g = seeded(seed)
      const groups = squadGroups(g, u)
      expect(squadGroups(seeded(seed), u)).toEqual(groups)
      const members = groups.flatMap((x) => x.members)
      expect(new Set(members).size).toBe(members.length)
      expect([...members].sort()).toEqual(Object.keys(g.squad).sort())
      for (const grp of groups) {
        expect(grp.members[0]).toBe(grp.leaderId)
        if (grp.kind !== 'age') expect(grp.members.length).toBeGreaterThanOrEqual(2)
        if (grp.kind === 'club-season') {
          const keys = new Set(grp.members.map((id) => `${u.index[id].clubId}@${u.index[id].season}`))
          expect(keys.size).toBe(1)
          expect(grp.label).toMatch(/^The \d{4}-\d{2} .+ lot$/)
          clubSeasonGroups++
        }
      }
    }
    // A season draft lands on several players from one club-season often enough for the groups to show
    expect(clubSeasonGroups).toBeGreaterThan(0)
  })

  it('reads the atmosphere from morale weighted by influence, plus chemistry', () => {
    const g = seeded('room-atmos')
    const base = atmosphereOf(g, u)
    expect(base.value).toBeGreaterThanOrEqual(0)
    expect(base.value).toBeLessThanOrEqual(100)
    const rows = hierarchy(g, u)
    // Upsetting the leaders costs more than upsetting the same number at the bottom
    const low = structuredClone(g)
    for (const r of rows.filter((x) => x.tier === 'leader')) low.squad[r.id].morale = 20
    const lowBottom = structuredClone(g)
    for (const r of rows.slice(-3)) lowBottom.squad[r.id].morale = 20
    expect(atmosphereOf(low, u).value).toBeLessThan(atmosphereOf(lowBottom, u).value)
    expect(atmosphereOf(low, u).lines.some((l) => l.startsWith('Unhappy'))).toBe(true)
  })

  it('changes nothing: reading the room leaves the game and its stream as they were', () => {
    const g = seeded('room-pure')
    playMatchweek(g, u, true)
    const before = JSON.stringify(g)
    hierarchy(g, u)
    squadGroups(g, u)
    atmosphereOf(g, u)
    expect(JSON.stringify(g)).toBe(before)
  })
})

describe('personality labels', () => {
  it('gives every England player-season one fixed label, and every label is used', () => {
    const seen = new Map<string, number>()
    for (const p of Object.values(u.index)) {
      const a = personalityOf(p)
      expect(personalityOf(p)).toEqual(a)
      expect(PERSONALITIES[a.id].label).toBe(a.label)
      seen.set(a.id, (seen.get(a.id) ?? 0) + 1)
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(PERSONALITIES).sort())
    // No label swallows the squad: balanced is the most common and still under half
    expect(Math.max(...seen.values()) / Object.keys(u.index).length).toBeLessThan(0.5)
  })

  it('follows the rules on the traits', () => {
    const p = (professionalism: number, consistency: number, bigMatch = 0.5, mentality = 70) => ({ traits: { professionalism, consistency, bigMatch, injuryProneness: 0.3 }, attributes: { mentality } as never })
    expect(personalityOf(p(0.8, 0.7)).label).toBe('Model professional')
    expect(personalityOf(p(0.3, 0.3)).label).toBe('Temperamental')
    expect(personalityOf(p(0.6, 0.45, 0.8)).label).toBe('Mercurial')
    expect(personalityOf(p(0.6, 0.55, 0.7)).label).toBe('Big-game player')
    expect(personalityOf(p(0.6, 0.55, 0.5, 85)).label).toBe('Driven')
    expect(personalityOf(p(0.6, 0.55)).label).toBe('Balanced')
  })
})
