import { describe, expect, it } from 'vitest'
import { TIERS } from '@game/logic/rarity'
import { noiseSamples, seeded } from '../sound/noise'
import { CATEGORY, FLOOR, GRADE_NOTES, LANDING_LEVEL, LANDING_TOP, MAX_LEVEL, WHISTLE_CALLS, envAt, peakOf, scoreFor, scoreLength, sourceBound, type NoiseVoice, type Score, type SoundRequest } from '../sound/scores'
import { SAFETY, renderScore, safetyCurve, type NoiseBank } from '../sound/render'
import { armAudio, liveAudio, playLanding, playSound, playUpgradeResult, unlockAudio } from '../sound/synth'
import { matchSoundOn } from '../sound/prefs'
import { cueScore } from '../sound/voices'
import { CUE_REQUESTS } from './cueRequests'

/** One of every request the palette answers, with the variants that change its shape. */
const REQUESTS: SoundRequest[] = [
  { id: 'whistle', call: 'kickoff' },
  { id: 'whistle', call: 'half' },
  { id: 'whistle', call: 'full' },
  { id: 'goal', tone: 'ours', seed: '3' },
  { id: 'goal', tone: 'neutral', seed: '3' },
  { id: 'goal', tone: 'theirs', seed: '3' },
  { id: 'goal', tone: 'ours', replay: true, seed: '3' },
  { id: 'near-miss', strength: 0.2, seed: '5' },
  { id: 'near-miss', strength: 1, seed: '5' },
  { id: 'save', strength: 0.6, seed: '7' },
  { id: 'card', red: false },
  { id: 'card', red: true },
  { id: 'sub', ours: true },
  { id: 'sub', ours: false },
  ...TIERS.map((tier): SoundRequest => ({ id: 'landing', tier })),
  { id: 'landing', tier: 'icons' },
  { id: 'landing', tier: 'gold', reduced: true },
  { id: 'pick' },
  { id: 'upgrade', won: true },
  { id: 'upgrade', won: false },
  { id: 'upgrade', won: true, reduced: true },
  { id: 'fanfare', treble: false },
  { id: 'fanfare', treble: true },
  { id: 'fanfare', treble: true, reduced: true },
  ...(['A', 'B', 'C', 'D'] as const).map((grade): SoundRequest => ({ id: 'grade', grade })),
  { id: 'click' },
]

const name = (r: SoundRequest) => JSON.stringify(r)

describe('the sound palette', () => {
  it('every sound is a well-formed score: voices start on time, rise, hold and fall inside their length, in the audible range', () => {
    for (const req of REQUESTS) {
      const s = scoreFor(req)
      expect(s.id, name(req)).toBe(req.id)
      expect(s.category).toBe(CATEGORY[req.id])
      expect(s.voices.length, name(req)).toBeGreaterThan(0)
      for (const v of s.voices) {
        expect(v.at, name(req)).toBeGreaterThanOrEqual(0)
        expect(v.attack, name(req)).toBeGreaterThan(0)
        expect(v.attack + (v.hold ?? 0), name(req)).toBeLessThan(v.dur)
        expect(v.peak, name(req)).toBeGreaterThan(0)
        const freqs = v.kind === 'noise' ? [v.freq, v.freqTo ?? v.freq] : [v.freq, v.kind === 'tone' ? (v.glideTo ?? v.freq) : (v.bendFrom ?? v.freq)]
        for (const f of freqs) {
          expect(f, name(req)).toBeGreaterThanOrEqual(20)
          expect(f, name(req)).toBeLessThanOrEqual(16000)
        }
      }
    }
  })

  it('is normalised: each score’s bound is exactly its level, no level above the cap, so nothing clips under the master', () => {
    for (const req of REQUESTS) {
      const s = scoreFor(req)
      expect(s.level, name(req)).toBeLessThanOrEqual(MAX_LEVEL)
      expect(peakOf(s.voices), name(req)).toBeCloseTo(s.level, 6)
    }
    // Two of the loudest at once still leave headroom under the master gain (0.35)
    expect(2 * MAX_LEVEL * 0.35).toBeLessThan(1)
  })

  it('is the same every time it is asked for the same way, and the seed only moves the cosmetics', () => {
    for (const req of REQUESTS) expect(scoreFor(req)).toEqual(scoreFor(req))
    const a = scoreFor({ id: 'goal', tone: 'ours', seed: '1' })
    const b = scoreFor({ id: 'goal', tone: 'ours', seed: '2' })
    expect(a).not.toEqual(b)
    expect(a.voices.length).toBe(b.voices.length)
    expect(a.level).toBe(b.level)
  })

  it('keeps quiet things quiet and short things short', () => {
    const level = (r: SoundRequest) => scoreFor(r).level
    const len = (r: SoundRequest) => scoreLength(scoreFor(r).voices)
    expect(level({ id: 'click' })).toBeLessThan(0.15)
    expect(len({ id: 'click' })).toBeLessThan(0.05)
    expect(level({ id: 'click' })).toBeLessThan(level({ id: 'pick' }))
    expect(len({ id: 'pick' })).toBeLessThan(0.4)
    expect(level({ id: 'sub', ours: false })).toBeLessThan(level({ id: 'sub', ours: true }))
    expect(level({ id: 'goal', tone: 'ours' })).toBeGreaterThan(level({ id: 'goal', tone: 'neutral' }))
    expect(level({ id: 'goal', tone: 'neutral' })).toBeGreaterThan(level({ id: 'goal', tone: 'theirs' }))
    expect(level({ id: 'goal', tone: 'ours', replay: true })).toBeLessThan(level({ id: 'goal', tone: 'ours' }))
    expect(len({ id: 'goal', tone: 'ours' })).toBeGreaterThan(2.5)
    expect(len({ id: 'goal', tone: 'theirs' })).toBeLessThan(len({ id: 'goal', tone: 'ours' }))
    expect(level({ id: 'near-miss', strength: 1 })).toBeGreaterThan(level({ id: 'near-miss', strength: 0.2 }))
    expect(level({ id: 'card', red: true })).toBeGreaterThan(level({ id: 'card', red: false }))
    expect(level({ id: 'fanfare', treble: true })).toBeGreaterThan(level({ id: 'fanfare', treble: false }))
    expect(len({ id: 'fanfare', treble: true })).toBeGreaterThan(len({ id: 'fanfare', treble: false }) + 1)
    expect(len({ id: 'fanfare', treble: true })).toBeLessThan(6)
  })
})

