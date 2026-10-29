/*
 * TouchLine's sound palette as plain data. Every sound is a score: a list of
 * voices (an oscillator, an FM pair or a band of noise), each with its own
 * envelope, start and length in seconds. `render.ts` turns a score into Web
 * Audio nodes; nothing here touches audio, the DOM or the game.
 *
 * Loudness: each score is normalised so the sum of its voices' envelopes,
 * every voice weighted by the most its source can send (`sourceBound`), never
 * passes the score's `level`, and no level passes `MAX_LEVEL`. Under the
 * master gain that keeps a sound, even two at once, far from clipping.
 *
 * Cosmetic variation (a ping's timing, a crowd layer's onset) comes from a
 * small seeded generator (`seeded` in noise.ts), never `Math.random` and never
 * the game's RNG, so a sound is the same every time it is asked for the same
 * way (the tests and the offline renders rely on it).
 */
import type { DisplayTier, Tier } from '@game/logic/rarity'
import type { PickGrade } from '@game/logic/pickGrades'
import { seeded, type NoiseColour } from './noise'
import { CUE_CATEGORY, isCue, type CueId } from './cues'

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth'

/** The silence an envelope starts and ends on (an exponential ramp cannot reach 0). */
export const FLOOR = 0.0001
/** No score is louder than this before the master gain. */
export const MAX_LEVEL = 0.9

interface Shape {
  /** Seconds from the score's start. */
  at: number
  /** Linear rise to `peak`, s. */
  attack: number
  /** Held at `peak` after the attack, s. */
  hold?: number
  /** The whole voice, attack and release included, s: an exponential fall to silence after the hold. */
  dur: number
  peak: number
}

/** An oscillator, optionally gliding (exponentially) to `glideTo` over `glideTime` s and through a low-pass. */
export interface ToneVoice extends Shape {
  kind: 'tone'
  freq: number
  wave?: Wave
  glideTo?: number
  glideTime?: number
  lowpass?: number
}

/**
 * An FM pair, the pea whistle: a sine carrier whose frequency the pea swings `modDepth` Hz either way `modHz`
 * times a second, with a slower wobble on top (`jitterHz`, `jitterDepth`), a quick bend up from `bendFrom` as
 * the breath arrives and a small drop to `dropTo` as it leaves.
 */
export interface FmVoice extends Shape {
  kind: 'fm'
  freq: number
  modHz: number
  modDepth: number
  jitterHz?: number
  jitterDepth?: number
  bendFrom?: number
  bendTime?: number
  dropTo?: number
}

/** A band of noise: white or pink through one filter, its frequency sweeping to `freqTo` over `sweep` s, with an optional slow tremolo (`am`) for a crowd's swell. */
export interface NoiseVoice extends Shape {
  kind: 'noise'
  colour: NoiseColour
  filter: 'bandpass' | 'lowpass' | 'highpass'
  freq: number
  freqTo?: number
  sweep?: number
  /** Band-pass: the quality factor. Low- and high-pass: the resonance in dB (0 for none). */
  q?: number
  /** Seconds into the looped buffer to start from (so two layers never read the same samples). */
  offset?: number
  am?: { hz: number; depth: number }
}

export type Voice = ToneVoice | FmVoice | NoiseVoice

export type SoundCategory = 'ui' | 'draft' | 'match' | 'reward'
export type GoalTone = 'ours' | 'theirs' | 'neutral'
export type WhistleCall = 'kickoff' | 'half' | 'full'

/** What can be asked for. */
export type SoundRequest =
  | { id: 'whistle'; call: WhistleCall }
  | { id: 'goal'; tone: GoalTone; replay?: boolean; seed?: string }
  | { id: 'near-miss'; strength: number; seed?: string }
  | { id: 'save'; strength: number; seed?: string }
  | { id: 'card'; red: boolean }
  | { id: 'sub'; ours: boolean }
  | { id: 'landing'; tier: DisplayTier; reduced?: boolean; seed?: string }
  | { id: 'pick' }
  | { id: 'upgrade'; won: boolean; reduced?: boolean; seed?: string }
  | { id: 'fanfare'; treble: boolean; reduced?: boolean; seed?: string }
  | { id: 'grade'; grade: PickGrade; reduced?: boolean; seed?: string }
  | { id: 'click' }
  /** The reel's own: a card passing the marker (`rate` about 0.9 to 1.2 shifts it), the season drum rolling, the drum stopping. */
  | { id: 'tick'; rate: number }
  | { id: 'whoosh' }
  | { id: 'pop' }

export type SoundId = SoundRequest['id']

export interface Score {
  id: SoundId | CueId
  category: SoundCategory
  /** The bound the voices were normalised to. */
  level: number
  voices: Voice[]
}

export const CATEGORY: Record<SoundId, SoundCategory> = {
  whistle: 'match',
  goal: 'match',
  'near-miss': 'match',
  save: 'match',
  card: 'match',
  sub: 'match',
  landing: 'draft',
  pick: 'draft',
  upgrade: 'draft',
  grade: 'draft',
  fanfare: 'reward',
  click: 'ui',
  tick: 'draft',
  whoosh: 'draft',
  pop: 'draft',
}

