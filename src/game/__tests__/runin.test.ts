import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { playOffOpponent, RUN_IN_TEMPLATES, runInCatalogue, runInJob, type RunInJob, type RunInTemplate } from '@engine/scenario'
import { tieScore } from '@engine/continental'
import { ACHIEVEMENTS } from '@engine/awards'
import { createGame } from '../logic/setup'
import { playMatchweek } from '../logic/week'
import { inRecordBooks } from '../logic/records'
import { finishDraftLabel, MODE_TITLE, modeLabel } from '../logic/modes'
import { nextStop, stopLine } from '../logic/seasonHighlights'
import { beginRunIn, briefOpen, briefStanding, gapLine, realFinish, RUN_IN_CONFIDENCE, RUN_IN_MORALE, RUN_IN_SPINS, RUN_IN_SQUAD, runInEntry, runInGameSettings, runInShare, runInUnlocks, runInVerdict, seedRunInDraft, takeoverTable, runInProjectedLineup } from '../logic/runin'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()
const WEST_HAM = runInJob(u, 'survival', 'england', 2025, 'west-ham-united')!

/** A run-in drafted by the assistant, at the takeover. */
function takenOver(job: RunInJob, seed: string, uv: LoadedUniverse = u): Game {
  const g = createGame(runInGameSettings(uv, job, { seed }))
  seedRunInDraft(g, uv)
  const rng = Rng.fromState(g.rngState)
  autoDraft(uv, g.draft!, rng)
  g.rngState = rng.getState()
  beginRunIn(g, uv)
  return g
}

/** The assistant's week, as Sim 5 plays it; returns the weeks played. */
function playOut(g: Game, uv: LoadedUniverse = u): number {
  let weeks = 0
  while (g.phase !== 'summary' && weeks < 40) {
    playMatchweek(g, uv, true)
    if (g.phase === 'match') g.phase = 'week'
    weeks++
  }
  return weeks
}

describe('Run-in: the reinforcements on the pitch', () => {
  it('shows the XI the job will start with, signings included, without touching the draft', () => {
    let signingsInXI = 0
    for (const seed of ['runin-xi-1', 'runin-xi-2', 'runin-xi-3', 'runin-xi-4']) {
      const g = createGame(runInGameSettings(u, WEST_HAM, { seed }))
      seedRunInDraft(g, u)
      // Nothing drafted yet: the pitch shows the club's own XI
      expect(runInProjectedLineup(g, u)).toBeNull()
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      const before = JSON.stringify(g)
      const projected = runInProjectedLineup(g, u)!
      expect(JSON.stringify(g)).toBe(before)
      beginRunIn(g, u)
      expect(projected).toEqual(g.lineup)
      const signed = new Set(JSON.parse(before).draft.history.flatMap((h: { pickedId: string | null }) => (h.pickedId ? [h.pickedId] : [])))
      signingsInXI += Object.values(projected).filter((id) => signed.has(id)).length
    }
    expect(signingsInXI).toBeGreaterThan(0)
    // Not a run-in, no projection
    const quick = createGame({ ...runInGameSettings(u, WEST_HAM, { seed: 'runin-xi-q' }), mode: 'quick' })
    expect(runInProjectedLineup(quick, u)).toBeNull()
  }, 120_000)
})

