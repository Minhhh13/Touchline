/*
 * Turns a score (scores.ts) into Web Audio nodes on any context: the live one
 * in synth.ts, or an OfflineAudioContext to render a sound to a file. Every
 * envelope here is the one `envAt` describes, so the normalisation in
 * scores.ts bounds what is actually played. No window, no DOM, no game.
 */
import { noiseSamples } from './noise'
import { FLOOR, type FmVoice, type NoiseVoice, type Score, type ToneVoice, type Voice } from './scores'

/** Seconds in the looped noise buffers every noise voice reads from. */
export const BANK_SECONDS = 3

export interface NoiseBank {
  white: AudioBuffer
  pink: AudioBuffer
}

/** The looped noise buffers for a context, filled from the seeded noise (the same samples every time). */
export function makeBank(c: BaseAudioContext): NoiseBank {
  const fill = (colour: 'white' | 'pink') => {
    const n = Math.round(c.sampleRate * BANK_SECONDS)
    const buf = c.createBuffer(1, n, c.sampleRate)
    buf.getChannelData(0).set(noiseSamples(n, colour))
    return buf
  }
  return { white: fill('white'), pink: fill('pink') }
}

/** Where the safety net starts to bend, and the most it lets through. */
export const SAFETY = { knee: 0.8, ceiling: 0.98 } as const

/**
 * The safety net's transfer curve over inputs -1..1: the identity up to the knee (every sound the palette makes, even
 * two loud ones at once), then a smooth bend that never reaches the ceiling, so a pile of sounds saturates softly
 * instead of clipping. Odd, monotonic and pure. (A compressor would add make-up gain and move every sound.)
 */
export function safetyCurve(n = 2049): Float32Array {
  const out = new Float32Array(n)
  const room = SAFETY.ceiling - SAFETY.knee
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= SAFETY.knee ? a : SAFETY.knee + room * Math.tanh((a - SAFETY.knee) / room)
    out[i] = Math.sign(x) * y
  }
  return out
}

/** The master's way out: the safety net, then the speakers. */
export function safetyNet(c: BaseAudioContext): AudioNode {
  const w = c.createWaveShaper()
  w.curve = safetyCurve()
  w.oversample = 'none'
  w.connect(c.destination)
  return w
}

/** The voice's envelope on a gain node, connected to `out`. */
function envelope(c: BaseAudioContext, out: AudioNode, at: number, v: Voice): GainNode {
  const g = c.createGain()
  const peak = Math.max(FLOOR * 2, v.peak)
  const held = at + v.attack + (v.hold ?? 0)
  // Silent before the first event too: a source starting on the same sample would otherwise pass one at full gain (a click)
  g.gain.value = FLOOR
  g.gain.setValueAtTime(FLOOR, at)
  g.gain.linearRampToValueAtTime(peak, at + v.attack)
  if (v.hold) g.gain.setValueAtTime(peak, held)
  g.gain.exponentialRampToValueAtTime(FLOOR, at + v.dur)
  g.connect(out)
  return g
}

function osc(c: BaseAudioContext, type: OscillatorType, freq: number, at: number): OscillatorNode {
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  return o
}

function renderTone(c: BaseAudioContext, out: AudioNode, t: number, v: ToneVoice): AudioScheduledSourceNode[] {
  const o = osc(c, v.wave ?? 'sine', v.freq, t)
  if (v.glideTo) o.frequency.exponentialRampToValueAtTime(v.glideTo, t + (v.glideTime ?? v.dur * 0.7))
  const env = envelope(c, out, t, v)
  if (v.lowpass) {
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = v.lowpass
    lp.Q.value = 0
    o.connect(lp)
    lp.connect(env)
  } else o.connect(env)
  o.start(t)
  o.stop(t + v.dur + 0.05)
  return [o]
}

function renderFm(c: BaseAudioContext, out: AudioNode, t: number, v: FmVoice): AudioScheduledSourceNode[] {
  const carrier = osc(c, 'sine', v.bendFrom ?? v.freq, t)
  if (v.bendFrom) carrier.frequency.linearRampToValueAtTime(v.freq, t + (v.bendTime ?? 0.03))
  if (v.dropTo) {
    carrier.frequency.setValueAtTime(v.freq, t + v.attack + (v.hold ?? 0))
    carrier.frequency.linearRampToValueAtTime(v.dropTo, t + v.dur)
  }
  const nodes: AudioScheduledSourceNode[] = [carrier]
  const mod = (hz: number, depth: number) => {
    const m = osc(c, 'sine', hz, t)
    const g = c.createGain()
    g.gain.value = depth
    m.connect(g)
    g.connect(carrier.frequency)
    m.start(t)
    m.stop(t + v.dur + 0.05)
    nodes.push(m)
  }
  mod(v.modHz, v.modDepth)
  if (v.jitterHz && v.jitterDepth) mod(v.jitterHz, v.jitterDepth)
  carrier.connect(envelope(c, out, t, v))
  carrier.start(t)
  carrier.stop(t + v.dur + 0.05)
  return nodes
}

function renderNoise(c: BaseAudioContext, out: AudioNode, t: number, v: NoiseVoice, bank: NoiseBank): AudioScheduledSourceNode[] {
  const src = c.createBufferSource()
  src.buffer = bank[v.colour]
  src.loop = true
  const f = c.createBiquadFilter()
  f.type = v.filter
  f.frequency.setValueAtTime(v.freq, t)
  if (v.freqTo) f.frequency.exponentialRampToValueAtTime(v.freqTo, t + (v.sweep ?? v.dur))
  f.Q.value = v.q ?? (v.filter === 'bandpass' ? 1 : 0)
  src.connect(f)
  const nodes: AudioScheduledSourceNode[] = [src]
  let dest = out
  if (v.am) {
    // A slow tremolo that only ever takes away: the gain swings between 1 - depth and 1
    const am = c.createGain()
    am.gain.value = 1 - v.am.depth / 2
    const lfo = osc(c, 'sine', v.am.hz, t)
    const depth = c.createGain()
    depth.gain.value = v.am.depth / 2
    lfo.connect(depth)
    depth.connect(am.gain)
    am.connect(out)
    lfo.start(t)
    lfo.stop(t + v.dur + 0.05)
    nodes.push(lfo)
    dest = am
  }
  f.connect(envelope(c, dest, t, v))
  src.start(t, (v.offset ?? 0) % BANK_SECONDS)
  src.stop(t + v.dur + 0.05)
  return nodes
}

/** Schedules every voice of `score` to start `at` s on the context's clock, into `out`; returns the sources (to stop early). */
export function renderScore(c: BaseAudioContext, out: AudioNode, at: number, score: Pick<Score, 'voices'>, bank: NoiseBank): AudioScheduledSourceNode[] {
  const nodes: AudioScheduledSourceNode[] = []
  for (const v of score.voices) {
    const t = at + v.at
    if (v.kind === 'tone') nodes.push(...renderTone(c, out, t, v))
    else if (v.kind === 'fm') nodes.push(...renderFm(c, out, t, v))
    else nodes.push(...renderNoise(c, out, t, v, bank))
  }
  return nodes
}
