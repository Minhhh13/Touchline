import type { Tier } from '@game/logic/rarity'
import { soundOn, subscribeSound } from './prefs'

/*
 * TouchLine's sounds, synthesised in the browser with the Web Audio API: no
 * audio files ship and no recording is copied. A few oscillators, gain
 * envelopes and a burst of white noise make every sound below.
 *
 * Rules: nothing plays before a user gesture (the context is created or resumed
 * inside one, see `armAudio`), nothing plays while sound is off, and nothing
 * happens where there is no AudioContext (tests, headless runs, old browsers).
 * Math.random here only varies a tick's pitch and fills the noise buffer; it is
 * presentation and never touches the game's RNG.
 */

/** The master volume: modest, under the page's own sounds and the viewer's music. */
export const MASTER_GAIN = 0.35

/** The first note of each landing; a quick way to tell the landings apart (and what the smoke test listens for). */
export const LANDING_NOTES: Record<Tier, readonly number[]> = {
  blue: [659.25],
  purple: [587.33, 880],
  pink: [698.46, 1046.5],
  red: [523.25, 659.25, 783.99, 1046.5],
  gold: [392, 493.88, 587.33, 783.99],
}

/** Seconds in the tick's and the whoosh's noise buffers (the smoke test tells them apart by length). */
export const TICK_NOISE_S = 0.04
export const WHOOSH_NOISE_S = 0.6

type Ctor = typeof AudioContext

let ctx: AudioContext | null = null
let master: GainNode | null = null
let tickNoise: AudioBuffer | null = null
let whooshNoise: AudioBuffer | null = null
let armed = false

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function noise(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate * seconds)), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Creates the context (or resumes a suspended one). Call only from a user gesture; does nothing while sound is off. */
export function unlockAudio(): void {
  if (!soundOn()) return
  try {
    if (!ctx) {
      const C = audioCtor()
      if (!C) return
      ctx = new C()
      master = ctx.createGain()
      master.gain.value = MASTER_GAIN
      master.connect(ctx.destination)
      tickNoise = noise(ctx, TICK_NOISE_S)
      whooshNoise = noise(ctx, WHOOSH_NOISE_S)
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  } catch {
    ctx = null
    master = null
  }
}

/**
 * Listens for the viewer's gestures (capture phase, so the Spin click unlocks the
 * context before the reel starts) and mutes the master at once when sound is turned
 * off. Safe to call many times.
 */
export function armAudio(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlockAudio, { capture: true, passive: true })
  subscribeSound(() => {
    if (!ctx || !master) return
    const on = soundOn()
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(on ? MASTER_GAIN : 0, ctx.currentTime)
  })
}

/** The context to play on now, or null: no gesture yet, sound off, or no Web Audio. */
export function liveAudio(): { c: AudioContext; out: AudioNode } | null {
  if (!ctx || !master || !soundOn() || ctx.state === 'closed') return null
  return { c: ctx, out: master }
}

/** A gain envelope: silent, up to `peak` in `attack` s, then an exponential fall to silence by `at + dur`. */
function envelope(c: AudioContext, out: AudioNode, at: number, peak: number, attack: number, dur: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(out)
  return g
}

function tone(c: AudioContext, out: AudioNode, at: number, freq: number, opts: { type?: OscillatorType; peak?: number; attack?: number; dur?: number; glideTo?: number } = {}): OscillatorNode {
  const dur = opts.dur ?? 0.5
  const osc = c.createOscillator()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, at)
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, at + dur * 0.7)
  osc.connect(envelope(c, out, at, opts.peak ?? 0.3, opts.attack ?? 0.005, dur))
  osc.start(at)
  osc.stop(at + dur + 0.05)
  return osc
}

/** A bell-ish note: the fundamental and a quiet, slightly inharmonic overtone. */
function chime(c: AudioContext, out: AudioNode, at: number, freq: number, opts: { type?: OscillatorType; peak?: number; dur?: number } = {}): void {
  const peak = opts.peak ?? 0.3
  const dur = opts.dur ?? 0.7
  tone(c, out, at, freq, { type: opts.type ?? 'sine', peak, dur })
  tone(c, out, at, freq * 2.76, { peak: peak * 0.12, dur: dur * 0.45 })
}

