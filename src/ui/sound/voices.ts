/*
 * The second pass's voices: the draft's moments (a pick by its band, the Hindsight XI, Squad complete, the manager
 * spin, the end case, a bonus spin, a head-to-head turn), the interface's quiet feedback (a tab, a toast, an error, a
 * confirm), the arena (a penalty kick, a Gauntlet rung, a bracket's tie) and a Trophy Room badge. Built from the
 * palette's own blocks (scores.ts) and normalised the same way. Every level here is well under the goal's roar (0.9):
 * the loudest, a world-class pick and a badge, sit at a landing's pink.
 *
 * Its own chunk: `synth.ts` imports it on the first gesture, so none of this is in the first download.
 */
import type { CueRequest } from './cues'
import type { BallTouch } from './ball'
import { seeded } from './noise'
import { chime, noise, normalise, shimmer, timpani, tone, type Score, type Voice } from './scores'

/** The most any cue here reaches; the match's goal is 0.9, a gold landing 0.9, a pink one 0.52. */
export const CUE_MAX_LEVEL = 0.5

/** Each cue's level: interface sounds barely there, the draft's under the reel's landings, the arena's under the match's crowd. */
export const CUE_LEVEL = {
  pickBand: { squad: 0.36, solid: 0.4, star: 0.45, world: 0.5 },
  hindsight: 0.3,
  squadComplete: 0.42,
  managerLanded: 0.3,
  caseOpen: 0.3,
  bonus: 0.42,
  turn: { mine: 0.28, theirs: 0.16 },
  tab: 0.06,
  toast: 0.1,
  error: 0.13,
  confirm: 0.12,
  kick: { scoredOurs: 0.42, scored: 0.3, missedOurs: 0.3, missed: 0.34 },
  rung: 0.34,
  bracketTie: { user: 0.22, other: 0.1 },
  badge: 0.5,
  /** The ball: a touch barely there, a strike as loud as a near miss's start, the woodwork the loudest of them. */
  ball: { touch: 0.07, pass: 0.1, long: 0.14, header: 0.12, throw: 0.06, goalkick: 0.15, strike: 0.24, keeper: 0.22, woodwork: 0.34 },
  /** The crowd under the match: the bed low, a swell up to a near miss's. */
  crowdBed: 0.12,
  crowdSwell: { min: 0.12, max: 0.3 },
} as const

const made = new Map<string, Score>()

/** The cue's score; pure, the same request gives the same score (kept: treat it as read-only). */
export function cueScore(req: CueRequest): Score {
  const key = JSON.stringify(req)
  let s = made.get(key)
  if (!s) {
    s = build(req)
    if (made.size > 120) made.clear()
    made.set(key, s)
  }
  return s
}

/** The pick's thock: a short band of noise, the sound of the card going down. */
function thock(at = 0): Voice {
  return noise(at, { filter: 'bandpass', freq: 1800, q: 1.5, dur: 0.04, peak: 1 })
}

/** C major from C5 up, for the Gauntlet's climb: rung i is the i-th step (two octaves over fifteen rungs). */
const SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53, 2093]