/** The envelope's value `t` s into the score: the same ramps `render.ts` schedules (linear up, held, exponential down). */
export function envAt(v: Shape, t: number): number {
  const x = t - v.at
  if (x < 0 || x > v.dur) return 0
  if (x < v.attack) return FLOOR + (v.peak - FLOOR) * (x / v.attack)
  const held = v.attack + (v.hold ?? 0)
  if (x <= held) return v.peak
  const rel = v.dur - held
  if (rel <= 0) return v.peak
  return v.peak * Math.pow(FLOOR / Math.max(FLOOR, v.peak), (x - held) / rel)
}

/**
 * The most a voice's source can send before its envelope: 1 for an oscillator; for noise (peaking at 1 before its
 * filter) a bound on the filtered peak, measured over the noise buffers and checked by the tests. A narrow band of
 * pink noise is quiet, so it may take a bigger envelope for the same loudness.
 */
export function sourceBound(v: Voice): number {
  // A sawtooth or square through a low-pass rings a little past 1 (Gibbs)
  if (v.kind === 'tone') return v.wave === 'sawtooth' || v.wave === 'square' ? 1.2 : 1
  if (v.kind === 'fm') return 1
  const q = Math.max(0.3, v.q ?? 1)
  if (v.colour === 'white') return v.filter === 'highpass' ? 2 : v.filter === 'lowpass' ? 1.4 : Math.min(1.4, 1.6 / Math.sqrt(q))
  // Pink noise is quieter the narrower its band and the higher it starts (most of its energy is low)
  if (v.filter === 'lowpass') return Math.min(1, 0.85 + v.freq / 16000)
  if (v.filter === 'highpass') return Math.min(0.8, 0.05 + 0.55 * Math.pow(2000 / v.freq, 0.25))
  return Math.min(1, 0.42 / Math.pow(q, 0.45))
}

/** When the score is over, s. */
export function scoreLength(voices: readonly Voice[]): number {
  return voices.reduce((m, v) => Math.max(m, v.at + v.dur), 0)
}

/**
 * The bound on the score's output: the most the weighted envelopes add up to at any moment (sampled every 2 ms and
 * at every peak). Oscillators add up in full (their peaks line up); independent bands of noise add in quadrature,
 * as the peaks of independent noise do, which the offline renders bear out (the safety net in render.ts covers the
 * rare sample beyond).
 */
export function peakOf(voices: readonly Voice[]): number {
  const end = scoreLength(voices)
  const times: number[] = []
  for (let t = 0; t <= end; t += 0.002) times.push(t)
  for (const v of voices) times.push(v.at + v.attack, v.at + v.attack + (v.hold ?? 0))
  // Each voice's bound once, not at every sample (the same numbers)
  const bounds = voices.map(sourceBound)
  let peak = 0
  for (const t of times) {
    let tones = 0
    let noise2 = 0
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i]
      const e = envAt(v, t) * bounds[i]
      if (v.kind === 'noise') noise2 += e * e
      else tones += e
    }
    peak = Math.max(peak, tones + Math.sqrt(noise2))
  }
  return peak
}

/**
 * The voices scaled so their bound is `level` (never above `MAX_LEVEL`). An exponential fall always ends on the same
 * floor, so scaling a peak bends its tail a little: a few passes settle the bound to within a millionth.
 */
export function normalise(id: SoundId | CueId, level: number, voices: Voice[]): Score {
  const target = Math.min(MAX_LEVEL, level)
  return { id, category: isCue(id) ? CUE_CATEGORY[id] : CATEGORY[id], level: target, voices: scaleTo(target, voices) }
}

/** The voices scaled so their bound (`peakOf`) is `level`: what `normalise` does, for a score built elsewhere (seasonScores.ts). */
export function scaleTo(level: number, voices: Voice[]): Voice[] {
  let out = voices
  for (let pass = 0; pass < 6; pass++) {
    const p = peakOf(out)
    if (!(p > 0)) break
    if (Math.abs(p - level) < 1e-7) break
    const k = level / p
    out = out.map((v) => ({ ...v, peak: v.peak * k }))
  }
  return out
}

// ---- Building blocks -------------------------------------------------------------------------------------

export function tone(at: number, freq: number, o: Partial<Omit<ToneVoice, 'kind' | 'at' | 'freq'>> = {}): ToneVoice {
  const dur = o.dur ?? 0.5
  return { kind: 'tone', at, freq, wave: o.wave ?? 'sine', attack: o.attack ?? 0.005, hold: o.hold ?? 0, dur, peak: o.peak ?? 0.3, ...(o.glideTo ? { glideTo: o.glideTo, glideTime: o.glideTime ?? dur * 0.7 } : {}), ...(o.lowpass ? { lowpass: o.lowpass } : {}) }
}

