import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { sidesFactory, type Sides } from './pools'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, benchAt, canChangeInPlay, changeInPlay, finishMatch, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, onPitch, onPitchAtMinute, rollBackSegment, simulateMatch, subsMade, type InPlayChange, type LivePlayer, type MatchInProgress } from '../match'
import { binOf } from '../matchDetail'
import type { MatchEvent, Tactics } from '../types'

const roundTrip = (mp: MatchInProgress): MatchInProgress => JSON.parse(JSON.stringify(mp)) as MatchInProgress
const GOALS = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const byMinute = (x: MatchEvent, y: MatchEvent) => x.minute - y.minute || x.text.localeCompare(y.text)

/** A match standing in the segment that holds minute k: 1-45 after kick-off, 46-70 after the first stop, 71-90 held after the second. */
function standingAt(seed: string, s: Sides, k: number): MatchInProgress {
  const mp = beginMatch({ rng: new Rng(seed), ...s, detail: 'full' })
  if (k >= 46) advanceMatch(mp, s, undefined, 70)
  if (k >= 71) advanceMatch(mp, s, undefined, 90)
  return mp
}

/** Play a match on from wherever it stands to the report. */
function playOut(mp: MatchInProgress, s: Sides) {
  if ((mp.clock ?? 45) < 70) advanceMatch(mp, s, undefined, 70)
  if ((mp.clock ?? 45) < 90) advanceMatch(mp, s, undefined, 90)
  return finishMatch(mp, s)
}

function sideOf(mp: MatchInProgress, side: 'home' | 'away') {
  return side === 'home' ? { snap: mp.home, live: mp.hLive, subs: mp.hSubs } : { snap: mp.away, live: mp.aLive, subs: mp.aSubs }
}

/** A fresh man off the bench and a starter still on, for a substitution at minute k. */
function aSub(mp: MatchInProgress, s: Sides, side: 'home' | 'away', k: number): { off: string; on: string } | null {
  const bench = benchAt(mp, side, k, s[side].getState).filter((id) => !sideOf(mp, side).live.some((p) => p.psId === id))
  const off = onPitchAtMinute(mp, side, k).find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red)
  return bench.length && off ? { off: off.psId, on: bench[0] } : null
}

