import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { playMatchweek, runSteps, simWeeksSteps } from '../logic/week'
import { officeTick } from '../logic/office'
import { withTick } from '../logic/officeSteps'
import { lodgeRequest, rippleTargets } from '../logic/officeCore'
import { makePromise } from '../logic/promises'
import { answerRequest, openRequests, talkOdds } from '../logic/transferRequests'
import { answerPress, bigMatchOf, BOAST_ANSWER, BOAST_LOST, BOAST_WON, pressEffect, pressQuestions, PRESS_ANSWERS, settleBoast } from '../logic/pressConference'
import { boardMood, isOfficeNews, playerRead, promiseClock, promiseClocks, promiseLineKind, promisesTo, requestDeadline, requestRisks } from '../logic/officeView'
import { buildDigest, digestSnapshot } from '../logic/digest'
import { filterNews } from '../logic/squadDisplay'
import { beginSeason, createGame } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { playerLookup } from '../logic/players'
import { seasonGame, seasonSettings, clone } from './seasonGame'
import type { Game } from '../types'

const u = loadTestUniverse(['england'])
const hash = (g: Game): string => createHash('sha256').update(JSON.stringify({ ...g, id: '', createdAt: '' })).digest('hex')

/** A week as the store plays it: the matchweek, then the office's tick. */
function storeWeek(g: Game): void {
  playMatchweek(g, u, true)
  if (g.phase === 'match') g.phase = 'week'
  officeTick(g, u)
}

/** Everything the Office, the Inbox, the digest and the Happiness view read, read the way the screens read it. */
function readOffice(g: Game): string {
  const out: unknown[] = []
  out.push(promiseClocks(g, u), pressQuestions(g, u), bigMatchOf(g, u), boardMood(g.season?.confidence ?? 50))
  for (const q of pressQuestions(g, u)) for (const a of Object.keys(PRESS_ANSWERS[q])) out.push(pressEffect(g, u, q, a))
  for (const id of Object.keys(g.squad)) out.push(playerRead(g, u, id), promisesTo(g, u, id))
  for (const r of openRequests(g)) {
    const id = Object.keys(g.squad).find((x) => playerLookup(g, u)(x)?.playerId === r.playerId)
    if (id) out.push(requestRisks(g, u, id, r), requestDeadline(r))
  }
  out.push(filterNews(g.season?.news ?? [], 'office').length, (g.season?.news ?? []).filter(isOfficeNews).length)
  return JSON.stringify(out)
}

describe('the Office read but never used', () => {
  it('a Season whose Office is read every week ends byte for byte the Season never read, and reading writes nothing', () => {
    for (const seed of ['office-view-nomove-1', 'office-view-nomove-2']) {
      const a = seasonGame(u, seed)
      const b = seasonGame(u, seed)
      for (let w = 0; w < 38 && a.phase !== 'summary'; w++) {
        const before = JSON.stringify(a)
        const once = readOffice(a)
        expect(JSON.stringify(a)).toBe(before)
        expect(readOffice(a)).toBe(once)
        storeWeek(a)
        storeWeek(b)
      }
      expect(a.office).toBeUndefined()
      expect(hash(a)).toBe(hash(b))
    }
  }, 120_000)

  it('a Dynasty read through its summer plays as the Dynasty never read', () => {
    const make = (): Game => {
      const g = createGame(seasonSettings('office-view-dynasty', { mode: 'dynasty' }))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      startSeasonProper(g)
      return g
    }
    const a = make()
    const b = make()
    for (let w = 0; w < 38 && a.phase !== 'summary'; w++) {
      readOffice(a)
      storeWeek(a)
      storeWeek(b)
    }
    advanceToNextSeason(a, u)
    advanceToNextSeason(b, u)
    readOffice(a)
    officeTick(a, u)
    officeTick(b, u)
    expect(a.office).toBeUndefined()
    expect(hash(a)).toBe(hash(b))
  }, 180_000)
})

