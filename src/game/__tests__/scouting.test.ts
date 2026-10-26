import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { advanceWindow, openWindow, type MarketContext } from '@engine/market'
import { newSquadPlayer } from '@engine/season'
import { playMatchweek } from '../logic/week'
import { ASSIGNMENT_GAIN, baseKnowledge, fileReports, focusFilter, fullScout, KNOWLEDGE_FADE, knowledgeOf, maskedView, MASKED_KEYS, maskRange, matchesFocus, OWN_LEAGUE_KNOWLEDGE, rangeWidth, REPORTS_CAP, setAssignment, setRecruitFocus, weeklyScouting } from '../logic/scouting'
import { advanceDay, enquireFor } from '../logic/marketOps'
import type { RecruitFocus, ScoutReport } from '../types'
import { clone, seasonGame } from './seasonGame'

const u = loadTestUniverse(['england'])
const england = Object.values(u.index).filter((p) => u.clubById[p.clubId]?.leagueId === 'england')

describe('scouting knowledge and masked ranges', () => {
  it('always contains the true value, at every knowledge level, for every England player-season', () => {
    expect(england.length).toBeGreaterThan(11_000)
    let checked = 0
    const bad: string[] = []
    for (const k of [0, 50, 90]) {
      const w = rangeWidth(k)
      expect(w).toBe(Math.max(2, Math.round((100 - k) / 5)))
      for (const p of england) {
        for (const key of [...MASKED_KEYS, 'overall'] as const) {
          const v = key === 'overall' ? p.overall : p.attributes[key]
          const r = maskRange(p.playerId, key, v, k)
          const again = maskRange(p.playerId, key, v, k)
          checked++
          // Inside, no wider than the knowledge allows, and pure: the same player gives the same range every call
          if (r.lo > v || r.hi < v || r.hi - r.lo > w || again.lo !== r.lo || again.hi !== r.hi) bad.push(`${p.id} ${key} ${k}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(11_000 * 14 * 3)
    expect(bad).toEqual([])
  }, 60_000)

  it('places the true value at different points of the range for different players (the offset is a hash, not a constant)', () => {
    const offsets = new Set(england.slice(0, 400).map((p) => p.attributes.pace - maskRange(p.playerId, 'pace', p.attributes.pace, 0).lo))
    expect(offsets.size).toBeGreaterThan(10)
    // Exact at full knowledge
    expect(maskRange('x', 'pace', 71, 100)).toEqual({ lo: 71, hi: 71 })
  })

  it('collapses a player to his exact values once fully scouted, and reports his traits as pros and cons', () => {
    const g = seasonGame(u, 'scout-exact')
    const p = Object.values(u.index).find((x) => x.season === 2012 && u.clubById[x.clubId]?.leagueId === 'england' && !g.squad[x.id])!
    const before = maskedView(g, u, p)
    expect(before.exact).toBe(false)
    expect(before.knowledge).toBe(OWN_LEAGUE_KNOWLEDGE)
    expect(before.pros.length + before.cons.length).toBe(0)
    const out = fullScout(g, u, p.id)
    expect(out.ok).toBe(true)
    const after = maskedView(g, u, p)
    expect(after.exact).toBe(true)
    for (const k of MASKED_KEYS) expect(after.attrs[k]).toEqual({ lo: p.attributes[k], hi: p.attributes[k] })
    expect(after.overall).toEqual({ lo: p.overall, hi: p.overall })
    // One full scout a matchweek outside a window
    const other = Object.values(u.index).find((x) => x.season === 2013 && u.clubById[x.clubId]?.leagueId === 'england' && !g.squad[x.id])!
    expect(fullScout(g, u, other.id).ok).toBe(false)
  })

  it('never masks the own squad or the league season being played', () => {
    const g = seasonGame(u, 'scout-own')
    for (const id of Object.keys(g.squad)) expect(maskedView(g, u, u.index[id]).exact).toBe(true)
    const rival = Object.values(g.season!.ai)[0]
    for (const id of rival.squad.slice(0, 5)) expect(maskedView(g, u, u.index[id]).exact).toBe(true)
  })

  it('raises an assigned league 5 a week to 100 and fades it 2 a week back to its starting level', () => {
    const g = seasonGame(u, 'scout-knowledge')
    expect(knowledgeOf(g, 'england')).toBe(OWN_LEAGUE_KNOWLEDGE)
    expect(setAssignment(g, 'england', true).ok).toBe(true)
    for (let i = 1; i <= 4; i++) {
      weeklyScouting(g, u)
      expect(knowledgeOf(g, 'england')).toBe(OWN_LEAGUE_KNOWLEDGE + i * ASSIGNMENT_GAIN)
    }
    for (let i = 0; i < 10; i++) weeklyScouting(g, u)
    expect(knowledgeOf(g, 'england')).toBe(100)
    setAssignment(g, 'england', false)
    weeklyScouting(g, u)
    expect(knowledgeOf(g, 'england')).toBe(100 - KNOWLEDGE_FADE)
    for (let i = 0; i < 40; i++) weeklyScouting(g, u)
    expect(knowledgeOf(g, 'england')).toBe(baseKnowledge(g, 'england'))
    // A second assignment needs a better chief scout
    expect(setAssignment(g, 'spain', true).ok).toBe(false)
  })

  it('files reports from a fork of a copy: assignments and a focus move no draw before the window opens', () => {
    const plain = seasonGame(u, 'scout-fork')
    const scouted = clone(plain)
    setAssignment(scouted, 'england', true)
    expect(setRecruitFocus(scouted, u, { position: 'ST', age: 'u24' }).ok).toBe(true)
    expect(scouted.scoutReports?.length).toBe(2)
    for (let i = 0; i < 12; i++) {
      playMatchweek(plain, u, true)
      playMatchweek(scouted, u, true)
      expect(scouted.rngState).toEqual(plain.rngState)
    }
    expect(scouted.season!.fixtures.map((f) => f.result?.homeGoals)).toEqual(plain.season!.fixtures.map((f) => f.result?.homeGoals))
    expect(scouted.scoutReports!.length).toBe(REPORTS_CAP)
    for (const r of scouted.scoutReports!) {
      const p = u.index[r.playerSeasonId]
      expect(matchesFocus(scouted.recruitFocus!, p)).toBe(true)
      expect(['A', 'B', 'C', 'D']).toContain(r.grade)
      expect(scouted.squad[p.id]).toBeUndefined()
    }
    // No player is reported twice
    expect(new Set(scouted.scoutReports!.map((r) => u.index[r.playerSeasonId].playerId)).size).toBe(scouted.scoutReports!.length)
  }, 60_000)

  it('grades better reports for better players: A-graded reports are better players than D-graded ones', () => {
    const g = seasonGame(u, 'scout-grade')
    setRecruitFocus(g, u, { position: 'CB' })
    const all: ScoutReport[] = []
    for (let i = 0; i < 40; i++) {
      g.scoutReports = []
      all.push(...fileReports(g, u, `grade-${i}`, 4))
    }
    const mean = (grade: string) => {
      const v = all.filter((r) => r.grade === grade).map((r) => u.index[r.playerSeasonId].overall)
      return v.reduce((a, b) => a + b, 0) / v.length
    }
    expect(all.filter((r) => r.grade === 'A').length).toBeGreaterThan(5)
    expect(all.filter((r) => r.grade === 'D').length).toBeGreaterThan(5)
    expect(mean('A')).toBeGreaterThan(mean('B'))
    expect(mean('B')).toBeGreaterThan(mean('D'))
  })
})

describe('the recruitment focus', () => {
  const focuses: RecruitFocus[] = [{ position: 'ST' }, { position: 'CB', age: 'u24' }, { age: 'veteran' }, { position: 'LW', maxFee: 15 }, { deal: 'loan' }, { position: 'GK', age: 'prime' }]

  it('lists at least 80% matching players over 200 seeded windows with a focus set', () => {
    let listed = 0
    let matching = 0
    for (let i = 0; i < 200; i++) {
      const focus = focuses[i % focuses.length]
      const rng = new Rng(`focus-window-${i}`)
      const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2020 && !cs.classic)
      const own = clubs[i % clubs.length]
      const ownSquad = own.squad.slice(0, 18).map((p) => ({ p, s: newSquadPlayer(p.id) }))
      const ctx: MarketContext = { u, rng, ownedPlayerIds: new Set(ownSquad.map((x) => x.p.playerId)), leagueSeason: 2020, priceLevel: 1.05, leagues: ['england'], focus: (p) => matchesFocus(focus, p) }
      const w = openWindow(ctx, 'january')
      for (let d = 0; d < 3; d++) advanceWindow(ctx, w, ownSquad, clubs.map((c) => c.clubId))
      listed += w.listings.length
      matching += w.listings.filter((l) => matchesFocus(focus, u.index[l.playerSeasonId])).length
    }
    expect(listed).toBeGreaterThan(2000)
    expect(matching / listed).toBeGreaterThanOrEqual(0.8)
  }, 60_000)

  it('narrows the game January window and its trickle, and approaches still reach anyone', () => {
    const g = seasonGame(u, 'focus-game', 18)
    setRecruitFocus(g, u, { position: 'ST' })
    playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    advanceDay(g, u)
    const listings = g.window!.listings
    expect(listings.length).toBeGreaterThan(10)
    expect(listings.filter((l) => matchesFocus(g.recruitFocus!, u.index[l.playerSeasonId])).length / listings.length).toBeGreaterThanOrEqual(0.8)
    const keeper = Object.values(u.index).find((p) => p.positions[0] === 'GK' && p.season === 2018 && u.clubById[p.clubId]?.leagueId === 'england')!
    expect(enquireFor(g, u, keeper.id).message).toBeTruthy()
    // Clearing the focus clears the filter
    setRecruitFocus(g, u, null)
    expect(g.recruitFocus).toBeUndefined()
    expect(focusFilter(g)).toBeUndefined()
  }, 60_000)
})