/** Every man's stats and flags agree with the log; the pitch holds one man per slot; nobody comes back. */
function expectConsistent(mp: MatchInProgress) {
  for (const side of ['home', 'away'] as const) {
    const { live, subs } = sideOf(mp, side)
    const ids = live.map((p) => p.psId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(subs.length).toBeLessThanOrEqual(MAX_SUBS)
    expect(managerWindowsUsed(mp, side)).toBeLessThanOrEqual(MAX_WINDOWS)
    for (const p of live) {
      const own = mp.events.filter((e) => e.side === side)
      const theirs = mp.events.filter((e) => e.side !== side)
      expect(p.goals).toBe(own.filter((e) => (e.type === 'goal' || e.type === 'penalty') && e.playerId === p.psId).length)
      expect(p.assists).toBe(own.filter((e) => e.type === 'goal' && e.secondaryId === p.psId).length)
      expect(p.saves).toBe(theirs.filter((e) => e.type === 'save' && e.secondaryId === p.psId).length)
      expect(p.yellow).toBe(own.some((e) => e.type === 'yellow' && e.playerId === p.psId))
      const red = own.find((e) => e.type === 'red' && e.playerId === p.psId)
      const injury = own.find((e) => e.type === 'injury' && e.playerId === p.psId)
      const offSub = own.find((e) => e.type === 'substitution' && e.playerId === p.psId)
      const onSub = own.find((e) => e.type === 'substitution' && e.secondaryId === p.psId)
      expect(p.red).toBe(!!red)
      expect(!!p.injury).toBe(!!injury)
      expect(p.offAt).toBe(red ? red.minute : injury ? injury.minute : offSub ? offSub.minute : 90)
      expect(p.onAt).toBe(onSub ? onSub.minute : 0)
    }
    for (let m = 0; m <= 89; m++) {
      const slots = onPitchAtMinute(mp, side, m).map((p) => p.slotId)
      expect(new Set(slots).size).toBe(slots.length)
    }
  }
}

describe('changes with the ball in play', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()
  const sides = sidesFactory(u)
  const KS = [0, 12, 30, 44, 46, 58, 69, 71, 80, 89]

  it('a change that changes nothing is refused, leaves the match untouched, and the match equals simulateMatch (40 seeds × 10 minutes)', () => {
    for (let i = 0; i < 40; i++) {
      for (const k of KS) {
        const seed = `inplay-identity-${i}`
        const one = simulateMatch({ rng: new Rng(seed), ...sides(i), detail: 'full' })
        const s = sides(i)
        let mp = standingAt(seed, s, k)
        const side = i % 2 ? 'home' : 'away'
        const snap = JSON.stringify(mp)
        const t = sideOf(mp, side).snap.tactics
        const out = changeInPlay(mp, s, { side, minute: k, tactics: { ...t, roles: { ...t.roles } }, substitutions: [{ off: 'nobody', on: 'nobody-else' }] })
        expect(out.applied).toBe(false)
        expect(out.refusal).toBe('no-change')
        expect(out.refused).toHaveLength(1)
        expect(JSON.stringify(mp)).toBe(snap)
        mp = roundTrip(mp)
        const two = playOut(mp, s)
        expect(two.events).toEqual(one.events)
        expect(two.homeStats).toEqual(one.homeStats)
        expect(two.awayStats).toEqual(one.awayStats)
        expect(two.homeReport).toEqual(one.homeReport)
        expect(two.awayReport).toEqual(one.awayReport)
        expect(two.conditionLoss).toEqual(one.conditionLoss)
        expect([two.homeGoals, two.awayGoals, two.motmId]).toEqual([one.homeGoals, one.awayGoals, one.motmId])
      }
    }
  })

  it('a real change at k keeps the past as shown, never moves the match stream, and repeats exactly', () => {
    for (let i = 0; i < 30; i++) {
      for (const k of KS) {
        const seed = `inplay-past-${i}`
        const s = sides(i)
        const untouched = standingAt(seed, s, k)
        const mp = roundTrip(untouched)
        const side = i % 2 ? 'away' : 'home'
        const t = sideOf(mp, side).snap.tactics
        const flipped: Tactics = { ...t, mentality: t.mentality === 'attacking' ? 'defensive' : 'attacking', pressing: t.pressing === 'high' ? 'low' : 'high' }
        const sub = i % 3 === 0 ? aSub(mp, s, side, k) : null
        const change: InPlayChange = { side, minute: k, tactics: flipped, substitutions: sub ? [sub] : [] }
        const twin = roundTrip(mp)
        const out = changeInPlay(mp, s, change)
        expect(out.applied).toBe(true)
        if (sub && !out.refused.length) expect(out.made).toHaveLength(1)
        const past = (x: MatchInProgress) => x.events.filter((e) => e.minute <= k && !(e.type === 'substitution' && e.minute === k && e.text.startsWith(`Change on ${k} minutes`))).sort(byMinute)
        expect(past(mp)).toEqual(past(untouched))
        expect((mp.momentum ?? []).slice(0, binOf(k) + 1)).toEqual((untouched.momentum ?? []).slice(0, binOf(k) + 1))
        expect(mp.rngState).toEqual(untouched.rngState)
        expect(mp.segment).toEqual(untouched.segment)
        expect(mp.clock).toBe(untouched.clock)
        // Nothing after k was shown, and the replayed stretch stays inside the segment
        for (const e of mp.events.slice(untouched.segment!.eventStart)) if (e.type !== 'half_time') expect(e.minute).toBeLessThanOrEqual(mp.segment!.to >= 90 ? 94 : mp.segment!.to)
        changeInPlay(twin, s, change)
        expect(JSON.stringify(twin)).toBe(JSON.stringify(mp))
        expectConsistent(mp)
        // It plays on to a full report
        const r = playOut(mp, s)
        expect(r.homeStats.length).toBeGreaterThanOrEqual(11)
        expect(r.halfTimeScore).toEqual(currentAt(r.events, 45))
      }
    }
  })

  it('stays consistent through many changes at random minutes, with substitutions, through the stops and the hold', () => {
    for (let i = 0; i < 60; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`inplay-many-${i}`), ...s, detail: 'full' })
      const pick = new Rng(`inplay-many-pick-${i}`)
      const side = i % 2 ? 'home' : 'away'
      const changesIn = (lo: number, hi: number) => {
        let m = lo
        for (let n = 0; n < 3; n++) {
          m = pick.int(m, hi)
          const t = sideOf(mp, side).snap.tactics
          const sub = pick.chance(0.6) ? aSub(mp, s, side, m) : null
          changeInPlay(mp, s, { side, minute: m, tactics: { ...t, tempo: pick.pick(['slow', 'standard', 'fast'] as const), width: pick.pick(['narrow', 'standard', 'wide'] as const) }, substitutions: sub ? [sub] : [] })
          expectConsistent(mp)
        }
      }
      changesIn(1, 44)
      advanceMatch(mp, s, { side }, 70)
      expectConsistent(mp)
      changesIn(46, 69)
      advanceMatch(mp, s, { side }, 90)
      changesIn(71, 89)
      expectConsistent(mp)
      const r = finishMatch(mp, s)
      expect(r.homeGoals).toBe(r.events.filter((e) => GOALS.has(e.type) && e.side === 'home').length)
      expect(r.awayGoals).toBe(r.events.filter((e) => GOALS.has(e.type) && e.side === 'away').length)
      expect(r.timeline!.length).toBeGreaterThan(2)
    }
  })

  it('rolling the whole segment back restores the pitch it started from, with its routine changes parked at their minutes', () => {
    let parked = 0
    for (let i = 0; i < 40; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`inplay-rollback-${i}`), ...s, detail: 'full' })
      const kickOff = roundTrip(mp)
      rollBackSegment(kickOff, 0)
      expect(kickOff.events.map((e) => e.type)).toEqual(['kickoff', 'half_time'])
      expect(kickOff.hLive.every((p) => p.onAt === 0 && p.offAt === 90 && !p.yellow && !p.red && !p.injury && !p.goals && !p.assists && !p.saves)).toBe(true)
      expect(kickOff.hSubs).toEqual([])
      const at45 = roundTrip(mp)
      advanceMatch(mp, s, undefined, 70)
      const routine = (subs: typeof mp.hSubs) => subs.filter((x) => x.minute > 45 && (x.reason === 'tired' || x.reason === 'tactical'))
      const madeHome = routine(mp.hSubs)
      const madeAway = routine(mp.aSubs)
      const parkedHome = mp.pendingSubs!.home.length
      rollBackSegment(mp, 45)
      expect(mp.hLive).toEqual(at45.hLive)
      expect(mp.aLive).toEqual(at45.aLive)
      expect(mp.hSubs).toEqual(at45.hSubs)
      expect(mp.aSubs).toEqual(at45.aSubs)
      expect(mp.events).toEqual(at45.events)
      expect(mp.pendingSubs!.home).toHaveLength(parkedHome + madeHome.length)
      for (const x of [...madeHome, ...madeAway]) expect([...mp.pendingSubs!.home, ...mp.pendingSubs!.away]).toContainEqual(x)
      parked += madeHome.length + madeAway.length
    }
    expect(parked).toBeGreaterThan(10)
  })

  it('changes do what they say over 300 seeds: attacking from 20 scores more after 20, shut up shop from 75 quietens both sides, a sub at 60 comes on at 60', () => {
    const n = 300
    let base = 0
    let attacking = 0
    let lateBase = { own: 0, opp: 0 }
    let lateShut = { own: 0, opp: 0 }
    let subsAt60 = 0
    for (let i = 0; i < n; i++) {
      const s = sides(i, { home: 'defensive', away: 'balanced' })
      const seed = `inplay-effects-${i}`
      const after = (events: MatchEvent[], from: number, side: 'home' | 'away') => events.filter((e) => GOALS.has(e.type) && e.side === side && e.minute > from).length
      base += after(simulateMatch({ rng: new Rng(seed), ...sides(i, { home: 'defensive', away: 'balanced' }) }).events, 20, 'home')
      const mp = standingAt(seed, s, 20)
      expect(changeInPlay(mp, s, { side: 'home', minute: 20, tactics: { ...mp.home.tactics, mentality: 'attacking' } }).applied).toBe(true)
      attacking += after(playOut(mp, s).events, 20, 'home')

      const held = standingAt(seed, s, 75)
      const control = roundTrip(held)
      expect(changeInPlay(held, s, { side: 'home', minute: 75, shout: 'shut-up-shop' }).applied).toBe(true)
      const shut = finishMatch(held, s)
      const ctl = finishMatch(control, s)
      lateShut.own += after(shut.events, 75, 'home')
      lateShut.opp += after(shut.events, 75, 'away')
      lateBase.own += after(ctl.events, 75, 'home')
      lateBase.opp += after(ctl.events, 75, 'away')
      expect(shut.homeReport.lateEffect).toBeTruthy()

      const sixty = standingAt(seed, s, 60)
      const sub = aSub(sixty, s, 'home', 60)
      if (sub) {
        const out = changeInPlay(sixty, s, { side: 'home', minute: 60, substitutions: [sub] })
        if (out.made.length) {
          expect(out.made).toEqual([{ minute: 60, off: sub.off, on: sub.on, reason: 'manager' }])
          const on = sixty.hLive.find((p) => p.psId === sub.on)!
          expect(on.onAt).toBe(60)
          expect(sixty.hLive.find((p) => p.psId === sub.off)!.offAt).toBe(60)
          expect(onPitchAtMinute(sixty, 'home', 61).some((p) => p.psId === sub.on)).toBe(true)
          expect(sixty.events.some((e) => e.type === 'substitution' && e.minute === 60 && e.secondaryId === sub.on)).toBe(true)
          subsAt60++
        } else expect(out.refused[0].why).toBe('no-subs-left')
      }
    }
    console.log(`goals after 20: ${base} untouched, ${attacking} attacking; after 75: ${JSON.stringify(lateBase)} untouched, ${JSON.stringify(lateShut)} shut up shop`)
    expect(attacking).toBeGreaterThan(base * 1.08)
    expect(lateShut.own).toBeLessThan(lateBase.own * 0.8)
    expect(lateShut.opp).toBeLessThan(lateBase.opp * 0.9)
    expect(subsAt60).toBeGreaterThan(n * 0.9)
  })

  it('refuses with the right reason: a shout before 70, stoppage time, the past, a fourth window, a sixth change, an old save, a summary match', () => {
    const s = sides(1)
    const mp = standingAt('inplay-rules', s, 30)
    // A shout before 70 is refused on its own; instructions with it still apply
    const shoutOnly = changeInPlay(mp, s, { side: 'home', minute: 30, shout: 'all-out-attack' })
    expect(shoutOnly).toMatchObject({ applied: false, refusal: 'no-change', shoutRefused: true })
    const withTactics = changeInPlay(mp, s, { side: 'home', minute: 30, shout: 'all-out-attack', tactics: { ...mp.home.tactics, tempo: mp.home.tactics.tempo === 'fast' ? 'slow' : 'fast' } })
    expect(withTactics).toMatchObject({ applied: true, shoutRefused: true })
    expect(mp.home.shout).toBeUndefined()
    // The past
    expect(changeInPlay(mp, s, { side: 'home', minute: 20, tactics: { ...mp.home.tactics, width: 'wide' } }).refusal).toBe('in-the-past')
    // The other side is not held back by our change
    expect(changeInPlay(mp, s, { side: 'away', minute: 20, tactics: { ...mp.away.tactics, width: mp.away.tactics.width === 'wide' ? 'narrow' : 'wide' } }).applied).toBe(true)
    // Outside the segment in play and the stops
    expect(changeInPlay(mp, s, { side: 'home', minute: 45, tactics: { ...mp.home.tactics, width: 'wide' } }).refusal).toBe('outside-segment')
    expect(changeInPlay(mp, s, { side: 'home', minute: 50, tactics: { ...mp.home.tactics, width: 'wide' } }).refusal).toBe('outside-segment')

    // Windows and changes: three changes at the break are free, then two windows, then nothing left
    const w = standingAt('inplay-windows', s, 0)
    const breakSubs = [0, 1, 2].map(() => null as { off: string; on: string } | null)
    const used = new Set<string>()
    for (let n = 0; n < 3; n++) {
      const bench = benchAt(w, 'home', 45, s.home.getState).filter((id) => !used.has(id) && !w.hLive.some((p) => p.psId === id))
      const off = onPitch(w, 'home').find((p) => p.position !== 'GK' && !used.has(p.psId))!
      breakSubs[n] = { off: off.psId, on: bench[0] }
      used.add(off.psId)
      used.add(bench[0])
    }
    advanceMatch(w, s, { side: 'home', substitutions: breakSubs.filter((x): x is { off: string; on: string } => !!x) }, 70)
    expect(managerWindowsUsed(w, 'home')).toBe(0)
    let minute = 46
    let refusedWhy: string | undefined
    while (minute < 69 && !refusedWhy) {
      const sub = aSub(w, s, 'home', minute)
      if (!sub) break
      const out = changeInPlay(w, s, { side: 'home', minute, substitutions: [sub], tactics: { ...w.home.tactics, passing: w.home.tactics.passing === 'short' ? 'direct' : 'short' } })
      expect(out.applied).toBe(true)
      if (out.refused.length) refusedWhy = out.refused[0].why
      minute += 3
    }
    expect(refusedWhy).toBe('no-subs-left')
    expect(subsMade(w, 'home')).toBe(MAX_SUBS)

    // A fourth window: three in-play windows from 46 on, then the fourth is refused while its instructions apply
    let fourth = 0
    for (let i = 0; i < 20 && !fourth; i++) {
      const x = standingAt(`inplay-fourth-${i}`, s, 46)
      const ks = [47, 52, 57]
      const firstThree = ks.map((k) => {
        const sub = aSub(x, s, 'home', k)
        return sub ? changeInPlay(x, s, { side: 'home', minute: k, substitutions: [sub], tactics: { ...x.home.tactics, tempo: k % 2 ? 'fast' : 'slow' } }) : null
      })
      if (firstThree.some((o) => !o || o.made.length !== 1) || subsMade(x, 'home', 62) >= MAX_SUBS) continue
      expect(managerWindowsUsed(x, 'home')).toBe(MAX_WINDOWS)
      const sub = aSub(x, s, 'home', 62)
      if (!sub) continue
      const out = changeInPlay(x, s, { side: 'home', minute: 62, substitutions: [sub], tactics: { ...x.home.tactics, tempo: 'slow' } })
      expect(out.applied).toBe(true)
      expect(out.refused).toEqual([{ ...sub, why: 'no-window' }])
      expect(x.home.tactics.tempo).toBe('slow')
      expect(managerWindowsUsed(x, 'home')).toBe(MAX_WINDOWS)
      fourth++
    }
    expect(fourth).toBe(1)

    // Stoppage time and the whistle
    const held = standingAt('inplay-rules', s, 80)
    expect(changeInPlay(held, s, { side: 'home', minute: 90, tactics: { ...held.home.tactics, width: 'wide' } }).refusal).toBe('too-late')
    expect(changeInPlay(held, s, { side: 'home', minute: 92, tactics: { ...held.home.tactics, width: 'wide' } }).refusal).toBe('too-late')
    expect(canChangeInPlay(held, 89)).toEqual({ ok: true, nextStop: null })
    // An old save without the segment waits for the stop
    const old = standingAt('inplay-rules', s, 30)
    delete old.segment
    expect(canChangeInPlay(old, 30)).toEqual({ ok: false, refusal: 'no-segment', nextStop: 45 })
    expect(changeInPlay(old, s, { side: 'home', minute: 30, tactics: { ...old.home.tactics, width: 'wide' } }).refusal).toBe('no-segment')
    // A summary match cannot be cut
    const summary = beginMatch({ rng: new Rng('inplay-summary'), ...s, detail: 'summary' })
    expect(summary.segment).toBeUndefined()
    expect(changeInPlay(summary, s, { side: 'home', minute: 30, tactics: { ...summary.home.tactics, width: 'wide' } }).refusal).toBe('summary-match')
  })

  it('a substitution needs the ball in play, and a man who has just come on cannot go straight off', () => {
    let checked = 0
    for (let i = 0; i < 12; i++) {
      const s = sides(i)
      const mp = standingAt(`inplay-kickoff-${i}`, s, 0)
      const sub = aSub(mp, s, 'home', 0)
      if (!sub) continue
      const t = mp.home.tactics
      const snap = JSON.stringify(mp)
      // At 0 the substitution is refused and nothing else changes, so the match is untouched
      expect(changeInPlay(mp, s, { side: 'home', minute: 0, substitutions: [sub] })).toEqual({ applied: false, refusal: 'no-change', made: [], refused: [{ ...sub, why: 'before-kick-off' }] })
      expect(JSON.stringify(mp)).toBe(snap)
      // Instructions at 0 still apply from the first minute, and the starters stay the starters
      const out = changeInPlay(mp, s, { side: 'home', minute: 0, substitutions: [sub], tactics: { ...t, width: t.width === 'wide' ? 'narrow' : 'wide' } })
      expect(out).toMatchObject({ applied: true, made: [], refused: [{ ...sub, why: 'before-kick-off' }] })
      expect(mp.hLive.filter((p) => p.onAt === 0)).toHaveLength(11)
      // On at 20, and straight off again at 20: refused; a minute later he can go
      const at20 = changeInPlay(mp, s, { side: 'home', minute: 20, substitutions: [sub] })
      if (!at20.made.length) continue
      const next = benchAt(mp, 'home', 20, s.home.getState).find((id) => !mp.hLive.some((p) => p.psId === id))
      if (!next) continue
      expect(changeInPlay(mp, s, { side: 'home', minute: 20, substitutions: [{ off: sub.on, on: next }] }).refused).toEqual([{ off: sub.on, on: next, why: 'not-on-pitch' }])
      if (mp.hLive.find((p) => p.psId === sub.on)!.offAt < 90) continue
      expect(changeInPlay(mp, s, { side: 'home', minute: 21, substitutions: [{ off: sub.on, on: next }] }).made).toHaveLength(1)
      expectConsistent(mp)
      checked++
    }
    expect(checked).toBeGreaterThan(6)
  })

  it('a shout after 70 plays the rest under it and survives a later cut; the bench and the pitch at a minute follow the log', () => {
    const s = sides(5)
    const mp = beginMatch({ rng: new Rng('inplay-shout'), ...s, detail: 'full' })
    advanceMatch(mp, s, { side: 'home', shout: 'all-out-attack' }, 70)
    advanceMatch(mp, s, { side: 'home', shout: 'all-out-attack' }, 90)
    expect(mp.home.shout).toBe('all-out-attack')
    const fatigue = mp.home.modifiers.fatigue
    expect(changeInPlay(mp, s, { side: 'home', minute: 80, tactics: { ...mp.home.tactics, width: mp.home.tactics.width === 'wide' ? 'narrow' : 'wide' } }).applied).toBe(true)
    // The shout's legs are paid once, not twice
    expect(mp.home.modifiers.fatigue).toBe(fatigue)
    expect(changeInPlay(mp, s, { side: 'home', minute: 82, shout: 'shut-up-shop' }).applied).toBe(true)
    expect(mp.home.shout).toBe('shut-up-shop')
    expect(mp.timeline!.filter((e) => e.by === 'manager' && e.shout).map((e) => [e.minute, e.shout])).toEqual([[70, 'all-out-attack'], [82, 'shut-up-shop']])
    const on70 = onPitchAtMinute(mp, 'home', 70).map((p: LivePlayer) => p.psId)
    expect(on70).toHaveLength(onPitchAtMinute(mp, 'home', 70).length)
    for (const id of benchAt(mp, 'home', 70, s.home.getState)) expect(on70).not.toContain(id)
  })

  it('the changes made by minute k are the ones a cut at k keeps: changes decided later in the segment are not spent yet', () => {
    let ahead = 0
    for (let i = 0; i < 80; i++) {
      for (const k of [12, 50, 63, 75]) {
        const mp = standingAt(`inplay-count-${i}`, sides(i), k)
        for (const side of ['home', 'away'] as const) {
          const cut = roundTrip(mp)
          rollBackSegment(cut, k)
          expect(subsMade(mp, side, k)).toBe(subsMade(cut, side))
          if (subsMade(mp, side) > subsMade(mp, side, k)) ahead++
        }
      }
    }
    // Routine and injury changes are decided ahead of the clock often enough for the difference to matter
    expect(ahead).toBeGreaterThan(20)
  })

  it('a cut in the last minutes never writes an event at or before its minute (injuries stop at 88)', () => {
    const s = sides(0)
    let replayed = 0
    for (let i = 0; i < 400; i++) {
      for (const k of [87, 88, 89]) {
        const mp = standingAt(`inplay-late-${i}`, s, k)
        const before = new Set(mp.events.filter((e) => e.minute <= k).map((e) => JSON.stringify(e)))
        const t = mp.home.tactics
        expect(changeInPlay(mp, s, { side: 'home', minute: k, tactics: { ...t, mentality: t.mentality === 'attacking' ? 'defensive' : 'attacking' } }).applied).toBe(true)
        for (const e of mp.events) if (e.minute <= k) expect(before.has(JSON.stringify(e))).toBe(true)
        replayed++
      }
    }
    expect(replayed).toBe(1200)
  })

  it('keeps the new match fields small and only on full-detail matches', () => {
    const s = sides(2)
    const r = simulateMatch({ rng: new Rng('inplay-size'), ...s, detail: 'full' })
    expect(r.seedKey).toMatch(/^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/)
    // A side whose instructions never changed keeps no kick-off entry in the result: its final tactics say it
    for (const side of ['home', 'away'] as const) {
      const changed = r.timeline!.some((e) => e.side === side && e.by !== 'kickoff' && (e.instructions || e.setPieces))
      expect(r.timeline!.some((e) => e.side === side && e.by === 'kickoff')).toBe(changed)
    }
    let total = 0
    for (let i = 0; i < 60; i++) {
      const x = simulateMatch({ rng: new Rng(`inplay-size-${i}`), ...sides(i), detail: 'full' })
      const bytes = JSON.stringify({ timeline: x.timeline, seedKey: x.seedKey }).length
      expect(bytes).toBeLessThan(512)
      total += bytes
    }
    expect(total / 60).toBeLessThan(400)
    const summary = simulateMatch({ rng: new Rng('inplay-size'), ...sides(2), detail: 'summary' })
    expect(summary.timeline).toBeUndefined()
    expect(summary.seedKey).toBeUndefined()
  })
})

function currentAt(events: MatchEvent[], minute: number) {
  const g = events.filter((e) => GOALS.has(e.type) && e.minute <= minute)
  return { home: g.filter((e) => e.side === 'home').length, away: g.filter((e) => e.side === 'away').length }
}
