/*
 * The season's cues as scores, in the palette's own voices (scores.ts): what
 * plays while a season simulates (seasonCues.ts says when). Background sounds,
 * all far under the match day's: a result is a soft blip, a stinger a short
 * phrase, the end of the season a short fanfare, never the Cup's. Pure data
 * like scores.ts, normalised the same way (`scaleTo`), seeded the same way;
 * kept out of the first download, loaded with the screens that use it.
 */
import { seeded } from './noise'
import { brass, chime, noise, scaleTo, shimmer, timpani, tone, type Voice } from './scores'

export type ResultOutcome = 'W' | 'D' | 'L'
/** The big moments of a season (perfect.ts, liveTable.ts and the clinch weeks). */
export type StingerKind = 'perfect-alive' | 'perfect-broken' | 'top4' | 'top' | 'title' | 'relegated'
/** Where a season finished, for its closing fanfare. */
export type SeasonFinish = 'champion' | 'top4' | 'mid' | 'drop'

/** What the season can ask for. */
export type SeasonSoundRequest =
  /** A result landing: `thin` is the shorter, quieter blip of the fastest speed. */
  | { id: 'result'; outcome: ResultOutcome; thin?: boolean }
  /** A small cheer under a result, weighted by the goals scored. */
  | { id: 'goals'; goals: number }
  | { id: 'stinger'; kind: StingerKind; reduced?: boolean }
  | { id: 'season-end'; finish: SeasonFinish; perfect: boolean; reduced?: boolean }
  /** Several results at once (a skip, Sim 5, Sim to end): one quick riffle of up to six pips and a closing note. */
  | { id: 'batch'; won: number; drawn: number; lost: number }
  /** The low crowd bed near the end of a perfect run, `dur` s long; `level` 0..1 is how close the end is. */
  | { id: 'tension'; level: number; dur: number }
  /** The first half shown and the January window open. */
  | { id: 'halfway' }

export type SeasonSoundId = SeasonSoundRequest['id']

export interface SeasonScore {
  id: SeasonSoundId
  /** The bound the voices were normalised to. */
  level: number
  voices: Voice[]
}

/** The loudest a season cue may be: the closing fanfare, half the Cup's (0.85) and well under a goal's roar (0.9). */
export const SEASON_MAX_LEVEL = 0.45
/** The result blips' levels: a click is 0.12, so these sit at the same quiet step. */
export const RESULT_LEVEL: Record<ResultOutcome, number> = { W: 0.14, D: 0.12, L: 0.12 }
/** The fastest speed's blips, quieter still. */
export const THIN_RESULT_LEVEL = 0.09
/** The first note of each result: a win high, a draw in the middle, a loss low (what the smoke listens for). */
export const RESULT_NOTES: Record<ResultOutcome, number> = { W: 659.25, D: 440, L: 329.63 }
export const STINGER_LEVEL: Record<StingerKind, number> = { 'perfect-alive': 0.22, 'perfect-broken': 0.2, top4: 0.2, top: 0.26, title: 0.34, relegated: 0.26 }
export const FINISH_LEVEL: Record<SeasonFinish, number> = { champion: 0.42, top4: 0.3, mid: 0.22, drop: 0.24 }

function score(id: SeasonSoundId, level: number, voices: Voice[]): SeasonScore {
  const target = Math.min(SEASON_MAX_LEVEL, level)
  return { id, level: target, voices: scaleTo(target, voices) }
}

const made = new Map<string, SeasonScore>()

/** Every season cue as a normalised score. Pure; the same request gives the same score (built once and kept: read-only). */
export function seasonScoreFor(req: SeasonSoundRequest): SeasonScore {
  const key = JSON.stringify(req)
  let s = made.get(key)
  if (!s) {
    s = build(req)
    if (made.size > 120) made.clear()
    made.set(key, s)
  }
  return s
}

