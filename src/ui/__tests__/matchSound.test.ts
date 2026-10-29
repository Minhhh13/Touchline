import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '@engine/types'
import { shotXg } from '@engine/matchStats'
import { goalHolds } from '../match/possession'
import { GOAL_FLIGHT_MS, timeline, type GoalHold, type TimelinePoint } from '../match/clockStore'
import { REPLAY, replayFrame } from '../match/keyMoments'
import { FULL_OOH_XG, OOH_XG, dueMatchSounds, goalMoments, matchSoundCues, mixKindOf, replayNetAt } from '../sound/match'
import { MIX, admit, createMix } from '../sound/mix'
import type { SoundRequest } from '../sound/scores'

const ev = (minute: number, type: MatchEvent['type'], side: 'home' | 'away', position?: { x: number; y: number }): MatchEvent => ({ minute, type, side, text: '', ...(position ? { position } : {}) })

describe('the match’s sounds', () => {
  const close = { x: 93, y: 50 }
  const far = { x: 66, y: 12 }
  const events: MatchEvent[] = [ev(0, 'kickoff', 'home'), ev(12, 'chance', 'home', close), ev(18, 'chance', 'away', far), ev(30, 'save', 'away', close), ev(33, 'yellow', 'home'), ev(40, 'goal', 'home', close), ev(44, 'substitution', 'away'), ev(52, 'red', 'away'), ev(60, 'substitution', 'home'), ev(75, 'chance', 'home', close)]
  const first = [{ from: 0, to: 45 }]

  it('whistles the kick-off at 0 and 46, half time at the end of the 45th minute and full time only at the whistle', () => {
    expect(shotXg(events[1])).toBeGreaterThanOrEqual(OOH_XG)
    expect(shotXg(events[2])).toBeLessThan(OOH_XG)
    const half = matchSoundCues(events, first, { userSide: 'home', start: 0, stopAt: 45, final: false })
    const whistles = half.filter((c) => c.req.id === 'whistle').map((c) => [c.t, c.req.id === 'whistle' && c.req.call])
    expect(whistles).toEqual([
      [0.002, 'kickoff'],
      [46, 'half'],
    ])
    const second = matchSoundCues(events, [...first, { from: 46, to: 90 }], { userSide: 'home', start: 46, stopAt: 93, final: true })
    expect(second.filter((c) => c.req.id === 'whistle').map((c) => c.req.id === 'whistle' && c.req.call)).toEqual(['half', 'kickoff', 'full'])
    expect(second.find((c) => c.key === 'whistle-full')!.t).toBe(94)
    // A resumed stretch (a change in play at 52) has no kick-off
    expect(matchSoundCues(events, [{ from: 52, to: 70 }], { userSide: 'home', start: 52, stopAt: 70, final: false }).some((c) => c.req.id === 'whistle')).toBe(false)
  })

  it('cues an "ooh" for a real chance only, a save, the card at its foul, and the substitutions, inside the ranges the pitch plays', () => {
    const cues = matchSoundCues(events, first, { userSide: 'home', start: 0, stopAt: 45, final: false })
    const ids = cues.map((c) => c.req.id)
    expect(ids.filter((i) => i === 'near-miss')).toHaveLength(1)
    expect(ids.filter((i) => i === 'save')).toHaveLength(1)
    expect(ids.filter((i) => i === 'card')).toHaveLength(1)
    expect(ids.filter((i) => i === 'sub')).toHaveLength(1)
    // Goals sound from their holds, not from the cues; nothing after 45 in the first half
    expect(ids).not.toContain('goal')
    expect(cues.every((c) => c.t <= 46)).toBe(true)
    const sub = cues.find((c) => c.req.id === 'sub')!
    expect(sub.req.id === 'sub' && sub.req.ours).toBe(false)
    expect(Math.floor(sub.t)).toBe(44)
    const ooh = cues.find((c) => c.req.id === 'near-miss')!
    expect(Math.floor(ooh.t)).toBe(12)
    expect(ooh.req.id === 'near-miss' && ooh.req.strength).toBeCloseTo(Math.min(1, shotXg(events[1]) / FULL_OOH_XG), 9)
    const all = matchSoundCues(events, [...first, { from: 46, to: 90 }], { userSide: 'home', start: 0, stopAt: 93, final: true })
    const red = all.find((c) => c.req.id === 'card' && c.req.red)
    expect(red && Math.floor(red.t)).toBe(52)
    for (let i = 1; i < all.length; i++) expect(all[i].t).toBeGreaterThanOrEqual(all[i - 1].t)
  })

  const at = (t: number, hold: TimelinePoint['hold'] = null): TimelinePoint => ({ t, hold })

  it('plays what the clock passed since the last frame, nothing when it went back, only the last whistle on a skip', () => {
    const cues = matchSoundCues(events, [...first, { from: 46, to: 90 }], { userSide: 'home', start: 0, stopAt: 93, final: true })
    expect(dueMatchSounds(at(0), at(0.01), cues, [], GOAL_FLIGHT_MS)).toEqual([{ id: 'whistle', call: 'kickoff' }])
    expect(dueMatchSounds(at(0.01), at(0.02), cues, [], GOAL_FLIGHT_MS)).toEqual([])
    const ooh = cues.find((c) => c.req.id === 'near-miss')!
    expect(dueMatchSounds(at(ooh.t - 0.01), at(ooh.t + 0.01), cues, [], GOAL_FLIGHT_MS)).toEqual([ooh.req])
    // Re-anchored back (a change in play): silence, then play on from there
    expect(dueMatchSounds(at(30), at(12), cues, [], GOAL_FLIGHT_MS)).toEqual([])
    // Skip to full time from 20: the full-time whistle alone, not every chance and card on the way
    expect(dueMatchSounds(at(20), at(94), cues, [], GOAL_FLIGHT_MS)).toEqual([{ id: 'whistle', call: 'full' }])
  })

  it('a goal sounds as the ball crosses the line in its hold, at once with reduced motion, and again at the replay’s net', () => {
    const holds = goalHolds(events, 0, 45, { userSide: 'home', replay: true })
    expect(holds).toHaveLength(1)
    const h = holds[0]
    const moments = goalMoments(h, GOAL_FLIGHT_MS)
    expect(moments.map((m) => m.req)).toEqual([
      { id: 'goal', tone: 'ours', seed: h.key },
      { id: 'goal', tone: 'ours', replay: true, seed: h.key },
    ])
    expect(moments[0].at).toBe(GOAL_FLIGHT_MS)
    // The replay's net: where the replay frame says the ball lands
    const net = replayNetAt(h)!
    expect(replayFrame(h, net, h.t)!.landed).toBeCloseTo(0, 6)
    expect(replayFrame(h, net - 1, h.t)!.landed).toBeLessThan(0)
    expect(net).toBeLessThan(h.ms)
    expect(net - (h.ms - (h.replay ?? 0))).toBeGreaterThan(REPLAY.flight)
    // Frame by frame through the hold: the goal once at the flight, the replay once at its net
    const anchor = { at: 39, since: 0, spent: Infinity, running: true, speed: 1, boost: 1, period: 1000, end: 46, holds }
    const heard: string[] = []
    let prev = timeline(anchor, 0)
    for (let now = 16; now < 16000; now += 16) {
      const cur = timeline(anchor, now)
      for (const r of dueMatchSounds(prev, cur, [], holds, GOAL_FLIGHT_MS)) heard.push(`${r.id === 'goal' && r.replay ? 'replay' : r.id}@${cur.hold?.elapsed.toFixed(0)}`)
      prev = cur
    }
    expect(heard).toHaveLength(2)
    expect(Number(heard[0].split('@')[1])).toBeGreaterThanOrEqual(GOAL_FLIGHT_MS)
    expect(Number(heard[0].split('@')[1])).toBeLessThan(GOAL_FLIGHT_MS + 17)
    expect(heard[1].startsWith('replay@')).toBe(true)
    expect(Number(heard[1].split('@')[1])).toBeLessThan(net + 17)
    // Reduced motion: no replay, and the net the moment the hold begins
    const still: GoalHold[] = goalHolds(events, 0, 45, { userSide: 'home', reduced: true, replay: true })
    expect(goalMoments(still[0], 0)).toEqual([{ at: 0, req: { id: 'goal', tone: 'ours', seed: still[0].key } }])
    expect(dueMatchSounds(at(still[0].t - 0.01), at(still[0].t, { index: 0, elapsed: 5 }), [], still, 0)).toEqual([{ id: 'goal', tone: 'ours', seed: still[0].key }])
    // A goal for the other side sounds subdued
    expect(goalHolds(events, 0, 45, { userSide: 'away' })[0].tone).toBe('theirs')
  })

  it('keeps the crowd from piling up in a fast-forward', () => {
    const mix = createMix()
    const ooh: SoundRequest = { id: 'near-miss', strength: 1 }
    const whistle: SoundRequest = { id: 'whistle', call: 'half' }
    const pass = (reqs: SoundRequest[], now: number, speed = 1) => reqs.filter((r) => admit(mix, mixKindOf(r), now, speed))
    expect(pass([ooh, whistle], 1000)).toEqual([ooh, whistle])
    expect(pass([{ id: 'save', strength: 1 }, whistle], 1000 + MIX.crowdGap - 1)).toEqual([whistle])
    expect(pass([ooh], 1000 + MIX.crowdGap)).toEqual([ooh])
    // At 4x the gap is wider
    expect(pass([ooh], 1000 + 2 * MIX.crowdGap, 4)).toEqual([])
    expect(pass([ooh], 1000 + MIX.crowdGap + MIX.crowdGapFast, 4)).toEqual([ooh])
    expect(mixKindOf({ id: 'card', red: false })).toBe('chime')
    expect(mixKindOf({ id: 'goal', tone: 'ours' })).toBe('goal')
  })
})
