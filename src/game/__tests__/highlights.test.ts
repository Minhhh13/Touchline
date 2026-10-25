import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { closeJanuary, kickOff, makeQuickChange, playbackResults, quickSquadAt, toKickoff } from '../logic/quick'
import { buildUpFrom, canShowHighlights, quickHighlights } from '../logic/highlights'
import { canPlayFor } from '../logic/quickBench'
import { compactGame } from '../logic/compact'
import { normaliseGame } from '../logic/save'
import { decodeSave, encodeSave } from '../saveStorage'
import { playerLookup } from '../logic/players'
import { autoDraft, isComplete, QUICK_RULES, type DraftRules } from '@engine/draft'
import { appearancesFromEvents } from '@engine/highlights'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import { Rng } from '@engine/rng'
import type { Game, GameSettings, QuickGameResult } from '../types'

const u = loadTestUniverse(['england'])

function settings(partial: Partial<GameSettings> = {}, rules: Partial<DraftRules> = {}): GameSettings {
  return { mode: 'quick', seed: 'hl-1', formationId: '4-3-3', teamName: 'Reel XI', shortName: 'REL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A quick game drafted by the assistant and standing at the tactics step. */
function drafted(partial: Partial<GameSettings> = {}, rules: Partial<DraftRules> = {}): Game {
  const g = createGame(settings(partial, rules))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  expect(isComplete(g.draft!)).toBe(true)
  toKickoff(g, u)
  return g
}

const snapshot = (g: Game) => JSON.stringify(g)
const GOALS = new Set(['goal', 'penalty', 'own_goal'])

/** Every game of the list rebuilds to the score, side and opponent shown, and its goals are the scorers the list names. */
function expectEveryGameRebuilt(g: Game, results: QuickGameResult[]): void {
  const before = snapshot(g)
  for (const r of results) {
    const hl = quickHighlights(g, u, r.matchweek)
    expect(hl, `matchweek ${r.matchweek}`).not.toBeNull()
    const mine = hl!.userHome ? 'home' : 'away'
    expect(hl!.userHome).toBe(r.home)
    expect(hl!.userHome ? hl!.awayTeamId : hl!.homeTeamId).toBe(r.opponentId)
    expect(hl!.userHome ? [hl!.homeGoals, hl!.awayGoals] : [hl!.awayGoals, hl!.homeGoals]).toEqual([r.gf, r.ga])
    const last = hl!.moments.at(-1)?.score ?? { home: 0, away: 0 }
    expect([last.home, last.away]).toEqual([hl!.homeGoals, hl!.awayGoals])
    const ours = hl!.events.filter((e) => GOALS.has(e.type) && e.side === mine).map((e) => e.minute)
    expect(ours).toEqual(r.scorers.map((s) => s.minute))
  }
  // Rebuilding never moves the save
  expect(snapshot(g)).toBe(before)
}

// Whole seasons replayed game by game: seconds alone, slower beside the other files
describe('highlights of any game of a quick season', { timeout: 300_000 }, () => {
  // One season per test: a whole season replayed game by game is long synchronous work for one worker
  it.each(['hl-1', 'hl-2'])('rebuilds every game of a season (%s) to exactly the score shown, the same reel every time, the save untouched', (seed) => {
    const g = drafted({ seed })
    kickOff(g, u)
    expect(g.phase).toBe('summary')
    expect(g.quickResult!.startRng).toBeDefined()
    expect(canShowHighlights(g)).toBe(true)
    const results = g.quickResult!.results!
    expect(results).toHaveLength(38)
    expectEveryGameRebuilt(g, results)
    expect(quickHighlights(g, u, 7)).toEqual(quickHighlights(g, u, 7))
  })

  it('rebuilds a season with a January deal and tactics changed in the window, and the first half while the window is open', () => {
    const g = drafted({ seed: 'hl-jan', january: true })
    kickOff(g, u)
    expect(g.phase).toBe('january')
    expect(canShowHighlights(g)).toBe(true)
    expectEveryGameRebuilt(g, playbackResults(g))
    expect(g.quickJanuary!.listings.length).toBeGreaterThan(0)
    g.tactics = { ...defaultTactics(g.tactics.formationId), mentality: 'attacking', pressing: 'high' }
    closeJanuary(g, u, 0)
    expect(g.phase).toBe('summary')
    expect(g.quickResult!.january).toBeDefined()
    expectEveryGameRebuilt(g, g.quickResult!.results!)
  })

  it('rebuilds a season with a bench and a change made during the playback', () => {
    const g = drafted({ seed: 'hl-bench' }, { benchPicks: 3 })
    kickOff(g, u)
    const games = playbackResults(g)
    const v = quickSquadAt(g, u, games, 12)
    const get = playerLookup(g, u)
    const slot = getFormation(g.tactics.formationId).slots.find((s) => v.lineup[s.id] && v.bench.some((id) => !v.out.includes(id) && canPlayFor(g)(get(id)!, s.position)))!
    const inId = v.bench.find((id) => !v.out.includes(id) && canPlayFor(g)(get(id)!, slot.position))!
    makeQuickChange(g, u, games, 12, slot.id, inId)
    expect(g.quickResult!.changes).toHaveLength(1)
    expectEveryGameRebuilt(g, g.quickResult!.results!)
  })

  it('keeps a bench season open, its changes and every game watchable through the compacted, compressed save and a reload', () => {
    const g = drafted({ seed: 'hl-save' }, { benchPicks: 3 })
    kickOff(g, u)
    const games = playbackResults(g)
    const v = quickSquadAt(g, u, games, 10)
    const get = playerLookup(g, u)
    const slot = getFormation(g.tactics.formationId).slots.find((s) => v.lineup[s.id] && v.bench.some((id) => !v.out.includes(id) && canPlayFor(g)(get(id)!, s.position)))!
    const inId = v.bench.find((id) => !v.out.includes(id) && canPlayFor(g)(get(id)!, slot.position))!
    makeQuickChange(g, u, games, 10, slot.id, inId)
    // What the store writes (compactGame, then lz-string) and reads back (decode, then normaliseGame)
    const stored = encodeSave(JSON.stringify(compactGame(g)))
    const back = normaliseGame(JSON.parse(decodeSave(stored)!) as Game)!
    expect(back.quickOpen).toBe(g.quickOpen)
    expect(back.quickChanges).toEqual(g.quickChanges)
    expect(back.quickStartRng).toEqual(g.quickStartRng)
    expect(back.draft?.rules.benchPicks).toBe(3)
    expect(back.draft?.bench).toEqual(g.draft?.bench)
    expect(back.quickResult).toEqual(g.quickResult)
    expect(canShowHighlights(back)).toBe(true)
    expectEveryGameRebuilt(back, back.quickResult!.results!)
  })

  it('shows the moments worth watching: every goal and card, chances and saves across seasons, men on the pitch when they act', () => {
    let chances = 0
    let saves = 0
    let games = 0
    for (const seed of ['hl-s1', 'hl-s2', 'hl-s3']) {
      const g = drafted({ seed })
      kickOff(g, u)
      for (const r of g.quickResult!.results!.filter((_, i) => i % 3 === 0)) {
        const hl = quickHighlights(g, u, r.matchweek)!
        games++
        const kinds = hl.moments.map((m) => m.kind)
        expect(kinds.filter((k) => GOALS.has(k))).toHaveLength(r.gf + r.ga)
        expect(kinds.filter((k) => k === 'yellow' || k === 'red')).toHaveLength(hl.events.filter((e) => e.type === 'yellow' || e.type === 'red').length)
        expect(hl.moments.map((m) => m.minute)).toEqual([...hl.moments.map((m) => m.minute)].sort((a, b) => a - b))
        chances += kinds.filter((k) => k === 'chance').length
        saves += kinds.filter((k) => k === 'save').length
        // Eleven men a side from kick-off, and every shot by a man on the pitch at the time
        for (const side of ['home', 'away'] as const) {
          expect(hl[side].appearances.filter((a) => a.onAt === 0)).toHaveLength(11)
          for (const e of hl.events.filter((x) => (x.type === 'chance' || x.type === 'save' || x.type === 'goal') && x.side === side)) {
            const a = hl[side].appearances.find((x) => x.psId === e.playerId)
            expect(a, e.text).toBeDefined()
            expect(a!.onAt).toBeLessThanOrEqual(e.minute)
          }
        }
        for (const e of hl.events.filter((x) => x.type === 'chance' || x.type === 'save' || GOALS.has(x.type))) expect(e.position).toBeDefined()
        expect(hl.momentum).toHaveLength(18)
      }
    }
    // Two a side per half at most, so a reel stays short; across 39 games there are plenty of both
    expect(chances / games).toBeGreaterThan(0.5)
    expect(saves / games).toBeGreaterThan(0.3)
    expect((chances + saves) / games).toBeLessThanOrEqual(8)
  })

  it('offers nothing for an older save without the start state, or for a game that no longer replays to its score', () => {
    const g = drafted({ seed: 'hl-old' })
    kickOff(g, u)
    const old = JSON.parse(snapshot(g)) as Game
    delete old.quickResult!.startRng
    expect(canShowHighlights(old)).toBe(false)
    expect(quickHighlights(old, u, 1)).toBeNull()
    const forged = JSON.parse(snapshot(g)) as Game
    forged.quickResult!.results![4].gf += 1
    expect(quickHighlights(forged, u, 5)).toBeNull()
    expect(quickHighlights(g, u, 99)).toBeNull()
  })

  it('offers nothing, and does not throw, when a bench change no longer replays on the data loaded', () => {
    const g = drafted({ seed: 'hl-bench-gone' }, { benchPicks: 3 })
    kickOff(g, u)
    const slot = getFormation(g.tactics.formationId).slots[0].id
    const broken = JSON.parse(snapshot(g)) as Game
    broken.quickChanges = [{ from: 3, slotId: slot, inId: 'nobody@2025@nowhere' }]
    expect(() => quickHighlights(broken, u, 10)).not.toThrow()
    expect(quickHighlights(broken, u, 10)).toBeNull()
    // The games before the change still replay
    expect(quickHighlights(broken, u, 2)).not.toBeNull()
  })
})

describe('appearances from a summary match', () => {
  it('puts a substitute in the slot of the man he replaced and ends a game at a red card or an injury', () => {
    const tactics = defaultTactics('4-3-3')
    const slots = getFormation('4-3-3').slots
    const lineup = Object.fromEntries(slots.map((s, i) => [s.id, `p${i}`]))
    const apps = appearancesFromEvents({ lineup, tactics }, [
      { minute: 30, type: 'red', side: 'home', playerId: 'p3', text: '' },
      { minute: 60, type: 'substitution', side: 'home', playerId: 'p9', secondaryId: 'sub1', text: '' },
      { minute: 70, type: 'injury', side: 'home', playerId: 'p5', text: '' },
      { minute: 50, type: 'substitution', side: 'away', playerId: 'p1', secondaryId: 'x', text: '' },
    ], 'home')
    expect(apps).toHaveLength(12)
    expect(apps.find((a) => a.psId === 'p3')).toMatchObject({ red: true, offAt: 30 })
    expect(apps.find((a) => a.psId === 'p5')).toMatchObject({ injured: true, offAt: 70 })
    expect(apps.find((a) => a.psId === 'p9')!.offAt).toBe(60)
    expect(apps.find((a) => a.psId === 'sub1')).toMatchObject({ slotId: slots[9].id, position: slots[9].position, onAt: 60, offAt: 90 })
    expect(apps.find((a) => a.psId === 'p1')!.offAt).toBe(90)
  })
})

describe('the reel build-up', () => {
  it('starts two minutes before a moment, never back over the moment before, and never after the moment', () => {
    const at = (minute: number) => ({ minute, kind: 'goal' as const, side: 'home' as const, text: '', score: { home: 0, away: 0 } })
    const ms = [at(1), at(10), at(11), at(11), at(40)]
    expect(ms.map((_, i) => buildUpFrom(ms, i))).toEqual([1, 8, 11, 11, 38])
    expect(buildUpFrom(ms, 5)).toBe(0)
  })
})
