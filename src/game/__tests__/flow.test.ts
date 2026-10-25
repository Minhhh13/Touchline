import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { advanceLiveMatch, playMatchweek, finishLiveMatch, playFriendly, startSeasonProper } from '../logic/week'
import { autoDraft } from '@engine/draft'
import { Rng } from '@engine/rng'
import { runQuickSeason } from '../logic/quick'
import { advanceToNextSeason } from '../logic/dynasty'
import { bidFor, advanceDay } from '../logic/marketOps'
import type { GameSettings } from '../types'
import { SEASON_RULES, QUICK_RULES } from '@engine/draft'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'flow-test',
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

describe('game flow', () => {
  const u = loadTestUniverse()

  it('quick mode drafts and simulates a season', () => {
    const g = createGame(settings({ mode: 'quick', rules: { ...QUICK_RULES, leagues: ['england'] } }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    runQuickSeason(g, u)
    expect(g.phase).toBe('summary')
    expect(g.quickResult!.won + g.quickResult!.drawn + g.quickResult!.lost).toBe(38)
    expect(g.quickResult!.table.length).toBe(20)
  })

  it('season mode plays a full managed season with live halves, cup, window and summary', () => {
    const g = createGame(settings())
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    expect(g.phase).toBe('preseason')
    expect(g.season!.matchweeks).toBe(38)
    expect(Object.keys(g.lineup).length).toBe(11)
    // A live friendly, finished with a half-time change
    playFriendly(g, u)
    expect(g.live?.kind).toBe('friendly')
    finishLiveMatch(g, u, { talk: 'fire-up', tactics: { ...g.tactics, mentality: 'attacking' } })
    expect(g.live).toBeNull()
    expect(g.lastMatch?.halfTimeScore).toBeDefined()
    startSeasonProper(g)
    // Six live weeks through both stops (matchweek 6 is followed by a cup tie)
    for (let i = 0; i < 6; i++) {
      playMatchweek(g, u, false)
      expect(g.live?.kind).toBe('league')
      expect(g.live?.mp.clock).toBe(45)
      advanceLiveMatch(g, u, { talk: 'encourage' })
      expect(g.live?.kind).toBe('league')
      expect(g.live?.mp.clock).toBe(70)
      advanceLiveMatch(g, u, { shout: i % 2 ? 'all-out-attack' : 'shut-up-shop' })
      if (g.live?.kind === 'cup') finishLiveMatch(g, u, { talk: 'calm' })
      expect(g.live).toBeNull()
      const ours = g.lastMatch!.homeTeamId === 'user' ? g.lastMatch!.homeReport : g.lastMatch!.awayReport
      expect(ours.lateEffect).toContain(i % 2 ? 'All-out attack' : 'Shut up shop')
    }
    expect(g.season!.matchweek).toBe(6)
    expect(g.season!.cup.some((t) => t.result)).toBe(true)
    // Sim to the window and buy someone
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    const listing = g.window!.listings.find((l) => l.status === 'available')!
    const before = Object.keys(g.squad).length
    const out = bidFor(g, u, listing.playerSeasonId, Math.min(g.finances.budget, listing.asking))
    if (out.accepted) expect(Object.keys(g.squad).length).toBe(before + 1)
    advanceDay(g, u)
    // Sim to the end
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(g.history.length).toBe(1)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(38)
    expect(g.awards?.teamOfTheSeason.length).toBe(11)
    expect(Number.isFinite(g.finances.budget)).toBe(true)
  })

  it('a week stops at half time and at 70, keeps the changes made at both, and an old save without a clock resumes at 45', () => {
    const g = createGame(settings({ seed: 'two-stops' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    playMatchweek(g, u, false)
    expect(g.live?.kind).toBe('league')
    const mw = g.season!.matchweek
    const live = g.live!
    // A paused match from before the window carries no clock: it stands at half time
    delete live.mp.clock
    delete live.mp.pendingSubs
    const kickOff = { ...g.lineup }
    const htOff = Object.values(g.lineup).find((id) => id !== g.lineup['gk'] && !live.mp.hLive.concat(live.mp.aLive).some((p) => p.psId === id && (p.red || p.offAt < 90)))!
    const htOn = g.bench.find((id) => g.squad[id] && !g.squad[id].injury)!
    advanceLiveMatch(g, u, { talk: 'fire-up', tactics: { ...g.tactics, mentality: 'attacking' }, substitutions: [{ off: htOff, on: htOn }] })
    // Still live, now at the 70th minute, with the half-time changes written back
    expect(g.live).toBe(live)
    expect(live.mp.clock).toBe(70)
    expect(g.season!.matchweek).toBe(mw)
    expect(g.tactics.mentality).toBe('attacking')
    expect(Object.values(g.lineup)).toContain(htOn)
    expect(g.bench).toContain(htOff)
    expect(live.mp.events.some((e) => e.minute > 45 && e.minute <= 70)).toBe(true)
    expect(live.mp.events.some((e) => e.minute > 70)).toBe(false)
    // A second change at 70, with a shout
    const userLive = live.userIsHome ? live.mp.hLive : live.mp.aLive
    const lateOff = userLive.find((p) => p.offAt >= 90 && !p.red && p.position !== 'GK' && p.psId !== htOn)!
    const lateOn = g.bench.find((id) => g.squad[id] && !g.squad[id].injury && !userLive.some((p) => p.psId === id))!
    advanceLiveMatch(g, u, { shout: 'shut-up-shop', tactics: { ...g.tactics, defensiveLine: 'deep' }, substitutions: [{ off: lateOff.psId, on: lateOn }] })
    expect(g.live).toBeNull()
    expect(g.season!.matchweek).toBe(mw + 1)
    expect(g.tactics.defensiveLine).toBe('deep')
    expect(Object.values(g.lineup)).toContain(lateOn)
    const res = g.lastMatch!
    const ours = live.userIsHome ? res.homeReport : res.awayReport
    expect(ours.halfTimeEffect).toBeTruthy()
    expect(ours.lateEffect).toContain('Shut up shop')
    expect(ours.substitutions.map((s) => s.reason)).toEqual(expect.arrayContaining(['half-time', '70th minute']))
    expect(ours.substitutions.find((s) => s.on === lateOn)?.minute).toBe(70)
    // Appearances count the kick-off eleven as starters, not the men who came on
    expect(g.squad[kickOff['gk']].seasonStats.apps).toBe(1)
    expect(g.squad[htOn].seasonStats.apps).toBe(1)
    expect(g.squad[htOn].seasonStats.starts).toBe(0)
  })

  it('a man taken off at half time cannot come back on at 70, and only the changes the engine made reach the lineup', () => {
    const g = createGame(settings({ seed: 'no-way-back' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    playMatchweek(g, u, false)
    const live = g.live!
    const userLive = () => (live.userIsHome ? live.mp.hLive : live.mp.aLive)
    const htOff = Object.values(g.lineup).find((id) => id !== g.lineup['gk'] && !userLive().some((p) => p.psId === id && (p.red || p.offAt < 90)))!
    const htOn = g.bench.find((id) => g.squad[id] && !g.squad[id].injury)!
    advanceLiveMatch(g, u, { talk: 'encourage', substitutions: [{ off: htOff, on: htOn }] })
    expect(live.mp.clock).toBe(70)
    // The half-time change was written back: the man who came off now sits on the bench
    expect(g.bench).toContain(htOff)
    expect(Object.values(g.lineup)).toContain(htOn)
    const lineupAt70 = { ...g.lineup }
    const benchAt70 = [...g.bench]
    // Asking for him again at 70 is refused by the engine and leaves the lineup and bench untouched
    const lateOff = userLive().find((p) => p.offAt >= 90 && !p.red && p.position !== 'GK' && p.psId !== htOn)!
    advanceLiveMatch(g, u, { shout: 'keep-shape', substitutions: [{ off: lateOff.psId, on: htOff }] })
    expect(g.live).toBeNull()
    const res = g.lastMatch!
    const ours = live.userIsHome ? res.homeReport : res.awayReport
    expect(ours.substitutions.some((s) => s.reason === '70th minute')).toBe(false)
    expect(ours.substitutions.filter((s) => s.on === htOff)).toHaveLength(0)
    expect(userLive().filter((p) => p.psId === htOff)).toHaveLength(1)
    expect(g.lineup).toEqual(lineupAt70)
    expect(g.bench).toEqual(benchAt70)
  })

  it('dynasty moves to the next season with ageing and a summer draft', () => {
    const g = createGame(settings({ mode: 'dynasty', leagueSeason: 2015, hostClubId: 'leicester-city' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const before = Object.keys(g.squad).length
    const report = advanceToNextSeason(g, u)
    expect(g.year).toBe(2)
    expect(g.settings.leagueSeason).toBe(2016)
    expect(g.phase).toBe('draft')
    expect(g.draft!.rules.squadSize).toBeGreaterThanOrEqual(Object.keys(g.squad).length)
    expect(Object.keys(g.squad).length + report.retired.length + report.expired.length).toBe(before)
    for (const id of Object.keys(g.squad)) expect(g.customPlayers[id]).toBeTruthy()
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    expect(g.season!.leagueSeason).toBe(2016)
    expect(g.window?.kind).toBe('summer')
  })

  it('plays a 34-matchweek Bundesliga season drafting from all of Europe', () => {
    const e = loadTestUniverse(['england', 'germany', 'spain'])
    const g = createGame(settings({ leagueId: 'germany', wheelLeagues: ['england', 'germany', 'spain'], hostClubId: 'fc-augsburg', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england', 'germany', 'spain'] } }))
    autoDraft(e, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, e)
    expect(g.season!.matchweeks).toBe(34)
    expect(Object.keys(g.season!.ai).length).toBe(17)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, e, true)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(34)
  })
})
