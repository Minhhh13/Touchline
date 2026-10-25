import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, currentScore, finishMatch, onPitch, simulateMatch, teamInputFromPool, type MatchInProgress, type MatchTeamInput } from '../match'
import { tacticsForStyle } from '../tactics'
import type { PlayerSeason } from '../types'

/** Best distinct players per position within an overall band, so every slot has a natural fit. */
function bestXIpool(all: PlayerSeason[], minOverall: number, maxOverall: number): PlayerSeason[] {
  const seen = new Set<string>()
  const pool: PlayerSeason[] = []
  const perPos: Record<string, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 }
  const sorted = all.filter((p) => p.overall >= minOverall && p.overall <= maxOverall).sort((a, b) => b.overall - a.overall)
  for (const pos of Object.keys(perPos)) {
    let n = 0
    for (const p of sorted) {
      if (n >= perPos[pos]) break
      if (seen.has(p.playerId) || p.positions[0] !== pos) continue
      seen.add(p.playerId)
      pool.push(p)
      n++
    }
  }
  return pool
}

describe('match engine', () => {
  const u = loadTestUniverse()
  const all = Object.values(u.index)
  const elite = bestXIpool(all, 86, 99)
  const mid = bestXIpool(all, 72, 76)
  const weak = bestXIpool(all, 62, 66)

  it('elite side beats a mid-table side most of the time, and never produces NaN', () => {
    const rng = new Rng('match-1')
    let wins = 0
    let draws = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite)
      const away = teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('balanced', '4-2-3-1'), mid)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      expect(Number.isFinite(r.homeGoals)).toBe(true)
      expect(Number.isFinite(r.xg.home)).toBe(true)
      if (r.homeGoals > r.awayGoals) wins++
      else if (r.homeGoals === r.awayGoals) draws++
    }
    const winRate = wins / n
    console.log(`elite(home) v mid: win ${(winRate * 100).toFixed(1)}% draw ${((draws / n) * 100).toFixed(1)}%`)
    expect(winRate).toBeGreaterThan(0.72)
    expect(winRate).toBeLessThan(0.97)
  })

  it('elite side away at a weak side wins very often', () => {
    const rng = new Rng('match-2')
    let wins = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('W', 'Weak', 'WEA', tacticsForStyle('defensive', '5-3-2'), weak)
      const away = teamInputFromPool('E', 'Elite', 'ELI', tacticsForStyle('press', '4-3-3'), elite)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      if (r.awayGoals > r.homeGoals) wins++
    }
    console.log(`elite(away) v weak: win ${((wins / n) * 100).toFixed(1)}%`)
    expect(wins / n).toBeGreaterThan(0.8)
  })

  it('equal sides are roughly symmetric with a home edge', () => {
    const rng = new Rng('match-3')
    let hw = 0
    let aw = 0
    const n = 600
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), mid)
      const away = teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), mid)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      if (r.homeGoals > r.awayGoals) hw++
      else if (r.awayGoals > r.homeGoals) aw++
    }
    console.log(`equal: home ${((hw / n) * 100).toFixed(1)}% away ${((aw / n) * 100).toFixed(1)}% draw ${(((n - hw - aw) / n) * 100).toFixed(1)}%`)
    expect(hw).toBeGreaterThan(aw)
    expect(hw / n).toBeLessThan(0.6)
  })

  it('produces a coherent event timeline', () => {
    const rng = new Rng('match-4')
    const home = teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite)
    const away = teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('counter', '4-2-3-1'), mid)
    const r = simulateMatch({ rng, home, away, detail: 'full' })
    const goals = r.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
    expect(goals.filter((e) => e.side === 'home').length).toBe(r.homeGoals)
    expect(goals.filter((e) => e.side === 'away').length).toBe(r.awayGoals)
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].minute).toBeGreaterThanOrEqual(r.events[i - 1].minute)
    expect(r.events.at(-1)?.type).toBe('full_time')
    expect(r.homeStats.length).toBeGreaterThanOrEqual(11)
    for (const s of [...r.homeStats, ...r.awayStats]) {
      expect(s.rating).toBeGreaterThanOrEqual(4.5)
      expect(s.rating).toBeLessThanOrEqual(10)
    }
  })

  // Pinned over 2,000 seeded matches on the same rotation of sides and styles (seed
  // 'window-baseline'). History: the two-half engine measured 3.982 goals, 2.449 cards and
  // 0.3745 injuries a match; the three-segment engine 4.027, 2.446 and 0.3755 (within 3%).
  // The depth engine (ENGINE_VERSION 4) re-pins at 4.122, 2.812 and 0.3935: cards rose by
  // 15% because every card scales by 0.7 + 0.6 × aggression / 100 and outfield aggression
  // averages about 68 (a factor near 1.11, applied to the second yellow and the straight
  // red too); goals rose 2.4% on the three-segment figure, about half a per cent of it
  // from the aerial set-piece term and the rest a different random stream (1.5σ at this
  // sample size); injuries use the same formula when no live state is passed, so their
  // 4.8% is stream noise (1.3σ). A later change that moves any of these by 3% is noticed.
  const BASELINE = { goals: 4.122, cards: 2.812, injuries: 0.3935 }
  const TOLERANCE = 0.03

  it('keeps goal, card and injury means within 3% of the depth engine\'s pinned values over 2,000 seeded matches', () => {
    const pools = [elite, mid, weak]
    const styles = ['balanced', 'press', 'counter', 'defensive'] as const
    const rng = new Rng('window-baseline')
    const n = 2000
    let goals = 0
    let cards = 0
    let injuries = 0
    let lateCards = 0
    let lateInjuries = 0
    for (let i = 0; i < n; i++) {
      const home = teamInputFromPool('H', 'Home', 'HOM', tacticsForStyle(styles[i % 4], '4-3-3'), pools[i % 3])
      const away = teamInputFromPool('A', 'Away', 'AWA', tacticsForStyle(styles[(i >> 2) % 4], '4-2-3-1'), pools[(i + 1) % 3])
      const r = simulateMatch({ rng, home, away, detail: i % 2 ? 'full' : 'summary' })
      goals += r.homeGoals + r.awayGoals
      for (const e of r.events) {
        if (e.type === 'yellow' || e.type === 'red') {
          cards++
          if (e.minute > 70) lateCards++
        } else if (e.type === 'injury') {
          injuries++
          if (e.minute > 70) lateInjuries++
        }
      }
    }
    const means = { goals: goals / n, cards: cards / n, injuries: injuries / n }
    console.log(`means over ${n}: goals ${means.goals.toFixed(3)} cards ${means.cards.toFixed(3)} injuries ${means.injuries.toFixed(4)}`)
    for (const k of ['goals', 'cards', 'injuries'] as const) {
      expect(Math.abs(means[k] - BASELINE[k]) / BASELINE[k]).toBeLessThan(TOLERANCE)
    }
    // Discipline and injuries are spread by minutes: the last twenty carry about 20/90 of them
    expect(lateCards / cards).toBeGreaterThan(0.19)
    expect(lateCards / cards).toBeLessThan(0.26)
    expect(lateInjuries / injuries).toBeGreaterThan(0.17)
    expect(lateInjuries / injuries).toBeLessThan(0.28)
  })

  /** Serialise and parse, as a paused match saved to localStorage is. */
  const roundTrip = (mp: MatchInProgress): MatchInProgress => JSON.parse(JSON.stringify(mp)) as MatchInProgress

  it('a match through simulateMatch and through beginMatch, advanceMatch(70) and finishMatch is identical event for event', () => {
    for (let i = 0; i < 40; i++) {
      const seed = `identity-${i}`
      const sides = () => ({
        home: teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle(i % 2 ? 'balanced' : 'press', '4-3-3'), i % 3 ? elite : mid),
        away: teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle(i % 3 ? 'counter' : 'defensive', '4-2-3-1'), i % 3 ? mid : weak),
      })
      const one = simulateMatch({ rng: new Rng(seed), ...sides(), detail: i % 2 ? 'full' : 'summary' })
      const split = sides()
      const rng = new Rng(seed)
      let mp = beginMatch({ rng, home: split.home, away: split.away, detail: i % 2 ? 'full' : 'summary' })
      expect(mp.clock).toBe(45)
      mp = roundTrip(mp)
      advanceMatch(mp, split, undefined, 70)
      expect(mp.clock).toBe(70)
      mp = roundTrip(mp)
      const two = finishMatch(mp, split)
      expect(two.events).toEqual(one.events)
      expect(two.homeStats).toEqual(one.homeStats)
      expect(two.awayStats).toEqual(one.awayStats)
      expect(two.homeReport).toEqual(one.homeReport)
      expect(two.awayReport).toEqual(one.awayReport)
      expect(two.conditionLoss).toEqual(one.conditionLoss)
      expect([two.homeGoals, two.awayGoals, two.motmId]).toEqual([one.homeGoals, one.awayGoals, one.motmId])
    }
  })

  it('advancing to 70 plays only the 46th to 70th minutes and is a no-op once there', () => {
    const rng = new Rng('clock-1')
    const home = teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite)
    const away = teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('balanced', '4-2-3-1'), mid)
    const mp = beginMatch({ rng, home, away })
    const firstHalf = mp.events.length
    for (const e of mp.events) expect(e.minute).toBeLessThanOrEqual(45)
    advanceMatch(mp, { home, away }, undefined, 70)
    const added = mp.events.slice(firstHalf)
    expect(added.length).toBeGreaterThan(0)
    for (const e of added) {
      expect(e.minute).toBeGreaterThanOrEqual(46)
      expect(e.minute).toBeLessThanOrEqual(70)
    }
    const snapshot = JSON.stringify(mp)
    advanceMatch(mp, { home, away }, undefined, 70)
    expect(JSON.stringify(mp)).toBe(snapshot)
    expect(currentScore(mp)).toEqual({ home: mp.events.filter((e) => e.side === 'home' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length, away: mp.events.filter((e) => e.side === 'away' && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')).length })
  })

  it('a paused match saved without a clock resumes at 45 and finishes exactly as one with it', () => {
    const sides = () => ({
      home: teamInputFromPool('A', 'Elite', 'ELI', tacticsForStyle('balanced', '4-3-3'), elite),
      away: teamInputFromPool('B', 'Mid', 'MID', tacticsForStyle('counter', '4-2-3-1'), mid),
    })
    const a = sides()
    const withClock = beginMatch({ rng: new Rng('old-save'), ...a })
    const b = sides()
    const legacy = beginMatch({ rng: new Rng('old-save'), ...b })
    // An older save never wrote these fields
    delete legacy.clock
    delete legacy.pendingSubs
    const resumed = roundTrip(legacy)
    advanceMatch(resumed, b, { side: 'home', talk: 'fire-up' }, 70)
    expect(resumed.clock).toBe(70)
    expect(resumed.events.some((e) => e.minute > 45 && e.minute <= 70)).toBe(true)
    const r1 = finishMatch(withClock, a, { side: 'home', talk: 'fire-up' })
    const r2 = finishMatch(resumed, b, { side: 'home' })
    expect(r2.events).toEqual(r1.events)
    expect(r2.homeReport.halfTimeEffect).toBe(r1.homeReport.halfTimeEffect)
  })

  /** A seeded match standing at 70 with the human at home, as a fresh copy per call. */
  function at70(seed: string, a: { home: MatchTeamInput; away: MatchTeamInput }): MatchInProgress {
    const mp = beginMatch({ rng: new Rng(seed), ...a })
    advanceMatch(mp, a, { side: 'home', talk: 'encourage' }, 70)
    return mp
  }

  it('shouts cost both ways for the last twenty minutes only', () => {
    const a = { home: teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), mid), away: teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), mid) }
    const base = at70('shout-base', a)
    const late = { 'all-out-attack': { own: 0, opp: 0 }, 'shut-up-shop': { own: 0, opp: 0 }, 'keep-shape': { own: 0, opp: 0 } }
    const n = 400
    for (const shout of ['all-out-attack', 'shut-up-shop', 'keep-shape'] as const) {
      for (let i = 0; i < n; i++) {
        const mp = roundTrip(base)
        mp.rngState = new Rng(`shout-${i}`).getState()
        const r = finishMatch(mp, a, { side: 'home', shout })
        const goals = r.events.filter((e) => e.minute > 70 && (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal'))
        late[shout].own += goals.filter((e) => e.side === 'home').length
        late[shout].opp += goals.filter((e) => e.side === 'away').length
        // Nothing before the 70th minute moves (the report sorts by minute), and the shout is reported
        const byMinute = (x: { minute: number; text: string }, y: { minute: number; text: string }) => x.minute - y.minute || x.text.localeCompare(y.text)
        expect([...r.events.filter((e) => e.minute <= 70)].sort(byMinute)).toEqual([...base.events.filter((e) => e.minute <= 70)].sort(byMinute))
        expect(r.homeReport.lateEffect).toBeTruthy()
        expect(r.awayReport.lateEffect).toBeUndefined()
        expect(r.homeReport.modifiers.fatigue - base.home.modifiers.fatigue).toBe(shout === 'all-out-attack' ? 4 : 0)
      }
    }
    console.log(`late goals over ${n} each: ${JSON.stringify(late)}`)
    expect(late['all-out-attack'].own).toBeGreaterThan(late['keep-shape'].own)
    expect(late['all-out-attack'].opp).toBeGreaterThan(late['keep-shape'].opp)
    expect(late['shut-up-shop'].own).toBeLessThan(late['keep-shape'].own)
    expect(late['shut-up-shop'].opp).toBeLessThan(late['keep-shape'].opp)
  })

  it('routine changes due after 70 wait for the window; the manager making his own drops his, the AI keeps its', () => {
    const a = { home: teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), mid), away: teamInputFromPool('B', 'B', 'B', tacticsForStyle('press', '4-2-3-1'), mid) }
    let found = 0
    for (let i = 0; i < 60 && found < 5; i++) {
      const mp = at70(`pending-${i}`, a)
      const pending = mp.pendingSubs!
      if (!pending.home.length || !pending.away.length) continue
      found++
      for (const side of ['home', 'away'] as const) {
        for (const s of pending[side]) {
          expect(s.minute).toBeGreaterThan(70)
          // Not on his side's pitch yet at the stop (both sides draw on the same pool here)
          expect(onPitch(mp, side).some((p) => p.psId === s.on)).toBe(false)
        }
      }
      // The manager brings on a fresh man himself
      const live = onPitch(mp, 'home')
      const off = live.find((p) => p.position !== 'GK' && p.onAt === 0)!
      const on = a.home.bench.find((id) => !mp.hLive.some((p) => p.psId === id))!
      const awayPending = pending.away.map((s) => s.on)
      const r = finishMatch(mp, a, { side: 'home', substitutions: [{ off: off.psId, on }], shout: 'keep-shape' })
      const ours = r.homeReport.substitutions.filter((s) => s.minute >= 70)
      expect(ours).toHaveLength(1)
      expect(ours[0]).toMatchObject({ minute: 70, off: off.psId, on, reason: '70th minute' })
      // The AI's parked changes went ahead unless the last twenty minutes overtook them
      const theirs = r.awayReport.substitutions.filter((s) => s.minute > 70)
      for (const s of theirs) expect(awayPending).toContain(s.on)
      expect(mp.pendingSubs!.home).toHaveLength(0)
      expect(mp.pendingSubs!.away).toHaveLength(0)
    }
    expect(found).toBeGreaterThan(0)
  })

  it('the AI side goes for it when behind at 70 and protects a one-goal lead', () => {
    const a = { home: teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), elite), away: teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-2-3-1'), mid) }
    let trailing = 0
    let narrow = 0
    for (let i = 0; i < 80 && (trailing < 3 || narrow < 3); i++) {
      const mp = at70(`react-${i}`, a)
      const s = currentScore(mp)
      const before = mp.away.tactics
      finishMatch(mp, a, { side: 'home', shout: 'keep-shape' })
      if (s.away < s.home) {
        trailing++
        expect(mp.away.tactics.mentality).toBe('attacking')
        expect(mp.away.tactics.tempo).toBe('fast')
      } else if (s.away - s.home === 1) {
        narrow++
        expect(mp.away.tactics.mentality).toBe('defensive')
        expect(mp.away.tactics.defensiveLine).toBe('deep')
      } else {
        expect(mp.away.tactics).toEqual(before)
      }
      // The human side is never touched by the AI rule
      expect(mp.home.tactics).toEqual(a.home.tactics)
    }
    expect(trailing).toBeGreaterThan(0)
  })
})