describe('the envelope', () => {
  it('rises linearly from silence, holds, and falls exponentially back to silence at its end', () => {
    const v = { at: 0.1, attack: 0.02, hold: 0.1, dur: 0.5, peak: 0.6 }
    expect(envAt(v, 0)).toBe(0)
    expect(envAt(v, 0.1)).toBeCloseTo(FLOOR, 9)
    expect(envAt(v, 0.11)).toBeCloseTo(0.3, 3)
    expect(envAt(v, 0.12)).toBeCloseTo(0.6, 9)
    expect(envAt(v, 0.2)).toBe(0.6)
    expect(envAt(v, 0.6)).toBeCloseTo(FLOOR, 9)
    expect(envAt(v, 0.61)).toBe(0)
    let prev = Infinity
    for (let t = 0.22; t <= 0.6; t += 0.01) {
      expect(envAt(v, t)).toBeLessThan(prev)
      prev = envAt(v, t)
    }
  })
})

describe('the referee’s whistle', () => {
  it('blows one long blast for a kick-off, two for half time, three for full time, the last the longest', () => {
    expect(WHISTLE_CALLS.kickoff).toHaveLength(1)
    expect(WHISTLE_CALLS.half).toHaveLength(2)
    expect(WHISTLE_CALLS.full).toHaveLength(3)
    for (const call of ['kickoff', 'half', 'full'] as const) {
      const blasts = WHISTLE_CALLS[call]
      const last = blasts[blasts.length - 1][1]
      for (const [, d] of blasts) expect(d).toBeLessThanOrEqual(last)
      // Blasts never overlap
      for (let i = 1; i < blasts.length; i++) expect(blasts[i][0]).toBeGreaterThan(blasts[i - 1][0] + blasts[i - 1][1])
      const s = scoreFor({ id: 'whistle', call })
      const carriers = s.voices.filter((v) => v.kind === 'fm' && v.freq < 4000)
      expect(carriers).toHaveLength(blasts.length)
    }
  })

  it('is a pea whistle: an FM carrier near 3 kHz trilled by the pea some 30 to 60 times a second', () => {
    for (const v of scoreFor({ id: 'whistle', call: 'kickoff' }).voices) {
      if (v.kind !== 'fm') continue
      expect(v.modHz).toBeGreaterThanOrEqual(30)
      expect(v.modHz).toBeLessThanOrEqual(60)
      expect(v.modDepth / v.freq).toBeGreaterThan(0.02)
      expect(v.modDepth / v.freq).toBeLessThan(0.1)
    }
    const carrier = scoreFor({ id: 'whistle', call: 'kickoff' }).voices.find((v) => v.kind === 'fm')!
    expect(carrier.kind === 'fm' && carrier.freq).toBeGreaterThan(2500)
    expect(carrier.kind === 'fm' && carrier.freq).toBeLessThan(3500)
  })
})