describe('promise clocks', () => {
  it('count down to the verdict: a benched man falls behind, then out of reach, and the promise is broken', () => {
    let lost = 0
    for (const seed of ['office-clock-1', 'office-clock-2', 'office-clock-3']) {
      const g = seasonGame(u, seed, 4)
      const xi = new Set(Object.values(g.lineup))
      // The weakest man out of the XI, whom the week's auto-pick never puts back in (engine 9's lineups moved these seeds)
      const get = playerLookup(g, u)
      const bench = Object.keys(g.squad).filter((id) => !xi.has(id) && !g.contracts[id]?.loan).sort((x, y) => get(x)!.overall - get(y)!.overall)[0]
      expect(makePromise(g, u, bench, 'minutes').ok).toBe(true)
      const promise = g.office!.promises![0]
      const first = promiseClock(g, u, promise)
      expect(first.weeksLeft).toBe(promise.due - g.season!.matchweek)
      expect(first.track).toBe('on')
      let last = first
      let seenLost = false
      for (let w = 0; w < 6 && promise.state === 'open'; w++) {
        const slot = Object.keys(g.lineup).find((k) => g.lineup[k] === bench)
        if (slot) delete g.lineup[slot]
        storeWeek(g)
        if (promise.state !== 'open') break
        const c = promiseClock(g, u, promise)
        expect(c.weeksLeft).toBe((last.weeksLeft ?? 0) - 1)
        if (c.weeksLeft! <= 1) expect(c.urgency).toBe('due')
        expect(c.track).not.toBe('on')
        if (c.track === 'lost') seenLost = true
        last = c
      }
      expect(promise.state).toBe('broken')
      if (seenLost) lost++
      // The Happiness view names what was broken
      expect(promiseLineKind(promisesTo(g, u, bench), promise.settledAt!, false)).toBe('minutes')
      expect(promiseLineKind(promisesTo(g, u, bench), promise.settledAt!, true)).toBeNull()
    }
    expect(lost).toBeGreaterThan(0)
  }, 120_000)
})

describe('what each answer risks', () => {
  it('is what the answer then does: the refusal hits him and the men the preview names, and a talk has the stated odds', () => {
    for (const seed of ['office-risk-1', 'office-risk-2', 'office-risk-3']) {
      const g = seasonGame(u, seed, 6)
      const ids = Object.keys(g.squad).filter((id) => !g.contracts[id]?.loan)
      const [refuser, talker] = [ids[2], ids[9]]
      for (const id of [refuser, talker]) expect(lodgeRequest(g, u, id, 'morale')).not.toBeNull()
      const req = (id: string) => openRequests(g).find((r) => r.playerId === playerLookup(g, u)(id)!.playerId)!
      const risks = requestRisks(g, u, refuser, req(refuser))
      expect(risks.map((r) => r.answer)).toEqual(['talk', 'promise-minutes', 'promise-contract', 'list', 'refuse'])
      const refuse = risks.find((r) => r.answer === 'refuse')!
      const targets = rippleTargets(g, u, refuser, -2)
      expect(refuse.ripple?.men ?? 0).toBe(targets.length)
      const before = Object.fromEntries(Object.entries(g.squad).map(([id, s]) => [id, s.morale]))
      const was = JSON.stringify(g)
      requestRisks(g, u, talker, req(talker))
      expect(JSON.stringify(g)).toBe(was)
      expect(answerRequest(g, u, refuser, 'refuse').ok).toBe(true)
      const moved = Object.keys(g.squad).filter((id) => id !== refuser && g.squad[id].morale !== before[id])
      for (const id of moved) expect(targets.some((x) => x.id === id)).toBe(true)
      if (before[refuser] + refuse.lose! >= 10) expect(g.squad[refuser].morale).toBeCloseTo(before[refuser] + refuse.lose!, 5)
      const talk = requestRisks(g, u, talker, req(talker)).find((r) => r.answer === 'talk')!
      expect(talk.odds).toBe(talkOdds(g, u, req(talker), 'talk'))
      expect(requestDeadline(req(talker)).weeksLeft).toBe(3)
    }
  }, 60_000)

  it('what he thinks follows what happened: a broken promise makes him wary', () => {
    const g = seasonGame(u, 'office-read', 4)
    const id = Object.keys(g.squad).find((x) => !Object.values(g.lineup).includes(x) && !g.contracts[x]?.loan)!
    expect(playerRead(g, u, id)!.trust).toBe('neutral')
    makePromise(g, u, id, 'minutes')
    for (let w = 0; w < 7 && g.office!.promises![0].state === 'open'; w++) {
      const slot = Object.keys(g.lineup).find((k) => g.lineup[k] === id)
      if (slot) delete g.lineup[slot]
      storeWeek(g)
    }
    const read = playerRead(g, u, id)!
    expect(read.trust).toBe('wary')
    expect(read.broken).toBe(1)
  }, 60_000)
})

