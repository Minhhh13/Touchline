/**
 * The ball path as football: possession spells with phases, set pieces that
 * are staged before they are taken, and attacks that end where the engine
 * says they end.
 *
 * Open play. The man on the ball takes a touch and looks up (longer at the
 * back and for a slow tempo, quicker on the break), then plays by the phase
 * he is in, read off where the ball is for his side:
 * - Build-up (his own third): the keeper rolls it to a centre-back or kicks
 *   long; the back line circulates it, switches it across, steps in with it,
 *   or goes long when the side plays direct.
 * - Progression (the middle third): passes into midfield and beyond, a
 *   switch of play to the far wing, a dribble, a ball back to recycle.
 * - Final third: out wide to the winger or the overlapping full-back, down
 *   the line, a cross; in the middle a lay-off, a one-two or a ball in behind.
 *   Attacks with no shot in the log end the way attacks do: the cross headed
 *   clear, the keeper claiming, a deflection behind for a corner, a through
 *   ball overhit for a goal kick, a ball cut out.
 * The side on the ball loses it now and then (more often the further up it
 * is and the less of the pressure it has), to a tackle, an interception or
 * the press; a ball won in its own half sets off a quicker counter.
 *
 * Moments. Every shot in the log is struck at its event's position on its
 * strike moment (timing.ts), at the end of an attack picked to fit the
 * event: a corner for "heads it home from a corner", a cross for a header,
 * a ball over the top for a man who rounds or chips the keeper, a long chain
 * for "a flowing team move", a scramble for a loose ball, a cut-back for a
 * tap-in, a lay-off for a curler from the edge (a direct free kick when no
 * one assisted it), a foul in the box and the spot for a penalty. A goal's
 * last pass comes from its recorded assister. After the shot: the net and a
 * kick-off, the keeper's save (held and thrown out, or tipped behind for a
 * corner), the post or the bar and a clearance, or wide and a goal kick.
 * Every booking has its foul (timing.ts `foulTimes`): the ball stops, the
 * free kick is set up and taken.
 *
 * Pure and deterministic for a seed (its own `ball-<seed>-<from>` stream,
 * never the game's generator).
 */
import type { MatchEvent, Tactics } from '@engine/types'
import { binOf, type PitchPoint } from '@engine/matchDetail'
import { Rng, hashString } from '@engine/rng'
import { metres, onPitchAt, other, toShared, type PlacedPlayer, type Side } from './pitchGeometry'
import type { BallKeyframe, BallKind, Phase, PlayStyle, PlayTag, PossessionInput, SetPieceKind } from './possession'
import { FOUL_STOP, foulTimes, matchPace, MAX_HOP, MAX_SQUEEZE, SECOND, SPEED, strikeTimes, toMatch, toPicture } from './timing'
import { shapePoint, type Scene } from './shape'
import { swayPhase } from './movement'

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

export const STANDARD_STYLE: PlayStyle = { tempo: 'standard', passing: 'mixed', width: 'standard', pressing: 'mid' }

/** A side's style of play from its instructions. */
export function styleOf(t: Tactics | undefined): PlayStyle {
  if (!t) return STANDARD_STYLE
  return { tempo: t.tempo, passing: t.passing, width: t.width, pressing: t.pressing }
}

/** The attack that ends in a shot, picked from the event. */
export type Pattern = 'cross' | 'cutback' | 'through' | 'edge' | 'team-move' | 'counter' | 'solo' | 'scramble' | 'corner' | 'penalty' | 'freekick'

/** How a logged shot was made, from its text, its type, its assist and where it was struck (attacking coordinates). */
export function patternFor(ev: MatchEvent, h: number): Pattern {
  const text = ev.text.toLowerCase()
  const at = ev.position ?? { x: 88, y: 50 }
  if (ev.type === 'penalty') return 'penalty'
  if (ev.type === 'own_goal') return h % 2 ? 'cross' : 'scramble'
  if (text.includes('from a corner')) return 'corner'
  if (text.includes('head')) return h % 3 === 0 ? 'corner' : 'cross'
  if (text.includes('rounds the keeper') || text.includes('chips the keeper')) return 'through'
  if (text.includes('flowing team move')) return 'team-move'
  if (text.includes('loose ball') || text.includes('crowd of bodies') || text.includes('on the line')) return 'scramble'
  if (text.includes('taps in') || text.includes('close range') || text.includes('six yards')) return 'cutback'
  if (text.includes('edge of the box') || text.includes('curls')) return ev.type === 'goal' && !ev.secondaryId && h % 2 === 0 ? 'freekick' : 'edge'
  if (at.x < 84) return h % 3 === 0 ? 'solo' : 'edge'
  const pool: Pattern[] = ['cross', 'cross', 'through', 'cutback', 'counter', 'solo', 'team-move', 'edge']
  return pool[h % pool.length]
}

/** The minutes each attack would like before its strike (it shortens to fit a crowded spell). */
const PATTERN_WINDOW: Record<Pattern, number> = { cross: 2.2, cutback: 2.2, through: 1.9, edge: 1.9, 'team-move': 3.2, counter: 1.6, solo: 1.7, scramble: 2.2, corner: 3.2, penalty: 2.6, freekick: 2.6 }

interface Beat {
  to: PitchPoint
  kind: BallKind
  side: Side
  holder?: string
  /** Metres per match minute. */
  speed: number
  /** Least duration of the hop. */
  min: number
  /** The touch before it (minutes). */
  dwell: number
  /** The ball stands still this long after it arrives (a set piece being set up). */
  wait?: number
  sp?: SetPieceKind
  loft?: number
  bend?: number
  play?: PlayTag
  phase?: Phase
  /** May be left out when time is short (from the front). */
  optional?: boolean
}

