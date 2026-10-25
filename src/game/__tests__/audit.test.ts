import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { closeLiveMatch, eventContext, finishLiveMatch, playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { acceptOffer, bidFor, enquireFor, releasePlayer } from '../logic/marketOps'
import { advanceToNextSeason } from '../logic/dynasty'
import { normaliseGame } from '../logic/save'
import { rollEvent } from '@engine/events'
import { newSquadPlayer, USER_TEAM } from '@engine/season'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'audit-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function started(u: ReturnType<typeof loadTestUniverse>, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

function toWindow(g: Game, u: ReturnType<typeof loadTestUniverse>): Game {
  while (g.season!.matchweek < 19) playMatchweek(g, u, true)
  expect(g.window?.kind).toBe('january')
  return g
}

describe('audit fixes: season and squad', () => {
  const u = loadTestUniverse()

  it('a suspension is served one match at a time while the player sits out', () => {
    const g = started(u)
    const benchId = g.bench[0]
    g.squad[benchId].suspension = 2
    playMatchweek(g, u, true)
    expect(g.squad[benchId].suspension).toBe(1)
    playMatchweek(g, u, true)
    expect(g.squad[benchId].suspension).toBe(0)
    // Served, so he is picked again when he is the best option; never below zero
    playMatchweek(g, u, true)
    expect(g.squad[benchId].suspension).toBe(0)
  })

  it('bonus spins are spent by the draft that used them', () => {
    const g = createGame(settings({ mode: 'dynasty' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    g.bonusSpins = 3
    beginSeason(g, u)
    expect(g.bonusSpins).toBe(0)
  })

  it('the summer only runs once, from a finished season', () => {
    const g = started(u, { mode: 'dynasty' })
    const year = g.year
    const report = advanceToNextSeason(g, u)
    expect(report.retired).toEqual([])
    expect(g.year).toBe(year)
    expect(g.phase).toBe('week')
  })

  it('the final match played live waits on the match screen before the season closes', () => {
    const g = started(u)
    while (g.season!.matchweek < g.season!.matchweeks - 1) playMatchweek(g, u, true)
    playMatchweek(g, u, false)
    expect(g.live?.kind).toBe('league')
    finishLiveMatch(g, u, { talk: 'calm' })
    expect(g.live).toBeNull()
    expect(g.phase).toBe('match')
    expect(g.seasonEnding).toBe(true)
    expect(g.history.length).toBe(0)
    closeLiveMatch(g, u)
    expect(g.seasonEnding).toBe(false)
    expect(g.phase).toBe('summary')
    expect(g.history.length).toBe(1)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(38)
  })

  it('agents only call in a dynasty, where the spin can be redeemed', () => {
    const season = started(u)
    const dynasty = started(u, { mode: 'dynasty' })
    for (const g of [season, dynasty]) for (let i = 0; i < 3; i++) playMatchweek(g, u, true)
    const ids = (g: Game) => {
      const out = new Set<string>()
      for (let i = 0; i < 300; i++) {
        const ev = rollEvent(eventContext(g, u, new Rng(`ev-${i}`)))
        if (ev) out.add(ev.id)
      }
      return out
    }
    expect(ids(season).has('agent')).toBe(false)
    expect(ids(dynasty).has('agent')).toBe(true)
  })

  it('saves from older builds get every later field filled in', () => {
    const g = started(u)
    const old: Record<string, unknown> = { ...g }
    delete old.weekPlayed
    delete old.live
    delete old.jobOffers
    delete old.pendingMove
    delete old.customPlayers
    const oldSettings: Record<string, unknown> = { ...g.settings }
    delete oldSettings.wheelLeagues
    old.settings = oldSettings
    const n = normaliseGame(old as unknown as Game)!
    expect(n.weekPlayed).toEqual([])
    expect(n.live).toBeNull()
    expect(n.jobOffers).toEqual([])
    expect(n.pendingMove).toBeNull()
    expect(n.customPlayers).toEqual({})
    expect(n.settings.wheelLeagues).toEqual(['england'])
    expect(n.squad).toBe(g.squad)
    // No Quick Draft manager on a save from before managers: optional, left absent, and no rule switches them on
    expect(n.manager).toBeUndefined()
    expect(n.settings.rules.managers).toBeUndefined()
    expect(normaliseGame(null)).toBeNull()
    expect(normaliseGame({} as Game)).toBeNull()
  })
})

describe('audit fixes: transfer market', () => {
  const u = loadTestUniverse()

  it('an offer for a player we no longer have is withdrawn, not paid', () => {
    const g = toWindow(started(u, { seed: 'audit-offer' }), u)
    const id = g.bench[0]
    const rival = Object.keys(g.season!.ai)[0]
    g.window!.offers.push({ playerSeasonId: id, fromClubId: rival, amount: 12, day: g.window!.day, status: 'open' })
    g.window!.offers.push({ playerSeasonId: id, fromClubId: Object.keys(g.season!.ai)[1], amount: 9, day: g.window!.day, status: 'open' })
    const budget = g.finances.budget
    releasePlayer(g, u, id)
    expect(g.window!.offers.filter((o) => o.playerSeasonId === id).every((o) => o.status === 'withdrawn')).toBe(true)
    // Even a stale open offer cannot be cashed
    g.window!.offers[g.window!.offers.length - 1].status = 'open'
    acceptOffer(g, u, g.window!.offers.length - 1)
    expect(g.finances.budget).toBe(budget)
    expect(g.window!.offers[g.window!.offers.length - 1].status).toBe('withdrawn')
  })

  it('signing a rival\'s player takes him out of their squad for the rest of the season', () => {
    const g = toWindow(started(u, { seed: 'audit-poach' }), u)
    g.finances.budget = 9999
    g.finances.wageCap = 999999
    const get = playerLookup(g, u)
    // A fringe player of a league rival, old enough that no club calls him untouchable
    let target: { psId: string; clubId: string } | null = null
    for (const [clubId, club] of Object.entries(g.season!.ai)) {
      const fringe = club.squad.map((id) => u.index[id]).filter((p) => p && p.age >= 24 && p.age < 33 && p.overall < 78)
      const notListed = fringe.find((p) => !g.window!.listings.some((l) => u.index[l.playerSeasonId]?.playerId === p.playerId))
      if (notListed) {
        target = { psId: notListed.id, clubId }
        break
      }
    }
    expect(target).toBeTruthy()
    const out = enquireFor(g, u, target!.psId)
    expect(out.ok).toBe(true)
    const listing = g.window!.listings.find((l) => l.playerSeasonId === target!.psId)!
    const bid = bidFor(g, u, listing.playerSeasonId, Math.ceil(listing.asking))
    expect(bid.accepted).toBe(true)
    expect(g.squad[target!.psId]).toBeTruthy()
    expect(g.season!.ai[target!.clubId].squad).not.toContain(target!.psId)
    expect(g.season!.ai[target!.clubId].state[target!.psId]).toBeUndefined()
    expect(get(target!.psId)).toBeTruthy()
  })

  it('a human already in the squad cannot be bought twice from another season\'s listing', () => {
    const g = toWindow(started(u, { seed: 'audit-dup' }), u)
    g.finances.budget = 9999
    g.finances.wageCap = 999999
    const listing = g.window!.listings.find((l) => l.status === 'available')!
    const human = u.index[listing.playerSeasonId].playerId
    // The same person, another season of his career, is already ours
    const other = Object.values(u.index).find((p) => p.playerId === human && p.id !== listing.playerSeasonId) ?? u.index[listing.playerSeasonId]
    g.squad[other.id] = newSquadPlayer(other.id)
    g.contracts[other.id] = { years: 2 }
    const out = bidFor(g, u, listing.playerSeasonId, Math.ceil(listing.asking))
    expect(out.accepted).toBe(false)
    expect(out.message).toContain('already in your squad')
    expect(g.squad[listing.playerSeasonId]).toBeUndefined()
  })

  it('a summer signing made while the wheel still spins keeps his place in the squad', () => {
    const g = started(u, { mode: 'dynasty', seed: 'audit-summer', leagueSeason: 2015, hostClubId: 'leicester-city' })
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    advanceToNextSeason(g, u)
    expect(g.phase).toBe('draft')
    expect(g.window?.kind).toBe('summer')
    g.finances.budget = 9999
    g.finances.wageCap = 999999
    const listing = g.window!.listings.find((l) => l.status === 'available')!
    const out = bidFor(g, u, listing.playerSeasonId, Math.ceil(listing.asking))
    expect(out.accepted).toBe(true)
    expect(g.draft!.takenPlayers).toContain(u.index[listing.playerSeasonId].playerId)
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    // Still ours, under contract, and on the team sheet (the bench holds nine; a 21st man is a reserve)
    expect(g.squad[listing.playerSeasonId]).toBeTruthy()
    expect(g.contracts[listing.playerSeasonId]).toBeTruthy()
    const placed = new Set([...Object.values(g.lineup), ...g.bench])
    expect(placed.has(listing.playerSeasonId) || Object.keys(g.squad).length > 20).toBe(true)
    expect(g.season!.ai[USER_TEAM]).toBeUndefined()
  })
})