/** A card passing the marker: a 40 ms burst of band-passed noise. `rate` (about 0.9 to 1.1) shifts its pitch. */
export function playTick(at: number, rate: number): AudioScheduledSourceNode | null {
  const a = liveAudio()
  if (!a || !tickNoise) return null
  const { c, out } = a
  const src = c.createBufferSource()
  src.buffer = tickNoise
  src.playbackRate.value = rate
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 3200 * rate
  band.Q.value = 3
  src.connect(band)
  band.connect(envelope(c, out, at, 0.55, 0.001, 0.035))
  src.start(at)
  src.stop(at + TICK_NOISE_S)
  return src
}

/** The season showing: a short rising whoosh of filtered noise. */
export function playWhoosh(at: number): AudioScheduledSourceNode | null {
  const a = liveAudio()
  if (!a || !whooshNoise) return null
  const { c, out } = a
  const src = c.createBufferSource()
  src.buffer = whooshNoise
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 1.4
  band.frequency.setValueAtTime(320, at)
  band.frequency.exponentialRampToValueAtTime(2400, at + 0.42)
  src.connect(band)
  band.connect(envelope(c, out, at, 0.32, 0.18, 0.5))
  src.start(at)
  src.stop(at + WHOOSH_NOISE_S)
  return src
}

/** The season landing on the drum: a soft pop, a sine dropping in pitch. */
export function playPop(at: number): AudioScheduledSourceNode | null {
  const a = liveAudio()
  if (!a) return null
  return tone(a.c, a.out, at, 540, { glideTo: 190, peak: 0.45, dur: 0.14 })
}

/**
 * The reveal, scaled by rarity: blue a plain chime; purple and pink a brighter two-note chime
 * (pink higher and brighter); red a rising arpeggio; gold an arpeggio into a held sting chord with a
 * shimmer of high pings on top. `reduced` (prefers-reduced-motion) drops the shimmer.
 */
export function playLanding(tier: Tier, reduced = false): void {
  const a = liveAudio()
  if (!a) return
  const { c, out } = a
  const t = c.currentTime + 0.01
  const n = LANDING_NOTES[tier]
  switch (tier) {
    case 'blue':
      chime(c, out, t, n[0], { dur: 0.8 })
      break
    case 'purple':
      chime(c, out, t, n[0], { dur: 0.5 })
      chime(c, out, t + 0.12, n[1], { dur: 0.9 })
      break
    case 'pink':
      chime(c, out, t, n[0], { type: 'triangle', dur: 0.5 })
      chime(c, out, t + 0.11, n[1], { type: 'triangle', dur: 1 })
      break
    case 'red':
      n.forEach((f, i) => chime(c, out, t + i * 0.075, f, { type: 'triangle', peak: 0.26, dur: i === n.length - 1 ? 1.1 : 0.4 }))
      break
    case 'gold': {
      n.forEach((f, i) => chime(c, out, t + i * 0.06, f, { type: 'triangle', peak: 0.24, dur: 0.35 }))
      const sting = t + 0.26
      tone(c, out, sting, 98, { type: 'sine', peak: 0.4, attack: 0.004, dur: 0.6 })
      for (const f of [783.99, 987.77, 1174.66]) tone(c, out, sting, f, { type: 'triangle', peak: 0.14, attack: 0.01, dur: 1.5 })
      if (!reduced) {
        const pings = [2093, 2637, 3136, 2349, 3520, 2794, 3951, 3136]
        pings.forEach((f, i) => tone(c, out, sting + 0.08 + i * 0.07 + Math.random() * 0.03, f * (0.99 + Math.random() * 0.02), { peak: 0.07, dur: 0.25 }))
      }
      break
    }
  }
}

/** Stops scheduled sources that have not finished (a skip, a new spin, a closed screen). */
export function stopAll(nodes: Iterable<AudioScheduledSourceNode>): void {
  for (const n of nodes) {
    try {
      n.stop()
    } catch {
      // Already stopped
    }
  }
}
