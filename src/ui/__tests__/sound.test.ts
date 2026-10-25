import { describe, expect, it } from 'vitest'
import { REEL_CARDS, REEL_JITTER, REEL_LAND } from '@game/logic/reel'
import { TIERS } from '@game/logic/rarity'
import { FULL_TIMING, OVERSHOOT, QUICK_TIMING, SETTLE_MS, SPIN_MS, STRIP_CURVE, cubicBezier, reelKeyframes, reelPosition, type ReelTiming } from '../reelCurve'
import { tickTimes } from '../sound/schedule'
import { LANDING_NOTES, liveAudio, playLanding, playTick, unlockAudio } from '../sound/synth'
import { startReelSound } from '../sound/reel'
import { soundOn } from '../sound/prefs'
import { quickSpinPref } from '../viewerPrefs'

const GAP = 6

/** The strip as styles.css lays it out (8 px padding, cards of `card` px, 6 px gaps), a window `width` wide, stopping `jitter` cards off centre. */
function strip(card: number, width: number, jitter: number) {
  const pitch = card + GAP
  const lefts = Array.from({ length: REEL_CARDS }, (_, i) => 8 + i * pitch)
  const distance = lefts[REEL_LAND] + card / 2 - width / 2 + jitter * card
  return { pitch, distance, overshoot: OVERSHOOT * card, geometry: { boundaries: lefts.map((l) => l - GAP / 2), marker: width / 2 } }
}

function ticks(card: number, width: number, jitter: number, timing: ReelTiming = FULL_TIMING) {
  const s = strip(card, width, jitter)
  return tickTimes(s.geometry, { position: (ms) => reelPosition(ms, s.distance, s.overshoot, timing), duration: timing.spin, bounce: timing.bounce, delay: timing.season })
}

const LAYOUTS: Array<[number, number]> = [[68, 258], [68, 328], [84, 392], [84, 480], [84, 720]]
const JITTERS = [-1, -0.5, 0, 0.5, 1].map((f) => f * REEL_JITTER)

describe('reel timing and curve', () => {
  it('runs a CS-length opening: a short season, about 5.8 s of strip, a hold, and a quick mode of about 2 s', () => {
    expect(SPIN_MS).toBeGreaterThanOrEqual(5500)
    expect(SPIN_MS).toBeLessThanOrEqual(6000)
    expect(FULL_TIMING.season).toBeLessThanOrEqual(1000)
    expect(FULL_TIMING.hold).toBe(400)
    expect(SETTLE_MS).toBe(FULL_TIMING.season + FULL_TIMING.spin + FULL_TIMING.hold)
    expect(QUICK_TIMING.spin).toBe(2000)
    expect(QUICK_TIMING.season + QUICK_TIMING.spin + QUICK_TIMING.hold).toBeLessThan(3000)
    expect(QUICK_TIMING.drum).toBeLessThan(QUICK_TIMING.season)
    expect(FULL_TIMING.drum).toBeLessThan(FULL_TIMING.season)
  })

  it('the bezier matches CSS: ends pinned, monotonic, flat at the end', () => {
    const f = cubicBezier(...STRIP_CURVE)
    expect(f(0)).toBe(0)
    expect(f(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 400; i++) {
      const v = f(i / 400)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(1 - f(0.999)).toBeLessThan(1e-5)
  })

  it('one smooth curve: a very fast start, a long crawl, a small overshoot, an ease back with no jump', () => {
    for (const [card, width] of LAYOUTS) {
      for (const j of JITTERS) {
        const s = strip(card, width, j)
        const pos = (ms: number) => reelPosition(ms, s.distance, s.overshoot, FULL_TIMING)
        const main = FULL_TIMING.spin - FULL_TIMING.bounce
        expect(pos(0)).toBe(0)
        expect(pos(FULL_TIMING.spin)).toBe(s.distance)
        // The first quarter second covers over ten cards; the last 1.5 s creeps over two or three
        expect(pos(250) / s.pitch).toBeGreaterThan(10)
        const last = (s.distance + s.overshoot - pos(FULL_TIMING.spin - 1500)) / s.pitch
        expect(last).toBeGreaterThan(1.8)
        expect(last).toBeLessThan(3)
        // Sampled every millisecond once: forward until the peak, back after it, never a jump
        const p = Array.from({ length: FULL_TIMING.spin + 1 }, (_, t) => pos(t))
        let forward = true
        let backward = true
        let jump = 0
        for (let t = 1; t < p.length; t++) {
          const d = p[t] - p[t - 1]
          if (t <= main && d < 0) forward = false
          if (t > main && d > 0) backward = false
          jump = Math.max(jump, Math.abs(d))
        }
        expect(forward && backward).toBe(true)
        expect(jump).toBeLessThan(card)
        // The peak is the overshoot, 8 to 15% of a card, at the start of the bounce
        expect(Math.max(...p)).toBeCloseTo(s.distance + s.overshoot, 6)
        expect(s.overshoot / card).toBeGreaterThanOrEqual(0.08)
        expect(s.overshoot / card).toBeLessThanOrEqual(0.15)
        // At rest at both turning points: the speed falls to nothing at the peak and at the stop
        expect(p[main] - p[main - 1]).toBeLessThan(0.05)
        expect(p[main + 1] - p[main]).toBeGreaterThan(-0.05)
        expect(p[FULL_TIMING.spin] - p[FULL_TIMING.spin - 1]).toBeGreaterThan(-0.05)
      }
    }
  })

  it('keyframes follow the curve from 0 to the stop', () => {
    const s = strip(84, 392, 0.2)
    for (const timing of [FULL_TIMING, QUICK_TIMING]) {
      const k = reelKeyframes(s.distance, s.overshoot, timing)
      const offsets = k.map((f) => f.offset as number)
      expect(offsets[0]).toBe(0)
      expect(offsets[offsets.length - 1]).toBe(1)
      for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1])
      expect(k[0].transform).toBe('translate3d(0.00px, 0, 0)')
      expect(k[k.length - 1].transform).toBe(`translate3d(${(-s.distance).toFixed(2)}px, 0, 0)`)
      expect(k.length).toBeGreaterThan(timing.spin / 20)
    }
  })
})