/** A bell-ish note: the fundamental and a quiet, slightly inharmonic overtone. */
export function chime(at: number, freq: number, o: { wave?: Wave; peak?: number; dur?: number } = {}): ToneVoice[] {
  const peak = o.peak ?? 0.3
  const dur = o.dur ?? 0.7
  return [tone(at, freq, { wave: o.wave ?? 'sine', peak, dur }), tone(at, freq * 2.76, { peak: peak * 0.12, dur: dur * 0.45 })]
}

export function noise(at: number, o: Omit<NoiseVoice, 'kind' | 'at' | 'colour' | 'attack' | 'peak'> & { colour?: NoiseColour; attack?: number; peak?: number }): NoiseVoice {
  return { kind: 'noise', at, colour: o.colour ?? 'white', attack: o.attack ?? 0.002, peak: o.peak ?? 1, ...o } as NoiseVoice
}

/** A brass note: a sawtooth through a darker low-pass with a soft attack, doubled an octave down (round 9: warmer, the edge filed off). */
export function brass(at: number, freq: number, dur: number, peak = 0.3, hold = 0): ToneVoice[] {
  return [tone(at, freq, { wave: 'sawtooth', attack: 0.04, hold, dur, peak, lowpass: Math.min(2200, freq * 3) }), tone(at, freq / 2, { wave: 'triangle', attack: 0.04, hold, dur, peak: peak * 0.5 })]
}

/** High glints over a reward, scattered by the seed; none with reduced motion. Soft-edged and quiet (round 9): a sparkle, not a row of beeps. */
export function shimmer(at: number, freqs: number[], step: number, r: () => number, peak = 0.05): ToneVoice[] {
  return freqs.map((f, i) => tone(at + i * step + r() * 0.03, f * (0.99 + r() * 0.02), { peak: peak * 0.8, attack: 0.012, dur: 0.38 }))
}

/**
 * A warm mallet, the round 9 palette's main voice (a marimba's bar rather than `chime`'s glassy bell): a sine
 * fundamental with a soft attack, a quiet octave, its fourth partial (3.93 times) gone in a blink, and a felt knock of
 * low-passed noise. `bright` (0 to 1) scales the overtones; `knock: false` leaves the felt out.
 */
export function mallet(at: number, freq: number, o: { peak?: number; dur?: number; bright?: number; knock?: boolean } = {}): Voice[] {
  const peak = o.peak ?? 0.3
  const dur = o.dur ?? 0.6
  const b = o.bright ?? 1
  const v: Voice[] = [tone(at, freq, { attack: 0.006, dur, peak })]
  if (b > 0) v.push(tone(at, freq * 2, { attack: 0.006, dur: dur * 0.5, peak: peak * 0.16 * b }), tone(at, freq * 3.93, { attack: 0.003, dur: Math.max(0.03, Math.min(0.12, dur * 0.25)), peak: peak * 0.05 * b }))
  if (o.knock !== false) v.push(noise(at, { filter: 'lowpass', freq: Math.min(1800, freq * 2), q: 0, attack: 0.002, dur: 0.03, peak: peak * 0.35 }))
  return v
}

/** A warm bell for a reward's top note: harmonic partials (1, 2, 3) rather than `chime`'s inharmonic 2.76, so it rings round. */
export function bell(at: number, freq: number, o: { peak?: number; dur?: number } = {}): ToneVoice[] {
  const peak = o.peak ?? 0.25
  const dur = o.dur ?? 1.2
  return [tone(at, freq, { attack: 0.008, dur, peak }), tone(at, freq * 2, { attack: 0.008, dur: dur * 0.55, peak: peak * 0.22 }), tone(at, freq * 3, { attack: 0.006, dur: dur * 0.3, peak: peak * 0.07 })]
}

/**
 * A held chord of soft, low-passed triangles under a moment, each note doubled a quarter of a semitone sharp so it
 * breathes (the first of each pair is in tune, so a test can find the note).
 */
export function pad(at: number, freqs: readonly number[], o: { peak?: number; attack?: number; hold?: number; dur?: number; lowpass?: number } = {}): ToneVoice[] {
  const peak = o.peak ?? 0.1
  const attack = o.attack ?? 0.05
  const dur = o.dur ?? 1.2
  return freqs.flatMap((f) => {
    const lp = o.lowpass ?? Math.min(2400, f * 3)
    const s = { wave: 'triangle' as const, attack, hold: o.hold ?? 0, dur, lowpass: lp }
    return [tone(at, f, { ...s, peak }), tone(at, f * 1.0145, { ...s, peak: peak * 0.6 })]
  })
}

/** A soft wooden knock (a card going down, a tie filled in): a short band of noise, low and round, at a mallet's level (its noise counts heavily in the bound, so a louder knock would push the notes down). */
export function knock(at = 0, freq = 1100, peak = 0.2): NoiseVoice {
  return noise(at, { filter: 'bandpass', freq, q: 1.3, attack: 0.0015, dur: 0.035, peak })
}

