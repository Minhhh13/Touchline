import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { produce } from 'immer'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import { closeJanuary, closeJanuarySpin, kickOff, openSpinChoices, rollJanuarySpin, toKickoff } from '../logic/quick'
import { kickoffStep } from '../logic/endCase'
import { tidyUniverseNames } from '../logic/playerNames'
import { createGame } from '../logic/setup'
import { runQuickJob, universeMark } from '../quickJob'
import { breathe } from '../../engine/__tests__/helpers'
import type { Game } from '../types'

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', rel), 'utf8')) as T

/** A universe built from the packs as the store and the worker each build their own: tidied names, classic or not. */
function universe(leagues: string[], classic: boolean): LoadedUniverse {
  const index = read<LeaguesFile>('leagues.json')
  const parts = leagues.map((id) => {
    const file = path.join(root, 'public', 'data', id, 'players-classic.json')
    return buildLeague(read<PlayersFile>(`${id}/players.json`), read<MetaFile>(`${id}/meta.json`), index.leagues.find((l) => l.id === id), classic && existsSync(file) ? read<PlayersFile>(`${id}/players-classic.json`) : undefined)
  })
  return tidyUniverseNames(mergeUniverses(parts, index.leagues, index.generatedAt)).universe
}

const page = universe(['england'], false)
const worker = universe(['england'], false)

/** A Quick Draft auto-drafted to the tactics step, with or without the January window and a bench. */
function atKickoff(seed: string, i: number): Game {
  const g = createGame({ mode: 'quick', seed, formationId: i % 3 === 0 ? '4-4-2' : '4-3-3', teamName: 'Worker XI', shortName: 'WRK', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2015 + (i % 10), rules: { ...QUICK_RULES, leagues: ['england'], ...(i % 4 === 1 ? { benchPicks: 3 } : {}) }, jobSecurity: false, difficulty: 'calibrated', january: i % 2 === 0 })
  const rng = Rng.fromState(g.rngState)
  autoDraft(page, g.draft!, rng)
  g.rngState = rng.getState()
  g.phase = 'kickoff'
  toKickoff(g, page)
  if (i % 5 === 2) g.captainId = Object.values(g.lineup)[3]
  return g
}

describe('the quick-season worker', () => {
  it('kicks off 50 seeded seasons, and closes their January windows, byte for byte as the page does', async () => {
    expect(universeMark(worker)).toBe(universeMark(page))
    let january = 0
    let spins = 0
    for (let i = 0; i < 50; i++) {
      if (i % 5 === 0) await breathe()
      const game = atKickoff(`quick-worker-${i}`, i)
      expect(kickoffStep(game)).toBe('tactics')
      const skip = i % 7 === 3
      // The page: the store's kickOff, an Immer recipe over the frozen game
      const onPage = produce(game, (g) => {
        kickOff(g, page, skip)
      })
      // The worker: a structured copy in, its own universe, a structured copy back (postMessage both ways)
      const inWorker = structuredClone(runQuickJob({ op: 'kickOff', game: structuredClone(game), skip }, worker))
      expect(JSON.stringify(inWorker), `seed ${i}`).toBe(JSON.stringify(onPage))
      expect(inWorker).toEqual(onPage)
      expect(['summary', 'january']).toContain(inWorker.phase)
      if (inWorker.phase === 'january') {
        january++
        // And the season played on from either is the same
        const a = produce(onPage, (g) => closeJanuary(g, page, null))
        const b = produce(inWorker, (g) => closeJanuary(g, page, null))
        expect(JSON.stringify(b)).toBe(JSON.stringify(a))
        // The window closed in the worker, passing or signing a listing, is the page's close too
        const index = i % 4 === 0 ? null : 0
        const closed = produce(onPage, (g) => closeJanuary(g, page, index))
        const closedInWorker = structuredClone(runQuickJob({ op: 'closeJanuary', game: structuredClone(onPage), index }, worker))
        expect(JSON.stringify(closedInWorker), `seed ${i} January ${index}`).toBe(JSON.stringify(closed))
        // The January spin: its player kept out, or placed in the first slot he can take
        if (i % 3 === 0) {
          const spun = produce(onPage, (g) => rollJanuarySpin(g, page))
          const slotId = i % 6 === 0 ? (openSpinChoices(spun, page)[0]?.slotId ?? null) : null
          const kept = produce(spun, (g) => closeJanuarySpin(g, page, slotId))
          const keptInWorker = structuredClone(runQuickJob({ op: 'closeJanuarySpin', game: structuredClone(spun), slotId }, worker))
          expect(JSON.stringify(keptInWorker), `seed ${i} January spin ${slotId}`).toBe(JSON.stringify(kept))
          spins++
        }
      }
    }
    expect(january).toBeGreaterThanOrEqual(20)
    expect(spins).toBeGreaterThanOrEqual(5)
  }, 300_000)

  it('marks a universe with other leagues or the classic seasons as different', () => {
    const marks = new Set([universeMark(page), universeMark(universe(['england'], true)), universeMark(universe(['england', 'spain'], false))])
    expect(marks.size).toBe(3)
  }, 120_000)
})