function build(req: CueRequest): Score {
  switch (req.id) {
    case 'pick-band': {
      // A squad man the old pick (thock, E5 to B5); then a third note, then a triad, then a triad with a shimmer
      const v: Voice[] = [thock(), tone(0.005, 659.25, { peak: 0.5, dur: 0.14 }), tone(0.065, 987.77, { peak: 0.5, dur: 0.22 })]
      if (req.band === 'solid') v.push(tone(0.125, 1318.51, { peak: 0.32, dur: 0.24 }))
      if (req.band === 'star' || req.band === 'world') v.push(...chime(0.125, 1318.51, { wave: 'triangle', peak: 0.34, dur: 0.4 }), ...chime(0.185, 1567.98, { wave: 'triangle', peak: 0.3, dur: req.band === 'world' ? 0.9 : 0.5 }))
      if (req.band === 'world') {
        v.push(tone(0.185, 98, { attack: 0.004, dur: 0.4, peak: 0.25 }))
        if (!req.reduced) v.push(...shimmer(0.26, [2637, 3136, 3951, 3520], 0.05, seeded('pick-world'), 0.06))
      }
      return normalise('pick-band', CUE_LEVEL.pickBand[req.band], v)
    }
    case 'hindsight':
      // Looking back: perfect, a soft rising sixth with a glint; otherwise a gentle falling third, thoughtful, never a buzzer
      return req.perfect
        ? normalise('hindsight', CUE_LEVEL.hindsight, [...chime(0, 659.25, { wave: 'triangle', dur: 0.5 }), ...chime(0.12, 1046.5, { wave: 'triangle', dur: 0.9 }), ...(req.reduced ? [] : shimmer(0.24, [2093, 2637], 0.07, seeded('hindsight'), 0.05))])
        : normalise('hindsight', CUE_LEVEL.hindsight, [...chime(0, 587.33, { dur: 0.45 }), ...chime(0.14, 493.88, { dur: 0.8 })])
    case 'squad-complete': {
      // The sheet signed: a low drum, then an open fifth rising to the octave, held under the pundits' numbers
      const v: Voice[] = [...timpani(0, 98, 0.5), tone(0.02, 196, { wave: 'triangle', attack: 0.02, hold: 0.2, dur: 1.2, peak: 0.2 })]
      ;[392, 587.33, 783.99].forEach((f, i) => v.push(...chime(0.06 + i * 0.09, f, { wave: 'triangle', peak: 0.24, dur: i === 2 ? 1.1 : 0.4 })))
      if (!req.reduced) v.push(...shimmer(0.36, [2349, 3136, 2637], 0.07, seeded('squad-complete'), 0.05))
      return normalise('squad-complete', CUE_LEVEL.squadComplete, v)
    }
    case 'manager-landed':
      // All three managers landed: three quick bell notes, A C sharp E (apart from the red landing's C E G), the shortlist in
      return normalise('manager-landed', CUE_LEVEL.managerLanded, [...chime(0, 440, { dur: 0.3 }), ...chime(0.08, 554.37, { dur: 0.3 }), ...chime(0.16, 659.25, { dur: 0.7 })])
    case 'case-open':
      // The case's latch: a click, a short low knock and the lid's breath (noise swept up)
      return normalise('case-open', CUE_LEVEL.caseOpen, [
        noise(0, { filter: 'highpass', freq: 3000, q: 0, attack: 0.001, dur: 0.025, peak: 1 }),
        tone(0.01, 180, { glideTo: 120, glideTime: 0.06, attack: 0.002, dur: 0.12, peak: 0.6 }),
        noise(0.05, { filter: 'bandpass', freq: 500, freqTo: 2200, sweep: 0.3, q: 1.4, attack: 0.12, dur: 0.38, peak: 0.6 }),
      ])
    case 'bonus':
      // A bonus spin earned: two bright bells a fourth apart, and a glint
      return normalise('bonus', CUE_LEVEL.bonus, [...chime(0, 1046.5, { wave: 'triangle', dur: 0.4 }), ...chime(0.11, 1396.91, { wave: 'triangle', dur: 0.8 }), ...(req.reduced ? [] : shimmer(0.2, [2794, 3520, 4186], 0.05, seeded('bonus'), 0.06))])
    case 'turn':
      // A head-to-head turn passing (E flat and B flat, apart from every landing's notes): rising to the one whose pick it is on this screen, falling and quieter when it goes to the other
      return req.mine
        ? normalise('turn', CUE_LEVEL.turn.mine, [...chime(0, 622.25, { dur: 0.3 }), ...chime(0.1, 932.33, { dur: 0.6 })])
        : normalise('turn', CUE_LEVEL.turn.theirs, [...chime(0, 932.33, { dur: 0.3 }), ...chime(0.1, 622.25, { dur: 0.5 })])
    case 'tab':
      // Softer and lower than a primary button's click
      return normalise('tab', CUE_LEVEL.tab, [tone(0, 900, { attack: 0.002, dur: 0.035, peak: 0.6 }), noise(0, { filter: 'bandpass', freq: 2400, q: 2, attack: 0.001, dur: 0.015, peak: 0.6 })])
    case 'toast':
      return normalise('toast', CUE_LEVEL.toast, [tone(0, 880, { attack: 0.004, dur: 0.12, peak: 0.5 }), tone(0.07, 1174.66, { attack: 0.004, dur: 0.2, peak: 0.5 })])
    case 'error':
      // Two low notes falling a semitone, soft-edged: something did not work, without a buzzer
      return normalise('error', CUE_LEVEL.error, [tone(0, 311.13, { wave: 'triangle', attack: 0.008, dur: 0.14, peak: 0.5 }), tone(0.12, 293.66, { wave: 'triangle', attack: 0.008, dur: 0.24, peak: 0.5 })])
    case 'confirm':
      // A dialog's action taken: a rising fifth, short
      return normalise('confirm', CUE_LEVEL.confirm, [tone(0, 698.46, { attack: 0.004, dur: 0.1, peak: 0.5 }), tone(0.06, 1046.5, { attack: 0.004, dur: 0.22, peak: 0.5 })])
    case 'kick': {
      // The boot (a low thud and a slap), then the net's swish and a lift for a goal, or the keeper's gloves and a groan for a miss
      const r = seeded(`kick:${req.scored ? 's' : 'm'}:${req.ours ? 'o' : 't'}`)
      const v: Voice[] = [tone(0, 110, { glideTo: 55, glideTime: 0.08, attack: 0.002, dur: 0.14, peak: 0.6 }), noise(0, { filter: 'lowpass', freq: 1200, q: 0, dur: 0.05, peak: 0.8 })]
      if (req.scored) {
        v.push(noise(0.22, { filter: 'bandpass', freq: 2600, freqTo: 900, sweep: 0.3, q: 1.2, attack: 0.01, dur: 0.34, peak: 0.45 }))
        if (req.ours) v.push(...chime(0.26, 783.99, { wave: 'triangle', peak: 0.26, dur: 0.3 }), ...chime(0.34, 1046.5, { wave: 'triangle', peak: 0.26, dur: 0.6 }))
        else v.push(tone(0.26, 220, { wave: 'triangle', attack: 0.02, dur: 0.4, peak: 0.2, lowpass: 900 }))
        return normalise('kick', req.ours ? CUE_LEVEL.kick.scoredOurs : CUE_LEVEL.kick.scored, v)
      }
      v.push(tone(0.2, 150, { glideTo: 82, glideTime: 0.1, attack: 0.002, dur: 0.16, peak: 0.6 }), noise(0.2, { filter: 'lowpass', freq: 1500, q: 0, dur: 0.07, peak: 0.7 }))
      // Their miss is ours to cheer (a bright pair up); ours a low falling pair
      if (req.ours) v.push(tone(0.3, 293.66, { wave: 'triangle', attack: 0.02, dur: 0.3, peak: 0.24, glideTo: 277.18 }), tone(0.52, 246.94, { wave: 'triangle', attack: 0.02, dur: 0.6, peak: 0.24, glideTo: 220 }))
      else v.push(...chime(0.3 + r() * 0.02, 659.25, { wave: 'triangle', peak: 0.26, dur: 0.3 }), ...chime(0.4, 987.77, { wave: 'triangle', peak: 0.26, dur: 0.6 }))
      return normalise('kick', req.ours ? CUE_LEVEL.kick.missedOurs : CUE_LEVEL.kick.missed, v)
    }
    case 'rung': {
      // A rung climbed: one step higher on the scale each time, a note and its fifth
      const i = Math.max(0, Math.min(SCALE.length - 1, Math.round(req.rung)))
      const f = SCALE[i]
      return normalise('rung', CUE_LEVEL.rung, [thock(), ...chime(0.02, f, { wave: 'triangle', dur: 0.5 }), ...chime(0.1, f * 1.5, { wave: 'triangle', peak: 0.2, dur: 0.6 })])
    }
    case 'bracket-tie':
      // A tie filled in on the bracket: a soft wooden tick, a little chime for the user's own
      return req.user
        ? normalise('bracket-tie', CUE_LEVEL.bracketTie.user, [noise(0, { filter: 'bandpass', freq: 1400, q: 2, attack: 0.001, dur: 0.03, peak: 1 }), ...chime(0.02, 987.77, { dur: 0.45 })])
        : normalise('bracket-tie', CUE_LEVEL.bracketTie.other, [noise(0, { filter: 'bandpass', freq: 1400, q: 2, attack: 0.001, dur: 0.03, peak: 1 }), tone(0, 740, { attack: 0.002, dur: 0.06, peak: 0.5 })])
    case 'ball':
      return ballScore(req.touch, req.power)
    case 'crowd-swell': {
      // The crowd rising as an attack reaches the box: voices and shouts swelling over a second, falling back unanswered
      const d = Math.min(1, Math.max(0, req.danger))
      const r = seeded(`swell:${Math.round(d * 10)}`)
      const v: Voice[] = [
        noise(0, { colour: 'pink', filter: 'bandpass', freq: 380, freqTo: 560, sweep: 0.9, q: 0.8, attack: 0.55, hold: 0.25, dur: 1.7, peak: 1, offset: r() * 2, am: { hz: 2.7, depth: 0.15 } }),
        noise(0.08, { colour: 'pink', filter: 'bandpass', freq: 1000, freqTo: 1300, sweep: 0.8, q: 1, attack: 0.5, hold: 0.2, dur: 1.5, peak: 0.6 + 0.3 * d, offset: r() * 2, am: { hz: 4.1, depth: 0.22 } }),
        noise(0.15, { colour: 'pink', filter: 'highpass', freq: 2400, q: 0, attack: 0.45, hold: 0.1, dur: 1.2, peak: 0.25 * d, offset: r() * 2, am: { hz: 5.3, depth: 0.3 } }),
      ]
      return normalise('crowd-swell', CUE_LEVEL.crowdSwell.min + (CUE_LEVEL.crowdSwell.max - CUE_LEVEL.crowdSwell.min) * d, v)
    }
    case 'crowd-bed': {
      // The stadium under the play: a low murmur and a band of distant voices, breathing slowly; 4.6 s, laid end over end
      const level = Math.min(1, Math.max(0, req.level))
      return normalise('crowd-bed', CUE_LEVEL.crowdBed * level, [
        noise(0, { colour: 'pink', filter: 'lowpass', freq: 320, q: 0, attack: 1.1, hold: 2.2, dur: 4.6, peak: 1, offset: 0.3, am: { hz: 0.7, depth: 0.18 } }),
        noise(0, { colour: 'pink', filter: 'bandpass', freq: 650, q: 0.7, attack: 1.2, hold: 2, dur: 4.6, peak: 0.7, offset: 1.1, am: { hz: 1.3, depth: 0.25 } }),
        noise(0.2, { colour: 'pink', filter: 'bandpass', freq: 1500, q: 1.2, attack: 1.2, hold: 1.8, dur: 4.4, peak: 0.25, offset: 1.7, am: { hz: 3.1, depth: 0.35 } }),
      ])
    }
    case 'badge': {
      // A medal pinned on: a low strike, a bright bell held over its fifth, a glint
      const v: Voice[] = [tone(0, 130.81, { attack: 0.003, dur: 0.35, peak: 0.3 }), ...chime(0.02, 1046.5, { wave: 'triangle', peak: 0.3, dur: 1.2 }), ...chime(0.09, 1567.98, { wave: 'triangle', peak: 0.22, dur: 1.1 })]
      if (!req.reduced) v.push(...shimmer(0.2, [2093, 2637, 3136, 4186], 0.06, seeded('badge'), 0.06))
      return normalise('badge', CUE_LEVEL.badge, v)
    }
  }
}