/** One blast of the referee's pea whistle, `dur` s long. */
export function whistleBlast(at: number, dur: number, pitch = 1): Voice[] {
  const f = 2950 * pitch
  const hold = Math.max(0, dur - 0.012 - 0.07)
  const fm = { at, attack: 0.012, hold, dur, modHz: 46, bendTime: 0.035 }
  return [
    { kind: 'fm', ...fm, peak: 1, freq: f, modDepth: 150, jitterHz: 11, jitterDepth: 35, bendFrom: f * 0.92, dropTo: f * 0.95 },
    { kind: 'fm', ...fm, peak: 0.1, freq: f * 2, modDepth: 300, bendFrom: f * 1.84, dropTo: f * 1.9 },
    // The pea rattles the air through the ring too, and the breath hisses in as the blast starts
    noise(at, { filter: 'bandpass', freq: f, q: 5, attack: 0.008, hold, dur, peak: 0.5, am: { hz: 46, depth: 0.35 } }),
    noise(at, { filter: 'highpass', freq: 4500, q: 0, attack: 0.004, dur: Math.min(0.09, dur), peak: 0.35 }),
  ]
}

/** The whistle's calls: one long blast for a kick-off, two for half time, three (short, short, long) for full time. */
export const WHISTLE_CALLS: Record<WhistleCall, ReadonlyArray<readonly [number, number]>> = {
  kickoff: [[0, 0.72]],
  half: [
    [0, 0.26],
    [0.4, 0.78],
  ],
  full: [
    [0, 0.24],
    [0.36, 0.24],
    [0.72, 1.15],
  ],
}

/** A crowd swell: four bands of pink noise (rumble, voices, the shouts on top) rising together, each breathing slowly. */
function roar(at: number, size: number, r: () => number, o: { high?: boolean; tail?: boolean } = {}): NoiseVoice[] {
  const j = () => r() * 0.06
  const s = Math.max(0.3, size)
  const out: NoiseVoice[] = [
    noise(at + j(), { colour: 'pink', filter: 'lowpass', freq: 260, q: 0, attack: 0.45 * s, hold: 0.9 * s, dur: 3.1 * s, peak: 0.6, offset: r() * 2, am: { hz: 2.3 + r(), depth: 0.12 } }),
    noise(at + j(), { colour: 'pink', filter: 'bandpass', freq: 420, freqTo: 640, sweep: 0.6 * s, q: 0.9, attack: 0.35 * s, hold: 1 * s, dur: 3.2 * s, peak: 1, offset: r() * 2, am: { hz: 3.1 + r(), depth: 0.18 } }),
    noise(at + j(), { colour: 'pink', filter: 'bandpass', freq: 1050, freqTo: 1250, sweep: 0.5 * s, q: 1.1, attack: 0.4 * s, hold: 0.8 * s, dur: 2.8 * s, peak: 0.75, offset: r() * 2, am: { hz: 4.3 + r(), depth: 0.22 } }),
  ]
  if (o.high !== false) {
    out.push(noise(at + 0.05 + j(), { colour: 'pink', filter: 'highpass', freq: 2600, q: 0, attack: 0.3 * s, hold: 0.55 * s, dur: 2.1 * s, peak: 0.3, offset: r() * 2, am: { hz: 5.5 + r(), depth: 0.3 } }))
    // Hands: a band of claps, the tremolo fast and deep, as the roar turns to applause
    out.push(noise(at + 0.6 * s + j(), { filter: 'bandpass', freq: 2500, q: 0.7, attack: 0.5 * s, hold: 0.6 * s, dur: 2.4 * s, peak: 0.3, offset: r() * 2, am: { hz: 9.5 + r() * 2, depth: 0.55 } }))
  }
  // The stadium's tail: the low rumble that rolls on under the roar and dies away last
  if (o.tail !== false) out.push(noise(at + 0.1 + j(), { colour: 'pink', filter: 'lowpass', freq: 170, q: 0, attack: 0.8 * s, hold: 1.1 * s, dur: 4.2 * s, peak: 0.45, offset: r() * 2, am: { hz: 0.9, depth: 0.1 } }))
  return out
}

/** The crowd's "ooh": a chorus of low triangle voices sliding down, through a soft "oo" vowel of pink noise. */
function oohVoices(at: number, strength: number, r: () => number): Voice[] {
  const lift = 1 + 0.06 * strength
  const chorus = [196, 207.65, 220, 233.08, 246.94, 261.63].map((f) => tone(at + r() * 0.07, f * (0.985 + r() * 0.03) * lift, { wave: 'triangle', attack: 0.17 + r() * 0.06, hold: 0.16, dur: 1.05 + r() * 0.15, peak: 0.3, glideTo: f * 0.82, glideTime: 1.0, lowpass: 950 }))
  return [
    ...chorus,
    noise(at, { colour: 'pink', filter: 'bandpass', freq: 340, freqTo: 300, sweep: 1, q: 2.5, attack: 0.18, hold: 0.15, dur: 1.1, peak: 1, offset: r() * 2 }),
    noise(at + 0.02, { colour: 'pink', filter: 'bandpass', freq: 820, freqTo: 700, sweep: 1, q: 3, attack: 0.2, hold: 0.1, dur: 1, peak: 0.6, offset: r() * 2 }),
    // The murmur after it, the crowd settling back
    noise(at + 0.25, { colour: 'pink', filter: 'lowpass', freq: 260, q: 0, attack: 0.3, hold: 0.2, dur: 1.4, peak: 0.45, offset: r() * 2, am: { hz: 2.1, depth: 0.15 } }),
  ]
}