describe('Run-in: the takeover', () => {
  it('inherits the real squad and seeds a draft of four spins on top of it', () => {
    const g = createGame(runInGameSettings(u, WEST_HAM, { seed: 'runin-squad' }))
    expect(g.settings).toMatchObject({ mode: 'runin', difficulty: 'realistic', jobSecurity: true, continental: false, leagueId: 'england', leagueSeason: 2025, hostClubId: 'west-ham-united', teamName: 'West Ham United', runIn: { template: 'survival' } })
    seedRunInDraft(g, u)
    const ids = Object.keys(g.squad)
    expect(ids).toHaveLength(RUN_IN_SQUAD)
    const real = new Set(u.clubSeasonByKey['west-ham-united@2025'].squad.map((p) => p.id))
    expect(ids.every((id) => real.has(id))).toBe(true)
    for (const s of Object.values(g.squad)) {
      expect(s).toMatchObject({ familiarity: 70, sharpness: 85, morale: RUN_IN_MORALE.survival })
      expect(s.condition).toBeGreaterThanOrEqual(88)
      expect(s.condition).toBeLessThanOrEqual(97)
    }
    const d = g.draft!
    expect(d.rules.squadSize).toBe(RUN_IN_SQUAD + RUN_IN_SPINS)
    expect(d.respinsLeft).toBe(1)
    expect(Object.keys(d.lineup)).toHaveLength(11)
    expect(d.bench).toHaveLength(RUN_IN_SQUAD - 11)
    expect(d.takenPlayers).toHaveLength(RUN_IN_SQUAD)
    expect(finishDraftLabel(g)).toBe('Take the job')
    // Four spins add four players
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, d, rng)
    g.rngState = rng.getState()
    expect(d.history.filter((h) => h.pickedId)).toHaveLength(RUN_IN_SPINS)
    beginRunIn(g, u)
    expect(Object.keys(g.squad)).toHaveLength(RUN_IN_SQUAD + RUN_IN_SPINS)
    expect(g.draft).toBeNull()
  })

  it('starts at matchweek 28 in the projected table, with no cup, window, Europe or friendlies, and the brief as the board target', () => {
    const g = takenOver(WEST_HAM, 'runin-start')
    const s = g.season!
    expect(s).toMatchObject({ matchweek: 28, takeoverAt: 28, matchweeks: 38, cup: [], cupEliminated: true, cupWon: false, boardTarget: 17, confidence: RUN_IN_CONFIDENCE.survival, aiOffset: 0, sacked: false })
    expect(s.continental).toBeUndefined()
    expect(s.objectives).toEqual([{ id: 'survive', label: 'Stay up: finish 17th or better', target: 17 }])
    expect(g).toMatchObject({ phase: 'week', friendliesPlayed: 3, window: null })
    // Nothing before the takeover was played: those weeks are the projection
    expect(s.fixtures.filter((f) => f.result)).toHaveLength(0)
    const table = seasonTable(s)
    expect(table.every((r) => r.played === 28)).toBe(true)
    expect(positionOf(table, USER_TEAM)).toBe(18)
    expect(table.find((r) => r.teamId === USER_TEAM)!.points).toBe(28)
    expect(takeoverTable(s)).toEqual(table)
    // Two points from safety since engine 6's reconciled table (scaleTable, QA O-1) put Spurs on 30, not 29
    expect(briefStanding(g)).toMatchObject({ template: 'survival', target: 17, position: 18, points: 28, gap: -2, toPlay: 10, settled: null })
    expect(gapLine('survival', 17, 18, -1)).toBe('1 point behind safety')
    expect(modeLabel(g, 'short')).toBe('Run-in')
    expect(MODE_TITLE.runin).toBe('Run-in')
  })

  it('plays to the summary in ten assistant weeks, the table carrying the projection in', () => {
    const g = takenOver(WEST_HAM, 'runin-play')
    expect(playOut(g)).toBe(10)
    expect(g.phase).toBe('summary')
    const table = seasonTable(g.season!)
    expect(table.every((r) => r.played === 38)).toBe(true)
    const mine = g.season!.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
    expect(mine).toHaveLength(10)
    expect(mine.every((f) => f.matchweek > 28)).toBe(true)
    const won = mine.filter((f) => (f.homeTeamId === USER_TEAM ? f.result!.homeGoals > f.result!.awayGoals : f.result!.awayGoals > f.result!.homeGoals)).length
    const drawn = mine.filter((f) => f.result!.homeGoals === f.result!.awayGoals).length
    const row = table.find((r) => r.teamId === USER_TEAM)!
    expect(row.points).toBe(28 + 3 * won + drawn)
    expect(g.history.at(-1)).toMatchObject({ points: row.points, position: positionOf(table, USER_TEAM) })
    expect(g.season!.objectives![0].met).toBe(!g.season!.sacked && positionOf(table, USER_TEAM) <= 17 ? true : g.season!.sacked ? undefined : false)
  })

  it('replays: the same seed gives the same draft and the same season', () => {
    const a = takenOver(WEST_HAM, 'runin-replay')
    const b = takenOver(WEST_HAM, 'runin-replay')
    playOut(a)
    playOut(b)
    expect(a.history[0]).toEqual(b.history[0])
    expect(a.rngState).toEqual(b.rngState)
    expect(Object.keys(a.squad).sort()).toEqual(Object.keys(b.squad).sort())
  })

  it('keeps a run-in out of the record books and the season achievements', () => {
    for (const template of RUN_IN_TEMPLATES) {
      const job = runInCatalogue(u, template)[0]
      const g = takenOver(job, `runin-books-${template}`)
      playOut(g)
      expect(inRecordBooks(g)).toBe(false)
      expect(g.unlocked.every((id) => ['survivor', 'great-escape', 'run-in-title'].includes(id)), g.unlocked.join()).toBe(true)
      expect(g.unlocked).toEqual(expect.arrayContaining(runInUnlocks(g, u, positionOf(seasonTable(g.season!), USER_TEAM))))
    }
    expect(ACHIEVEMENTS.filter((a) => a.id === 'great-escape' || a.id === 'run-in-title')).toHaveLength(2)
  }, 60000)
})

