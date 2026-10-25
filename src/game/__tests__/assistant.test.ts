import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { advanceLiveMatch, applyEventChoice, closeLiveMatch, playMatchweek, startSeasonProper } from '../logic/week'
import { advanceWithAssistant, assistantCall, assistantTakesStops, bestBenchFit, autoPlayMatchweek, matchPlayOf, playMatchweekAs, TIRED_AT_70 } from '../logic/assistant'
import { playerLookup } from '../logic/players'
import { normaliseGame } from '../logic/save'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function started(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const answerEvent = (g: Game) => {
  if (g.pendingEvent) applyEventChoice(g, u, g.pendingEvent.choices[0].id)
}

describe('the assistant at the live stops', () => {
  it('is deterministic, stays within the changes left and only brings on fit, unused men, natural fits first', { timeout: 120_000 }, () => {
    let calls = 0
    let subsMade = 0
    let natural = 0
    let naturalAvailable = 0
    for (let s = 0; s < 10; s++) {
      const g = started(`assist-${s}`)
      for (let w = 0; w < 3; w++) {
        answerEvent(g)
        // Tired legs and a sick bay, so the assistant has changes to make and men it must not use
        for (const [i, id] of Object.keys(g.squad).entries()) g.squad[id].condition = 60 + ((i * 7 + s) % 35)
        const bench = g.bench.filter((id) => !Object.values(g.lineup).includes(id))
        if (bench[0]) g.squad[bench[0]].injury = { description: 'Test knock', weeksOut: 2 }
        if (bench[1]) g.squad[bench[1]].suspension = 1
        playMatchweek(g, u, false)
        while (g.live) {
          const live = g.live
          const mp = live.mp
          const appeared = new Set((live.userIsHome ? mp.hLive : mp.aLive).map((p) => p.psId))
          const made = (live.userIsHome ? mp.hSubs : mp.aSubs).length
          const atBreak = (mp.clock ?? 45) < 70
          const call = assistantCall(g, u)
          expect(assistantCall(clone(g), u)).toEqual(call)
          calls++
          const subs = call.substitutions ?? []
          expect(subs.length).toBeLessThanOrEqual(atBreak ? Math.min(3, 5 - made) : 5 - made)
          expect(new Set(subs.map((x) => x.on)).size).toBe(subs.length)
          expect(new Set(subs.map((x) => x.off)).size).toBe(subs.length)
          const get = playerLookup(g, u)
          for (const [k, sub] of subs.entries()) {
            expect(appeared.has(sub.on)).toBe(false)
            expect(g.squad[sub.on].injury).toBeNull()
            expect(g.squad[sub.on].suspension).toBeLessThanOrEqual(0)
            expect(g.bench).toContain(sub.on)
            const offPos = (live.userIsHome ? mp.hLive : mp.aLive).find((p) => p.psId === sub.off)!.position
            const naturalLeft = g.bench.some((id) => !appeared.has(id) && !subs.slice(0, k).some((x) => x.on === id) && g.squad[id] && !g.squad[id].injury && g.squad[id].suspension <= 0 && get(id)?.positions.includes(offPos))
            if (naturalLeft) {
              naturalAvailable++
              if (get(sub.on)!.positions.includes(offPos)) natural++
            }
          }
          subsMade += subs.length
          // Everyone out on his feet: the assistant wants every change, and still makes no more than are left
          const drained = clone(g)
          for (const sp of Object.values(drained.squad)) sp.condition = 5
          const most = assistantCall(drained, u).substitutions ?? []
          expect(most.length).toBeLessThanOrEqual(atBreak ? Math.min(3, 5 - made) : 5 - made)
          expect(atBreak ? call.talk : call.shout).toBeDefined()
          advanceWithAssistant(g, u)
        }
        closeLiveMatch(g, u)
      }
    }
    expect(calls).toBeGreaterThan(45)
    expect(subsMade).toBeGreaterThan(15)
    // Whenever a natural fit was on the bench, the assistant took one
    expect(natural).toBe(naturalAvailable)
  })

  it('reads the score: calm ahead, all-out attack behind, shut up shop a goal up at 70', { timeout: 120_000 }, () => {
    const seen = new Set<string>()
    for (let s = 0; s < 30 && seen.size < 5; s++) {
      const g = started(`score-${s}`)
      for (let w = 0; w < 3; w++) {
        answerEvent(g)
        playMatchweek(g, u, false)
        while (g.live) {
          const mp = g.live.mp
          const sc = mp.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
          const us = sc.filter((e) => e.side === (g.live!.userIsHome ? 'home' : 'away')).length
          const diff = us - (sc.length - us)
          const call = assistantCall(g, u)
          if ((mp.clock ?? 45) < 70) {
            if (diff > 0) expect(call.talk).toBe('calm')
            if (diff === 0) expect(call.talk).toBe('encourage')
            if (diff < 0) expect(['fire-up', 'encourage']).toContain(call.talk)
            seen.add(`ht-${Math.sign(diff)}`)
          } else {
            expect(call.shout).toBe(diff < 0 ? 'all-out-attack' : diff === 1 || diff === 2 ? 'shut-up-shop' : 'keep-shape')
            seen.add(`late-${Math.sign(diff)}`)
          }
          advanceWithAssistant(g, u)
        }
        closeLiveMatch(g, u)
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })

  it('takes off the tired at 70 and leaves the fresh alone; three changes at most at the break', { timeout: 120_000 }, () => {
    const g = started('tired-legs')
    playMatchweek(g, u, false)
    const exhausted = clone(g)
    for (const s of Object.values(exhausted.squad)) s.condition = 30
    expect(assistantCall(exhausted, u).substitutions).toHaveLength(3)
    advanceLiveMatch(g, u, { talk: 'none' })
    expect(g.live?.mp.clock).toBe(70)
    const fresh = clone(g)
    for (const s of Object.values(fresh.squad)) s.condition = 100
    expect(assistantCall(fresh, u).substitutions).toEqual([])
    const tired = clone(g)
    for (const s of Object.values(tired.squad)) s.condition = TIRED_AT_70
    const subs = assistantCall(tired, u).substitutions ?? []
    const made = (tired.live!.userIsHome ? tired.live!.mp.hSubs : tired.live!.mp.aSubs).length
    expect(subs.length).toBe(Math.min(5 - made, tired.bench.filter((id) => !Object.values(tired.lineup).includes(id)).length))
  })

  it('at 70 makes only what is left of the five after the changes at the break, however many fresh men sit on the bench', { timeout: 120_000 }, () => {
    let bound = 0
    for (let s = 0; s < 12 && bound < 3; s++) {
      const g = started(`late-cap-${s}`)
      playMatchweek(g, u, false)
      // Everyone out on his feet: three changes at the break, and at 70 he wants more than are left
      for (const sp of Object.values(g.squad)) sp.condition = 30
      advanceWithAssistant(g, u)
      if (g.live?.mp.clock !== 70) continue
      const mp = g.live.mp
      const made = (g.live.userIsHome ? mp.hSubs : mp.aSubs).length
      const appeared = new Set((g.live.userIsHome ? mp.hLive : mp.aLive).map((p) => p.psId))
      const get = playerLookup(g, u)
      const outfieldLeft = g.bench.filter((id) => !appeared.has(id) && g.squad[id] && !g.squad[id].injury && g.squad[id].suspension <= 0 && !get(id)!.positions.every((x) => x === 'GK')).length
      expect(made).toBeGreaterThanOrEqual(3)
      const subs = assistantCall(g, u).substitutions ?? []
      expect(subs.length).toBe(Math.min(5 - made, outfieldLeft))
      if (outfieldLeft > 5 - made) bound++
    }
    // The cap, not the bench, was what stopped him
    expect(bound).toBeGreaterThanOrEqual(3)
  })
})

it('prefers a natural fit on the bench to a better man out of position', { timeout: 120_000 }, () => {
  let checked = 0
  for (let s = 0; s < 10; s++) {
    const g = started(`fit-${s}`)
    const get = playerLookup(g, u)
    const bench = g.bench.filter((id) => !Object.values(g.lineup).includes(id))
    for (const pos of ['CB', 'CM', 'ST', 'LB', 'RW'] as const) {
      const nat = bench.find((id) => get(id)!.positions.includes(pos))
      const other = bench.find((id) => !get(id)!.positions.includes(pos) && !get(id)!.positions.includes('GK'))
      if (!nat || !other) continue
      // The out-of-position man fresh and the natural fit tired, so on rating and condition alone the wrong one wins
      g.squad[nat].condition = 1
      g.squad[other].condition = 100
      const choice = bestBenchFit(g, u, pos, new Set(bench.filter((id) => id !== nat && id !== other)))
      expect(choice).toBe(nat)
      checked++
    }
  }
  expect(checked).toBeGreaterThan(10)
})

describe('the three ways to play a match', () => {
  it('Sim result gives exactly what Auto-play gives for the same save', { timeout: 120_000 }, () => {
    let weeks = 0
    for (let s = 0; s < 5; s++) {
      const g = started(`same-${s}`)
      for (let w = 0; w < 7; w++) {
        answerEvent(g)
        const sim = clone(g)
        playMatchweekAs(sim, u, 'sim')
        expect(sim.live).toBeNull()
        // Auto-play as the screen plays it: kick off live, then the assistant at every stop it reaches
        const auto = clone(g)
        playMatchweekAs(auto, u, 'auto')
        let stops = 0
        while (auto.live) {
          advanceWithAssistant(auto, u)
          stops++
        }
        expect(stops).toBeGreaterThanOrEqual(2)
        expect(sim.lastMatch).toEqual(auto.lastMatch)
        expect(sim.lastCupMatch).toEqual(auto.lastCupMatch)
        expect(sim.rngState).toEqual(auto.rngState)
        expect(sim.season!.fixtures).toEqual(auto.season!.fixtures)
        expect(sim.squad).toEqual(auto.squad)
        playMatchweekAs(g, u, 'sim')
        closeLiveMatch(g, u)
        weeks++
      }
    }
    expect(weeks).toBe(35)
  })

  // Pinned before the assistant, the auto-play modes and the new pitch existed: Watch, then
  // "No changes" at both stops of every live match, for six seeds and eight matchweeks.
  const NO_CHANGES: Record<string, string> = {
    'nochange-0': '1-1:22 1-1:21 0-0:21 2-1:23 1-3:27 1-0:20 2-2:20 6-0:28 | {"a":-2013927475,"b":-1194208708,"c":816882748,"d":1898028393}',
    'nochange-1': '3-1:22 1-2:22 0-6:25 2-0:21 0-0:19 0-0:15 2-0:20 4-3:23 | {"a":-457853650,"b":-1292216832,"c":-1003535281,"d":745269842}',
    'nochange-2': '0-0:20 0-1:18 1-6:24 0-1:20 2-6:27 3-3:22 2-2:24 4-0:25 | {"a":-970600428,"b":1492406997,"c":-1443725060,"d":-88145279}',
    'nochange-3': '2-2:19 0-0:22 3-0:18 0-0:15 1-2:20 3-2:21 2-2:21 1-1:20 | {"a":1954827892,"b":1752051480,"c":1997004075,"d":332861320}',
    'nochange-4': '0-2:19 4-1:20 0-5:22 1-1:24 3-0:28 2-4:24 0-7:28 3-4:26 | {"a":-583909369,"b":-1802310069,"c":-705170307,"d":370352460}',
    'nochange-5': '2-0:19 1-1:19 1-0:18 0-4:19 2-4:24 0-2:23 1-0:21 4-3:23 | {"a":1921535986,"b":1126402745,"c":-1814733773,"d":1144483427}',
  }

  it('Watch with "No changes" at both stops plays exactly as it did before', { timeout: 120_000 }, () => {
    for (const seed of Object.keys(NO_CHANGES)) {
      const g = started(seed)
      const scores: string[] = []
      for (let w = 0; w < 8; w++) {
        answerEvent(g)
        playMatchweekAs(g, u, 'watch')
        while (g.live) advanceLiveMatch(g, u, (g.live.mp.clock ?? 45) === 45 ? { talk: 'none' } : {})
        const r = g.lastMatch!
        scores.push(`${r.homeGoals}-${r.awayGoals}:${r.events.length}`)
        closeLiveMatch(g, u)
      }
      expect(`${scores.join(' ')} | ${JSON.stringify(g.rngState)}`).toBe(NO_CHANGES[seed])
    }
  })

  it('a whole season on Auto-play needs no decision at any stop and finishes', { timeout: 120_000 }, () => {
    const g = started('auto-season', { matchPlay: 'auto' })
    expect(matchPlayOf(g)).toBe('auto')
    let weeks = 0
    while (g.phase !== 'summary' && weeks < 60) {
      answerEvent(g)
      autoPlayMatchweek(g, u)
      expect(g.live).toBeNull()
      weeks++
    }
    expect(g.phase).toBe('summary')
    expect(g.season!.matchweek).toBe(g.season!.matchweeks)
    expect(g.season!.fixtures.filter((f) => f.homeTeamId === 'user' || f.awayTeamId === 'user').every((f) => f.result)).toBe(true)
  })

  it('the preference is optional: an old save, Quick Draft and the Daily all play as Watch', { timeout: 120_000 }, () => {
    const g = started('pref')
    expect(g.settings.matchPlay).toBeUndefined()
    expect(matchPlayOf(g)).toBe('watch')
    const old = { ...g, settings: { ...g.settings } } as Record<string, unknown>
    delete (old.settings as Record<string, unknown>).matchPlay
    const n = normaliseGame(old as unknown as Game)!
    expect(matchPlayOf(n)).toBe('watch')
    expect(matchPlayOf({ ...g, settings: { ...g.settings, matchPlay: 'sim' } })).toBe('sim')
    expect(matchPlayOf({ ...g, settings: { ...g.settings, mode: 'dynasty', matchPlay: 'auto' } })).toBe('auto')
    expect(matchPlayOf({ ...g, settings: { ...g.settings, mode: 'quick', matchPlay: 'sim' } })).toBe('watch')
    expect(matchPlayOf({ ...g, settings: { ...g.settings, mode: 'daily', matchPlay: 'auto' } })).toBe('watch')
  })

  it('a match reopened mid-way (a reload, or the cup tie after the league match) keeps the assistant on only under Auto-play', { timeout: 120_000 }, () => {
    const g = started('reopen')
    expect(assistantTakesStops(g)).toBe(false)
    g.settings.matchPlay = 'auto'
    // No live match on: nothing to take
    expect(assistantTakesStops(g)).toBe(false)
    playMatchweek(g, u, false)
    expect(g.live).toBeTruthy()
    expect(assistantTakesStops(g)).toBe(true)
    // Through the save and back, as a reload reads it
    expect(assistantTakesStops(normaliseGame(clone(g)))).toBe(true)
    expect(assistantTakesStops({ ...g, settings: { ...g.settings, matchPlay: 'watch' } })).toBe(false)
    expect(assistantTakesStops({ ...g, settings: { ...g.settings, matchPlay: undefined } })).toBe(false)
    expect(assistantTakesStops({ ...g, settings: { ...g.settings, mode: 'quick' } })).toBe(false)
    expect(assistantTakesStops(null)).toBe(false)
  })
})