/** The first note of each landing; a quick way to tell the landings apart (and what the smoke test listens for). */
export const LANDING_NOTES: Record<Tier, readonly number[]> = {
  blue: [659.25],
  purple: [587.33, 880],
  pink: [698.46, 1046.5],
  red: [523.25, 659.25, 783.99, 1046.5, 1318.51],
  gold: [392, 493.88, 587.33, 783.99],
}

/** The landing's held top note, rising with rarity. */
export const LANDING_TOP: Record<Tier, number> = { blue: 659.25, purple: 880, pink: 1046.5, red: 1318.51, gold: 1567.98 }

/** The landing's level, rising with rarity. */
export const LANDING_LEVEL: Record<Tier, number> = { blue: 0.185, purple: 0.24, pink: 0.29, red: 0.39, gold: 0.82 }

/**
 * The draft's own levels. Round 9 set every level here, in voices.ts and in seasonScores.ts from offline renders (the
 * loudest 100 ms of each under the master, docs/DESIGN_SYSTEM.md section 14, "Loudness"), not from the bound alone: a
 * score's bound counts its noise heavily and its partials in full, so two scores at one level can sound 10 dB apart.
 */
export const DRAFT_LEVEL = { tick: 0.14, whoosh: 0.11, pop: 0.15, pick: 0.19, upgradeWon: 0.455, upgradeLost: 0.23 } as const
/** The grades' levels, A loudest. */
export const GRADE_LEVEL: Record<PickGrade, number> = { A: 0.69, B: 0.45, C: 0.39, D: 0.43 }
/** The fanfares: the loudest of the game's own moments after a goal's roar. */
export const FANFARE_LEVEL = { cup: 0.86, treble: 0.9 } as const
/** A click: barely there. */
export const CLICK_LEVEL = 0.11

/** The grades' levels and the notes each lands on. */
export const GRADE_NOTES: Record<PickGrade, readonly number[]> = { A: [523.25, 659.25, 783.99, 1046.5], B: [783.99, 1046.5], C: [659.25], D: [329.63, 277.18] }

// ---- The palette -----------------------------------------------------------------------------------------

const made = new Map<string, Score>()

/** Every sound the game makes, as a normalised score. Pure; the same request gives the same score (built once and kept: treat it as read-only). */
export function scoreFor(req: SoundRequest): Score {
  const key = JSON.stringify(req)
  let s = made.get(key)
  if (!s) {
    s = build(req)
    if (made.size > 200) made.clear()
    made.set(key, s)
  }
  return s
}

