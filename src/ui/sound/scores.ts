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

export type SoundId = SoundRequest['id']

export interface Score {
  id: SoundId
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
export function normalise(id: SoundId, level: number, voices: Voice[]): Score {
  const target = Math.min(MAX_LEVEL, level)
  return { id, category: CATEGORY[id], level: target, voices: scaleTo(target, voices) }
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

/** A brass note: a sawtooth through a low-pass with a soft attack, doubled an octave down. */
export function brass(at: number, freq: number, dur: number, peak = 0.3, hold = 0): ToneVoice[] {
  return [tone(at, freq, { wave: 'sawtooth', attack: 0.03, hold, dur, peak, lowpass: Math.min(3200, freq * 4.5) }), tone(at, freq / 2, { wave: 'triangle', attack: 0.03, hold, dur, peak: peak * 0.45 })]
}

/** High pings over a reward, scattered by the seed; none with reduced motion. */
export function shimmer(at: number, freqs: number[], step: number, r: () => number, peak = 0.07): ToneVoice[] {
  return freqs.map((f, i) => tone(at + i * step + r() * 0.03, f * (0.99 + r() * 0.02), { peak, dur: 0.25 }))
}

/** One blast of the referee's pea whistle, `dur` s long. */
export function whistleBlast(at: number, dur: number, pitch = 1): Voice[] {
  const f = 2950 * pitch
  const hold = Math.max(0, dur - 0.012 - 0.07)
  const fm = { at, attack: 0.012, hold, dur, modHz: 46, bendTime: 0.035 }
  return [
    { kind: 'fm', ...fm, peak: 1, freq: f, modDepth: 150, jitterHz: 11, jitterDepth: 35, bendFrom: f * 0.92, dropTo: f * 0.95 },
    { kind: 'fm', ...fm, peak: 0.1, freq: f * 2, modDepth: 300, bendFrom: f * 1.84, dropTo: f * 1.9 },
    noise(at, { filter: 'bandpass', freq: f, q: 5, attack: 0.008, hold, dur, peak: 0.5 }),
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
function roar(at: number, size: number, r: () => number, o: { high?: boolean } = {}): NoiseVoice[] {
  const j = () => r() * 0.06
  const s = Math.max(0.3, size)
  const out: NoiseVoice[] = [
    noise(at + j(), { colour: 'pink', filter: 'lowpass', freq: 260, q: 0, attack: 0.45 * s, hold: 0.9 * s, dur: 3.1 * s, peak: 0.6, offset: r() * 2, am: { hz: 2.3 + r(), depth: 0.12 } }),
    noise(at + j(), { colour: 'pink', filter: 'bandpass', freq: 420, freqTo: 640, sweep: 0.6 * s, q: 0.9, attack: 0.35 * s, hold: 1 * s, dur: 3.2 * s, peak: 1, offset: r() * 2, am: { hz: 3.1 + r(), depth: 0.18 } }),
    noise(at + j(), { colour: 'pink', filter: 'bandpass', freq: 1050, freqTo: 1250, sweep: 0.5 * s, q: 1.1, attack: 0.4 * s, hold: 0.8 * s, dur: 2.8 * s, peak: 0.75, offset: r() * 2, am: { hz: 4.3 + r(), depth: 0.22 } }),
  ]
  if (o.high !== false) out.push(noise(at + 0.05 + j(), { colour: 'pink', filter: 'highpass', freq: 2600, q: 0, attack: 0.3 * s, hold: 0.55 * s, dur: 2.1 * s, peak: 0.3, offset: r() * 2, am: { hz: 5.5 + r(), depth: 0.3 } }))
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
export const LANDING_LEVEL: Record<Tier, number> = { blue: 0.27, purple: 0.37, pink: 0.52, red: 0.55, gold: 0.9 }

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
      // The pick confirmed: a soft thock and a rising two-note blip
      return normalise('pick', 0.45, [noise(0, { filter: 'bandpass', freq: 1800, q: 1.5, dur: 0.04, peak: 1 }), tone(0.005, 660, { peak: 0.5, dur: 0.14 }), tone(0.065, 990, { peak: 0.5, dur: 0.22 }), tone(0.065, 990 * 2.76, { peak: 0.05, dur: 0.1 })])
    case 'upgrade':
      return upgradeScore(req.won, !!req.reduced, req.seed)
    case 'fanfare':
      return req.treble ? trebleScore(!!req.reduced, req.seed) : cupScore(!!req.reduced, req.seed)
    case 'grade':
      return gradeScore(req.grade, !!req.reduced, req.seed)
    case 'click':
      // Very quiet: a short bright tick for a primary button
      return normalise('click', 0.12, [noise(0, { filter: 'bandpass', freq: 3800, q: 1.5, attack: 0.001, dur: 0.02, peak: 1 }), tone(0, 1400, { attack: 0.001, dur: 0.03, peak: 0.5 })])
  }
}

/**
 * The reveal, rising with rarity: blue a plain chime; purple and pink a brighter two-note chime (pink higher and
 * brighter); red a rising arpeggio to E6; gold an arpeggio into a held G major sting to G6 over a low thump, with a
 * shimmer of high pings (dropped with reduced motion). The Icons card plays gold's.
 */
function landingScore(display: DisplayTier, reduced: boolean, seed = ''): Score {
  const tier: Tier = display === 'icons' ? 'gold' : display
  const n = LANDING_NOTES[tier]
  const r = seeded(`landing:${seed}:${tier}`)
  const v: Voice[] = []
  switch (tier) {
    case 'blue':
      v.push(...chime(0, n[0], { dur: 0.8 }))
      break
    case 'purple':
      v.push(...chime(0, n[0], { dur: 0.5 }), ...chime(0.12, n[1], { dur: 0.9 }))
      break
    case 'pink':
      v.push(...chime(0, n[0], { wave: 'triangle', dur: 0.5 }), ...chime(0.11, n[1], { wave: 'triangle', dur: 1 }), tone(0.11, n[1] * 2, { peak: 0.05, dur: 0.5 }))
      break
    case 'red':
      n.forEach((f, i) => v.push(...chime(i * 0.07, f, { wave: 'triangle', peak: 0.26, dur: i === n.length - 1 ? 1.2 : 0.4 })))
      break
    case 'gold': {
      n.forEach((f, i) => v.push(...chime(i * 0.06, f, { wave: 'triangle', peak: 0.24, dur: 0.35 })))
      const sting = 0.26
      v.push(tone(sting, 98, { attack: 0.004, dur: 0.6, peak: 0.2 }))
      for (const f of [783.99, 987.77, 1174.66, 1567.98]) v.push(tone(sting, f, { wave: 'triangle', peak: 0.14, attack: 0.01, dur: 1.5 }))
      if (!reduced) v.push(...shimmer(sting + 0.08, [2093, 2637, 3136, 2349, 3520, 2794, 3951, 3136], 0.07, r))
      break
    }
  }
  return normalise('landing', LANDING_LEVEL[tier], v)
}

/**
 * The Upgrader's verdict. A win: a low thump, a rising C major arpeggio into a held chord, and six high pings
 * (dropped with reduced motion). A loss: a falling "wah-wah", two sliding minor notes into a low groan.
 */
function upgradeScore(won: boolean, reduced: boolean, seed = ''): Score {
  const r = seeded(`upgrade:${seed}`)
  if (won) {
    const v: Voice[] = [tone(0, 110, { attack: 0.004, dur: 0.45, peak: 0.2, glideTo: 70 })]
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => v.push(...chime(i * 0.07, f, { wave: 'triangle', peak: 0.24, dur: i === 3 ? 1.2 : 0.35 })))
    for (const f of [1046.5, 1318.51, 1567.98]) v.push(tone(0.3, f, { wave: 'triangle', peak: 0.1, attack: 0.02, dur: 1.4 }))
    if (!reduced) v.push(...shimmer(0.36, [2637, 3136, 3520, 4186, 3136, 3951], 0.06, r, 0.06))
    return normalise('upgrade', 0.7, v)
  }
  return normalise('upgrade', 0.42, [
    tone(0, 392, { wave: 'triangle', peak: 0.26, attack: 0.01, dur: 0.32, glideTo: 370 }),
    tone(0.3, 349.23, { wave: 'triangle', peak: 0.26, attack: 0.01, dur: 0.34, glideTo: 330 }),
    tone(0.62, 311.13, { wave: 'triangle', peak: 0.28, attack: 0.01, dur: 0.9, glideTo: 185 }),
    tone(0.62, 77.78, { peak: 0.3, attack: 0.02, dur: 0.8, glideTo: 55 }),
  ])
}

/** A timpani stroke: a low sine dropping a little, and a thud of low noise. */
export function timpani(at: number, freq: number, peak = 0.6): Voice[] {
  return [tone(at, freq, { glideTo: freq * 0.8, glideTime: 0.3, attack: 0.004, dur: 0.6, peak }), noise(at, { filter: 'lowpass', freq: 220, q: 0, dur: 0.22, peak: peak * 0.9 })]
}

/** A cymbal: bright noise, crashing in or swelling up. */
export function cymbal(at: number, dur: number, swell = false, peak = 0.35): NoiseVoice {
  return noise(at, { filter: 'highpass', freq: 5200, q: 0, attack: swell ? dur * 0.85 : 0.004, dur, peak, offset: 0.7 })
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
  v.push(...timpani(at + 0.48, root / 4), ...timpani(chord, root / 4, 0.7), cymbal(chord - 0.5, 0.5, true, 0.2), cymbal(chord, 1.6))
  return { v, chord }
}

/** The Cup won: a brass fanfare in C into a held chord, timpani, a cymbal crash and a shimmer (none with reduced motion). */
function cupScore(reduced: boolean, seed = ''): Score {
  const r = seeded(`cup:${seed}`)
  const { v, chord } = phrase(0, 523.25, 0.7)
  if (!reduced) v.push(...shimmer(chord + 0.15, [2093, 2637, 3136, 2349, 3520, 2794], 0.08, r))
  return normalise('fanfare', 0.85, v)
}

/** The Treble: the Cup's phrase, then the same a tone higher into a longer chord over a timpani roll and a crowd's roar, and a longer shimmer. */
function trebleScore(reduced: boolean, seed = ''): Score {
  const r = seeded(`treble:${seed}`)
  const first = phrase(0, 523.25, 0.25)
  const second = phrase(1.5, 587.33, 1.2)
  const v: Voice[] = [...first.v, ...second.v]
  // The roll into the last chord, and the crowd under it
  for (let i = 0; i < 6; i++) v.push(...timpani(second.chord - 0.42 + i * 0.07, 146.83 / 2, 0.3 + i * 0.05))
  v.push(...roar(second.chord - 0.1, 0.9, r).map((x) => ({ ...x, peak: x.peak * 0.45 })))
  if (!reduced) v.push(...shimmer(second.chord + 0.15, [2349, 2960, 3520, 2637, 3951, 3136, 4699, 3520], 0.08, r))
  return normalise('fanfare', 0.9, v)
}

/**
 * The draft's grade landing on the recap, with its pop: a stamp (a low thud and a slap), then A a bright arpeggio
 * with a shimmer, B a rising two-note chime, C one plain note, D a falling minor pair.
 */
function gradeScore(grade: PickGrade, reduced: boolean, seed = ''): Score {
  const r = seeded(`grade:${seed}:${grade}`)
  const n = GRADE_NOTES[grade]
  const v: Voice[] = [tone(0, 120, { glideTo: 70, glideTime: 0.12, attack: 0.003, dur: 0.22, peak: 0.35 }), noise(0, { filter: 'lowpass', freq: 900, q: 0, dur: 0.09, peak: 0.5 })]
  if (grade === 'A') {
    n.forEach((f, i) => v.push(...chime(0.04 + i * 0.055, f, { wave: 'triangle', peak: 0.22, dur: i === n.length - 1 ? 1.1 : 0.35 })))
    if (!reduced) v.push(...shimmer(0.3, [2093, 2637, 3136, 3951], 0.06, r, 0.06))
  } else if (grade === 'B') {
    v.push(...chime(0.04, n[0], { wave: 'triangle', dur: 0.45 }), ...chime(0.15, n[1], { wave: 'triangle', dur: 0.9 }))
  } else if (grade === 'C') {
    v.push(...chime(0.04, n[0], { dur: 0.7 }))
  } else {
    v.push(tone(0.04, n[0], { wave: 'triangle', peak: 0.28, attack: 0.01, dur: 0.36, glideTo: n[0] * 0.97 }), tone(0.3, n[1], { wave: 'triangle', peak: 0.28, attack: 0.01, dur: 0.7, glideTo: n[1] * 0.92 }))
  }
  return normalise('grade', grade === 'A' ? 0.7 : grade === 'B' ? 0.62 : grade === 'C' ? 0.55 : 0.58, v)
}
