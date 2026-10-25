import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { closeLiveMatch, eventContext, finishLiveMatch, playFriendly, playMatchweek, startSeasonProper } from '../logic/week'
import { buildYouthIntake } from '../logic/youth'
import { autoDraft, peekActive, QUICK_RULES, SEASON_RULES, spinOdds } from '@engine/draft'
import { canUpgrade } from '@engine/upgrader'
import { powerUpUsed, powerUpsOn } from '@engine/powerups'
import { Rng } from '@engine/rng'
import { acceptOffer, bidFor, enquireFor, releasePlayer } from '../logic/marketOps'
import { advanceToNextSeason } from '../logic/dynasty'
import { normaliseGame, normaliseProfile } from '../logic/save'
import { matchPlayOf } from '../logic/assistant'
import { capOfGame } from '../logic/cap'
import { chainOfGame } from '../logic/chain'
import { rollEvent } from '@engine/events'
import { computeTable, newSquadPlayer, seasonTable, USER_TEAM } from '@engine/season'
import { briefStanding, runInVerdict, takeoverTable } from '../logic/runin'
import { playerLookup } from '../logic/players'
import { runQuickSeason } from '../logic/quick'
import { storyForGame } from '../logic/story'
import { modeLabel } from '../logic/modes'
import { arenaVerdictOf, challengeHeadline } from '../logic/arenaClaim'
import type { Game, GameSettings, Profile } from '../types'
import { maskedView, setAssignment, setRecruitFocus } from '../logic/scouting'
import { contractDemand } from '../logic/contracts'
import { requestOptions } from '../logic/board'
import { readSaveFile } from '../store'
import { decodeSave } from '../saveStorage'

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
    delete old.arena
    delete old.capSpent
    delete old.teammateChain
    const oldSettings: Record<string, unknown> = { ...g.settings }
    delete oldSettings.wheelLeagues
    delete oldSettings.weekly
    delete oldSettings.runIn
    delete oldSettings.matchPlay
    old.settings = oldSettings
    const oldSeason: Record<string, unknown> = { ...g.season! }
    delete oldSeason.carryIn
    delete oldSeason.takeoverAt
    old.season = oldSeason
    const n = normaliseGame(old as unknown as Game)!
    expect(n.weekPlayed).toEqual([])
    expect(n.live).toBeNull()
    expect(n.jobOffers).toEqual([])
    expect(n.pendingMove).toBeNull()
    expect(n.customPlayers).toEqual({})
    expect(n.arena).toBeNull()
    // No salary cap before the Moneyball wheel: nothing to say about money
    expect(n.settings.rules.budget).toBeUndefined()
    expect(capOfGame(n)).toBeNull()
    // Nor a teammate chain before the chain
    expect(n.settings.rules.chain).toBeUndefined()
    expect(chainOfGame(n)).toBeNull()
    expect(n.settings.wheelLeagues).toEqual(['england'])
    // No weekly theme before the Weekly Challenge: the mode's label stands alone
    expect(n.settings.weekly).toBeUndefined()
    expect(modeLabel(n, 'short')).toBe('Season')
    // A season from before the Run-in carries no table in: it reads from its fixtures alone, with no brief
    expect(n.settings.runIn).toBeUndefined()
    expect(n.season!.carryIn).toBeUndefined()
    expect(seasonTable(n.season!)).toEqual(computeTable(n.season!.fixtures, [USER_TEAM, ...Object.keys(n.season!.ai)]))
    expect(takeoverTable(n.season!)).toBeNull()
    expect(briefStanding(n)).toBeNull()
    expect(runInVerdict(n, u)).toBeNull()
    // A ghost from before arena links carries no arena claim: it still reads as a quick challenge
    const ghost = normaliseGame({ ...old, settings: { ...oldSettings, challenge: { name: 'Minh', picks: [], claim: { pts: 70, w: 21, d: 7, l: 10, t: 'TITLE_RACE' }, verified: 'yes', data: '2026-01-01', engine: '4' } } } as unknown as Game)!
    expect(ghost.settings.challenge?.arena).toBeUndefined()
    expect(challengeHeadline(ghost.settings.challenge!)).toBe('70 pts')
    expect(arenaVerdictOf(ghost)).toBeNull()
    // The match-play preference stays unset and reads as Watch (today's stops at 45 and 70)
    expect(n.settings.matchPlay).toBeUndefined()
    expect(matchPlayOf(n)).toBe('watch')
    expect(n.squad).toBe(g.squad)
    // No Quick Draft manager on a save from before managers: optional, left absent, and no rule switches them on
    expect(n.manager).toBeUndefined()
    expect(n.settings.rules.managers).toBeUndefined()
    // Nor a manager spin, an end-of-draft case or a locker draft: all optional, left absent, and no rule switches them on
    expect(n.managerSpin).toBeUndefined()
    expect(n.endCase).toBeUndefined()
    expect(n.settings.rules.managerSpin).toBeUndefined()
    expect(n.settings.rules.endCase).toBeUndefined()
    expect(n.draft?.locker).toBeUndefined()
    expect(normaliseGame(null)).toBeNull()
    expect(normaliseGame({} as Game)).toBeNull()
    // A quick result saved before the live table has no rounds; a January window before it, no first-half rounds
    expect(n.quickResult?.rounds).toBeUndefined()
    // A profile saved before the 38-0 chase reads as no perfect seasons and no run yet
    const oldProfile: Partial<Profile> = { achievements: {}, leaderboard: [], dailyStreak: 2, lastDailyDate: null, dailyResults: {}, gamesPlayed: 3, seasonsSimulated: 3, theme: 'dark', managerName: 'Old' }
    const p = normaliseProfile(oldProfile, { ...oldProfile, theme: 'auto', managerName: '' } as Profile)
    expect(p.quickBests).toEqual({ perfectSeasons: 0, longestPerfectRun: 0 })
    expect(p.theme).toBe('dark')
    expect(p.dailyStreak).toBe(2)
    // A profile from before the end-of-draft case has an empty locker
    expect(p.inventory).toEqual({})
  })

  it('a quick save from before Season Story opens and still tells its story', () => {
    const g = createGame(settings({ mode: 'quick', seed: 'audit-story', rules: { ...QUICK_RULES, leagues: ['england'] } }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const old = JSON.parse(JSON.stringify(g)) as Game
    const q = old.quickResult as unknown as Record<string, unknown>
    delete q.clinchedAt
    delete q.doomedAt
    delete q.moment
    const n = normaliseGame(old)!
    expect(n.quickResult!.moment).toBeUndefined()
    expect(n.quickResult!.clinchedAt).toBeUndefined()
    const story = storyForGame(n, u)!
    expect(story.strip).toHaveLength(38)
    expect(story.moment.length).toBeGreaterThan(0)
  })
  it('a save from before the happiness log and the Inbox player links loads and plays', () => {
    const g = started(u, { seed: 'pre-happiness-save' })
    playMatchweek(g, u, true)
    playMatchweek(g, u, true)
    const old = JSON.parse(JSON.stringify(g)) as Game
    for (const s of Object.values(old.squad)) delete s.moraleLog
    for (const item of old.season!.news) delete item.playerId
    const n = normaliseGame(old)!
    expect(n.squad).toBe(old.squad)
    expect(Object.values(n.squad).every((s) => s.moraleLog === undefined)).toBe(true)
    while (n.season!.matchweek < 6) playMatchweek(n, u, true)
    expect(Object.values(n.squad).some((s) => (s.moraleLog?.length ?? 0) > 0)).toBe(true)
  }, 60_000)

  it('a save from before recruitment (no knowledge, focus, reports, clauses, requests, slider or data hub) loads and plays', () => {
    const g = started(u, { seed: 'pre-recruitment-save' })
    playMatchweek(g, u, true)
    const old = JSON.parse(JSON.stringify(g)) as Game
    for (const k of ['knowledge', 'assignments', 'scouted', 'scoutSlot', 'recruitFocus', 'scoutReports', 'negotiations', 'bonusDue', 'youthFacilities', 'dataHub'] as const) delete old[k]
    for (const c of Object.values(old.contracts)) {
      delete c.clauses
      delete c.sellOn
      delete c.shopped
    }
    delete old.season!.requests
    delete old.finances.wageShift
    delete old.finances.bonusesPaid
    const n = normaliseGame(old)!
    expect(n.recruitFocus).toBeUndefined()
    expect(n.scouted).toBeUndefined()
    expect(n.contracts).toBe(old.contracts)
    expect(maskedView(n, u, u.index[Object.keys(n.squad)[0]]).exact).toBe(true)
    expect(contractDemand(n, u, Object.keys(n.squad)[0], 'rotation')).not.toBeNull()
    expect(requestOptions(n, u).length).toBeGreaterThan(0)
    while (n.season!.matchweek < 6) playMatchweek(n, u, true)
    expect(Object.keys(n.dataHub ?? {}).length).toBeGreaterThan(0)
    // A save written with every recruitment field round-trips an export and an import
    setRecruitFocus(n, u, { position: 'CM', age: 'u24' })
    setAssignment(n, 'england', true)
    const id = Object.keys(n.squad)[0]
    n.contracts[id].clauses = { release: 40, appearance: 5, goal: 10 }
    n.contracts[id].shopped = true
    n.scouted = [n.scoutReports![0].playerSeasonId]
    n.season!.requests = [{ kind: 'budget', mw: 6, accepted: true }]
    n.finances.wageShift = 2
    const back = normaliseGame(JSON.parse(decodeSave(readSaveFile(JSON.stringify({ state: { game: n }, version: 1 })))!).state.game as Game)!
    expect(back.recruitFocus).toEqual(n.recruitFocus)
    expect(back.assignments).toEqual(['england'])
    expect(back.contracts[id].clauses).toEqual({ release: 40, appearance: 5, goal: 10 })
    expect(back.scoutReports).toEqual(n.scoutReports)
    expect(back.season!.requests).toEqual(n.season!.requests)
    expect(back.finances.wageShift).toBe(2)
    // Lists past their cap are trimmed, and a malformed list is dropped
    const long = normaliseGame({ ...back, scouted: Array.from({ length: 200 }, (_, i) => `x${i}`), assignments: 'england' as unknown as string[] })!
    expect(long.scouted!.length).toBe(80)
    expect(long.scouted!.at(-1)).toBe('x199')
    expect(long.assignments).toEqual([])
    playMatchweek(back, u, true)
  }, 60_000)

  it('a quick draft saved before Gamble mode reads with no Icons, no upgrader and the same lookup', () => {
    const g = createGame({ mode: 'quick', seed: 'OLD-GAMBLE', formationId: '4-3-3', teamName: 'Old XI', shortName: 'OLD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const old = JSON.parse(JSON.stringify(g)) as Record<string, unknown>
    const d = old.draft as Record<string, unknown>
    delete d.gambleRng
    delete d.upgradeRng
    delete d.upgrade
    const n = normaliseGame(old as unknown as Game)!
    expect(canUpgrade(n.draft!)).toBe(false)
    expect(spinOdds(u, n.draft!).icons).toBe(0)
    const id = u.clubSeasons[0].squad[0].id
    expect(playerLookup(n, u)(id)).toBe(u.index[id])
  })

  it('a quick draft saved before power-ups reads with no tray, nothing used and the same lookup', () => {
    const g = createGame({ mode: 'quick', seed: 'OLD-POWER', formationId: '4-3-3', teamName: 'Old XI', shortName: 'OLD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const old = JSON.parse(JSON.stringify(g)) as Record<string, unknown>
    const d = old.draft as Record<string, unknown>
    delete d.powerRng
    delete d.powerUps
    const n = normaliseGame(old as unknown as Game)!
    expect(powerUpsOn(n.draft!)).toBe(false)
    expect(powerUpUsed(n.draft!, 'reroll')).toBe(false)
    expect(peekActive(n.draft!)).toBe(false)
    const id = u.clubSeasons[0].squad[0].id
    expect(playerLookup(n, u)(id)).toBe(u.index[id])
  })

  it('a save from before classic seasons (no `classic` rule) loads and plays without ever meeting one', () => {
    const g = started(u, { seed: 'pre-classic-save', leagueSeason: 2008, hostClubId: 'chelsea' })
    const rules: Record<string, unknown> = { ...g.settings.rules }
    delete rules.classic
    const n = normaliseGame({ ...g, settings: { ...g.settings, rules } } as unknown as Game)!
    expect(n.settings.rules.classic).toBeUndefined()
    const classicIds = (ids: string[]) => ids.filter((id) => u.clubSeasonByKey[`${u.index[id]?.clubId}@${u.index[id]?.season}`]?.classic)
    toWindow(n, u)
    expect(classicIds(n.window!.listings.map((l) => l.playerSeasonId))).toEqual([])
    while (n.phase !== 'summary') playMatchweek(n, u, true)
    n.settings.mode = 'dynasty'
    advanceToNextSeason(n, u)
    expect(n.settings.leagueSeason).toBe(2009)
    expect(classicIds(n.window?.listings.map((l) => l.playerSeasonId) ?? [])).toEqual([])
    expect(classicIds(Object.keys(n.squad))).toEqual([])
  }, 120_000)

  it('friendlies and the youth intake never reach a classic season without the opt-in, and do with it', () => {
    const opponents = (classic: boolean) => {
      const g = createGame(settings({ seed: `classic-friendly-${classic}`, leagueSeason: 2010, hostClubId: 'everton', mode: 'dynasty', rules: { ...SEASON_RULES, leagues: ['england'], ...(classic ? { classic: true } : {}) } }))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      const seasons: number[] = []
      const youth: string[] = []
      for (let i = 0; i < 80; i++) {
        g.rngState = new Rng(`classic-friendly-${i}`).getState()
        g.live = null
        g.friendliesPlayed = 0
        playFriendly(g, u)
        seasons.push(Number(g.live!.opponentId.split('@')[1]))
        youth.push(...buildYouthIntake(g, u, new Rng(`classic-youth-${i}`)))
      }
      return { seasons, youth: youth.map((id) => u.index[id].season) }
    }
    const off = opponents(false)
    expect(off.seasons.every((s) => s >= 2008)).toBe(true)
    expect(off.youth.length).toBeGreaterThan(0)
    expect(off.youth.every((s) => s >= 2008)).toBe(true)
    const on = opponents(true)
    expect(on.seasons.some((s) => s < 2008)).toBe(true)
    expect(on.youth.some((s) => s < 2008)).toBe(true)
  }, 180_000)
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
    // A fringe player of a league rival, old enough that no club calls him untouchable, and not
    // the same man as one we drafted from another season (the market refuses those)
    const owned = new Set(Object.keys(g.squad).map((id) => get(id)?.playerId))
    let target: { psId: string; clubId: string } | null = null
    for (const [clubId, club] of Object.entries(g.season!.ai)) {
      const fringe = club.squad.map((id) => u.index[id]).filter((p) => p && p.age >= 24 && p.age < 33 && p.overall < 78 && !owned.has(p.playerId))
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