function build(req: SoundRequest): Score {
  switch (req.id) {
    case 'whistle':
      return normalise('whistle', 0.24, WHISTLE_CALLS[req.call].flatMap(([at, dur]) => whistleBlast(at, dur)))
    case 'goal': {
      const r = seeded(`goal:${req.seed ?? ''}:${req.tone}:${req.replay ? 'r' : ''}`)
      // The net: a low thud and the swish of the ball in the mesh, as the ball crosses the line
      const net: Voice[] = [tone(0, 96, { glideTo: 46, glideTime: 0.16, attack: 0.003, dur: 0.32, peak: 0.6 }), noise(0, { filter: 'lowpass', freq: 520, q: 0, dur: 0.12, peak: 0.6 }), noise(0.01, { filter: 'bandpass', freq: 2600, freqTo: 900, sweep: 0.3, q: 1.2, attack: 0.01, dur: 0.36, peak: 0.35 })]
      if (req.replay) return normalise('goal', 0.42, [...net, ...roar(0.04, 0.6, r, { high: false })])
      if (req.tone === 'theirs') return normalise('goal', 0.38, [...net, ...roar(0.08, 0.55, r, { high: false })])
      return normalise('goal', req.tone === 'ours' ? 0.9 : 0.75, [...net, ...roar(0.04, req.tone === 'ours' ? 1 : 0.85, r)])
    }
    case 'near-miss': {
      const s = Math.min(1, Math.max(0, req.strength))
      return normalise('near-miss', 0.3 + 0.28 * s, oohVoices(0, s, seeded(`ooh:${req.seed ?? ''}`)))
    }
    case 'save': {
      const s = Math.min(1, Math.max(0, req.strength))
      // The gloves: a short low thump and a slap of noise; then a smaller "ooh"
      const gloves: Voice[] = [tone(0, 150, { glideTo: 82, glideTime: 0.1, attack: 0.002, dur: 0.16, peak: 0.8 }), noise(0, { filter: 'lowpass', freq: 1500, q: 0, dur: 0.07, peak: 0.9 })]
      const ooh = oohVoices(0.09, s, seeded(`save:${req.seed ?? ''}`)).map((v) => ({ ...v, peak: v.peak * 0.55 }))
      return normalise('save', 0.5 + 0.25 * s, [...gloves, ...ooh])
    }
    case 'card': {
      // A sharp peep, the card flicked out, and for a red a low, dark stab
      const voices: Voice[] = [...whistleBlast(0, 0.3, 1.02), noise(0.34, { filter: 'highpass', freq: 3200, q: 0, dur: 0.05, peak: 0.5 })]
      if (req.red) voices.push(tone(0.38, 110, { wave: 'sawtooth', attack: 0.01, hold: 0.08, dur: 0.62, peak: 0.45, lowpass: 640 }), tone(0.38, 116.54, { wave: 'sawtooth', attack: 0.01, hold: 0.08, dur: 0.62, peak: 0.45, lowpass: 640 }), tone(0.38, 55, { attack: 0.005, dur: 0.5, peak: 0.6 }))
      return normalise('card', req.red ? 0.32 : 0.26, voices)
    }
    case 'sub':
      // The board going up: a two-note chime, G5 then C6
      return normalise('sub', req.ours ? 0.26 : 0.15, [...chime(0, 783.99, { dur: 0.9 }), ...chime(0.2, 1046.5, { dur: 1.2 })])
    case 'landing':
      return landingScore(req.tier, !!req.reduced, req.seed)
    case 'pick':
      // The pick confirmed: a wooden knock and two warm mallets rising, E5 then B5
      return normalise('pick', DRAFT_LEVEL.pick, [knock(0, 900), ...mallet(0.005, 659.25, { dur: 0.18, peak: 0.3, knock: false }), ...mallet(0.06, 987.77, { dur: 0.28, peak: 0.3, knock: false })])
    case 'upgrade':
      return upgradeScore(req.won, !!req.reduced, req.seed)
    case 'fanfare':
      return req.treble ? trebleScore(!!req.reduced, req.seed) : cupScore(!!req.reduced, req.seed)
    case 'grade':
      return gradeScore(req.grade, !!req.reduced, req.seed)
    case 'click':
      // Very quiet: a soft round tock for a primary button, low and short (no bright tick)
      return normalise('click', CLICK_LEVEL, [noise(0, { filter: 'bandpass', freq: 1900, q: 1.1, attack: 0.0015, dur: 0.018, peak: 0.8 }), tone(0, 820, { attack: 0.0015, dur: 0.032, peak: 0.5, glideTo: 620, glideTime: 0.03 })])
    case 'tick':
      return reelTick(req.rate)
    case 'whoosh':
      // The season drum rolling: a soft breath of pink noise swept up, never a hiss
      return normalise('whoosh', DRAFT_LEVEL.whoosh, [noise(0, { colour: 'pink', filter: 'bandpass', freq: 280, freqTo: 1700, sweep: 0.42, q: 1.1, attack: 0.18, dur: 0.5, peak: 1, offset: 1.9 })])
    case 'pop':
      // The drum stopping: a round wooden pop, a sine falling 420 to 170 Hz over a felt knock
      return normalise('pop', DRAFT_LEVEL.pop, [tone(0, 420, { glideTo: 170, glideTime: 0.1, attack: 0.003, dur: 0.16, peak: 0.6 }), noise(0, { filter: 'lowpass', freq: 900, q: 0, attack: 0.002, dur: 0.04, peak: 0.4 })])
  }
}

/**
 * A card passing the reel's marker: a short knock of band-passed noise near 2 kHz (it was 3.2 kHz, a hard click) over
 * a tiny falling tock, both shifted by `rate`. The rate is rounded to a hundredth, so a reel's run builds a few dozen
 * scores at most; the noise is read from a point the rate picks, so neighbouring ticks never share their samples.
 */
function reelTick(rate: number): Score {
  const k = Math.min(1.3, Math.max(0.8, Math.round(rate * 100) / 100))
  return normalise('tick', DRAFT_LEVEL.tick, [
    noise(0, { filter: 'bandpass', freq: 2000 * k, q: 1.6, attack: 0.0012, dur: 0.03, peak: 1, offset: (k * 7.31) % 2.9 }),
    tone(0, 760 * k, { attack: 0.0015, dur: 0.028, peak: 0.45, glideTo: 600 * k, glideTime: 0.025 }),
  ])
}

/**
 * The reveal, rising with rarity, in warm mallets (round 9): blue one mallet; purple and pink two rising (pink higher
 * and brighter, over a soft pad); red a rising arpeggio to E6 over a held pad; gold an arpeggio into a held G major
 * pad up to G6 over a low thump, a round bell on top and a shimmer of glints (dropped with reduced motion). The Icons
 * card plays gold's.
 */