function build(req: SeasonSoundRequest): SeasonScore {
  switch (req.id) {
    case 'result':
      return resultScore(req.outcome, !!req.thin)
    case 'goals': {
      // A short lift of the crowd, bigger and a touch longer with every goal up to five; the shouts on top from four
      const g = Math.max(1, Math.min(5, Math.round(req.goals)))
      const r = seeded(`season-goals:${g}`)
      const len = 0.42 + 0.08 * g
      const v: Voice[] = [
        noise(0.02, { colour: 'pink', filter: 'bandpass', freq: 480, freqTo: 620, sweep: len * 0.5, q: 0.9, attack: 0.12, hold: 0.05, dur: len, peak: 1, offset: r() * 2 }),
        noise(0.03, { colour: 'pink', filter: 'bandpass', freq: 1050, freqTo: 1200, sweep: len * 0.5, q: 1.1, attack: 0.12, dur: len * 0.9, peak: 0.6, offset: r() * 2 }),
      ]
      if (g >= 4) v.push(noise(0.06, { colour: 'pink', filter: 'highpass', freq: 2600, q: 0, attack: 0.1, dur: len * 0.7, peak: 0.25, offset: r() * 2 }))
      return score('goals', 0.05 + 0.02 * g, v)
    }
    case 'stinger':
      return stingerScore(req.kind, !!req.reduced)
    case 'season-end':
      return finishScore(req.finish, req.perfect, !!req.reduced)
    case 'batch': {
      // The results in order of the tally, up to six pips (each outcome keeps its share), then a note for the run: a
      // major third up for two points a game or more, a plain fifth for one or more, a falling minor third below that
      const n = req.won + req.drawn + req.lost
      const pips = n ? Math.min(6, n) : 0
      const share = (k: number) => (n ? Math.round((k / n) * pips) : 0)
      const w = share(req.won)
      const d = Math.min(pips - w, share(req.drawn))
      const seq: ResultOutcome[] = [...Array<ResultOutcome>(w).fill('W'), ...Array<ResultOutcome>(d).fill('D'), ...Array<ResultOutcome>(Math.max(0, pips - w - d)).fill('L')]
      const v: Voice[] = seq.map((o, i) => tone(i * 0.045, RESULT_NOTES[o] * 1.5, { wave: 'triangle', attack: 0.004, dur: 0.09, peak: 0.3 }))
      const end = seq.length * 0.045 + 0.04
      const ppg = n ? (3 * req.won + req.drawn) / n : 1
      if (ppg >= 2) v.push(...chime(end, 659.25, { wave: 'triangle', peak: 0.3, dur: 0.35 }), ...chime(end + 0.08, 830.61, { wave: 'triangle', peak: 0.3, dur: 0.6 }))
      else if (ppg >= 1) v.push(...chime(end, 523.25, { peak: 0.3, dur: 0.35 }), ...chime(end + 0.08, 783.99, { peak: 0.3, dur: 0.55 }))
      else v.push(tone(end, 392, { wave: 'triangle', attack: 0.01, dur: 0.3, peak: 0.3, glideTo: 380 }), tone(end + 0.14, 329.63, { wave: 'triangle', attack: 0.01, dur: 0.55, peak: 0.3, glideTo: 311.13 }))
      return score('batch', 0.16, v)
    }
    case 'tension': {
      // A low rumble of the crowd holding its breath, swelling over the gap to the next result, and a faint low A under it
      const dur = Math.max(0.4, Math.min(4, req.dur))
      const k = Math.max(0, Math.min(1, req.level))
      return score('tension', 0.035 + 0.055 * k, [
        noise(0, { colour: 'pink', filter: 'lowpass', freq: 240 + 120 * k, q: 0, attack: dur * 0.55, hold: dur * 0.15, dur, peak: 1, offset: 1.3, am: { hz: 1.6 + k, depth: 0.25 } }),
        tone(0, 110, { attack: dur * 0.6, hold: dur * 0.1, dur, peak: 0.25 }),
      ])
    }
    case 'halfway':
      // The window opening: a soft rising fourth, G5 then C6
      return score('halfway', 0.16, [...chime(0, 783.99, { dur: 0.45 }), ...chime(0.12, 1046.5, { dur: 0.8 })])
  }
}

