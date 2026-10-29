import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import type { MoraleEntry, MoraleReason } from '@engine/types'
import { STATUS_LABEL } from '@engine/status'
import { playMatchweek } from '../logic/week'
import { officeTick } from '../logic/office'
import { brokenTo, makePromise, MAX_OPEN_PROMISES, openPromises, PROMISE_LIST_CAP, settlePromises } from '../logic/promises'
import { releasePlayer } from '../logic/marketOps'
import { playerLookup } from '../logic/players'
import { describeMorale } from '../logic/happiness'
import { TALK_LABEL } from '../logic/talks'
import { lastVerdict, legendInSquad, noteSeasonEnd, targetMet } from '../logic/dynastyHistory'
import { seasonGame } from './seasonGame'
import type { Game, SeasonRecord } from '../types'

/**
 * Round 10's test gaps in the Office and the club history: the promise list's cap and the promises dropped when a
 * man leaves or a season ends, the broken-promise count, every line the Happiness view words, the board's last word
 * and a legend's player-season in the squad.
 */

const u = loadTestUniverse(['england'])

function storeWeek(g: Game): void {
  playMatchweek(g, u, true)
  if (g.phase === 'match') g.phase = 'week'
  officeTick(g, u)
}

describe('the promise list', () => {
  it('keeps at most the cap, dropping the oldest settled first and never an open one', async () => {
    let made = 0
    for (const seed of ['r10-promises-a', 'r10-promises-b']) {
      const g = seasonGame(u, seed, 1)
      const real = (id: string) => playerLookup(g, u)(id)!.playerId
      for (let w = 0; w < 30 && g.season!.matchweek < g.season!.matchweeks - 1; w++) {
        // Promise football to whoever can take one, up to the squad's limit of open promises
        for (const id of Object.keys(g.squad)) if (openPromises(g).length < MAX_OPEN_PROMISES && makePromise(g, u, id, 'minutes').ok) made++
        const open = openPromises(g).map((p) => `${p.playerId}|${p.madeAt}`)
        const list = g.office!.promises!
        expect(list.length).toBeLessThanOrEqual(PROMISE_LIST_CAP)
        expect(openPromises(g).length).toBeLessThanOrEqual(MAX_OPEN_PROMISES)
        // The settled ones kept are the newest settled: none older survives a newer one dropped
        const madeAts = list.map((p) => p.madeAt)
        expect([...madeAts].sort((a, b) => a - b)).toEqual(madeAts)
        storeWeek(g)
        // Every promise open before the week is still listed, open or settled now, while its man is here
        const after = new Set(g.office!.promises!.map((p) => `${p.playerId}|${p.madeAt}`))
        const here = new Set(Object.keys(g.squad).map(real))
        for (const k of open) if (here.has(k.split('|')[0])) expect(after.has(k)).toBe(true)
      }
      expect(g.office!.promises!.length).toBe(PROMISE_LIST_CAP)
      await breathe()
    }
    expect(made).toBeGreaterThan(2 * PROMISE_LIST_CAP)
  }, 120_000)

  it("drops an open promise when its man leaves or its season is over, and counts each broken one to him", () => {
    const g = seasonGame(u, 'r10-promise-leave', 3)
    const ids = Object.values(g.lineup)
    const xi = new Set(ids)
    // c sits outside the XI, as the assistant picks it: a man it leaves out for the promise's weeks
    const c = Object.keys(g.squad).find((id) => !xi.has(id) && !g.contracts[id]?.loan)!
    const [a, b] = [ids[2], ids[4]]
    for (const id of [a, b, c]) expect(makePromise(g, u, id, 'minutes').ok).toBe(true)
    const morale = Object.fromEntries(Object.entries(g.squad).map(([id, s]) => [id, s.morale]))
    // He leaves: his promise goes with him, quietly (no one else's morale moves, nothing counts as broken)
    releasePlayer(g, u, a)
    // A promise carried over from an earlier season is wiped by the summer
    g.office!.promises!.find((p) => p.playerId === playerLookup(g, u)(b)!.playerId)!.year = g.year - 1
    settlePromises(g, u)
    expect(openPromises(g).map((p) => p.playerId)).toEqual([playerLookup(g, u)(c)!.playerId])
    for (const [id, m] of Object.entries(morale)) if (g.squad[id]) expect(g.squad[id].morale).toBe(m)
    expect(g.office!.broken ?? {}).toEqual({})
    expect(brokenTo(g, u, c)).toBe(0)
    expect(brokenTo(g, u, 'nobody@2025@burnley')).toBe(0)
    // Kept out of the side for the promise's weeks: broken, and counted against him once
    // The manager picks the side each week and leaves him out of it
    for (let w = 0; w < 8 && openPromises(g).length; w++) {
      for (const k of Object.keys(g.lineup)) if (g.lineup[k] === c) delete g.lineup[k]
      g.bench = g.bench.filter((x) => x !== c)
      playMatchweek(g, u, false)
      if (g.phase === 'match') g.phase = 'week'
      officeTick(g, u)
    }
    expect(g.office!.promises!.find((p) => p.playerId === playerLookup(g, u)(c)!.playerId)!.state).toBe('broken')
    expect(brokenTo(g, u, c)).toBe(1)
  }, 60_000)
})