describe('the press and the big match', () => {
  /** A game and week whose next match is a big league one (a derby or a title decider). */
  function bigWeek(): Game {
    for (const seed of ['office-big-1', 'office-big-2', 'office-big-3', 'office-big-4', 'office-big-5', 'office-big-6']) {
      const g = seasonGame(u, seed)
      for (let w = 0; w < 37; w++) {
        const big = bigMatchOf(g, u)
        if (big && big.kind !== 'final' && big.kind !== 'semi-final') return g
        storeWeek(g)
      }
    }
    throw new Error('no big match found')
  }

  it('asks about the big match first, shows exactly what each answer does, and holds a boast to the result', () => {
    const g = bigWeek()
    const qs = pressQuestions(g, u)
    expect(qs[0]).toBe('big-match')
    expect(qs).not.toContain('opponent')
    const rng = JSON.stringify(g.rngState)
    for (const [a, fx] of Object.entries(PRESS_ANSWERS['big-match'])) expect(pressEffect(g, u, 'big-match', a)).toEqual(fx)
    const conf = g.season!.confidence
    expect(answerPress(g, u, 'big-match', BOAST_ANSWER).ok).toBe(true)
    expect(g.office!.boast?.week).toBe(g.season!.matchweek + 1)
    // The boast itself moves nothing until the match is played
    expect(g.season!.confidence).toBe(conf)
    expect(JSON.stringify(g.rngState)).toBe(rng)
    playMatchweek(g, u, true)
    if (g.phase === 'match') g.phase = 'week'
    const before = g.season!.confidence
    const news = g.season!.news.length
    const r = settleBoast(g)
    expect(r).not.toBeNull()
    expect(g.office!.boast).toBeUndefined()
    const want = r === 'W' ? BOAST_WON.board : r === 'L' ? BOAST_LOST.board : 0
    expect(g.season!.confidence).toBeCloseTo(Math.max(0, Math.min(100, before + want)), 5)
    expect(g.season!.news.length).toBe(news + 1)
    expect(isOfficeNews(g.season!.news[0])).toBe(true)
    expect(settleBoast(g)).toBeNull()
  }, 120_000)

  it('the boast, the press and the requests leave the game stream where it was', () => {
    const g = bigWeek()
    const state = JSON.stringify(g.rngState)
    for (const q of pressQuestions(g, u)) answerPress(g, u, q, Object.keys(PRESS_ANSWERS[q])[0])
    officeTick(g, u)
    expect(JSON.stringify(g.rngState)).toBe(state)
  }, 120_000)
})

describe('the office in the Inbox and the digest', () => {
  it('its items are marked, filtered under Office and grouped in the digest of a sim', () => {
    const g = seasonGame(u, 'office-digest', 6)
    const xi = new Set(Object.values(g.lineup))
    const bench = Object.keys(g.squad).find((id) => !xi.has(id) && !g.contracts[id]?.loan)!
    makePromise(g, u, bench, 'minutes')
    const snap = digestSnapshot(g)!
    const box = { g }
    // Sim on with the bench man left out: the promise breaks inside the sim and he asks to leave
    for (let w = 0; w < 7; w++) {
      const slot = Object.keys(g.lineup).find((k) => g.lineup[k] === bench)
      if (slot) delete g.lineup[slot]
      runSteps(withTick(box, u, simWeeksSteps(box, u, 1), officeTick))
    }
    const marked = g.season!.news.filter(isOfficeNews)
    expect(marked.some((n) => n.title.startsWith('Promise broken'))).toBe(true)
    expect(marked.some((n) => n.title.includes('transfer request'))).toBe(true)
    expect(filterNews(g.season!.news, 'office').map((x) => x.n)).toEqual(marked)
    const d = buildDigest(snap, g)!
    expect(d.office.some((n) => n.title.startsWith('Promise broken'))).toBe(true)
    // Nothing unmarked: an older save's items, or any other news, never land in the Office group
    expect(d.office.every(isOfficeNews)).toBe(true)
    expect(clone(d.news).filter((n) => !isOfficeNews(n)).length).toBe(d.news.length - d.news.filter(isOfficeNews).length)
  }, 120_000)
})