/**
 * The ball: a boot's low thump (a sine falling an octave) under the slap of leather (a short band of noise), firmer
 * and brighter the harder it is struck. A header is duller (no slap above 700 Hz), a throw only the slap of the
 * hands, a strike adds the crack and the ball's whoosh, the keeper's gloves are a padded clap, and the woodwork
 * rings: four inharmonic partials of a steel tube over the thud.
 */
function ballScore(touch: BallTouch, power: number): Score {
  const p = Math.min(1, Math.max(0.2, power))
  const level = CUE_LEVEL.ball[touch] * (0.6 + 0.4 * p)
  const thump = (f: number, peak: number, dur = 0.12): Voice => tone(0, f, { glideTo: f * 0.5, glideTime: dur * 0.6, attack: 0.002, dur, peak })
  const slap = (freq: number, q: number, peak: number, dur = 0.03): Voice => noise(0, { filter: 'bandpass', freq, q, attack: 0.001, dur, peak })
  switch (touch) {
    case 'touch':
      return normalise('ball', level, [thump(140, 0.5, 0.08), slap(1100, 1.4, 0.6, 0.02)])
    case 'pass':
      return normalise('ball', level, [thump(120, 0.7), slap(1300, 1.2, 0.8)])
    case 'long':
    case 'goalkick':
      return normalise('ball', level, [thump(95, 0.8, 0.16), slap(1500, 1, 0.9, 0.035), noise(0.03, { filter: 'bandpass', freq: 900, freqTo: 400, sweep: 0.25, q: 0.8, attack: 0.03, dur: 0.3, peak: 0.25 })])
    case 'header':
      return normalise('ball', level, [thump(160, 0.7, 0.1), noise(0, { filter: 'lowpass', freq: 700, q: 0, attack: 0.001, dur: 0.05, peak: 0.8 })])
    case 'throw':
      return normalise('ball', level, [slap(2200, 1.5, 0.7, 0.025), noise(0.02, { filter: 'bandpass', freq: 700, freqTo: 350, sweep: 0.2, q: 0.9, attack: 0.04, dur: 0.22, peak: 0.25 })])
    case 'strike':
      return normalise('ball', level, [thump(85, 1, 0.18), slap(1800, 0.9, 1, 0.04), noise(0, { filter: 'highpass', freq: 3500, q: 0, attack: 0.001, dur: 0.018, peak: 0.6 }), noise(0.03, { filter: 'bandpass', freq: 1400, freqTo: 500, sweep: 0.3, q: 0.7, attack: 0.02, dur: 0.35, peak: 0.35 })])
    case 'keeper':
      return normalise('ball', level, [thump(150, 0.8, 0.14), noise(0, { filter: 'lowpass', freq: 1500, q: 0, attack: 0.001, dur: 0.07, peak: 0.9 }), noise(0.01, { filter: 'bandpass', freq: 600, q: 1, attack: 0.002, dur: 0.06, peak: 0.5 })])
    case 'woodwork':
      return normalise('ball', level, [
        thump(110, 0.7, 0.12),
        noise(0, { filter: 'bandpass', freq: 2600, q: 2, attack: 0.001, dur: 0.03, peak: 0.8 }),
        ...[523, 1347, 2389, 3712].map((f, i) => tone(0, f, { attack: 0.001, dur: 1.1 - i * 0.22, peak: 0.3 / (1 + i * 0.6) })),
      ])
  }
}