describe('the draft’s sounds', () => {
  it('the reel’s landing rises with rarity: a higher top note, a louder level and more voices each tier up', () => {
    const order = ['blue', 'purple', 'pink', 'red', 'gold'] as const
    for (let i = 1; i < order.length; i++) {
      expect(LANDING_TOP[order[i]]).toBeGreaterThan(LANDING_TOP[order[i - 1]])
      expect(LANDING_LEVEL[order[i]]).toBeGreaterThan(LANDING_LEVEL[order[i - 1]])
      expect(scoreFor({ id: 'landing', tier: order[i] }).voices.length).toBeGreaterThan(scoreFor({ id: 'landing', tier: order[i - 1] }).voices.length)
    }
    for (const t of order) expect(scoreFor({ id: 'landing', tier: t }).voices.some((v) => v.kind === 'tone' && Math.abs(v.freq - LANDING_TOP[t]) < 0.01)).toBe(true)
    // The Icons card plays gold's; reduced motion drops the shimmer
    expect(scoreFor({ id: 'landing', tier: 'icons' })).toEqual(scoreFor({ id: 'landing', tier: 'gold' }))
    expect(scoreFor({ id: 'landing', tier: 'gold', reduced: true }).voices.length).toBeLessThan(scoreFor({ id: 'landing', tier: 'gold' }).voices.length)
  })

  it('the grade lands brightest for an A and falls for a D', () => {
    const levels = (['A', 'B', 'C'] as const).map((g) => scoreFor({ id: 'grade', grade: g }).level)
    expect(levels[0]).toBeGreaterThan(levels[1])
    expect(levels[1]).toBeGreaterThan(levels[2])
    const d = scoreFor({ id: 'grade', grade: 'D' }).voices.filter((v) => v.kind === 'tone' && GRADE_NOTES.D.includes(v.freq))
    expect(d).toHaveLength(2)
    for (const v of d) expect(v.kind === 'tone' && (v.glideTo ?? v.freq) < v.freq).toBe(true)
    expect(GRADE_NOTES.A[GRADE_NOTES.A.length - 1]).toBeGreaterThan(GRADE_NOTES.D[0] * 2)
  })
})

describe('the noise', () => {
  it('peaks at exactly 1, the same for the same seed, different for another', () => {
    for (const colour of ['white', 'pink'] as const) {
      const a = noiseSamples(48000, colour)
      expect(Math.max(...a.map(Math.abs))).toBeCloseTo(1, 9)
      expect(noiseSamples(48000, colour)).toEqual(a)
      expect(noiseSamples(48000, colour, 'other')).not.toEqual(a)
    }
    const r = seeded('x')
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('every noise voice in the palette stays inside its bound through its filter (the Web Audio biquads, at both ends of a sweep)', () => {
    const SR = 48000
    const buffers = { white: noiseSamples(SR * 3, 'white'), pink: noiseSamples(SR * 3, 'pink') }
    const peakThrough = (x: Float32Array, type: NoiseVoice['filter'], f: number, Q: number) => {
      // The Web Audio biquads (the Audio EQ Cookbook; low- and high-pass Q in dB)
      const w = (2 * Math.PI * f) / SR
      const cos = Math.cos(w)
      const sin = Math.sin(w)
      let b: [number, number, number]
      let a: [number, number, number]
      if (type === 'bandpass') {
        const alpha = sin / (2 * Q)
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cos, 1 - alpha]
      } else {
        const alpha = sin / (2 * Math.pow(10, Q / 20))
        b = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        a = [1 + alpha, -2 * cos, 1 - alpha]
      }
      let x1 = 0
      let x2 = 0
      let y1 = 0
      let y2 = 0
      let peak = 0
      for (let i = 0; i < x.length; i++) {
        const y = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0]
        x2 = x1
        x1 = x[i]
        y2 = y1
        y1 = y
        peak = Math.max(peak, Math.abs(y))
      }
      return peak
    }
    const seen = new Set<string>()
    // The palette's and the second pass's cues (voices.ts) alike
    for (const score of [...REQUESTS.map(scoreFor), ...CUE_REQUESTS.map(cueScore)]) {
      for (const v of score.voices) {
        if (v.kind !== 'noise') continue
        const q = v.q ?? (v.filter === 'bandpass' ? 1 : 0)
        for (const f of [v.freq, v.freqTo ?? v.freq]) {
          const key = `${v.colour}-${v.filter}-${f}-${q}`
          if (seen.has(key)) continue
          seen.add(key)
          expect(peakThrough(buffers[v.colour], v.filter, f, q), key).toBeLessThanOrEqual(sourceBound(v))
        }
      }
    }
    expect(seen.size).toBeGreaterThan(10)
  })
})

