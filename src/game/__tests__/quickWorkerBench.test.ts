import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { kickOff, makeQuickChange, playbackResults, quickChangeProblem, quickSquadAt, toKickoff } from '../logic/quick'
import { markQuickSeasonFresh, quickSeasonKnownFresh } from '../logic/quickSeam'
import { createGame } from '../logic/setup'
import { runQuickJob } from '../quickJob'
import { breathe, freshTestUniverse, loadTestUniverse } from '../../engine/__tests__/helpers'
import type { Game } from '../types'

// The page's universe and the worker's own, built apart as the two threads build theirs
const page = loadTestUniverse(['england'])
const worker = freshTestUniverse(['england'])

/** A Quick Draft with a bench, kicked off on the page (with or without the January window). */
function kickedOff(seed: string, i: number): Game {
  const g = createGame({ mode: 'quick', seed, formationId: i % 2 ? '4-4-2' : '4-3-3', teamName: 'Bench XI', shortName: 'BEN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2012 + (i % 12), rules: { ...QUICK_RULES, leagues: ['england'], benchPicks: 3, managers: false }, jobSecurity: false, difficulty: 'calibrated', january: i % 3 === 0 })
  const rng = Rng.fromState(g.rngState)
  autoDraft(page, g.draft!, rng)
  g.rngState = rng.getState()
  g.phase = 'kickoff'
  toKickoff(g, page)
  kickOff(g, page, false)
  return g
}

/** The first change the playback allows from game `revealed` on: the first bench man who can take a starter's slot. */
function firstChange(game: Game, revealed: number): { slotId: string; inId: string } | null {
  const results = playbackResults(game)
  const view = quickSquadAt(game, page, results, revealed)
  for (const inId of view.bench) {
    for (const s of getFormation(game.tactics.formationId).slots) {
      if (!quickChangeProblem(game, page, results, revealed, { slotId: s.id, inId })) return { slotId: s.id, inId }
    }
  }
  return null
}

describe('a quick bench change in the worker', () => {
  it('plays 16 seeded changes byte for byte as the page does, checked or not', async () => {
    let made = 0
    let january = 0
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) await breathe()
      const game = kickedOff(`bench-worker-${i}`, i)
      const revealed = 3 + (i % 9)
      const c = firstChange(game, revealed)
      if (!c) continue
      if (game.phase === 'january') january++
      const onPage = produce(game, (g) => {
        makeQuickChange(g, page, playbackResults(g), revealed, c.slotId, c.inId)
      })
      for (const check of [true, false]) {
        const inWorker = structuredClone(runQuickJob({ op: 'quickChange', game: structuredClone(game), revealed, ...c, check }, worker))
        expect(JSON.stringify(inWorker), `seed ${i} check ${check}`).toBe(JSON.stringify(onPage))
      }
      // A second change on the season the first one played
      const c2 = firstChange(onPage, revealed + 2)
      if (c2) {
        const twice = produce(onPage, (g) => {
          makeQuickChange(g, page, playbackResults(g), revealed + 2, c2.slotId, c2.inId)
        })
        const twiceInWorker = structuredClone(runQuickJob({ op: 'quickChange', game: structuredClone(onPage), revealed: revealed + 2, ...c2, check: true }, worker))
        expect(JSON.stringify(twiceInWorker), `seed ${i} second change`).toBe(JSON.stringify(twice))
      }
      made++
    }
    expect(made).toBeGreaterThanOrEqual(12)
    expect(january).toBeGreaterThanOrEqual(2)
  }, 240_000)

  it('refuses a season this engine does not play as shown, and leaves the change to the page', () => {
    const game = kickedOff('bench-worker-stale', 1)
    expect(game.phase).toBe('summary')
    const c = firstChange(game, 4)!
    // A game already shown that this engine would not play: the earlier engine's score
    const stale = produce(game, (g) => {
      const first = g.quickResult?.results?.[0]
      if (first) first.gf += 3
    })
    expect(() => runQuickJob({ op: 'quickChange', game: structuredClone(stale), revealed: 4, ...c, check: true }, worker)).toThrow('stale')
  }, 60_000)

  it('knows a season the page has just played as fresh, so the worker need not check it', () => {
    const game = kickedOff('bench-worker-fresh', 2)
    const copy: Game = JSON.parse(JSON.stringify(game))
    expect(quickSeasonKnownFresh(copy)).toBe(false)
    markQuickSeasonFresh(copy)
    expect(quickSeasonKnownFresh(copy)).toBe(true)
    expect(quickSeasonKnownFresh(produce(copy, (g) => void (g.quickChanges = [{ from: 3, slotId: 'x', inId: 'y' }])))).toBe(false)
  }, 60_000)
})
