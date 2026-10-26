import type { DisplayTier } from '@game/logic/rarity'
import { matchSoundOn, soundOn, subscribeSound } from './prefs'
import { makeBank, renderScore, safetyNet, type NoiseBank } from './render'
import { scoreFor, type SoundRequest } from './scores'

/*
 * TouchLine's sounds, synthesised in the browser with the Web Audio API: no
 * audio files ship and no recording is copied. Oscillators, FM pairs, gain
 * envelopes and filtered noise make every sound: the reel's tick, whoosh and
 * pop below, and the palette in scores.ts (`playSound`), rendered by render.ts.
 *
 * Rules: nothing plays before a user gesture (the context is created or resumed
 * inside one, see `armAudio`), nothing plays while sound is off, and nothing
 * happens where there is no AudioContext (tests, headless runs, old browsers).
 * Match sounds also follow their own switch (`matchSoundOn`). Math.random here
 * only varies a tick's pitch and fills the tick's noise; the palette's variation
 * is seeded per sound. All of it is presentation and never touches the game.
 */

/** The master volume: modest, under the page's own sounds and the viewer's music. */
export const MASTER_GAIN = 0.35

export { LANDING_NOTES } from './scores'

/** Seconds in the tick's and the whoosh's noise buffers (the smoke test tells them apart by length). */
export const TICK_NOISE_S = 0.04
export const WHOOSH_NOISE_S = 0.6

type Ctor = typeof AudioContext

let ctx: AudioContext | null = null
let master: GainNode | null = null
let tickNoise: AudioBuffer | null = null
let whooshNoise: AudioBuffer | null = null
let bank: NoiseBank | null = null
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
      master.connect(safetyNet(ctx))
      tickNoise = noise(ctx, TICK_NOISE_S)
      whooshNoise = noise(ctx, WHOOSH_NOISE_S)
      bank = makeBank(ctx)
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
  window.addEventListener('click', clickSound, { capture: true, passive: true })
  subscribeSound(() => {
    if (!ctx || !master) return
    const on = soundOn()
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(on ? MASTER_GAIN : 0, ctx.currentTime)
  })
}

/** A primary button pressed: the palette's quiet click (none on a disabled button or inside `data-sound="off"`). */
function clickSound(e: Event): void {
  const t = e.target as Element | null
  const b = typeof t?.closest === 'function' ? t.closest('.btn.primary') : null
  if (!b || (b as HTMLButtonElement).disabled || b.closest('[data-sound="off"]')) return
  playSound({ id: 'click' })
}

/** The context to play on now, or null: no gesture yet, sound off, or no Web Audio. */
export function liveAudio(): { c: AudioContext; out: AudioNode } | null {
  if (!ctx || !master || !soundOn() || ctx.state === 'closed') return null
  return { c: ctx, out: master }
}

/** A gain envelope: silent, up to `peak` in `attack` s, then an exponential fall to silence by `at + dur`. */
function envelope(c: AudioContext, out: AudioNode, at: number, peak: number, attack: number, dur: number): GainNode {
  const g = c.createGain()
  g.gain.value = 0.0001
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

/** The reveal, rising with rarity (scores.ts `landingScore`); the Icons card plays gold's. `reduced` (prefers-reduced-motion) drops the shimmer. */
export function playLanding(display: DisplayTier, reduced = false): void {
  playSound({ id: 'landing', tier: display, reduced })
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

/** The Upgrader's needle passing a tick mark: the reel's tick, now. `rate` (about 0.9 to 1.2) shifts its pitch. */
export function playDialTick(rate: number): void {
  const a = liveAudio()
  if (a) playTick(a.c.currentTime + 0.005, rate)
}

/** The Upgrader's verdict, a sting for a win and a falling "wah-wah" for a loss (scores.ts `upgradeScore`); `reduced` drops the win's shimmer. */
export function playUpgradeResult(won: boolean, reduced = false): void {
  playSound({ id: 'upgrade', won, reduced })
}

/**
 * Plays one sound of the palette (scores.ts) `delay` s from now: nothing without a gesture, with sound off, or for
 * a match sound with match sounds off. Returns the sources it scheduled (empty when it played nothing).
 */
export function playSound(req: SoundRequest, delay = 0): AudioScheduledSourceNode[] {
  const a = liveAudio()
  if (!a || !bank) return []
  const score = scoreFor(req)
  if (score.category === 'match' && !matchSoundOn()) return []
  try {
    return renderScore(a.c, a.out, a.c.currentTime + 0.01 + Math.max(0, delay), score, bank)
  } catch {
    return []
  }
}