/** A win: a short rising fourth (E5 to A5); a draw one mellow A4; a loss a falling pair, E4 to C♯4. Thin: the first note alone, shorter. */
function resultScore(o: ResultOutcome, thin: boolean): SeasonScore {
  const f = RESULT_NOTES[o]
  const level = thin ? THIN_RESULT_LEVEL : RESULT_LEVEL[o]
  if (thin) return score('result', level, [tone(0, f, { wave: o === 'W' ? 'sine' : 'triangle', attack: 0.004, dur: 0.16, peak: 0.3, ...(o === 'L' ? { glideTo: f * 0.94 } : {}) })])
  if (o === 'W') return score('result', level, [...chime(0, f, { dur: 0.26 }), ...chime(0.07, 880, { dur: 0.42 })])
  if (o === 'D') return score('result', level, [tone(0, f, { wave: 'triangle', attack: 0.006, dur: 0.38, peak: 0.3 })])
  return score('result', level, [tone(0, f, { wave: 'triangle', attack: 0.006, dur: 0.2, peak: 0.3 }), tone(0.12, 277.18, { wave: 'triangle', attack: 0.006, dur: 0.36, peak: 0.3, glideTo: 266 })])
}

/** The first notes of each stinger (the tests tell them apart by these). */
export const STINGER_NOTES: Record<StingerKind, readonly number[]> = {
  'perfect-alive': [1046.5, 1318.51, 1567.98],
  'perfect-broken': [392, 311.13],
  top4: [783.99, 987.77, 1174.66],
  top: [523.25, 659.25, 783.99, 1046.5],
  title: [392, 523.25],
  relegated: [146.83, 110],
}

function stingerScore(kind: StingerKind, reduced: boolean): SeasonScore {
  const n = STINGER_NOTES[kind]
  const r = seeded(`season-stinger:${kind}`)
  const v: Voice[] = []
  switch (kind) {
    case 'perfect-alive':
      // Still perfect: a quick bright arpeggio and a sparkle
      n.forEach((f, i) => v.push(...chime(i * 0.06, f, { wave: 'triangle', peak: 0.24, dur: i === n.length - 1 ? 0.8 : 0.3 })))
      if (!reduced) v.push(...shimmer(0.2, [2637, 3136, 3951], 0.05, r, 0.05))
      break
    case 'perfect-broken':
      // The run over: a soft falling minor third, G4 to E♭4, over a low sigh
      v.push(tone(0, n[0], { wave: 'triangle', attack: 0.01, dur: 0.3, peak: 0.26, glideTo: n[0] * 0.98 }), tone(0.24, n[1], { wave: 'triangle', attack: 0.01, dur: 0.7, peak: 0.26, glideTo: n[1] * 0.93 }), tone(0.24, 77.78, { attack: 0.02, dur: 0.6, peak: 0.2, glideTo: 65 }))
      break
    case 'top4':
      n.forEach((f, i) => v.push(...chime(i * 0.08, f, { peak: 0.24, dur: i === n.length - 1 ? 0.7 : 0.3 })))
      break
    case 'top':
      // Top of the table: a C major arpeggio into a held chord
      n.forEach((f, i) => v.push(...chime(i * 0.065, f, { wave: 'triangle', peak: 0.22, dur: i === n.length - 1 ? 0.9 : 0.3 })))
      for (const f of [523.25, 659.25, 783.99]) v.push(tone(0.26, f, { wave: 'triangle', attack: 0.02, dur: 0.9, peak: 0.08 }))
      break
    case 'title':
      // The title sealed: a brass "ta-daa" (G4, then a held C major chord) on a timpani stroke, and a sparkle
      v.push(...brass(0, n[0], 0.16, 0.28))
      for (const f of [523.25, 659.25, 783.99]) v.push(...brass(0.18, f, 1.1, 0.22, 0.3))
      v.push(...timpani(0.18, 130.81, 0.5))
      if (!reduced) v.push(...shimmer(0.3, [2093, 2637, 3136, 3951], 0.07, r, 0.05))
      break
    case 'relegated':
      // The drop certain: a dark low minor chord sinking, low-passed sawtooths over a soft thud
      v.push(tone(0, n[0], { wave: 'sawtooth', attack: 0.03, hold: 0.2, dur: 1.2, peak: 0.3, lowpass: 520, glideTo: n[0] * 0.94, glideTime: 1 }), tone(0, 174.61, { wave: 'sawtooth', attack: 0.03, hold: 0.2, dur: 1.2, peak: 0.22, lowpass: 520, glideTo: 174.61 * 0.94, glideTime: 1 }), tone(0, n[1], { attack: 0.01, dur: 0.8, peak: 0.4, glideTo: 82 }))
      break
  }
  return score('stinger', STINGER_LEVEL[kind], v)
}