describe('Run-in: every template', () => {
  it('starts each brief in the right place and ends in a verdict that names the real outcome', () => {
    const first: Record<RunInTemplate, RunInJob> = { title: runInCatalogue(u, 'title')[0], europe: runInCatalogue(u, 'europe')[0], survival: WEST_HAM }
    for (const template of RUN_IN_TEMPLATES) {
      const job = first[template]
      const g = takenOver(job, `runin-verdict-${template}`)
      expect(briefStanding(g)).toMatchObject({ position: job.projected.position, points: job.projected.points, gap: job.gap, target: job.target })
      expect(g.season!.boardTarget).toBe(job.target)
      expect(runInVerdict(g, u)).toBeNull()
      playOut(g)
      const v = runInVerdict(g, u)!
      const club = u.clubById[job.clubId].shortName
      expect(v.from).toEqual({ matchweek: 28, position: job.projected.position, points: job.projected.points })
      expect(v.real).toEqual(job.real)
      expect(v.met).toBe(!v.sacked && v.position <= job.target)
      expect(v.chip).toBe(v.met ? { title: 'TITLE WON', europe: 'TOP FOUR', survival: 'SURVIVED' }[template] : 'MISSED')
      expect(v.line).toContain(`; the real ${club} `)
      expect(v.realLine).toMatch(new RegExp(`^📊 The real ${club} (went down|won the title|finished \\d+(st|nd|rd|th)) on ${job.real.points}(, in the relegation play-off place)?$`))
      const text = runInShare(g, u)!.split('\n')
      expect(text[0]).toBe(`TouchLine · Run-in · ${club} ${job.season}-${String((job.season + 1) % 100).padStart(2, '0')}`)
      expect(text[1]).toMatch(new RegExp(`^Took over at MW28: \\d+(st|nd|rd|th), ${job.projected.points} pts \\(projected\\)$`))
      expect(text[2]).toBe(`${v.icon} ${v.chip} · ${v.position}${['th', 'st', 'nd', 'rd'][v.position % 10 > 3 || (v.position % 100 >= 11 && v.position % 100 <= 13) ? 0 : v.position % 10]} on ${v.points}`)
      expect([...text[3]].length).toBe(10)
      expect(text).toContain(v.realLine)
      expect(text.at(-1)).toBe(`Seed runin-verdict-${template}`)
    }
  }, 60000)

  it('words the West Ham verdict against the real relegation', () => {
    const g = takenOver(WEST_HAM, 'runin-west-ham')
    playOut(g)
    const v = runInVerdict(g, u)!
    expect(v.realLine).toBe('📊 The real West Ham went down on 39')
    if (v.met) expect(v.line).toBe(`You kept West Ham up on ${v.points}; the real West Ham went down on 39`)
    else if (!v.sacked) expect(v.line).toBe(`West Ham went down on ${v.points} under you; the real West Ham went down on 39`)
  })
})