function landingScore(display: DisplayTier, reduced: boolean, seed = ''): Score {
  const tier: Tier = display === 'icons' ? 'gold' : display
  const n = LANDING_NOTES[tier]
  const r = seeded(`landing:${seed}:${tier}`)
  const v: Voice[] = []
  switch (tier) {
    case 'blue':
      v.push(...mallet(0, n[0], { dur: 0.8 }))
      break
    case 'purple':
      v.push(...mallet(0, n[0], { dur: 0.5 }), ...mallet(0.11, n[1], { dur: 0.9 }))
      break
    case 'pink':
      v.push(...mallet(0, n[0], { dur: 0.5 }), ...mallet(0.1, n[1], { dur: 1 }), ...pad(0.1, [n[0] / 2], { peak: 0.08, attack: 0.06, dur: 0.9 }))
      break
    case 'red':
      n.forEach((f, i) => v.push(...mallet(i * 0.07, f, { peak: 0.24, dur: i === n.length - 1 ? 1.2 : 0.4, knock: i === 0 })))
      v.push(...pad(0.28, [261.63, 329.63, 392], { peak: 0.06, attack: 0.08, hold: 0.2, dur: 1.1 }))
      break
    case 'gold': {
      n.forEach((f, i) => v.push(...mallet(i * 0.06, f, { peak: 0.22, dur: 0.35, knock: i === 0 })))
      const sting = 0.26
      v.push(tone(sting, 98, { attack: 0.006, dur: 0.6, peak: 0.22, glideTo: 82, glideTime: 0.4 }))
      v.push(...pad(sting, [392, 493.88, 587.33, 783.99], { peak: 0.07, attack: 0.04, hold: 0.25, dur: 1.5 }))
      v.push(...bell(sting, 987.77, { peak: 0.12, dur: 1.4 }), ...bell(sting + 0.04, LANDING_TOP.gold, { peak: 0.1, dur: 1.5 }))
      if (!reduced) v.push(...shimmer(sting + 0.1, [2093, 2637, 3136, 2349, 3520, 2794, 3951, 3136], 0.07, r))
      break
    }
  }
  return normalise('landing', LANDING_LEVEL[tier], v)
}

/**
 * The Upgrader's verdict. A win: a low thump, a rising C major arpeggio of mallets into a held pad and a bell, and six
 * glints (dropped with reduced motion). A loss: a soft falling "wah-wah", two low-passed minor notes sliding into a
 * low groan.
 */
function upgradeScore(won: boolean, reduced: boolean, seed = ''): Score {
  const r = seeded(`upgrade:${seed}`)
  if (won) {
    const v: Voice[] = [tone(0, 110, { attack: 0.006, dur: 0.45, peak: 0.2, glideTo: 70 })]
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => v.push(...mallet(i * 0.07, f, { peak: 0.22, dur: i === 3 ? 1.2 : 0.35, knock: i === 0 })))
    v.push(...pad(0.3, [523.25, 659.25, 783.99], { peak: 0.06, attack: 0.05, hold: 0.2, dur: 1.3 }), ...bell(0.3, 1567.98, { peak: 0.08, dur: 1.3 }))
    if (!reduced) v.push(...shimmer(0.36, [2637, 3136, 3520, 4186, 3136, 3951], 0.06, r))
    return normalise('upgrade', DRAFT_LEVEL.upgradeWon, v)
  }
  const wah = { wave: 'triangle' as const, attack: 0.02, lowpass: 1100 }
  return normalise('upgrade', DRAFT_LEVEL.upgradeLost, [
    tone(0, 392, { ...wah, peak: 0.26, dur: 0.32, glideTo: 370 }),
    tone(0.3, 349.23, { ...wah, peak: 0.26, dur: 0.34, glideTo: 330 }),
    tone(0.62, 311.13, { ...wah, peak: 0.28, dur: 0.9, glideTo: 185 }),
    tone(0.62, 77.78, { peak: 0.3, attack: 0.03, dur: 0.8, glideTo: 55 }),
  ])
}

/** A timpani stroke: a low sine dropping a little, and a soft thud of low noise. */
export function timpani(at: number, freq: number, peak = 0.6): Voice[] {
  return [tone(at, freq, { glideTo: freq * 0.8, glideTime: 0.3, attack: 0.006, dur: 0.6, peak }), noise(at, { filter: 'lowpass', freq: 200, q: 0, attack: 0.003, dur: 0.2, peak: peak * 0.7 })]
}

/** A cymbal: bright noise, crashing in or swelling up (round 9: a little lower and quieter, a wash rather than a hiss). */
export function cymbal(at: number, dur: number, swell = false, peak = 0.28): NoiseVoice {
  return noise(at, { filter: 'highpass', freq: 4400, q: 0, attack: swell ? dur * 0.85 : 0.006, dur, peak, offset: 0.7 })
}

