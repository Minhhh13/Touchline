import type { DisplayTier } from '@game/logic/rarity'
import { categoryOn, soundOn, soundVolume, subscribeSound, subscribeVolume, volumeGain } from './prefs'
import { makeBank, renderScore, safetyNet, type NoiseBank } from './render'
import { scoreFor, type Score, type SoundCategory, type SoundRequest } from './scores'
import { CUE_CATEGORY, isCue, makeThinner, type CueRequest } from './cues'

/*
 * TouchLine's sounds, synthesised in the browser with the Web Audio API: no
 * audio files ship and no recording is copied. Oscillators, FM pairs, gain
 * envelopes and filtered noise make every sound, all of them scores: the
 * palette in scores.ts (`playSound`, the reel's tick, whoosh and pop included),
 * the cues in voices.ts and the season's in seasonScores.ts (`playScore`),
 * rendered by render.ts.
 *
 * Rules: nothing plays before a user gesture (the context is created or resumed
 * inside one, see `armAudio`), nothing plays while sound is off, and nothing
 * happens where there is no AudioContext (tests, headless runs, old browsers).
 * Match, draft and interface sounds also follow their own switches (`categoryOn`), and the
 * master follows the viewer's volume on a perceptual curve (`gainNow`, `volumeGain`).
 * Math.random (in reel.ts) only varies a tick's pitch; the palette's variation is
 * seeded per sound. All of it is presentation and never touches the game.
 */

/** The master volume: modest, under the page's own sounds and the viewer's music. */
export const MASTER_GAIN = 0.35

export { LANDING_NOTES } from './scores'

type Ctor = typeof AudioContext

let ctx: AudioContext | null = null
let master: GainNode | null = null
let bank: NoiseBank | null = null
let armed = false

/** The master's gain now: `MASTER_GAIN` at the viewer's volume (on the perceptual curve, `volumeGain`), 0 with sound off. */
export function gainNow(): number {
  return soundOn() ? MASTER_GAIN * volumeGain(soundVolume()) : 0
}

type Voices = typeof import('./voices')
let voices: Voices | null = null
let voicesLoading: Promise<Voices | null> | null = null

/** The second pass's voices (voices.ts), a chunk of their own: fetched once, on the first gesture, so the first download never carries them. */
function loadVoices(): Promise<Voices | null> {
  voicesLoading ??= import('./voices').then(
    (m) => (voices = m),
    () => {
      voicesLoading = null
      return null
    },
  )
  return voicesLoading
}

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** The page has had a real gesture (sticky user activation); true where the browser cannot say. */
function hadGesture(): boolean {
  const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined
  return ua ? ua.hasBeenActive : true
}