describe('Run-in: the Bundesliga play-off', () => {
  const de = loadTestUniverse(['germany'])

  it('never says a 16th went down: it played a play-off the data does not keep', () => {
    expect(realFinish({ position: 16, points: 27 }, 18, 'germany')).toBe('finished 16th on 27, in the relegation play-off place')
    expect(realFinish({ position: 17, points: 25 }, 18, 'germany')).toBe('went down on 25')
    expect(realFinish({ position: 18, points: 39 }, 20, 'england')).toBe('went down on 39')
    expect(realFinish({ position: 18, points: 40 }, 20, 'spain')).toBe('went down on 40')
  })

  it('words the verdict and the Great Escape on the real outcome: only a 17th or 18th really went down', () => {
    const jobs = runInCatalogue(de, 'survival')
    const sixteenth = jobs.find((j) => j.real.position === 16)!
    const below = jobs.find((j) => j.real.position === 17)!
    expect(sixteenth.target).toBe(15)
    const a = takenOver(sixteenth, 'runin-playoff-16', de)
    playOut(a, de)
    const club = de.clubById[sixteenth.clubId].shortName
    expect(runInVerdict(a, de)!.realLine).toBe(`📊 The real ${club} finished 16th on ${sixteenth.real.points}, in the relegation play-off place`)
    // Engine 7: a 16th plays the relegation play-off, two legs against the weakest club promoted for the next season,
    // and meets the survival brief by winning it; no play-off for any other place
    let sixteenths = 0
    let survived = 0
    for (let i = 0; i < 60; i++) {
      const g = takenOver(sixteenth, `runin-playoff-16-${i}`, de)
      playOut(g, de)
      const v = runInVerdict(g, de)!
      if (v.sacked) {
        expect(g.season!.playOff).toBeUndefined()
        continue
      }
      if (v.position !== 16) {
        expect(g.season!.playOff).toBeUndefined()
        if (v.position > 16) expect(v.line.startsWith(`${club} went down on ${v.points} under you;`)).toBe(true)
        continue
      }
      sixteenths++
      const po = g.season!.playOff!
      const opp = playOffOpponent(de, 'germany', sixteenth.season)!
      expect(po.opponent).toBe(`${opp.clubId}@${opp.season}`)
      expect(po.tie.homeTeamId).toBe(USER_TEAM)
      expect(de.clubSeasons.some((cs) => cs.leagueId === 'germany' && cs.season === sixteenth.season && cs.clubId === opp.clubId)).toBe(false)
      const s = tieScore(po.tie)!
      expect(s.legs).toHaveLength(2)
      const won = po.tie.winnerId === USER_TEAM
      if (won) survived++
      expect(v.met).toBe(won)
      expect(v.chip).toBe(won ? 'SURVIVED' : 'MISSED')
      expect(v.line.startsWith(`${club} finished 16th on ${v.points} under you and ${won ? 'stayed up through' : 'went down in'} the relegation play-off, ${s.legs![0].home}-${s.legs![0].away} and ${s.legs![1].home}-${s.legs![1].away} against ${de.clubById[opp.clubId].name}, ${s.home}-${s.away} on aggregate`)).toBe(true)
      expect(g.season!.objectives!.find((o) => o.id === 'survive')!.met).toBe(won)
      expect(runInUnlocks(g, de, 16).includes('great-escape')).toBe(false)
      // Replayed alike
      const again = takenOver(sixteenth, `runin-playoff-16-${i}`, de)
      playOut(again, de)
      expect(again.season!.playOff).toEqual(po)
    }
    expect(sixteenths).toBeGreaterThan(0)
    expect(survived).toBeLessThanOrEqual(sixteenths)
    const b = takenOver(below, 'runin-playoff-17', de)
    playOut(b, de)
    expect(runInVerdict(b, de)!.realLine).toBe(`📊 The real ${de.clubById[below.clubId].shortName} went down on ${below.real.points}`)
    if (!b.season!.sacked) expect(runInUnlocks(b, de, 15)).toContain('great-escape')
  }, 60000)
})