/** One fanfare phrase: "ta-ta-ta-taaa, ta-taaa" into a held major chord, with timpani and a cymbal. Returns the voices and when the chord lands. */
function phrase(at: number, root: number, chordHold: number): { v: Voice[]; chord: number } {
  const f = (semi: number) => root * Math.pow(2, semi / 12)
  const v: Voice[] = []
  // Fifth below, three times, then the root; the third and fifth above, then the chord
  for (const s of [0, 0.16, 0.32]) v.push(...brass(at + s, f(-5), 0.15, 0.28))
  v.push(...brass(at + 0.48, f(0), 0.36, 0.3, 0.12))
  v.push(...brass(at + 0.8, f(4), 0.14, 0.28), ...brass(at + 0.95, f(7), 0.2, 0.28))
  const chord = at + 1.16
  for (const s of [0, 4, 7, 12]) v.push(...brass(chord, f(s), chordHold + 0.9, 0.22, chordHold))
  // A warm string pad an octave down under the held chord, so it swells instead of buzzing
  v.push(...pad(chord, [f(-12), f(-8), f(-5)], { peak: 0.08, attack: 0.12, hold: chordHold, dur: chordHold + 1 }))
  v.push(...timpani(at + 0.48, root / 4), ...timpani(chord, root / 4, 0.7), cymbal(chord - 0.5, 0.5, true, 0.16), cymbal(chord, 1.6))
  return { v, chord }
}

/** The Cup won: a brass fanfare in C into a held chord over a warm pad, timpani, a cymbal crash and a shimmer (none with reduced motion). */
function cupScore(reduced: boolean, seed = ''): Score {
  const r = seeded(`cup:${seed}`)
  const { v, chord } = phrase(0, 523.25, 0.7)
  if (!reduced) v.push(...shimmer(chord + 0.15, [2093, 2637, 3136, 2349, 3520, 2794], 0.08, r))
  return normalise('fanfare', FANFARE_LEVEL.cup, v)
}

/** The Treble: the Cup's phrase, then the same a tone higher into a longer chord over a timpani roll and a crowd's roar, and a longer shimmer. */
function trebleScore(reduced: boolean, seed = ''): Score {
  const r = seeded(`treble:${seed}`)
  const first = phrase(0, 523.25, 0.25)
  const second = phrase(1.5, 587.33, 1.2)
  const v: Voice[] = [...first.v, ...second.v]
  // The roll into the last chord, and the crowd under it
  for (let i = 0; i < 6; i++) v.push(...timpani(second.chord - 0.42 + i * 0.07, 146.83 / 2, 0.3 + i * 0.05))
  v.push(...roar(second.chord - 0.1, 0.9, r, { tail: false }).map((x) => ({ ...x, peak: x.peak * 0.45 })))
  if (!reduced) v.push(...shimmer(second.chord + 0.15, [2349, 2960, 3520, 2637, 3951, 3136, 4699, 3520], 0.08, r))
  return normalise('fanfare', FANFARE_LEVEL.treble, v)
}

/**
 * The draft's grade landing on the recap, with its pop: a stamp (a low thud and a felt slap), then A a bright mallet
 * arpeggio with a shimmer, B two rising mallets, C one plain mallet, D a soft falling minor pair.
 */
function gradeScore(grade: PickGrade, reduced: boolean, seed = ''): Score {
  const r = seeded(`grade:${seed}:${grade}`)
  const n = GRADE_NOTES[grade]
  const v: Voice[] = [tone(0, 120, { glideTo: 70, glideTime: 0.12, attack: 0.004, dur: 0.22, peak: 0.35 }), noise(0, { filter: 'lowpass', freq: 700, q: 0, attack: 0.002, dur: 0.08, peak: 0.45 })]
  if (grade === 'A') {
    n.forEach((f, i) => v.push(...mallet(0.04 + i * 0.055, f, { peak: 0.22, dur: i === n.length - 1 ? 1.1 : 0.35, knock: false })))
    v.push(...pad(0.2, [261.63, 392], { peak: 0.05, attack: 0.05, dur: 1 }))
    if (!reduced) v.push(...shimmer(0.3, [2093, 2637, 3136, 3951], 0.06, r))
  } else if (grade === 'B') {
    v.push(...mallet(0.04, n[0], { dur: 0.45, knock: false }), ...mallet(0.15, n[1], { dur: 0.9, knock: false }))
  } else if (grade === 'C') {
    v.push(...mallet(0.04, n[0], { dur: 0.7, knock: false }))
  } else {
    const soft = { wave: 'triangle' as const, peak: 0.28, attack: 0.012, lowpass: 1000 }
    v.push(tone(0.04, n[0], { ...soft, dur: 0.36, glideTo: n[0] * 0.97 }), tone(0.3, n[1], { ...soft, dur: 0.7, glideTo: n[1] * 0.92 }))
  }
  return normalise('grade', GRADE_LEVEL[grade], v)
}