/** Creates the context (or resumes a suspended one). Call only from a user gesture; does nothing while sound is off, or before the page has had a real one. */
export function unlockAudio(): void {
  if (!soundOn() || !hadGesture()) return
  let fresh = false
  try {
    if (!ctx) {
      const C = audioCtor()
      if (!C) return
      ctx = new C()
      fresh = true
      master = ctx.createGain()
      master.gain.value = gainNow()
      master.connect(safetyNet(ctx))
      const made = (bank = makeBank(ctx))
      // The buffers a sound has not asked for yet, each in a task of its own once the tap is over
      setTimeout(() => void made.white, 400)
      setTimeout(() => void made.pink, 800)
      void loadVoices()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  } catch {
    // A context this call made before the failure is closed, so a retry on the next gesture never piles up contexts
    if (!fresh) return
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
    ctx = null
    master = null
    bank = null
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
  const onGesture = (e: Event) => {
    if (e.isTrusted) unlockAudio()
  }
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, onGesture, { capture: true, passive: true })
  window.addEventListener('click', clickSound, { capture: true, passive: true })
  const follow = () => {
    // Sound switched on (the switch is pressed inside a gesture): make or resume the context now, not on the next tap
    if (soundOn() && (!ctx || ctx.state === 'suspended')) unlockAudio()
    if (!ctx || !master) return
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(gainNow(), ctx.currentTime)
    // Sound off: the context stops running too (a silent context still keeps the device's audio busy)
    if (!soundOn() && ctx.state === 'running') void ctx.suspend().catch(() => undefined)
  }
  subscribeSound(follow)
  subscribeVolume(follow)
}

/**
 * A primary button pressed: the palette's quiet click, or the confirm (a short rising fifth) when the button is a
 * dialog's own action. None on a disabled button or inside `data-sound="off"`.
 */
function clickSound(e: Event): void {
  if (!e.isTrusted) return
  const t = e.target as Element | null
  const b = typeof t?.closest === 'function' ? t.closest('.btn.primary') : null
  if (!b || (b as HTMLButtonElement).disabled || b.closest('[data-sound="off"]')) return
  if (b.closest('[role="dialog"], [role="alertdialog"]')) playSound({ id: 'confirm' })
  else playSound({ id: 'click' })
}

/** The context to play on now, or null: no gesture yet, sound off, or no Web Audio. */
export function liveAudio(): { c: AudioContext; out: AudioNode } | null {
  if (!ctx || !master || !soundOn() || ctx.state === 'closed') return null
  return { c: ctx, out: master }
}

/** The context for the reel's own sounds: as `liveAudio`, and null while the draft's sounds are off. */
function draftAudio(): { c: AudioContext; out: AudioNode } | null {
  return categoryOn('draft') ? liveAudio() : null
}

/** One of the reel's own scores at `at` on the context's clock (not thinned: the reel paces itself); the source to stop on a skip, or null. */
function reelSound(req: SoundRequest, at: number): AudioScheduledSourceNode | null {
  const a = draftAudio()
  if (!a || !bank) return null
  try {
    // A tick's or a pop's voices all end together, so the first source stands for the sound
    return renderScore(a.c, a.out, Math.max(at, a.c.currentTime), scoreFor(req), bank)[0] ?? null
  } catch {
    return null
  }
}

/** A card passing the marker: a short wooden knock near 2 kHz over a tiny tock (scores.ts `reelTick`). `rate` (about 0.9 to 1.2) shifts its pitch. */
export function playTick(at: number, rate: number): AudioScheduledSourceNode | null {
  return reelSound({ id: 'tick', rate }, at)
}

/** The season showing: a soft breath of pink noise swept up. */
export function playWhoosh(at: number): AudioScheduledSourceNode | null {
  return reelSound({ id: 'whoosh' }, at)
}

/** The season landing on the drum: a round wooden pop. */
export function playPop(at: number): AudioScheduledSourceNode | null {
  return reelSound({ id: 'pop' }, at)
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

/** The least time between two of the dial's ticks, ms: as the reel's (`MIN_TICK_GAP_MS`), so a fast needle never buzzes. */
export const DIAL_TICK_GAP_MS = 15
let lastDialTick = -Infinity

/** The Upgrader's needle passing a tick mark: the reel's tick, now (one per `DIAL_TICK_GAP_MS` at most). `rate` (about 0.9 to 1.2) shifts its pitch. */
export function playDialTick(rate: number): void {
  const a = liveAudio()
  if (!a) return
  const now = clock()
  if (now - lastDialTick < DIAL_TICK_GAP_MS && now >= lastDialTick) return
  lastDialTick = now
  playTick(a.c.currentTime + 0.005, rate)
}

/** The Upgrader's verdict, a sting for a win and a falling "wah-wah" for a loss (scores.ts `upgradeScore`); `reduced` drops the win's shimmer. */
export function playUpgradeResult(won: boolean, reduced = false): void {
  playSound({ id: 'upgrade', won, reduced })
}

const thin = makeThinner()
const clock = () => (typeof performance !== 'undefined' ? performance.now() : 0)

/**
 * Plays one sound of the palette (scores.ts) or one cue (cues.ts, voices.ts) `delay` s from now: nothing without a
 * gesture, with sound off, with the sound's category switched off (`categoryOn`), or for a rapid repeat the thinning
 * drops (`CUE_GAP_MS`). Returns the sources it scheduled (empty when it played nothing, or when a cue's voices are
 * still loading: the cue then plays as they arrive, if it is still within half a second).
 */
export function playSound(req: SoundRequest | CueRequest, delay = 0): AudioScheduledSourceNode[] {
  const a = liveAudio()
  if (!a || !bank) return []
  if (!categoryOn(isCue(req.id) ? CUE_CATEGORY[req.id] : scoreFor(req as SoundRequest).category)) return []
  if (!thin(req.id, clock())) return []
  if (!isCue(req.id)) return render(a, scoreFor(req as SoundRequest), delay)
  const cue = req as CueRequest
  if (voices) return render(a, voices.cueScore(cue), delay)
  const asked = clock()
  void loadVoices().then((v) => {
    const now = liveAudio()
    if (v && now && clock() - asked < 500) render(now, v.cueScore(cue), delay)
  })
  return []
}

function render(a: { c: AudioContext; out: AudioNode }, score: Score, delay: number): AudioScheduledSourceNode[] {
  if (!bank) return []
  try {
    return renderScore(a.c, a.out, a.c.currentTime + 0.01 + Math.max(0, delay), score, bank)
  } catch {
    return []
  }
}

/** A score built outside the palette: its voices, and (the season's) the switch it follows and the id it is thinned by. */
export interface OuterScore extends Pick<Score, 'voices'> {
  category?: SoundCategory
  /** Thinned by `CUE_GAP_MS` under this key (the season's as `season:<id>`). */
  thinAs?: string
}

/**
 * Plays a score built outside the palette (seasonScores.ts: the season's cues, loaded with the screens that use them)
 * `delay` s from now, on the same master and under the same rules as `playSound`: nothing without a gesture, with
 * sound off, with its category switched off, for a repeat inside its gap, or without Web Audio. Returns the sources it
 * scheduled (to stop on a pause).
 */
export function playScore(score: OuterScore, delay = 0): AudioScheduledSourceNode[] {
  const a = liveAudio()
  if (!a || !bank) return []
  if (score.category && !categoryOn(score.category)) return []
  if (score.thinAs && !thin(score.thinAs, clock())) return []
  try {
    return renderScore(a.c, a.out, a.c.currentTime + 0.01 + Math.max(0, delay), score, bank)
  } catch {
    return []
  }
}