/**
 * The season over. Champions: a short brass phrase in C ("ta-ta-taaa") into a held chord with timpani; a perfect
 * season adds a roll and a longer sparkle. The top four: a bright arpeggio. Mid-table: a soft plagal cadence (F to C).
 * Relegated: a low minor cadence. All far shorter and quieter than the Cup's fanfare.
 */
function finishScore(finish: SeasonFinish, perfect: boolean, reduced: boolean): SeasonScore {
  const r = seeded(`season-end:${finish}:${perfect ? 'p' : ''}`)
  const v: Voice[] = []
  if (finish === 'champion') {
    for (const s of [0, 0.15]) v.push(...brass(s, 392, 0.13, 0.26))
    v.push(...brass(0.3, 523.25, 0.24, 0.28))
    const chord = 0.56
    for (const f of [523.25, 659.25, 783.99, 1046.5]) v.push(...brass(chord, f, 1.5, 0.2, 0.5))
    v.push(...timpani(0.3, 130.81, 0.45), ...timpani(chord, 130.81, 0.55))
    if (perfect) for (let i = 0; i < 5; i++) v.push(...timpani(chord - 0.3 + i * 0.06, 98, 0.2 + i * 0.04))
    if (!reduced) v.push(...shimmer(chord + 0.12, perfect ? [2093, 2637, 3136, 3951, 3520, 4186] : [2093, 2637, 3136, 3951], 0.08, r, 0.05))
    return score('season-end', perfect ? SEASON_MAX_LEVEL : FINISH_LEVEL.champion, v)
  }
  if (finish === 'top4') {
    ;[587.33, 739.99, 880, 1174.66].forEach((f, i) => v.push(...chime(i * 0.08, f, { wave: 'triangle', peak: 0.22, dur: i === 3 ? 1.1 : 0.35 })))
    return score('season-end', FINISH_LEVEL.top4, v)
  }
  if (finish === 'mid') {
    for (const f of [349.23, 440, 523.25]) v.push(tone(0, f, { wave: 'triangle', attack: 0.03, dur: 0.6, peak: 0.16 }))
    for (const f of [329.63, 392, 523.25]) v.push(tone(0.42, f, { wave: 'triangle', attack: 0.03, dur: 1.1, peak: 0.16 }))
    return score('season-end', FINISH_LEVEL.mid, v)
  }
  for (const f of [233.08, 293.66, 349.23]) v.push(tone(0, f, { wave: 'triangle', attack: 0.03, dur: 0.6, peak: 0.16 }))
  for (const f of [220, 261.63, 329.63]) v.push(tone(0.45, f, { wave: 'triangle', attack: 0.03, dur: 1.2, peak: 0.16, glideTo: f * 0.97, glideTime: 1.1 }))
  v.push(tone(0.45, 55, { attack: 0.02, dur: 0.9, peak: 0.3 }))
  return score('season-end', FINISH_LEVEL.drop, v)
}
