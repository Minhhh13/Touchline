import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { bestXIpool, sidesFactory } from './pools'
import { Rng } from '../rng'
import { advanceMatch, beginMatch, changeInPlay, simulateMatch, teamInputFromPool, type FullMatchResult } from '../match'
import { feedFromLive, feedFromResult, type MatchFeed } from '../matchFeed'
import { isAttempt, possessionBase, shotXg, statsAt, statsSeries, XG_KAPPA, XG_NO_POSITION, xgStory, type TeamStatLine } from '../matchStats'
import { tacticsForStyle } from '../tactics'
import type { MatchEvent, Tactics } from '../types'

const ON_TARGET = new Set<MatchEvent['type']>(['goal', 'penalty', 'save'])

/** The same feed with one side's kick-off instructions replaced, for comparing instructions on identical matches. */
function withKickOff(feed: MatchFeed, side: 'home' | 'away', patch: Partial<Tactics>): MatchFeed {
  return { ...feed, timeline: feed.timeline.map((e) => (e.side === side && e.by === 'kickoff' ? { ...e, instructions: { ...e.instructions, ...patch } } : e)) }
}

describe('match stats minute by minute', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()
  const get = (id: string) => u.index[id]
  const sides = sidesFactory(u)
  const mid = bestXIpool(Object.values(u.index), 72, 76)
  const even = (i: number) => ({
    home: teamInputFromPool('H', 'Home', 'HOM', tacticsForStyle('balanced', '4-3-3'), mid),
    away: teamInputFromPool('A', 'Away', 'AWA', tacticsForStyle(i % 2 ? 'balanced' : 'possession', '4-2-3-1'), mid),
  })
  const results: FullMatchResult[] = []
  const rng = new Rng('stats-even')
  for (let i = 0; i < 200; i++) results.push(simulateMatch({ rng, ...even(i), detail: 'full' }))

  it('shots, on target, cards and xG are the log, minute by minute; fouls never fewer than cards; a corner for every corner attempt; nothing falls', () => {
    for (const r of results.slice(0, 30)) {
      const feed = feedFromResult(r, 'k')
      const s = statsSeries(feed, get)
      expect(s.home).toHaveLength(feed.lastMinute + 1)
      for (const side of ['home', 'away'] as const) {
        const opp = side === 'home' ? 'away' : 'home'
        for (let m = 0; m <= feed.lastMinute; m++) {
          const upTo = feed.events.filter((e) => e.side === side && e.minute <= m)
          const line = s[side][m]
          expect(line.shots).toBe(upTo.filter(isAttempt).length)
          expect(line.onTarget).toBe(upTo.filter((e) => ON_TARGET.has(e.type)).length)
          expect(line.yellows).toBe(upTo.filter((e) => e.type === 'yellow').length)
          expect(line.reds).toBe(upTo.filter((e) => e.type === 'red').length)
          expect(line.xg).toBeCloseTo(upTo.filter(isAttempt).reduce((a, e) => a + shotXg(e), 0), 2)
          expect(line.possession + s[opp][m].possession).toBeCloseTo(100, 5)
          expect(line.territory + s[opp][m].territory).toBeCloseTo(100, 5)
          if (m === 0) continue
          const prev = s[side][m - 1]
          for (const k of ['shots', 'onTarget', 'passes', 'passesCompleted', 'distanceKm', 'tackles', 'fouls', 'corners', 'offsides', 'yellows', 'reds'] as Array<keyof TeamStatLine>) expect(line[k]).toBeGreaterThanOrEqual(prev[k])
          const inMinute = feed.events.filter((e) => e.minute === m)
          const cards = inMinute.filter((e) => e.side === side && (e.type === 'yellow' || e.type === 'red')).length
          const pens = inMinute.filter((e) => e.side === opp && e.type === 'penalty').length
          expect(line.fouls - prev.fouls).toBeGreaterThanOrEqual(cards + pens)
          const corners = inMinute.filter((e) => e.side === side && isAttempt(e) && e.text.toLowerCase().includes('corner')).length
          expect(line.corners - prev.corners).toBeGreaterThanOrEqual(corners)
          expect(line.passesCompleted).toBeLessThanOrEqual(line.passes)
        }
      }
      // Territory at the whistle is the mean of the momentum bins (today's territory figure)
      const bins = r.momentum!
      expect(Math.abs(s.home[feed.lastMinute].territory - (bins.reduce((a, b) => a + b, 0) / bins.length) * 100)).toBeLessThanOrEqual(0.051)
    }
  })

  it('lands in sensible ranges per ninety at an even game over 200 seeded matches', () => {
    const acc: Record<string, number> = {}
    for (const r of results) {
      const s = statsSeries(feedFromResult(r, `even-${r.homeGoals}-${r.awayGoals}-${r.events.length}`), get)
      for (const side of ['home', 'away'] as const) for (const [k, v] of Object.entries(statsAt(s, 999)[side])) acc[k] = (acc[k] ?? 0) + v / (2 * results.length)
    }
    console.log(`per side per match: ${JSON.stringify(Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`)
    expect(acc.passes).toBeGreaterThan(400)
    expect(acc.passes).toBeLessThan(540)
    expect(acc.passPct).toBeGreaterThan(75)
    expect(acc.passPct).toBeLessThan(88)
    expect(acc.tackles).toBeGreaterThan(14)
    expect(acc.tackles).toBeLessThan(22)
    expect(acc.fouls).toBeGreaterThan(9.5)
    expect(acc.fouls).toBeLessThan(13.5)
    expect(acc.corners).toBeGreaterThan(4)
    expect(acc.corners).toBeLessThan(7)
    expect(acc.offsides).toBeGreaterThan(1.3)
    expect(acc.offsides).toBeLessThan(3)
    expect(acc.distanceKm).toBeGreaterThan(100)
    expect(acc.distanceKm).toBeLessThan(115)
    expect(acc.possession).toBeCloseTo(50, 5)
  })

  it('instructions move the modelled numbers: short passing, a high press, a high line', () => {
    const tally = (feeds: MatchFeed[], side: 'home' | 'away') => {
      const out = { passes: 0, pct: 0, tackles: 0, fouls: 0, offsides: 0 }
      for (const f of feeds) {
        const l = statsAt(statsSeries(f, get), f.lastMinute)[side]
        out.passes += l.passes
        out.pct += l.passPct
        out.tackles += l.tackles
        out.fouls += l.fouls
        out.offsides += l.offsides
      }
      return out
    }
    const feeds = results.slice(0, 80).map((r, i) => feedFromResult(r, `instr-${i}`))
    const mixed = tally(feeds.map((f) => withKickOff(f, 'home', { passing: 'mixed', pressing: 'mid' })), 'home')
    const short = tally(feeds.map((f) => withKickOff(f, 'home', { passing: 'short', pressing: 'mid' })), 'home')
    expect(short.passes).toBeGreaterThan(mixed.passes * 1.1)
    expect(short.pct).toBeGreaterThan(mixed.pct)
    const press = tally(feeds.map((f) => withKickOff(f, 'home', { passing: 'mixed', pressing: 'high' })), 'home')
    expect(press.tackles).toBeGreaterThan(mixed.tackles * 1.15)
    expect(press.fouls).toBeGreaterThan(mixed.fouls)
    const standard = tally(feeds.map((f) => withKickOff(f, 'home', { defensiveLine: 'standard' })), 'away')
    const high = tally(feeds.map((f) => withKickOff(f, 'home', { defensiveLine: 'high' })), 'away')
    expect(high.offsides).toBeGreaterThan(standard.offsides * 1.3)
  })

  it('possession leans with the midfield, the passing and the venue, and stays in 28..72', () => {
    for (const r of results.slice(0, 40)) {
      const feed = feedFromResult(r, 'p')
      const base = possessionBase(feed, 30)
      expect(base).toBeGreaterThanOrEqual(28)
      expect(base).toBeLessThanOrEqual(72)
      expect(possessionBase({ ...feed, neutral: true }, 30)).toBeCloseTo(base - 2, 6)
      expect(possessionBase(withKickOff(feed, 'home', { passing: 'short' }), 30)).toBeGreaterThanOrEqual(possessionBase(withKickOff(feed, 'home', { passing: 'direct' }), 30))
    }
  })

  it('xG per attempt: a penalty 0.76, an own goal nothing, an old attempt the mean, closer and more central is worth more, capped', () => {
    const e = (type: MatchEvent['type'], x?: number, y = 50, text = 'shot'): MatchEvent => ({ minute: 10, type, side: 'home', text, position: x === undefined ? undefined : { x, y } })
    expect(shotXg(e('penalty', 89.5))).toBe(0.76)
    expect(shotXg(e('own_goal', 96))).toBe(0)
    expect(shotXg(e('chance'))).toBe(XG_NO_POSITION)
    expect(shotXg(e('chance', 95))).toBeGreaterThan(shotXg(e('chance', 88)))
    expect(shotXg(e('chance', 88))).toBeGreaterThan(shotXg(e('chance', 78)))
    expect(shotXg(e('chance', 90, 50))).toBeGreaterThan(shotXg(e('chance', 90, 75)))
    expect(shotXg(e('chance', 95, 50, 'heads over'))).toBeLessThan(shotXg(e('chance', 95, 50, 'fires wide')))
    expect(shotXg(e('goal', 99.9, 50))).toBeLessThanOrEqual(0.92)
  })

  it('XG_KAPPA is calibrated: 400 seeded matches score what their attempts are worth', () => {
    expect(XG_KAPPA).toBe(1.55)
    const rng = new Rng('xg-calibration')
    let xg = 0
    let goals = 0
    let lambda = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const r = simulateMatch({ rng, ...sides(i), detail: 'full' })
      const story = xgStory(feedFromResult(r, 'c'))
      xg += story.home.reduce((a, s) => a + s.xg, 0) + story.away.reduce((a, s) => a + s.xg, 0)
      goals += r.events.filter((e) => e.type === 'goal' || e.type === 'penalty').length
      lambda += r.xg.home + r.xg.away
    }
    console.log(`per side: xG ${(xg / 2 / n).toFixed(3)}, goals (own goals aside) ${(goals / 2 / n).toFixed(3)}, engine expected goals ${(lambda / 2 / n).toFixed(3)}`)
    expect(Math.abs(xg / goals - 1)).toBeLessThan(0.05)
    expect(Math.abs(xg / lambda - 1)).toBeLessThan(0.08)
  })

  it('the xG story steps every attempt in its minute and holds a running total per minute', () => {
    for (const r of results.slice(0, 30)) {
      const feed = feedFromResult(r, 's')
      const story = xgStory(feed)
      for (const side of ['home', 'away'] as const) {
        expect(story[side]).toHaveLength(feed.events.filter((e) => e.side === side && isAttempt(e)).length)
        expect(story.perMinute[side]).toHaveLength(feed.lastMinute + 1)
        expect(story.perMinute[side][0]).toBe(0)
        for (let m = 1; m <= feed.lastMinute; m++) expect(story.perMinute[side][m]).toBeGreaterThanOrEqual(story.perMinute[side][m - 1])
        const last = story[side][story[side].length - 1]
        expect(story.perMinute[side][feed.lastMinute]).toBeCloseTo(last?.cumulative ?? 0, 9)
        expect(story[side].filter((s) => s.goal)).toHaveLength(feed.events.filter((e) => e.side === side && (e.type === 'goal' || e.type === 'penalty')).length)
      }
    }
  })

  it('a change at minute k leaves every minute up to k exactly as it was shown', () => {
    for (let i = 0; i < 30; i++) {
      const s = sides(i)
      const k = [12, 33, 52, 64, 77, 88][i % 6]
      const mp = beginMatch({ rng: new Rng(`stats-cut-${i}`), ...s, detail: 'full' })
      if (k >= 46) advanceMatch(mp, s, undefined, 70)
      if (k >= 71) advanceMatch(mp, s, undefined, 90)
      const before = statsSeries(feedFromLive(mp, 'f'), get)
      const t = mp.home.tactics
      const off = mp.hLive.find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red && p.onAt === 0)!
      const on = mp.home.bench.find((id) => !mp.hLive.some((p) => p.psId === id))
      const out = changeInPlay(mp, s, { side: 'home', minute: k, tactics: { ...t, pressing: t.pressing === 'high' ? 'low' : 'high', passing: t.passing === 'short' ? 'direct' : 'short' }, substitutions: on ? [{ off: off.psId, on }] : [] })
      expect(out.applied).toBe(true)
      const after = statsSeries(feedFromLive(mp, 'f'), get)
      expect(after.home.slice(0, k + 1)).toEqual(before.home.slice(0, k + 1))
      expect(after.away.slice(0, k + 1)).toEqual(before.away.slice(0, k + 1))
    }
  })
})