export function buildBallPath(input: PossessionInput): BallKeyframe[] {
  const { from, to, momentum, home, away } = input
  if (!home.length || !away.length) return []
  const rng = new Rng(`ball-${input.seed}-${from}`)
  const out: BallKeyframe[] = []
  const push = (k: BallKeyframe) => {
    const last = out[out.length - 1]
    if (last && k.t <= last.t) k.t = last.t + 0.001
    k.x = clamp(k.x, 0, 100)
    k.y = clamp(k.y, 0, 100)
    out.push(k)
  }
  // The path is laid out in picture time (timing.ts `matchPace`: a crowded minute plays longer on screen), so every
  // speed and wait below is what the viewer sees; its keyframes go back to match time at the end
  const pace = matchPace(input.events)
  const P = (t: number) => toPicture(pace, t)
  const strikes = strikeTimes(input.events, from, to)
  const strikeAt = new Map<number, number>()
  const shots = [...strikes.entries()].map(([idx, t]) => ({ ev: input.events[idx], t: P(t), idx })).sort((a, b) => a.t - b.t)
  for (const [, t] of strikes) strikeAt.set(P(t), t)
  const fouls = [...foulTimes(input.events, from, to).entries()].filter(([, f]) => f.staged).map(([idx, f]) => {
    strikeAt.set(P(f.t), f.t)
    return [idx, { ...f, t: P(f.t) }] as const
  })
  // A stretch that stops (at 45 or 70) ends a moment before the next one starts, so the restart is the next keyframe
  const end = P(to >= 90 ? Math.max(90, ...shots.map((s) => s.ev.minute)) + 1 : to + 0.98)
  const styleOf = (s: Side): PlayStyle => input.styles?.[s] ?? STANDARD_STYLE
  /** The men on the pitch at picture time `p`. */
  const squad = (s: Side, p: number) => onPitchAt(s === 'home' ? home : away, Math.min(Math.floor(toMatch(pace, p) + 1e-9), 89))
  const outfield = (s: Side, minute: number) => {
    const all = squad(s, minute)
    const men = all.filter((p) => p.position !== 'GK')
    return men.length ? men : all
  }
  const keeper = (s: Side, minute: number) => squad(s, minute).find((p) => p.position === 'GK')
  const along = (s: Side, p: PitchPoint) => (s === 'home' ? p.x : 100 - p.x)
  const acrossOf = (s: Side, p: PitchPoint) => (s === 'home' ? p.y : 100 - p.y)
  const at = (s: Side, a: number, c: number): PitchPoint => (s === 'home' ? { x: clamp(a, 0.5, 99.5), y: clamp(c, 0.5, 99.5) } : { x: clamp(100 - a, 0.5, 99.5), y: clamp(100 - c, 0.5, 99.5) })
  const goalLine = (s: Side) => (s === 'home' ? 100 : 0)
  const phases = new Map<string, number>()
  const phaseOf = (p: PlacedPlayer) => {
    let v = phases.get(p.psId)
    if (v === undefined) phases.set(p.psId, (v = swayPhase(p.psId)))
    return v
  }

  let pos: PitchPoint = { x: 50, y: 50 }
  let side: Side = from >= 46 && from < 71 ? 'away' : 'home'
  let holder: string | undefined
  let now = P(Math.max(0, from))
  /** No hop may land after this: the next moment's run-up, or the end of the range. */
  let deadline = end
  /** When the side on the ball won it, for a counter. */
  let regainAt = -Infinity
  let regainAlong = 50

  /** Where a man stands in his side's shape with the ball at `ball` and `poss` on it (the same shape the dots are drawn in). */
  const spot = (p: PlacedPlayer, ball: PitchPoint = pos, poss: Side = side): PitchPoint => {
    const sc: Scene = { ball, poss, settle: 1, setPiece: null, box: 0, boxSide: poss }
    return shapePoint(p, sc, phaseOf(p))
  }
  const nearestTo = (men: PlacedPlayer[], p: PitchPoint, ball: PitchPoint = pos, poss: Side = side) => men.reduce((a, b) => (metres(spot(a, ball, poss), p) < metres(spot(b, ball, poss), p) ? a : b))
  const zoneOf = (s: Side, p: PitchPoint): Phase => {
    const a = along(s, p)
    return a < 34 ? 'buildup' : a < 67 ? 'progression' : 'final'
  }
  const phaseNow = (s: Side, p: PitchPoint): Phase => (now - regainAt < 0.9 && regainAlong < 55 && s === side && along(s, p) < 85 ? 'counter' : zoneOf(s, p))
  const share = (s: Side, t: number) => {
    const pHome = momentum[binOf(Math.max(1, Math.floor(toMatch(pace, t) + 1e-9)))] ?? 0.5
    return s === 'home' ? pHome : 1 - pHome
  }
  const isKeeper = (id: string | undefined, s: Side) => !!id && keeper(s, now)?.psId === id

  /** A hop to `target` that takes as long as its length needs (at least `min`), squeezed to the deadline; false when it does not fit. */
  const hop = (target: PitchPoint, kind: BallKind, s: Side, who: string | undefined, speed: number, min: number, extra: Partial<BallKeyframe> = {}): boolean => {
    const d = metres(pos, target)
    let dur = Math.max(min, d / speed)
    if (now + dur > deadline) dur = deadline - now
    const squeeze = speed >= SPEED.cross ? 1.25 : MAX_SQUEEZE
    if (dur < 0.06 || d / dur > speed * squeeze) return false
    now += dur
    pos = { x: clamp(target.x, 0, 100), y: clamp(target.y, 0, 100) }
    if (s !== side) {
      regainAt = now
      regainAlong = along(s, pos)
    }
    side = s
    holder = who
    push({ t: now, x: pos.x, y: pos.y, kind, side: s, holder: who, phase: extra.phase ?? phaseNow(s, pos), ...extra })
    return true
  }
  /** The man on the ball takes a touch: the ball stays at his feet, drifting a yard or so the way he faces. */
  const touch = (minutes: number) => {
    const dur = Math.min(minutes, deadline - now)
    if (dur <= 0.02) return
    now += dur
    if (holder) {
      const dir = side === 'home' ? 1 : -1
      pos = { x: clamp(pos.x + dir * Math.min(1.4, dur * 4) * rng.float(0.3, 1), 1, 99), y: clamp(pos.y + rng.float(-0.8, 0.8), 1, 99) }
    }
    push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder, phase: phaseNow(side, pos) })
  }
  /** Stand still on the spot (a set piece being set up). */
  const still = (minutes: number) => {
    const dur = Math.min(minutes, deadline - now)
    if (dur <= 0.02) return
    now += dur
    push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder, phase: 'setpiece' })
  }
  const lastKf = () => out[out.length - 1]
  /** The ball has just been put on its spot for a set piece: it waits there (up to the deadline), and the set piece is taken when the wait is over. */
  const stage = (kind: SetPieceKind, wait: number) => {
    const k = lastKf()
    still(wait)
    if (k) k.setPiece = { kind, until: Math.max(k.t, now) }
  }
  /** Run with the ball: `m` metres towards `dir` (shared units, normalised here). */
  const runWith = (target: PitchPoint, speed: number = SPEED.carry, play: PlayTag = 'dribble'): boolean => hop(target, 'carry', side, holder, speed, 0.15, { play })

  const kickOff = (s: Side, t: number, wait: number) => {
    const men = outfield(s, t)
    const taker = men.length ? men.reduce((a, b) => (metres(a, { x: 50, y: 50 }) < metres(b, { x: 50, y: 50 }) ? a : b)) : undefined
    pos = { x: 50, y: 50 }
    side = s
    holder = taker?.psId
    now = t
    push({ t, x: 50, y: 50, kind: 'kickoff', side: s, holder, phase: 'setpiece', setPiece: { kind: 'kickoff', until: t + wait } })
    regainAt = -Infinity
  }

  /** Choose a team-mate of `s` to pass to: weighted by `weight`, within a hop and a sensible range. */
  const receiver = (weight: (p: PlacedPlayer, at: PitchPoint, d: number) => number, opts: { minM?: number; maxM?: number; exclude?: string[]; keeper?: boolean } = {}): { p: PlacedPlayer; at: PitchPoint } | null => {
    const minM = opts.minM ?? 7
    const maxM = opts.maxM ?? 40
    const men = squad(side, now).filter((p) => p.psId !== holder && (opts.keeper || p.position !== 'GK') && !(opts.exclude ?? []).includes(p.psId))
    const options: Array<{ p: PlacedPlayer; at: PitchPoint; w: number }> = []
    for (const p of men) {
      const s = spot(p)
      const d = metres(s, pos)
      if (d < minM || d > maxM || Math.hypot(s.x - pos.x, s.y - pos.y) > MAX_HOP - 1) continue
      const w = weight(p, s, d)
      if (w > 0) options.push({ p, at: s, w })
    }
    if (!options.length) return null
    const pick = rng.pickWeighted(options, (o) => o.w)
    return { p: pick.p, at: pick.at }
  }
  /** A pass to a chosen man, on the ground or in the air by its length and kind. */
  const passTo = (r: { p: PlacedPlayer; at: PitchPoint }, play: PlayTag, opts: { speed?: number; loft?: number } = {}): boolean => {
    const d = metres(pos, r.at)
    const longBall = play === 'switch' || play === 'long'
    const loft = opts.loft ?? (longBall ? 0.5 + rng.float(0, 0.3) : d > 30 ? 0.35 : 0)
    const speed = opts.speed ?? (longBall ? SPEED.long : play === 'back' || play === 'layoff' ? SPEED.soft : SPEED.pass)
    return hop(r.at, 'pass', side, r.p.psId, speed, 0.22, { loft, bend: rng.float(-0.06, 0.06), play })
  }

  /** The other side wins it: the nearest man steps in (a tackle or the press) or cuts out the pass (an interception). */
  const loseBall = (zoneNow: Phase): boolean => {
    const s = other(side)
    const men = outfield(s, now)
    if (!men.length) return false
    const pressing = styleOf(s).pressing
    if (rng.chance(0.55)) {
      const taker = nearestTo(men, pos)
      const ts = spot(taker)
      const point = { x: pos.x + (ts.x - pos.x) * 0.3, y: pos.y + (ts.y - pos.y) * 0.3 }
      const play: PlayTag = zoneNow === 'buildup' && pressing !== 'low' ? 'press' : 'tackle'
      if (hop(point, 'pass', s, taker.psId, SPEED.soft, 0.14, { play, bend: rng.float(-0.05, 0.05) })) {
        // Now and then it squirts out of play for a throw-in to the side that had it
        if (rng.chance(0.08) && Math.min(pos.y, 100 - pos.y) < 25) throwIn(other(s))
        return true
      }
      side = s
      holder = taker.psId
      return false
    }
    // A pass that never arrives: cut out on its way to the man it was meant for
    const meant = receiver((_p, _a, d) => Math.exp(-(((d - 16) / 12) ** 2)) + 0.01)
    const aim = meant ? meant.at : { x: pos.x + (side === 'home' ? 15 : -15), y: pos.y }
    const mid = { x: pos.x + (aim.x - pos.x) * 0.6, y: pos.y + (aim.y - pos.y) * 0.6 }
    const taker = nearestTo(men, mid)
    const ts = spot(taker)
    const cut = { x: mid.x + (ts.x - mid.x) * 0.4, y: mid.y + (ts.y - mid.y) * 0.4 }
    return hop(cut, 'pass', s, taker.psId, SPEED.pass, 0.18, { play: 'interception', bend: rng.float(-0.04, 0.04) })
  }

  /** Out of play over the touchline, then thrown back in by side `s` (the throw is staged: the ball waits while the thrower gets to it). */
  const throwIn = (s: Side) => {
    const lineY = pos.y < 50 ? 0.4 : 99.6
    const outAt = { x: clamp(pos.x + rng.float(-4, 4), 3, 97), y: lineY }
    if (!hop(outAt, 'pass', s, undefined, SPEED.pass, 0.12, { play: 'out', loft: 0.15 })) return
    const men = outfield(s, now)
    if (!men.length) return
    const thrower = nearestTo(men, outAt, outAt, s)
    const wait = 0.3
    if (!hop(outAt, 'reset', s, thrower.psId, SPEED.fetch, 0.28, { play: 'setpiece', phase: 'setpiece' })) return
    stage('throw', wait)
    const r = receiver((_p, _a, d) => Math.exp(-(((d - 12) / 8) ** 2)) + 0.01, { minM: 5, maxM: 26 })
    if (r) passTo(r, 'setpiece', { loft: 0.3, speed: SPEED.soft })
  }

  /** The keeper of `s` restarts: a goal kick from his six-yard box after the ball goes behind (staged), then short or long. */
  const goalKick = (s: Side, nearY: number) => {
    const gk = keeper(s, now)
    const kick = at(s, 5.5, s === 'home' ? (nearY < 50 ? 41 : 59) : nearY < 50 ? 59 : 41)
    // The ball is out of play: it goes to the keeper whatever the time, quicker (and with a shorter wait) when the next move is close
    const avail = deadline - now
    const wait = clamp(avail - 0.65, 0.12, 0.4)
    const fetch = metres(pos, kick) / SPEED.fetch
    const speed = fetch + wait > avail - 0.1 ? Math.min(SPEED.fetch * 3, metres(pos, kick) / Math.max(0.1, avail - wait - 0.1)) : SPEED.fetch
    const keep = deadline
    deadline = Math.max(deadline, now + 0.2)
    const ok = hop(kick, 'reset', s, gk?.psId, speed, 0.18, { play: 'setpiece', phase: 'setpiece' })
    deadline = keep
    if (!ok) {
      pos = kick
      side = s
      holder = gk?.psId
      return false
    }
    stage('goalkick', wait)
    if (deadline - now > 0.3) distribute(true)
    return true
  }
  /** The keeper on the ball: short to a centre-back or a full-back, or long into midfield. */
  const distribute = (goalKickNow = false): boolean => {
    const st = styleOf(side)
    const shortShare = st.passing === 'short' ? 0.85 : st.passing === 'direct' ? 0.35 : 0.62
    const pressed = styleOf(other(side)).pressing === 'high' ? 0.15 : 0
    if (rng.chance(shortShare - pressed)) {
      const r = receiver((p, _a, d) => ((p.position === 'CB' ? 3 : p.position === 'LB' || p.position === 'RB' ? 2 : p.position === 'DM' ? 1 : 0.05) * Math.exp(-(((d - 18) / 12) ** 2))) + 0.001, { minM: 6, maxM: 38 })
      if (r) return passTo(r, 'distribution', { speed: goalKickNow ? SPEED.pass : SPEED.soft })
    }
    const r = receiver((p, _a, d) => (['CM', 'AM', 'ST', 'LW', 'RW', 'DM'].includes(p.position) ? 1 : 0.1) * (d > 25 ? 1 : 0.1), { minM: 18, maxM: 49 })
    if (r) return passTo(r, 'long', { loft: 0.8, speed: SPEED.long })
    return false
  }

  /** A corner for `s` from the flag on the side of `y`, set up and swung in to `target` for `to` (a team-mate, or a defender heading it clear when `to` is of the other side). */
  const corner = (s: Side, y: number, takerId: string | undefined, wait: number): boolean => {
    const flag = { x: goalLine(s) === 100 ? 99.6 : 0.4, y: y < 50 ? 0.6 : 99.4 }
    const men = outfield(s, now)
    if (!men.length) return false
    const taker = (takerId && men.find((p) => p.psId === takerId)) || men.filter((p) => ['LW', 'RW', 'AM', 'CM', 'LB', 'RB'].includes(p.position)).reduce<PlacedPlayer | undefined>((a, b) => (!a || metres(b, flag) < metres(a, flag) ? b : a), undefined) || men[0]
    // The corner always stands long enough to read: the ball is fetched quicker when time is short, never the wait
    const avail = deadline - now
    const minWait = 0.3
    const fetch = Math.max(0.2, metres(pos, flag) / SPEED.fetch)
    const speed = fetch + minWait > avail ? metres(pos, flag) / Math.max(0.2, avail - minWait) : SPEED.fetch
    if (speed > SPEED.fetch * 2.5 || !hop(flag, 'reset', s, taker.psId, speed, 0.2, { play: 'setpiece', phase: 'setpiece' })) return false
    stage('corner', Math.max(minWait, Math.min(wait, deadline - now)))
    return true
  }

  /** A ball into the box that comes to nothing: headed clear, claimed, flicked on and cleared, or behind for a corner. */
  const deliveryOutcome = (s: Side, kind: 'cross' | 'corner' | 'freekick') => {
    const d = other(s)
    const tgt = at(s, 88 + rng.float(0, 7), 50 + rng.float(-14, 14))
    const defs = outfield(d, now)
    const gk = keeper(d, now)
    const r = rng.next()
    const loft = kind === 'cross' ? 0.6 : 0.85
    const bend = (pos.y > 50 ? -0.1 : 0.1) * (s === 'home' ? 1 : -1)
    if (r < 0.2 && gk) {
      // The keeper comes and claims it
      if (!hop(tgt, 'pass', d, gk.psId, SPEED.cross, 0.25, { loft, bend, play: 'claim' })) return
      touch(SECOND * rng.float(1.2, 2))
      distribute()
      return
    }
    if (!defs.length) return
    const header = nearestTo(defs, tgt, tgt, s)
    if (!hop(tgt, 'pass', d, header.psId, SPEED.cross, 0.25, { loft, bend, play: 'cross' })) return
    if (kind === 'cross' && r > 0.88) {
      // Glanced behind: a corner
      const outPt = at(s, 100, 50 + (acrossOf(s, pos) > 50 ? 1 : -1) * rng.float(8, 18))
      if (!hop(outPt, 'pass', s, undefined, SPEED.long, 0.12, { play: 'deflection', loft: 0.3 })) return
      if (deadline - now > 1.6 && corner(s, outPt.y, undefined, 0.55)) deliveryOutcome(s, 'corner')
      return
    }
    // Headed clear to the edge of the box or beyond, and the second ball is fought for
    const land = at(d, rng.float(22, 40), 50 + rng.float(-28, 28))
    if (!hop(land, 'pass', d, undefined, SPEED.long, 0.25, { loft: 0.55, play: 'clearance' })) return
    const winner = rng.chance(share(d, now)) ? d : s
    const men = outfield(winner, now)
    if (!men.length) return
    const man = nearestTo(men, land, land, winner)
    hop({ x: land.x + rng.float(-2, 2), y: land.y + rng.float(-2, 2) }, 'pass', winner, man.psId, SPEED.carry, 0.15, { play: winner === d ? 'header' : 'short' })
  }

  /** A ball in behind that comes to nothing: the keeper out to it, a defender across, or overhit for a goal kick. */
  const throughOutcome = () => {
    const s = side
    const d = other(s)
    const a = along(s, pos)
    const target = at(s, Math.min(96, a + rng.float(14, 22)), clamp(acrossOf(s, pos) + rng.float(-10, 10), 25, 75))
    if (Math.hypot(target.x - pos.x, target.y - pos.y) > MAX_HOP - 1) return
    const r = rng.next()
    const gk = keeper(d, now)
    if (along(s, target) > 84 && gk && r < 0.4) {
      if (hop(target, 'pass', d, gk.psId, SPEED.through, 0.25, { play: 'claim' })) {
        touch(SECOND * rng.float(1, 1.8))
        distribute()
      }
      return
    }
    if (along(s, target) > 86 && r > 0.82) {
      const behind = at(s, 100, acrossOf(s, target))
      if (hop(target, 'pass', s, undefined, SPEED.through, 0.25, { play: 'through' }) && hop(behind, 'pass', s, undefined, SPEED.soft, 0.12, { play: 'out' })) goalKick(d, behind.y)
      return
    }
    const defs = outfield(d, now)
    if (!defs.length) return
    const man = nearestTo(defs, target, target, s)
    hop(target, 'pass', d, man.psId, SPEED.through, 0.25, { play: 'interception' })
  }

  /** One decision on the ball in open play. False when there was no time for it. */
  const act = (z: Phase): boolean => {
    const st = styleOf(side)
    const fwd = (p: PitchPoint) => along(side, p) - along(side, pos)
    const c = acrossOf(side, pos)
    const r = rng.next()
    if (isKeeper(holder, side)) return distribute()
    if (z === 'buildup' || (z === 'counter' && along(side, pos) < 34)) {
      if (r < (st.passing === 'direct' ? 0.24 : st.passing === 'short' ? 0.05 : 0.11)) {
        const t = receiver((p, a, d) => (['ST', 'LW', 'RW', 'AM'].includes(p.position) ? 1 : 0.15) * (fwd(a) > 15 ? 1 : 0.05) * (d > 24 ? 1 : 0.2), { minM: 20, maxM: 49 })
        if (t) return passTo(t, 'long')
      }
      if (r < 0.22) return runWith(at(side, along(side, pos) + rng.float(5, 11), c + rng.float(-4, 4)))
      if (r < 0.32 && Math.abs(c - 50) > 14) {
        const t = receiver((_p, a) => (acrossOf(side, a) - 50) * (c - 50) < 0 && Math.abs(acrossOf(side, a) - c) > 22 ? 1 : 0, { minM: 15, maxM: 46 })
        if (t) return passTo(t, 'switch', { loft: metres(pos, t.at) > 30 ? 0.35 : 0.08, speed: SPEED.pass })
      }
      if (r < 0.36) {
        const gk = keeper(side, now)
        if (gk && along(side, pos) < 30) return passTo({ p: gk, at: spot(gk) }, 'back')
      }
      const t = receiver((p, a, d) => {
        const f = fwd(a)
        if (f < -14 || f > 30) return 0
        const role = ['CB', 'LB', 'RB', 'DM'].includes(p.position) ? 1.6 : p.position === 'CM' ? 1.2 : 0.3
        return role * Math.exp(-(((d - 16) / 11) ** 2)) * (f > 0 ? 1.3 : 1)
      })
      if (t) return passTo(t, fwd(t.at) > 4 ? 'forward' : fwd(t.at) < -4 ? 'back' : 'short')
      return runWith(at(side, along(side, pos) + 4, c))
    }
    if (z === 'progression' || z === 'counter') {
      const counter = z === 'counter'
      const switchShare = (st.width === 'wide' ? 0.22 : st.width === 'narrow' ? 0.07 : 0.14) * (counter ? 0.3 : 1)
      if (r < switchShare && Math.abs(c - 50) > 10) {
        const t = receiver((_p, a) => {
          const ca = acrossOf(side, a)
          return (ca - 50) * (c - 50) < 0 && Math.abs(ca - 50) > 22 && fwd(a) > -6 ? 1 : 0
        }, { minM: 22, maxM: 49 })
        if (t) return passTo(t, 'switch')
      }
      if (r < switchShare + 0.04) {
        throughOutcome()
        return true
      }
      if (r < switchShare + (counter ? 0.34 : 0.2)) return runWith(at(side, along(side, pos) + rng.float(6, 13), c + rng.float(-6, 6)), counter ? SPEED.dribble : SPEED.carry)
      if (!counter && r < switchShare + 0.32) {
        const t = receiver((_p, a, d) => (fwd(a) < -3 ? 1 : 0) * Math.exp(-(((d - 14) / 10) ** 2)))
        if (t) return passTo(t, 'back')
      }
      const t = receiver((p, a, d) => {
        const f = fwd(a)
        if (f < -6) return 0
        const role = ['AM', 'LW', 'RW', 'ST', 'CM'].includes(p.position) ? 1.4 : ['LB', 'RB'].includes(p.position) ? 0.8 : 0.4
        return role * Math.exp(-(((d - 17) / 12) ** 2)) * (f > 6 ? 1.8 : 1)
      })
      if (t) return passTo(t, fwd(t.at) > 4 ? 'forward' : 'short', counter ? { speed: SPEED.through } : {})
      return runWith(at(side, along(side, pos) + 5, c))
    }
    // The final third
    const wide = Math.abs(c - 50) > 24
    if (wide) {
      if (r < 0.32) {
        deliveryOutcome(side, 'cross')
        return true
      }
      if (r < 0.52 && along(side, pos) < 90) return runWith(at(side, Math.min(95, along(side, pos) + rng.float(6, 12)), c + (c < 50 ? -2 : 2)), SPEED.dribble)
      if (r < 0.75) {
        const t = receiver((_p, a, d) => (Math.abs(acrossOf(side, a) - 50) < 22 ? 1 : 0.1) * Math.exp(-(((d - 13) / 9) ** 2)))
        if (t) return passTo(t, 'layoff')
      }
      const t = receiver((_p, a) => (fwd(a) < -4 ? 1 : 0))
      if (t) return passTo(t, 'back')
      deliveryOutcome(side, 'cross')
      return true
    }
    if (r < 0.2) {
      throughOutcome()
      return true
    }
    if (r < 0.52) {
      const t = receiver((_p, a, d) => (Math.abs(acrossOf(side, a) - 50) > 22 ? 1 : 0.05) * Math.exp(-(((d - 18) / 12) ** 2)))
      if (t) return passTo(t, 'short')
    }
    if (r < 0.78) {
      const t = receiver((_p, a, d) => Math.exp(-(((d - 11) / 7) ** 2)) * (fwd(a) > -10 ? 1 : 0.1), { minM: 5, maxM: 24 })
      if (t) return passTo(t, 'layoff')
    }
    const t = receiver((_p, a) => (fwd(a) < -5 ? 1 : 0))
    if (t) return passTo(t, 'back')
    throughOutcome()
    return true
  }

  /** Ordinary play up to the deadline: a touch, a look, a decision; now and then the ball is lost. */
  const play = () => {
    for (let guard = 0; guard < 900 && deadline - now > 0.06; guard++) {
      const z = phaseNow(side, pos)
      const tempo = styleOf(side).tempo === 'slow' ? 1.3 : styleOf(side).tempo === 'fast' ? 0.78 : 1
      const keeperHas = isKeeper(holder, side)
      const look = SECOND * (keeperHas ? rng.float(1.1, 2.1) : z === 'buildup' ? rng.float(0.5, 1.1) : z === 'progression' ? rng.float(0.35, 0.85) : z === 'counter' ? rng.float(0.15, 0.35) : rng.float(0.25, 0.6)) * tempo
      if (deadline - now < look + 0.28) {
        touch(deadline - now)
        return
      }
      touch(look)
      if (!holder) {
        // A loose ball: the nearest man of the side credited with it gets there
        const men = outfield(side, now)
        if (men.length) {
          const man = nearestTo(men, pos)
          if (!hop({ x: pos.x, y: pos.y }, 'carry', side, man.psId, SPEED.carry, 0.15, { play: 'short' })) holder = man.psId
        }
        continue
      }
      let lose = (z === 'final' ? 0.025 : z === 'progression' || z === 'counter' ? 0.01 : 0.004) + 0.32 * (1 - share(side, now)) ** 2
      if (z === 'buildup') lose *= styleOf(other(side)).pressing === 'high' ? 1.5 : styleOf(other(side)).pressing === 'low' ? 0.6 : 1
      if (keeperHas) lose = 0
      const ok = rng.chance(lose) ? loseBall(z) : act(z)
      if (!ok) touch(deadline - now)
    }
  }

  // ------------------------------------------------------------------ the attacks that end in a shot
  /** The last ball that has to be quick: straight into the shooter's stride (in the air when it must be). */
  const directLastBall = (strike: number, target: PitchPoint, s: Side, shooter: string | undefined) => {
    let own = holder === shooter
    const d = metres(pos, target)
    if (own && d / (SPEED.carry * 1.6) > strike - now) own = d < 4
    const need = Math.max(0.2, d / (own ? SPEED.carry * 1.6 : SPEED.pass))
    if (strike - need > now + 0.05) {
      deadline = strike - need
      touch(strike - need - now)
    }
    const last = lastKf()
    if (!last || last.t < strike - 0.004) {
      const cross = !own && Math.abs(pos.y - target.y) > 22
      const far = Math.hypot(target.x - pos.x, target.y - pos.y) > 44
      const quick = !own && (far || metres(pos, target) / Math.max(0.01, strike - 0.002 - (last?.t ?? now)) > SPEED.pass * 1.6)
      push({ t: strike - 0.002, x: target.x, y: target.y, kind: own ? 'carry' : 'pass', side: s, holder: shooter, loft: quick ? 0.7 : cross ? 0.45 : 0, bend: cross ? (pos.y > target.y ? 0.12 : -0.12) * (s === 'home' ? 1 : -1) : 0, play: cross ? 'cross' : own ? 'dribble' : 'forward', phase: 'final' })
    }
  }

  /** Plan an attack for `s` ending with the shooter at `target` (attacking coordinates in `T`): the beats from where the ball is now. */
  const plan = (pattern: Pattern, ev: MatchEvent, target: PitchPoint, strike: number, shooter: PlacedPlayer | undefined, h: number): Beat[] | null => {
    const s = ev.side
    const nowMen = outfield(s, now)
    const thenMen = outfield(s, strike)
    const ids = new Set(nowMen.map((p) => p.psId))
    const men = thenMen.filter((p) => ids.has(p.psId))
    const pool = men.length ? men : thenMen
    if (!pool.length || !shooter) return null
    const beats: Beat[] = []
    let vpos = pos
    let vholder = side === s ? holder : undefined
    const ballAtTarget = (p: PlacedPlayer, ball: PitchPoint) => spot(p, ball, s)
    const add = (b: Beat) => {
      // A long ball goes in the air
      if (b.kind === 'pass' && Math.hypot(b.to.x - vpos.x, b.to.y - vpos.y) > 44 && (b.loft ?? 0) < 0.5) b.loft = 0.55
      beats.push(b)
      vpos = b.to
      vholder = b.holder
    }
    const tc = acrossOf(s, target)
    // The assister: a goal's own, else picked for the pattern
    const assistId = GOAL_TYPES.has(ev.type) && ev.type !== 'own_goal' ? ev.secondaryId : undefined
    const assister = assistId ? pool.find((p) => p.psId === assistId && p.psId !== shooter.psId) : undefined
    const others = pool.filter((p) => p.psId !== shooter.psId)
    const pickBy = (want: (p: PlacedPlayer) => number) => (others.length ? others.reduce((a, b) => (want(b) > want(a) ? b : a)) : undefined)
    // Win it back first when the other side has it
    if (side !== s) {
      const takers = pool.filter((p) => p.psId !== shooter.psId)
      const taker = (takers.length ? takers : pool).reduce((a, b) => (metres(spot(a, pos, side), pos) < metres(spot(b, pos, side), pos) ? a : b))
      const ts = spot(taker, pos, side)
      add({ to: { x: pos.x + (ts.x - pos.x) * 0.3, y: pos.y + (ts.y - pos.y) * 0.3 }, kind: 'pass', side: s, holder: taker.psId, speed: SPEED.soft, min: 0.14, dwell: 0, play: pattern === 'counter' ? 'tackle' : rng.chance(0.5) ? 'interception' : 'tackle', phase: pattern === 'counter' ? 'counter' : undefined })
    }
    /** Passes that move the ball towards `goal` through team-mates (each 9 to 34 metres), until within `close` metres of it. */
    const chainTo = (goal: PitchPoint, maxPasses: number, close: number, exclude: string[], optional = true) => {
      for (let k = 0; k < maxPasses && metres(vpos, goal) > close; k++) {
        let best: { p: PlacedPlayer; at: PitchPoint; score: number } | null = null
        for (const p of pool) {
          if (p.psId === vholder || exclude.includes(p.psId)) continue
          const a = ballAtTarget(p, vpos)
          const d = metres(a, vpos)
          if (d < 9 || d > 34 || Math.hypot(a.x - vpos.x, a.y - vpos.y) > MAX_HOP - 2) continue
          const gain = metres(vpos, goal) - metres(a, goal)
          if (gain < 3) continue
          const score = gain - Math.abs(d - 20) * 0.3 + rng.float(0, 6)
          if (!best || score > best.score) best = { p, at: a, score }
        }
        if (!best) break
        const lateral = Math.abs(acrossOf(s, best.at) - acrossOf(s, vpos))
        const play: PlayTag = lateral > 32 ? 'switch' : along(s, best.at) - along(s, vpos) > 5 ? 'forward' : 'short'
        const d = metres(best.at, vpos)
        add({ to: best.at, kind: 'pass', side: s, holder: best.p.psId, speed: play === 'switch' ? SPEED.long : SPEED.pass, min: 0.22, dwell: SECOND * rng.float(0.4, 0.8), loft: play === 'switch' ? 0.55 : d > 30 ? 0.3 : 0, bend: rng.float(-0.05, 0.05), play, optional })
      }
    }
    const flankOf = (p: PlacedPlayer | undefined): number => {
      if (p) {
        const c = acrossOf(s, ballAtTarget(p, vpos))
        if (Math.abs(c - 50) > 12) return c < 50 ? 10 : 90
      }
      return h % 2 ? 10 : 90
    }
    const shooterId = shooter.psId
    switch (pattern) {
      case 'cross':
      case 'cutback': {
        const crosser = assister ?? pickBy((p) => (['LW', 'RW', 'LB', 'RB'].includes(p.position) ? 30 : 0) + Math.abs(acrossOf(s, ballAtTarget(p, vpos)) - 50) - Math.abs(acrossOf(s, ballAtTarget(p, vpos)) - (tc < 50 ? 85 : 15)) * 0.3)
        if (!crosser) return null
        const flank = assister ? flankOf(assister) : flankOf(crosser)
        const wideA = 70 + rng.float(0, 6)
        const wide = at(s, wideA, flank)
        chainTo(wide, 4, 26, [shooterId, crosser.psId])
        if (vholder !== crosser.psId) add({ to: wide, kind: 'pass', side: s, holder: crosser.psId, speed: Math.abs(acrossOf(s, vpos) - flank) > 32 ? SPEED.long : SPEED.pass, min: 0.24, dwell: SECOND * rng.float(0.4, 0.8), loft: Math.abs(acrossOf(s, vpos) - flank) > 32 ? 0.55 : 0, play: Math.abs(acrossOf(s, vpos) - flank) > 32 ? 'switch' : 'forward' })
        const byline = pattern === 'cutback' ? at(s, 95.5, flank < 50 ? 24 : 76) : at(s, 84 + rng.float(0, 6), flank < 50 ? 8 : 92)
        add({ to: byline, kind: 'carry', side: s, holder: crosser.psId, speed: SPEED.dribble, min: 0.2, dwell: SECOND * 0.3, play: 'dribble', optional: true })
        const header = ev.text.toLowerCase().includes('head')
        add({ to: target, kind: 'pass', side: s, holder: shooterId, speed: pattern === 'cutback' ? SPEED.pass : SPEED.cross, min: 0.2, dwell: SECOND * 0.35, loft: pattern === 'cutback' ? 0 : header ? 0.75 : 0.45, bend: pattern === 'cutback' ? 0 : (flank < 50 ? 0.1 : -0.1) * (s === 'home' ? 1 : -1), play: pattern === 'cutback' ? 'cutback' : 'cross', phase: 'final' })
        return beats
      }
      case 'through':
      case 'counter': {
        const passer = assister ?? pickBy((p) => (['AM', 'CM', 'LW', 'RW'].includes(p.position) ? 20 : 0) - Math.abs(along(s, ballAtTarget(p, vpos)) - 60) * 0.5)
        if (!passer) return null
        const pa = ballAtTarget(passer, vpos)
        const pAt = at(s, clamp(along(s, pa), 50, 70), clamp(acrossOf(s, pa), 20, 80))
        if (pattern === 'counter' && beats.length) {
          // Won it: straight forward to the passer, who runs at them
          if (vholder !== passer.psId) add({ to: pAt, kind: 'pass', side: s, holder: passer.psId, speed: SPEED.through, min: 0.22, dwell: SECOND * 0.25, play: 'forward', phase: 'counter' })
          add({ to: at(s, along(s, pAt) + 12, acrossOf(s, pAt) + (tc - acrossOf(s, pAt)) * 0.3), kind: 'carry', side: s, holder: passer.psId, speed: SPEED.dribble, min: 0.2, dwell: 0, play: 'dribble', phase: 'counter', optional: true })
        } else {
          chainTo(pAt, 4, 22, [shooterId, passer.psId])
          if (vholder !== passer.psId) add({ to: pAt, kind: 'pass', side: s, holder: passer.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * rng.float(0.4, 0.7), play: 'forward' })
        }
        const ra = along(s, target) - rng.float(6, 11)
        const run = at(s, ra, tc + (acrossOf(s, vpos) - tc) * 0.15)
        add({ to: run, kind: 'pass', side: s, holder: shooterId, speed: SPEED.through, min: 0.24, dwell: SECOND * (pattern === 'counter' ? 0.2 : 0.45), play: 'through', phase: pattern === 'counter' ? 'counter' : 'final' })
        add({ to: target, kind: 'carry', side: s, holder: shooterId, speed: SPEED.dribble, min: 0.15, dwell: 0, play: 'dribble', phase: 'final' })
        return beats
      }
      case 'edge':
      case 'solo':
      case 'freekick': {
        if (pattern === 'solo') {
          const start = at(s, Math.max(60, along(s, target) - 22), clamp(tc + rng.float(-18, 18), 15, 85))
          chainTo(start, 4, 18, [shooterId, ...(assister ? [assister.psId] : [])])
          // A goal's assister plays him in before he goes on his own
          if (assister && vholder !== assister.psId) {
            const aAt = ballAtTarget(assister, vpos)
            if (Math.hypot(aAt.x - vpos.x, aAt.y - vpos.y) < MAX_HOP - 2 && Math.hypot(aAt.x - start.x, aAt.y - start.y) < MAX_HOP - 2) add({ to: aAt, kind: 'pass', side: s, holder: assister.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
          }
          if (vholder !== shooterId) add({ to: start, kind: 'pass', side: s, holder: shooterId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
          const mid = at(s, (along(s, start) + along(s, target)) / 2, (acrossOf(s, start) + tc) / 2 + rng.float(-6, 6))
          add({ to: mid, kind: 'carry', side: s, holder: shooterId, speed: SPEED.dribble, min: 0.18, dwell: SECOND * 0.25, play: 'dribble', optional: true })
          add({ to: target, kind: 'carry', side: s, holder: shooterId, speed: SPEED.dribble, min: 0.18, dwell: 0, play: 'dribble', phase: 'final' })
          return beats
        }
        if (pattern === 'freekick') {
          // Fouled on the edge: the ball placed and the wall set before he curls it
          const fouled = pickBy((p) => -metres(ballAtTarget(p, vpos), target)) ?? shooter
          const lead = at(s, along(s, target) + 2, tc + rng.float(-5, 5))
          chainTo(lead, 4, 20, [shooterId, fouled.psId])
          if (vholder !== fouled.psId) add({ to: lead, kind: 'pass', side: s, holder: fouled.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
          add({ to: { x: lead.x + (s === 'home' ? 0.6 : -0.6), y: lead.y }, kind: 'carry', side: s, holder: fouled.psId, speed: SPEED.carry, min: 0.1, dwell: 0, play: 'foul' })
          add({ to: target, kind: 'reset', side: s, holder: shooterId, speed: SPEED.fetch, min: 0.22, dwell: SECOND * 0.6, sp: 'freekick', wait: 0.85, play: 'setpiece', phase: 'setpiece' })
          return beats
        }
        const layer = assister ?? pickBy((p) => (['AM', 'CM', 'ST'].includes(p.position) ? 20 : 0) - Math.abs(acrossOf(s, ballAtTarget(p, vpos)) - 50) * 0.4)
        if (!layer) return null
        const feet = at(s, Math.min(84, along(s, target) + rng.float(4, 9)), clamp(tc + rng.float(-12, 12), 25, 75))
        chainTo(feet, 4, 22, [shooterId, layer.psId])
        if (vholder !== layer.psId) add({ to: feet, kind: 'pass', side: s, holder: layer.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
        const step = at(s, along(s, target) - 2.5, tc + rng.float(-2, 2))
        add({ to: step, kind: 'pass', side: s, holder: shooterId, speed: SPEED.soft, min: 0.18, dwell: SECOND * 0.3, play: 'layoff', phase: 'final' })
        add({ to: target, kind: 'carry', side: s, holder: shooterId, speed: SPEED.carry, min: 0.1, dwell: 0, play: 'dribble', phase: 'final' })
        return beats
      }
      case 'team-move': {
        const giver = assister ?? pickBy((p) => (['AM', 'CM', 'LW', 'RW'].includes(p.position) ? 20 : 0) - metres(ballAtTarget(p, vpos), target) * 0.2)
        if (!giver) return null
        // Back to front: a pass back first if the move starts high, then the chain, with a switch on the way
        const deep = at(s, 28, acrossOf(s, vpos) < 50 ? 70 : 30)
        chainTo(deep, 1, 30, [shooterId, giver.psId])
        const gAt = at(s, Math.min(78, along(s, target) - 14), clamp(acrossOf(s, ballAtTarget(giver, vpos)), 22, 78))
        chainTo(gAt, 6, 20, [shooterId, giver.psId])
        if (vholder !== giver.psId) add({ to: gAt, kind: 'pass', side: s, holder: giver.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.45, play: 'forward' })
        add({ to: target, kind: 'pass', side: s, holder: shooterId, speed: SPEED.pass, min: 0.22, dwell: SECOND * 0.35, play: metres(gAt, target) > 16 ? 'through' : 'layoff', phase: 'final' })
        return beats
      }
      case 'scramble': {
        const crosser = assister ?? pickBy((p) => (['LW', 'RW', 'LB', 'RB'].includes(p.position) ? 30 : 0) + Math.abs(acrossOf(s, ballAtTarget(p, vpos)) - 50))
        if (!crosser) return null
        const flank = flankOf(crosser)
        const wide = at(s, 80, flank)
        chainTo(wide, 3, 24, [shooterId, crosser.psId])
        if (vholder !== crosser.psId) add({ to: wide, kind: 'pass', side: s, holder: crosser.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
        const box = at(s, along(s, target) - rng.float(0, 3), tc + (flank < 50 ? -8 : 8))
        add({ to: box, kind: 'pass', side: s, holder: undefined, speed: SPEED.cross, min: 0.22, dwell: SECOND * 0.35, loft: 0.6, play: 'cross', phase: 'final' })
        const loose = at(s, along(s, target) + rng.float(-3, 1), tc + rng.float(-4, 4))
        add({ to: loose, kind: 'pass', side: s, holder: undefined, speed: SPEED.soft, min: 0.1, dwell: 0, play: 'deflection', phase: 'final' })
        add({ to: target, kind: 'carry', side: s, holder: shooterId, speed: SPEED.dribble, min: 0.08, dwell: 0, play: 'rebound', phase: 'final' })
        return beats
      }
      case 'corner': {
        const taker = assister ?? pickBy((p) => (['LW', 'RW', 'AM', 'CM'].includes(p.position) ? 10 : 0) - Math.abs(along(s, ballAtTarget(p, vpos)) - 75) * 0.1)
        if (!taker) return null
        const flank = h % 2 ? 10 : 90
        // The attack that wins it: a ball into the box blocked behind
        const wide = at(s, 80, flank)
        chainTo(wide, 3, 24, [shooterId])
        add({ to: at(s, 92, flank < 50 ? 32 : 68), kind: 'pass', side: other(s), holder: undefined, speed: SPEED.cross, min: 0.2, dwell: SECOND * 0.35, loft: 0.35, play: 'cross', optional: true })
        add({ to: at(s, 100, flank < 50 ? 30 : 70), kind: 'pass', side: s, holder: undefined, speed: SPEED.soft, min: 0.1, dwell: 0, play: 'deflection', optional: true })
        add({ to: at(s, 99.6, flank < 50 ? 0.6 : 99.4), kind: 'reset', side: s, holder: taker.psId, speed: SPEED.fetch, min: 0.28, dwell: 0, sp: 'corner', wait: 0.7, play: 'setpiece', phase: 'setpiece' })
        add({ to: target, kind: 'pass', side: s, holder: shooterId, speed: SPEED.cross, min: 0.28, dwell: 0, loft: 0.85, bend: (flank < 50 ? 0.12 : -0.12) * (s === 'home' ? 1 : -1), play: 'cross', phase: 'setpiece' })
        return beats
      }
      case 'penalty': {
        const fouled = pickBy((p) => (['ST', 'LW', 'RW', 'AM'].includes(p.position) ? 20 : 0) - Math.abs(along(s, ballAtTarget(p, vpos)) - 80) * 0.3) ?? shooter
        const lead = at(s, 82, clamp(acrossOf(s, ballAtTarget(fouled, vpos)), 25, 75))
        chainTo(lead, 4, 22, [shooterId, fouled.psId])
        if (vholder !== fouled.psId) add({ to: lead, kind: 'pass', side: s, holder: fouled.psId, speed: SPEED.pass, min: 0.24, dwell: SECOND * 0.5, play: 'forward' })
        const inBox = at(s, 90 + rng.float(0, 3), clamp(acrossOf(s, lead) + (50 - acrossOf(s, lead)) * 0.4, 32, 68))
        add({ to: inBox, kind: 'carry', side: s, holder: fouled.psId, speed: SPEED.dribble, min: 0.2, dwell: SECOND * 0.2, play: 'dribble' })
        add({ to: { x: inBox.x + (s === 'home' ? 0.5 : -0.5), y: inBox.y }, kind: 'carry', side: s, holder: fouled.psId, speed: SPEED.carry, min: 0.08, dwell: 0, play: 'foul' })
        add({ to: target, kind: 'reset', side: s, holder: shooterId, speed: SPEED.fetch, min: 0.25, dwell: SECOND * 0.8, sp: 'penalty', wait: 0.9, play: 'setpiece', phase: 'setpiece' })
        return beats
      }
    }
  }

  /** The beats' total time from the ball where it is: their touches, hops and waits. */
  const timeOf = (beats: Beat[], k = { dwell: 1, wait: 1, hop: 1 }) => {
    let t = 0
    let p = pos
    for (const b of beats) {
      t += b.dwell * k.dwell + Math.max(b.min, metres(p, b.to) / b.speed) * k.hop + (b.wait ?? 0) * k.wait
      p = b.to
    }
    return t
  }
  const fitsHop = (beats: Beat[]) => {
    let p = pos
    for (const b of beats) {
      if (b.kind !== 'reset' && Math.hypot(b.to.x - p.x, b.to.y - p.y) > MAX_HOP + 0.5 && (b.loft ?? 0) < 0.5) return false
      p = b.to
    }
    return true
  }

  /** Lay the beats out to end with the shooter at the target just before `strike`; false when they cannot fit. */
  const runBeats = (beats0: Beat[], strike: number): boolean => {
    let beats = beats0.slice()
    const budget = strike - 0.002 - now
    if (budget <= 0.1) return false
    // Shortest it could be: touches cut to a third, waits to a half, hops a little quicker
    const tight = { dwell: 0.3, wait: 0.5, hop: 1 / 1.35 }
    while (timeOf(beats, tight) > budget || !fitsHop(beats)) {
      const k = beats.findIndex((b) => b.optional)
      if (k < 0) return false
      beats.splice(k, 1)
    }
    if (!beats.length) return false
    // Scale: spare time goes to the touches and the waits (up to twice as long), then to slower hops (a quarter), then a first touch
    const base = timeOf(beats)
    let k = { dwell: 1, wait: 1, hop: 1 }
    if (base > budget) {
      // Between tight and nominal: shrink the touches and waits first, then the hops
      const elastic = timeOf(beats, { dwell: 1, wait: 1, hop: 0 })
      const rigid = base - elastic
      const tightElastic = timeOf(beats, { dwell: tight.dwell, wait: tight.wait, hop: 0 })
      if (budget - rigid >= tightElastic) {
        // The hops at their own pace; the touches and the set piece's wait give way (never below their tightest)
        const e = (budget - rigid) / Math.max(1e-6, elastic)
        k = { dwell: Math.max(tight.dwell, e), wait: Math.max(tight.wait, e), hop: 1 }
        const over = timeOf(beats, k) - budget
        if (over > 0) k.dwell = Math.max(0, k.dwell - over / Math.max(1e-6, timeOf(beats, { dwell: 1, wait: 0, hop: 0 })))
      } else {
        k = { dwell: tight.dwell, wait: tight.wait, hop: (budget - tightElastic) / Math.max(1e-6, rigid) }
      }
    } else {
      const spare = budget - base
      const elastic = timeOf(beats, { dwell: 1, wait: 1, hop: 0 })
      const rigid = base - elastic
      const e = Math.min(2, 1 + spare / Math.max(1e-6, elastic))
      const left = spare - (e - 1) * elastic
      const hk = Math.min(1.25, 1 + Math.max(0, left) / Math.max(1e-6, rigid))
      k = { dwell: e, wait: e, hop: hk }
      const after = timeOf(beats, k)
      if (budget - after > 0.02) touchAndDrift(budget - after)
    }
    // Play them
    beats.forEach((b, i) => {
      if (b.dwell > 0) {
        now += b.dwell * k.dwell
        push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder, phase: phaseNow(side, pos) })
      }
      const last = i === beats.length - 1
      const dur = Math.max(b.min, metres(pos, b.to) / b.speed) * k.hop
      const t = last ? strike - 0.002 - (b.wait ?? 0) * k.wait : now + dur
      now = Math.max(now + 0.01, t)
      pos = b.to
      if (b.side !== side) {
        regainAt = now
        regainAlong = along(b.side, pos)
      }
      side = b.side
      holder = b.holder
      const kf: BallKeyframe = { t: now, x: pos.x, y: pos.y, kind: b.kind, side: b.side, holder: b.holder, loft: b.loft, bend: b.bend, play: b.play, phase: b.phase ?? phaseNow(b.side, pos) }
      if (b.sp) kf.setPiece = { kind: b.sp, until: now + (b.wait ?? 0) * k.wait }
      push(kf)
      if (b.wait) {
        now += b.wait * k.wait
        push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder, phase: 'setpiece' })
      }
    })
    return true
  }
  /** Spare time before an attack: the man on it takes his time (short touches, a yard or two at a time). */
  const touchAndDrift = (minutes: number) => {
    let left = minutes
    while (left > 0.02) {
      const d = Math.min(left, SECOND * rng.float(0.6, 1.2))
      const keep = deadline
      deadline = now + d + 0.001
      touch(d)
      deadline = keep
      left -= d
    }
  }

  /** The other side's ball is won back at once by `s` (no time for anything else). */
  const loseBallTo = (s: Side, prefer?: PlacedPlayer) => {
    const men = outfield(s, now)
    if (!men.length) return
    const near = nearestTo(men, pos)
    const taker = prefer && metres(spot(prefer), pos) < metres(spot(near), pos) + 12 ? prefer : near
    const ts = spot(taker)
    if (!hop({ x: pos.x + (ts.x - pos.x) * 0.35, y: pos.y + (ts.y - pos.y) * 0.35 }, 'pass', s, taker.psId, SPEED.pass * 1.1, 0.12, { play: 'tackle' })) {
      side = s
      holder = taker.psId
    }
  }

  // ------------------------------------------------------------------ the start of the stretch
  const start = input.start
  if (start && (start.holder || start.x !== 50 || start.y !== 50)) {
    // Picked up where it stood: the path that ends there already has that keyframe, so the first one here is the next move
    pos = { x: start.x, y: start.y }
    side = start.side
    holder = start.holder
  } else if (start || from <= 0 || from === 46) {
    kickOff(start?.side ?? side, now, 0)
    stage('kickoff', 0.18)
  }
  else {
    // A stretch picked up mid-match (a highlight's build-up): the keeper of the side on top rolls it out
    const s: Side = share('home', now) >= 0.5 ? 'home' : 'away'
    const gk = keeper(s, now)
    side = s
    holder = gk?.psId
    pos = gk ? spot(gk, at(s, 8, 50), s) : at(s, 6, 50)
    push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side: s, holder, phase: 'buildup' })
  }

  // ------------------------------------------------------------------ the moments in order: fouls and shots
  type Moment = { t: number; shot?: { ev: MatchEvent; t: number; idx: number; si: number }; foul?: { ev: MatchEvent; t: number } }
  const moments: Moment[] = [...shots.map((s, si) => ({ t: s.t, shot: { ...s, si } })), ...fouls.map(([idx, f]) => ({ t: f.t, foul: { ev: input.events[idx], t: f.t } }))].sort((a, b) => a.t - b.t)
  // One foul per staged minute
  const seenFoul = new Set<number>()

  for (let mi = 0; mi < moments.length; mi++) {
    const m = moments[mi]
    if (m.foul) {
      const tf = m.foul.t
      if (seenFoul.has(tf) || tf < now + 0.3) continue
      seenFoul.add(tf)
      const card = m.foul.ev
      const v = other(card.side)
      // Play on until just before it, with the fouled side on the ball by then
      deadline = tf - 0.3
      play()
      deadline = tf - 0.05
      if (side !== v) {
        const men = outfield(v, now)
        if (men.length) {
          const taker = nearestTo(men, pos)
          const ts = spot(taker)
          if (!hop({ x: pos.x + (ts.x - pos.x) * 0.3, y: pos.y + (ts.y - pos.y) * 0.3 }, 'pass', v, taker.psId, SPEED.soft, 0.12, { play: 'interception' })) {
            side = v
            holder = taker.psId
          }
        }
      }
      // The fouled man runs at the man who will be booked, and is brought down
      const fouler = squad(card.side, tf).find((p) => p.psId === card.playerId)
      const toward = fouler ? spot(fouler) : pos
      const step = { x: pos.x + clamp(toward.x - pos.x, -4, 4), y: pos.y + clamp(toward.y - pos.y, -4, 4) }
      deadline = tf
      const fouledHolder = holder
      if (!hop(step, 'carry', side, fouledHolder, SPEED.dribble, 0.05, { play: 'dribble' })) {
        now = Math.max(now, tf - 0.01)
      }
      now = Math.max(now, tf - 0.001)
      push({ t: tf, x: pos.x, y: pos.y, kind: 'carry', side, holder: fouledHolder, play: 'foul', phase: phaseNow(side, pos) })
      now = tf
      // The whistle, the card, the ball placed; then the free kick
      deadline = tf + FOUL_STOP + 0.05
      // A foul in the box would be a penalty: the free kick is taken from just outside it
      const fkSpot = along(side, pos) > 81 ? at(side, 81, acrossOf(side, pos)) : { x: pos.x, y: pos.y }
      if (hop(fkSpot, 'reset', side, fouledHolder, SPEED.fetch, 0.18, { play: 'setpiece', phase: 'setpiece' })) {
        const wait = Math.max(0.1, tf + FOUL_STOP - now)
        stage('freekick', wait)
      }
      const next = moments[mi + 1]
      deadline = next ? Math.max(now, next.t - 0.3) : end
      if (along(side, pos) >= 64 && deadline - now > 0.9) deliveryOutcome(side, 'freekick')
      else {
        const r = receiver((_p, _a, d) => Math.exp(-(((d - 14) / 9) ** 2)) + 0.01, { minM: 5, maxM: 30 })
        if (r) passTo(r, 'setpiece')
      }
      continue
    }
    const { ev, t: strike, si, idx } = m.shot!
    const s = ev.side
    const target = toShared(ev.position ?? { x: 88, y: 50 }, s)
    const h = hashString(`${input.seed}-${idx}-${ev.minute}`) >>> 0
    const pattern = patternFor(ev, h)
    const shooters = outfield(s, P(ev.minute))
    const shooter = shooters.find((p) => p.psId === ev.playerId) ?? (shooters.length ? shooters.reduce((a, b) => (metres(a, target) < metres(b, target) ? a : b)) : undefined)
    // Open play up to the attack, sized to what the attack needs from where the ball has got to
    const want = PATTERN_WINDOW[pattern]
    deadline = strike - Math.min(want, Math.max(0.3, strike - now - 0.05))
    play()
    for (let iter = 0; iter < 2; iter++) {
      const trial = plan(pattern, ev, target, strike, shooter, h)
      if (!trial) break
      const need = timeOf(trial)
      if (strike - now - need > 0.45) {
        deadline = strike - need - 0.05
        play()
      } else break
    }
    deadline = strike - 0.002
    const beats = plan(pattern, ev, target, strike, shooter, h)
    const ran = !!beats && runBeats(beats, strike)
    if (!ran && pattern === 'penalty' && strike - now > 0.45) {
      // No room for the whole move: brought down where he is, and the ball on the spot as quickly as it can be
      deadline = strike - 0.3
      if (side !== s) loseBallTo(s)
      now += 0.04
      push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder, play: 'foul', phase: 'final' })
      const avail = strike - 0.3 - now
      hop(target, 'reset', s, shooter?.psId, Math.max(SPEED.fetch, metres(pos, target) / Math.max(0.12, avail)), 0.12, { play: 'setpiece', phase: 'setpiece' })
      deadline = strike - 0.002
      stage('penalty', strike - 0.002 - now)
    } else if (!ran) {
      // No room for the whole move: win it if needed, through the assister when there is one, and play the last ball straight in
      const assister = GOAL_TYPES.has(ev.type) && ev.secondaryId && ev.secondaryId !== shooter?.psId ? outfield(s, now).find((p) => p.psId === ev.secondaryId) : undefined
      deadline = strike - (assister ? 0.3 : 0.12)
      if (side !== s) loseBallTo(s, assister)
      if (assister && holder !== assister.psId && strike - now > 0.4) {
        const a = spot(assister, pos, s)
        const mid = { x: (a.x + target.x) / 2, y: (a.y + target.y) / 2 }
        hop(Math.hypot(mid.x - pos.x, mid.y - pos.y) < MAX_HOP - 2 ? mid : a, 'pass', s, assister.psId, SPEED.pass, 0.15, { play: 'forward' })
      }
      deadline = strike - 0.12
      directLastBall(strike, target, s, shooter?.psId)
    }
    pos = target
    side = s
    holder = shooter?.psId
    now = strike
    push({ t: strike, x: target.x, y: target.y, kind: 'shot', side: s, holder, play: pattern === 'penalty' || pattern === 'freekick' ? 'setpiece' : undefined, phase: 'final' })
    const nextMoment = moments[mi + 1]
    deadline = nextMoment ? nextMoment.t - 0.3 : end
    /** After the restart, leave the next move the time it needs to get from here to its strike. */
    const reserve = () => {
      const n = nextMoment?.shot
      if (!n) return nextMoment ? Math.max(now, nextMoment.t - 0.35) : end
      const far = metres(pos, toShared(n.ev.position ?? { x: 88, y: 50 }, n.ev.side)) + (n.ev.side !== side ? 30 : 0)
      return Math.max(now, n.t - Math.min(1.5, 0.3 + far / (SPEED.pass * 1.2)))
    }
    const gk = keeper(other(s), P(ev.minute))
    const text = ev.text.toLowerCase()
    if (GOAL_TYPES.has(ev.type)) {
      // In the net (the flight is drawn while the clock holds), then a kick-off from the centre spot once both sides are back in their halves
      push({ t: strike + 0.001, x: goalLine(s), y: 50 + clamp((target.y - 50) * 0.25, -4, 4), kind: 'goal', side: s })
      const nextShot = shots[si + 1]
      const hurry = !!nextShot && nextShot.ev.side === s && nextShot.t - strike < 1.5
      kickOff(other(s), strike + 0.002, 0)
      if (!hurry) {
        stage('kickoff', 0.35)
        const r = receiver((_p, a, d) => (fwdOf(other(s), a, pos) < 0 ? 1 : 0.1) * Math.exp(-(((d - 12) / 8) ** 2)), { minM: 5, maxM: 25 })
        if (r && deadline - now > 0.3) passTo(r, 'back')
      }
    } else if (ev.type === 'save') {
      const save = gk ? { x: gk.x + (target.x - gk.x) * 0.15, y: gk.y + (target.y - gk.y) * 0.35 } : { x: s === 'home' ? 96 : 4, y: 50 }
      if (!hop(save, 'save', other(s), gk?.psId, SPEED.shot, 0.1)) continue
      deadline = reserve()
      const tipped = (text.includes('brilliant') || text.includes('keep out')) && h % 2 === 0
      if (tipped && deadline - now > 2) {
        // Tipped round the post: a corner, set up and swung in, and headed away
        const outPt = { x: goalLine(s) === 100 ? 100 : 0, y: clamp(50 + (target.y >= 50 ? 1 : -1) * rng.float(7, 13), 0, 100) }
        if (hop(outPt, 'pass', s, undefined, SPEED.long, 0.1, { play: 'deflection', loft: 0.25 }) && corner(s, outPt.y, undefined, 0.6)) deliveryOutcome(s, 'corner')
      } else if (deadline - now > 0.9) {
        // The keeper gathers, takes a moment, then rolls it out or sends it long
        now += 0.35
        push({ t: now, x: save.x, y: save.y, kind: 'carry', side: other(s), holder: gk?.psId, phase: 'buildup' })
        distribute()
      }
    } else if (text.includes('post') || text.includes('crossbar')) {
      // Off the woodwork, back into play, and cleared
      const wood = { x: goalLine(s) === 100 ? 99.5 : 0.5, y: 50 + (target.y >= 50 ? 1 : -1) * 5.3 }
      if (!hop(wood, 'miss', s, undefined, SPEED.shot, 0.1, { loft: text.includes('crossbar') ? 0.45 : 0.12 })) continue
      const back = at(s, 86 + rng.float(-3, 3), 50 + rng.float(-18, 18))
      const defs = outfield(other(s), now)
      const man = defs.length ? defs.reduce((a, b) => (metres(spot(a, back, s), back) < metres(spot(b, back, s), back) ? a : b)) : undefined
      if (!hop(back, 'pass', other(s), man?.psId, SPEED.long, 0.15, { play: 'rebound' })) continue
      deadline = reserve()
      const land = at(other(s), rng.float(35, 48), 50 + rng.float(-25, 25))
      if (deadline - now > 0.6) hop(land, 'pass', other(s), undefined, SPEED.long, 0.3, { loft: 0.6, play: 'clearance' })
    } else {
      const wide = { x: goalLine(s) + (s === 'home' ? 1.5 : -1.5), y: 50 + (rng.chance(0.5) ? 1 : -1) * rng.float(14, 24) }
      // A shot from far out and wide goes wide on its own side, or over
      if (Math.hypot(wide.x - pos.x, wide.y - pos.y) > 46) wide.y = 100 - wide.y
      const over = Math.hypot(wide.x - pos.x, wide.y - pos.y) > 46
      if (!hop(wide, 'miss', s, undefined, SPEED.shot, 0.14, { loft: over || rng.chance(0.4) ? 0.55 : 0.15, bend: rng.float(-0.1, 0.1) })) continue
      deadline = reserve()
      goalKick(other(s), wide.y)
    }
  }
  deadline = end
  play()
  // Back to match time: a strike or a foul lands exactly on its moment (the clock's goal holds and cues are keyed to it)
  if (!pace.length) return out
  const T = (p: number) => strikeAt.get(p) ?? toMatch(pace, p)
  for (const k of out) {
    k.t = T(k.t)
    if (k.setPiece) k.setPiece = { ...k.setPiece, until: T(k.setPiece.until) }
  }
  return out

}

/** How far forward `a` is from `p` for side `s` (positive towards the goal it attacks). */
function fwdOf(s: Side, a: PitchPoint, p: PitchPoint): number {
  return s === 'home' ? a.x - p.x : p.x - a.x
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