/** A recording stand-in for an audio context: enough of the API for `renderScore`, logging every start, stop and gain value. */
function fakeContext() {
  const log = { starts: [] as number[], stops: [] as number[], gains: [] as number[], sources: 0 }
  const param = (track = false) => {
    const p = {
      value: 0,
      setValueAtTime(v: number) {
        if (track) log.gains.push(v)
        return p
      },
      linearRampToValueAtTime(v: number) {
        if (track) log.gains.push(v)
        return p
      },
      exponentialRampToValueAtTime(v: number) {
        if (track) log.gains.push(v)
        return p
      },
    }
    return p
  }
  const node = () => ({ connect: () => undefined })
  const source = () => {
    log.sources++
    return { ...node(), start: (t: number) => log.starts.push(t), stop: (t: number) => log.stops.push(t) }
  }
  const c = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param(true) }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: () => ({ ...source(), type: 'sine', frequency: param() }),
    createBufferSource: () => ({ ...source(), buffer: null, loop: false, playbackRate: param() }),
  }
  return { c: c as unknown as BaseAudioContext, log }
}

describe('rendering a score', () => {
  it('starts every source on time, stops it by the end of the score, and never sets a gain above the voice’s peak', () => {
    const bank = { white: {}, pink: {} } as unknown as NoiseBank
    for (const s of [...REQUESTS.map(scoreFor), ...CUE_REQUESTS.map(cueScore)] as Score[]) {
      const { c, log } = fakeContext()
      const nodes = renderScore(c, {} as AudioNode, 2, s, bank)
      expect(nodes.length).toBe(log.sources)
      expect(log.starts.length).toBe(log.sources)
      expect(Math.min(...log.starts)).toBeGreaterThanOrEqual(2)
      expect(Math.max(...log.stops)).toBeLessThanOrEqual(2 + scoreLength(s.voices) + 0.051)
      const peak = Math.max(...s.voices.map((v) => v.peak))
      // Gains: the envelopes, and the fixed FM depths and tremolo gains (Hz, or under 1)
      const envGains = log.gains.filter((g) => g <= 1.0001 || g > 10)
      expect(envGains.length).toBe(log.gains.length)
      for (const g of log.gains) if (g <= 1.0001) expect(g).toBeLessThanOrEqual(Math.max(1, peak) + 1e-9)
    }
  })
})

describe('the safety net', () => {
  it('passes every sound untouched below the knee, bends smoothly above it and never reaches full scale', () => {
    const c = safetyCurve(2049)
    const x = (i: number) => (i / 2048) * 2 - 1
    for (let i = 0; i < c.length; i++) {
      if (Math.abs(x(i)) <= SAFETY.knee) expect(c[i]).toBeCloseTo(x(i), 6)
      expect(Math.abs(c[i])).toBeLessThan(SAFETY.ceiling + 1e-9)
      if (i > 0) expect(c[i]).toBeGreaterThan(c[i - 1])
      expect(c[i]).toBeCloseTo(-c[2048 - i], 6)
    }
    // The loudest sound, two at once, under the master stays below the knee
    expect(2 * MAX_LEVEL * 0.35).toBeLessThan(SAFETY.knee)
  })
})

describe('sound without Web Audio (node)', () => {
  it('plays nothing and throws nothing for any sound, before or after arming', () => {
    expect(() => armAudio()).not.toThrow()
    expect(() => unlockAudio()).not.toThrow()
    expect(liveAudio()).toBeNull()
    expect(matchSoundOn()).toBe(true)
    for (const req of REQUESTS) expect(playSound(req)).toEqual([])
    expect(playSound({ id: 'fanfare', treble: true }, 1.5)).toEqual([])
    expect(() => playLanding('gold')).not.toThrow()
    expect(() => playUpgradeResult(true)).not.toThrow()
  })
})