describe("the Happiness view's words", () => {
  it('words every reason, with and without its note', () => {
    const line = (r: MoraleReason, n?: string) => describeMorale({ w: 1, d: 1, r, ...(n === undefined ? {} : { n }) } as MoraleEntry)
    expect(line('result', 'L')).toBe('Defeat')
    expect(line('cup', 'W 8.1')).toBe('Cup win, rated 8.1')
    expect(line('result')).toBe('Result')
    expect(line('minutes', '30/85')).toBe('Playing time 30% (expects 85%)')
    expect(line('minutes')).toBe('Playing time')
    expect(line('captain')).toBe('Lifted by the captain')
    expect(line('promise', 'kept')).toBe('Promise kept')
    expect(line('promise', 'broken')).toBe('Promise broken')
    expect(line('event', 'Fined for a late night')).toBe('Fined for a late night')
    expect(line('event')).toBe('Club news')
    expect(line('talk', 'contract-yes')).toBe('New contract agreed')
    expect(line('talk', 'shopped')).toBe('Shopped to other clubs')
    const talk = Object.keys(TALK_LABEL)[0] as keyof typeof TALK_LABEL
    expect(line('talk', talk)).toBe(TALK_LABEL[talk].label)
    expect(line('talk', 'unknown')).toBe('A word from you')
    expect(line('status', 'key')).toBe(`New status: ${STATUS_LABEL.key.toLowerCase()}`)
    expect(line('status', 'nonsense')).toBe('Status change')
    expect(line('summer')).toBe('A fresh start in the summer')
  })
})

describe("the club history's last word", () => {
  const record = (position: number, notes?: SeasonRecord['notes']): SeasonRecord => ({ year: 1, position, ...(notes ? { notes } : {}) }) as SeasonRecord

  it("reads last season's target and finish, and nothing without notes", () => {
    expect(lastVerdict([])).toBeNull()
    expect(lastVerdict([record(3)])).toBeNull()
    const notes = { target: 6, objectivesMet: 1, objectivesTotal: 2, confidence: 60 }
    expect(lastVerdict([record(9, notes), record(4, notes)])).toEqual({ target: 6, position: 4, met: true })
    expect(lastVerdict([record(4, notes), record(9, notes)])).toEqual({ target: 6, position: 9, met: false })
    // A sacked season never met its target, wherever it finished
    expect(lastVerdict([record(1, { ...notes, sacked: true })])).toEqual({ target: 6, position: 1, met: false })
    expect(targetMet(record(6, notes))).toBe(true)
  })

  it("finds a legend's player-season while he is in the squad, and notes a finished season once", () => {
    const g = seasonGame(u, 'r10-history', 2)
    const get = playerLookup(g, u)
    for (const id of Object.keys(g.squad)) expect(legendInSquad(g, u, get(id)!.playerId)?.id).toBe(id)
    expect(legendInSquad(g, u, 'not-a-player')).toBeUndefined()
    const leaver = Object.keys(g.squad)[0]
    const pid = get(leaver)!.playerId
    releasePlayer(g, u, leaver)
    expect(legendInSquad(g, u, pid)).toBeUndefined()
    // Mid-season nothing is noted
    expect(noteSeasonEnd(g, u)).toBe(false)
  }, 60_000)
})