describe('Run-in: Highlights', () => {
  it('stops before each of the last three weeks while the brief is open, and not once it is settled', () => {
    let stops = 0
    for (let i = 0; i < 6; i++) {
      const g = takenOver(WEST_HAM, `runin-stop-${i}`)
      while (g.phase !== 'summary' && g.season!.matchweek < 35) {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
      }
      if (g.phase === 'summary') continue
      const stop = nextStop(g, u)
      if (briefOpen(g)) {
        expect(stop).not.toBeNull()
        // A derby or a title decider outranks it; otherwise it is the brief
        if (stop!.kind === 'brief') {
          stops++
          expect(stop!.matchweek).toBe(36)
          expect(stopLine(stop!, u)).toMatch(/^Stopped for the run-in decider (v|at) .+, MW 36: \d+(st|nd|rd|th), /)
        } else expect(['derby', 'title-decider']).toContain(stop!.kind)
      } else expect(stop?.kind).not.toBe('brief')
      // Settle it: a carried table far clear of everyone leaves nothing to decide
      g.season!.carryIn![USER_TEAM] = { won: 28, drawn: 0, lost: 0, goalsFor: 80, goalsAgainst: 10 }
      expect(briefStanding(g)!.settled).toBe('met')
      expect(briefOpen(g)).toBe(false)
      expect(nextStop(g, u)?.kind).not.toBe('brief')
    }
    expect(stops).toBeGreaterThan(0)
    // Before the last three weeks the brief never stops the sim
    const early = takenOver(WEST_HAM, 'runin-stop-early')
    expect(briefOpen(early)).toBe(true)
    expect(nextStop(early, u)?.kind).not.toBe('brief')
  }, 60000)
})

describe('Run-in: the store', () => {
  it('opens in its own slot, plays to the summary and files on its own table and shelf', () => {
    const store = useStore
    store.setState({ universe: u, loadedLeagues: ['england'], game: null, parked: {} })
    // A Season under way is parked, never overwritten
    store.getState().startGame({ mode: 'season', seed: 'runin-store-season', formationId: '4-3-3', teamName: 'Season XI', shortName: 'SXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const before = store.getState().profile
    store.getState().startGame(runInGameSettings(u, WEST_HAM, { seed: 'runin-store' }))
    expect(store.getState().parked.season?.settings.teamName).toBe('Season XI')
    let g = store.getState().game!
    expect(g.settings.mode).toBe('runin')
    expect(Object.keys(g.squad)).toHaveLength(RUN_IN_SQUAD)
    expect(g.draft!.rules.squadSize).toBe(RUN_IN_SQUAD + RUN_IN_SPINS)
    store.getState().autoDraftRest()
    store.getState().finishDraft()
    g = store.getState().game!
    expect(g.phase).toBe('week')
    expect(g.season!.matchweek).toBe(28)
    store.getState().simToEnd()
    g = store.getState().game!
    expect(g.phase).toBe('summary')
    const profile = store.getState().profile
    expect(profile.runIns).toHaveLength(1)
    expect(profile.runIns![0]).toEqual(runInEntry(g, u, profile.runIns![0].date))
    expect(profile.runIns![0]).toMatchObject({ template: 'survival', hostClubId: 'west-ham-united', leagueSeason: 2025, from: { matchweek: 28, position: 18, points: 28 }, real: { position: 18, points: 39 } })
    expect(profile.cabinet!.runIns).toEqual({ played: 1, met: profile.runIns![0].met ? 1 : 0 })
    expect(profile.cabinet!.byMode.runin).toBe(1)
    // Its own shelf only: no leaderboard row, no league title, no season counted
    expect(profile.leaderboard).toEqual(before.leaderboard)
    expect(profile.cabinet!.league).toBe(before.cabinet?.league ?? 0)
    expect(profile.seasonsSimulated).toBe(before.seasonsSimulated)
    // Filed once
    store.getState().recordResult()
    expect(store.getState().profile.runIns).toHaveLength(1)
    expect(store.getState().profile.cabinet!.runIns.played).toBe(1)
  }, 60000)
})

describe('Run-in: balance guard', () => {
  it('meets the survival brief in 20 to 60% of 100 assistant run-ins from the England catalogue', () => {
    const jobs = runInCatalogue(u, 'survival')
    let met = 0
    for (let i = 0; i < 100; i++) {
      const g = takenOver(jobs[i % jobs.length], `runin-guard-${i}`)
      playOut(g)
      if (runInVerdict(g, u)!.met) met++
    }
    // Measured 36 of 100 (four spins); over 400 run-ins 40.5%. Tune RUN_IN_SPINS (3 to 5) first if this moves out
    expect(met).toBeGreaterThanOrEqual(20)
    expect(met).toBeLessThanOrEqual(60)
  }, 300000)
})