describe('reel tick schedule', () => {
  it('dense at the start, very sparse at the end, and the last tick at or before the strip comes to rest', () => {
    let runs = 0
    for (const timing of [FULL_TIMING, QUICK_TIMING]) {
      const rest = timing.season + timing.spin
      for (const [card, width] of LAYOUTS) {
        for (const j of JITTERS) {
          const t = ticks(card, width, j, timing)
          runs++
          expect(t.length).toBeGreaterThan(REEL_LAND - 10)
          expect(t.length).toBeLessThanOrEqual(REEL_LAND + 4)
          expect(t[0]).toBeGreaterThan(timing.season)
          expect(t[t.length - 1]).toBeLessThanOrEqual(rest)
          // Spacing widens through the deceleration (the bounce's ticks aside)
          const forward = t.filter((v) => v <= rest - timing.bounce)
          const gaps = forward.slice(1).map((v, i) => v - forward[i])
          for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] - 1)
          expect(gaps[0]).toBeLessThan(timing === FULL_TIMING ? 15 : 8)
          expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0] * 20)
          // Every run ends with a tick during the ease back: a boundary crossed back, or the settle tick
          expect(t.some((v) => v > rest - timing.bounce)).toBe(true)
        }
      }
    }
    expect(runs).toBe(2 * LAYOUTS.length * JITTERS.length)
  })

  it('an overshoot across a card boundary ticks out and back', () => {
    // Stop near the landed card's right edge: the overshoot runs into the gap and returns
    const t = ticks(68, 328, REEL_JITTER)
    const rest = FULL_TIMING.season + FULL_TIMING.spin
    const inBounce = t.filter((v) => v > rest - FULL_TIMING.bounce - 1500)
    expect(t.filter((v) => v > rest - FULL_TIMING.bounce).length).toBe(1)
    expect(inBounce.length).toBeGreaterThanOrEqual(2)
    // Stop at the centre: no boundary is crossed back, so one settle tick halfway back
    const c = ticks(68, 328, 0)
    const back = c.filter((v) => v > rest - FULL_TIMING.bounce)
    expect(back).toEqual([rest - FULL_TIMING.bounce / 2])
  })

  it('no slide, no ticks', () => {
    expect(tickTimes({ boundaries: [10, 20], marker: 0 }, { position: () => 0, duration: 1000 })).toEqual([])
    expect(tickTimes({ boundaries: [10, 20], marker: 0 }, { position: (ms) => ms, duration: 0 })).toEqual([])
    // Boundaries already past the marker, or beyond the stop, never tick
    expect(tickTimes({ boundaries: [-5, 0, 50, 150], marker: 0 }, { position: (ms) => ms / 10, duration: 1000 })).toEqual([500])
  })
})

describe('sound without Web Audio', () => {
  it('is on by default, quick spin off by default, and silent where there is no AudioContext (tests, headless)', () => {
    expect(soundOn()).toBe(true)
    expect(quickSpinPref.get()).toBe(false)
    expect(() => unlockAudio()).not.toThrow()
    expect(liveAudio()).toBeNull()
    expect(playTick(0, 1)).toBeNull()
    for (const t of TIERS) expect(() => playLanding(t)).not.toThrow()
    const s = strip(68, 328, 0)
    const run = startReelSound({ slide: null, geometry: s.geometry, timing: { position: () => 0, duration: SPIN_MS }, popAt: 850, reduced: false })
    expect(() => {
      run.land('gold')
      run.stop()
    }).not.toThrow()
  })

  it('every tier has its own first note', () => {
    const firsts = TIERS.map((t) => LANDING_NOTES[t][0])
    expect(new Set(firsts).size).toBe(TIERS.length)
    expect(LANDING_NOTES.blue).toHaveLength(1)
    expect(LANDING_NOTES.purple).toHaveLength(2)
    expect(LANDING_NOTES.pink).toHaveLength(2)
    expect(LANDING_NOTES.red.length).toBeGreaterThan(2)
  })
})
