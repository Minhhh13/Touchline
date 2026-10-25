/**
 * The live pitch: both XIs by formation slot and instructions, a football that
 * follows the ticker's clock through possession phases, shots, saves and
 * goals, nets that bulge, a goal celebration, and markers for cards, injuries
 * and substitutions.
 *
 * Everything that moves is an SVG attribute set from one requestAnimationFrame
 * loop that reads the shared clock (`timeline`), so React renders only when
 * the minute changes or a celebration starts. Every position on screen is
 * eased towards its target (the ball lightly, the players more), so a change
 * of possession, a kick-off, a substitution or a skip never makes anyone jump.
 * With prefers-reduced-motion the loop is off: the dots stand still, the ball
 * jumps from keyframe to keyframe and a goal is a still banner.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Appearance } from '@engine/match'
import type { MatchEvent, PlayerSeason, Tactics } from '@engine/types'
import { GOAL_FLIGHT_MS, timeline, useLiveClock } from '../match/clockStore'
import { initials, metres, onPitchAt, placeSide, separateSides, type PlacedPlayer, type Side } from '../match/pitchGeometry'
import { ballAt, bentPoint, buildBallPath, type BallKeyframe } from '../match/possession'
import { celebrationEnvelope, confetti, flightProgress, netBulge, netPoint, scorerRun } from '../match/celebration'
import { minuteLabel, textColourFor } from '../format'

export interface PitchSide {
  name: string
  shortName: string
  colour: string
  tactics?: Tactics
  appearances?: Appearance[]
}

export interface LivePitchProps {
  home: PitchSide & { tactics: Tactics; appearances: Appearance[] }
  away: PitchSide & { tactics: Tactics; appearances: Appearance[] }
  events: MatchEvent[]
  momentum: number[]
  /** The minutes this view plays: the segment the ticker is replaying. */
  from: number
  to: number
  seed: string
  getPlayer: (id: string) => PlayerSeason | undefined
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Shared pitch coordinates to SVG units: a 105 by 68 pitch, lying down or standing up. */
export function pitchMapper(portrait: boolean): (x: number, y: number) => [number, number] {
  return portrait ? (x, y) => [y * 0.68, 105 - x * 1.05] : (x, y) => [x * 1.05, y * 0.68]
}

/** The lines of the pitch, in landscape units; `portrait` stands them up. */
export const PitchMarkings = memo(function PitchMarkings({ portrait = false }: { portrait?: boolean }) {
  return (
    <g transform={portrait ? 'translate(0 105) rotate(-90)' : undefined} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.5">
      <rect x="0.5" y="0.5" width="104" height="67" />
      <line x1="52.5" y1="0.5" x2="52.5" y2="67.5" />
      <circle cx="52.5" cy="34" r="9.15" />
      <rect x="0.5" y="13.85" width="16.5" height="40.3" />
      <rect x="88" y="13.85" width="16.5" height="40.3" />
      <rect x="0.5" y="24.85" width="5.5" height="18.3" />
      <rect x="99" y="24.85" width="5.5" height="18.3" />
      <rect x="-1.5" y="30.34" width="2" height="7.32" stroke="rgba(255,255,255,0.8)" />
      <rect x="104.5" y="30.34" width="2" height="7.32" stroke="rgba(255,255,255,0.8)" />
      <circle cx="11.5" cy="34" r="0.35" fill="rgba(255,255,255,0.55)" stroke="none" />
      <circle cx="93.5" cy="34" r="0.35" fill="rgba(255,255,255,0.55)" stroke="none" />
    </g>
  )
})

/** The SVG frame for a pitch: the viewBox for its orientation and the striped turf. */
export function PitchSvg({ portrait = false, children, label }: { portrait?: boolean; children: ReactNode; label: string }) {
  return (
    <svg className={`pitch-svg ${portrait ? 'portrait' : ''}`} viewBox={portrait ? '-3 -3 74 111' : '-3 -3 111 74'} role="img" aria-label={label}>
      <PitchMarkings portrait={portrait} />
      {children}
    </svg>
  )
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/** The goal frame and its net at one end, in landscape units (x is the goal line, 0 or 105). The loop bulges the inner group. */
const Net = memo(function Net({ right, innerRef }: { right: boolean; innerRef: (el: SVGGElement | null) => void }) {
  const x0 = right ? 105 : 0
  const depth = right ? 2.3 : -2.3
  const xs = [0.33, 0.66, 1].map((f) => x0 + depth * f)
  const ys = [30.34, 31.56, 32.78, 34, 35.22, 36.44, 37.66]
  return (
    <g ref={innerRef} className="goal-net">
      <path d={`M ${x0} 30.34 L ${x0 + depth} 30.9 L ${x0 + depth} 37.1 L ${x0} 37.66 Z`} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.8)" strokeWidth="0.22" />
      {xs.map((x, i) => (
        <line key={`v${i}`} x1={x} y1={30.34 + 0.56 * (i + 1) / 3} x2={x} y2={37.66 - 0.56 * (i + 1) / 3} stroke="rgba(255,255,255,0.45)" strokeWidth="0.12" />
      ))}
      {ys.map((y, i) => (
        <line key={`h${i}`} x1={x0} y1={y} x2={x0 + depth} y2={34 + (y - 34) * 0.85} stroke="rgba(255,255,255,0.45)" strokeWidth="0.12" />
      ))}
      <line x1={x0} y1="30.34" x2={x0} y2="37.66" stroke="#fff" strokeWidth="0.6" strokeLinecap="round" />
    </g>
  )
})

/** A regular pentagon of radius r at (cx, cy), as SVG points. */
function pentagon(cx: number, cy: number, r: number, turn = 0): string {
  return Array.from({ length: 5 }, (_, k) => {
    const a = ((-90 + turn + k * 72) * Math.PI) / 180
    return `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`
  }).join(' ')
}

/**
 * The football, drawn in its own units around (0, 0): a shaded white sphere with
 * black pentagon patches. The patches are a repeating tile the loop slides in
 * the direction of travel, so the ball rolls; a smaller ball (phone width)
 * uses bigger, fewer patches so it still reads as a football.
 */
function BallArt({ id, r, simple, patchRef }: { id: string; r: number; simple: boolean; patchRef?: (el: SVGGElement | null) => void }) {
  const L = simple ? r * 2.3 : r * 1.55
  const pr = simple ? r * 0.5 : r * 0.36
  const tiles: string[] = []
  for (let i = -2; i <= 1; i++) for (let j = -2; j <= 1; j++) {
    tiles.push(pentagon(i * L, j * L, pr))
    tiles.push(pentagon((i + 0.5) * L, (j + 0.5) * L, pr, 36))
  }
  return (
    <>
      <circle r={r} fill={`url(#${id}-base)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <g ref={patchRef}>
          {tiles.map((pts, i) => (
            <polygon key={i} points={pts} fill="#1b1b1b" />
          ))}
        </g>
      </g>
      <circle r={r} fill={`url(#${id}-gloss)`} />
      <circle r={r} fill="none" stroke="#111" strokeWidth={r * 0.12} />
    </>
  )
}

interface P {
  x: number
  y: number
}

/** Ease `cur` towards `target` with time constant `tau` ms over `dt` ms (exponential smoothing, frame-rate independent). */
export function approach(cur: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return dt <= 0 ? cur : target
  return cur + (target - cur) * (1 - Math.exp(-dt / tau))
}

/** A man on the pitch, by side: the same player-season can turn out for both (a man drafted from the club you are playing). */
export function dotKey(side: Side, psId: string): string {
  return `${side}:${psId}`
}

/** Where a man who comes on walks on from: the touchline by the halfway line (shared coordinates). */
export const ENTRY_POINT: P = { x: 50, y: 103 }

/**
 * Where everything stood on the last frame drawn for a match (its pitch seed): a new segment of the
 * same match (the second half, the last twenty minutes, the replay from 71) starts from there rather
 * than from the formation, so nobody jumps when the pitch remounts. Only the latest match is kept.
 */
interface BallMotion {
  /** The ball on screen, and two slower followers of it (the players' drift and the blocks' lean). */
  p: P | null
  slow: P | null
  lean: P | null
  /** The patches' roll offset. */
  u: number
  v: number
  /** The time of the last frame drawn (0: the next frame moves nothing, after a sleep or a remount). */
  last: number
}

interface LastFrame {
  dots: Map<string, P>
  ball: P | null
  motion?: BallMotion
  /** The first minute of the segment that drew it: a pitch starting earlier than that is another viewing, which starts afresh. */
  from: number
}
const lastFrame = new Map<string, LastFrame>()
export function frameFor(seed: string, from: number): LastFrame {
  let f = lastFrame.get(seed)
  if (!f || from < f.from) {
    lastFrame.clear()
    f = { dots: new Map(), ball: null, from }
    lastFrame.set(seed, f)
  }
  f.from = from
  return f
}

export function LivePitch({ home, away, events, momentum, from, to, seed, getPlayer }: LivePitchProps) {
  const portrait = useMediaQuery('(max-width: 720px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const clock = useLiveClock((s) => s.clock)
  const holds = useLiveClock((s) => s.holds)
  const revealed = useLiveClock((s) => s.revealed)
  const celebrating = useLiveClock((s) => s.celebrating)
  const minute = Math.min(clock, to)
  const { home: homePlaced, away: awayPlaced } = useMemo(() => separateSides(placeSide(home.appearances, home.tactics, 'home'), placeSide(away.appearances, away.tactics, 'away')), [home.appearances, home.tactics, away.appearances, away.tactics])
  // A replay from 71 picks the ball up where the 70th-minute stop left it
  const startAt = useMemo(() => {
    if (from < 71 || from > 89) return undefined
    const prev = buildBallPath({ from: 46, to: 70, momentum, events, home: homePlaced, away: awayPlaced, seed })
    const last = prev[prev.length - 1]
    return last ? { x: last.x, y: last.y, side: last.side, holder: last.holder } : undefined
  }, [from, momentum, events, homePlaced, awayPlaced, seed])
  const path = useMemo(() => buildBallPath({ from, to, momentum, events, home: homePlaced, away: awayPlaced, seed, startAt }), [from, to, momentum, events, homePlaced, awayPlaced, seed, startAt])
  const map = useMemo(() => pitchMapper(portrait), [portrait])
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const R = portrait ? 1.75 : 1.5

  const stageRef = useRef<SVGGElement>(null)
  const ballRef = useRef<SVGGElement>(null)
  const bodyRef = useRef<SVGGElement>(null)
  const patchRef = useRef<SVGGElement | null>(null)
  const shadowRef = useRef<SVGGElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const celebRef = useRef<SVGCircleElement>(null)
  const shotRef = useRef<SVGLineElement>(null)
  const flashRef = useRef<SVGRectElement>(null)
  const nets = useRef<{ left: SVGGElement | null; right: SVGGElement | null }>({ left: null, right: null })
  const setLeftNet = useCallback((el: SVGGElement | null) => void (nets.current.left = el), [])
  const setRightNet = useCallback((el: SVGGElement | null) => void (nets.current.right = el), [])
  const setPatch = useCallback((el: SVGGElement | null) => void (patchRef.current = el), [])
  const dots = useRef(new Map<string, SVGGElement>())
  // One stable ref callback per man, so a re-render does not detach and re-attach every dot
  const refFns = useRef(new Map<string, (el: SVGGElement | null) => void>())
  const dotRef = (psId: string) => {
    let fn = refFns.current.get(psId)
    if (!fn) {
      fn = (el) => {
        if (el) dots.current.set(psId, el)
        else dots.current.delete(psId)
      }
      refFns.current.set(psId, fn)
    }
    return fn
  }
  const placed = useMemo(() => new Map<string, PlacedPlayer>([...homePlaced, ...awayPlaced].map((p) => [dotKey(p.side, p.psId), p])), [homePlaced, awayPlaced])
  // Where each man was when this match's pitch was last drawn (read once per mount, so React never moves a dot itself)
  const initial = useMemo(() => new Map(frameFor(seed, from).dots), [seed, from])
  // A fixed sway phase per man, from his id, so the picture is the same on every replay
  const phases = useMemo(() => new Map([...placed.keys()].map((id) => [id, [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 6283, 7) / 1000])), [placed])
  const colourOf = useMemo(() => ({ home: home.colour, away: away.colour }), [home.colour, away.colour])

  // The animation: one frame reads the shared clock, works out where everything should be and
  // eases what is on screen towards it. It runs while the clock does (a goal's hold counts):
  // paused, or stood at a stop, the last frame stays on screen and the loop sleeps until the
  // clock store changes again.
  useEffect(() => {
    if (reduced) return
    const kept = frameFor(seed, from)
    const shown = kept.dots
    // Carry on from the last frame drawn for this match, so a re-render, a remount or a new segment never moves anyone at once
    const ball: BallMotion = kept.motion ?? { p: kept.ball, slow: kept.ball, lean: kept.ball, u: 0, v: 0, last: 0 }
    kept.motion = ball
    ball.last = 0
    /** A new segment that finds the ball far from its kick-off (the second half): it rolls to the spot over a moment rather than snapping there. */
    let settleUntil = -1
    /** The first frame of a brand-new match places everyone; after that a man new to the pitch walks on. */
    let first = shown.size === 0
    const entered = new Map<string, number>()
    let id = 0
    const at = (x: number, y: number) => {
      const [sx, sy] = map(x, y)
      return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`
    }
    const frame = (now: number) => {
      id = 0
      const s = useLiveClock.getState()
      if (s.running) id = requestAnimationFrame(frame)
      // Time moves things only while the clock runs; stood at a stop or paused, a wake-up redraws without moving anyone
      const dt = s.running && ball.last ? Math.min(80, Math.max(0, now - ball.last)) : 0
      ball.last = now
      const tl = timeline(s, now)
      const T = Math.min(to + 1, tl.t)
      const hold = tl.hold ? s.holds[tl.hold.index] : undefined
      const elapsed = tl.hold?.elapsed ?? 0
      const b = ballAt(path, T)

      // Where the ball should be: on its path, or, during a goal's hold, flying into the net and then back to the centre spot
      let target: P = b ? { x: b.x, y: b.y } : { x: 50, y: 50 }
      let h = b?.h ?? 0
      let opacity = b ? (b.next?.kind === 'reset' && (b.progress ?? 0) < 1 ? 0.55 : 1) : 0
      let snapBall = false
      let shotKf: BallKeyframe | undefined
      let goalKf: BallKeyframe | undefined
      // Just past a goal's hold the path still runs from the strike into the net and back to the spot: the ball is on the spot
      if (!hold && b && (b.next?.kind === 'goal' || path[b.index]?.kind === 'goal')) target = { x: 50, y: 50 }
      if (hold && b) {
        shotKf = path[b.index]
        goalKf = b.next ?? undefined
        const mouth = goalKf && goalKf.kind === 'goal' ? { x: goalKf.x, y: goalKf.y } : { x: hold.side === 'home' ? 100 : 0, y: 50 }
        const inNet = netPoint(mouth)
        const fp = flightProgress(elapsed, GOAL_FLIGHT_MS)
        const bend = (shotKf.y > 50 ? -0.05 : 0.05) * (hold.side === 'home' ? 1 : -1)
        const flying = bentPoint(shotKf, inNet, bend, fp)
        const ev = events[+hold.key]
        const loft = ev?.type === 'penalty' ? 0.12 : 0.28
        target = flying
        h = fp < 1 ? loft * 4 * fp * (1 - fp) : 0
        snapBall = true
        if (elapsed > hold.ms - 700 && elapsed <= hold.ms - 350) opacity = Math.max(0, (hold.ms - 350 - elapsed) / 350)
        else if (elapsed > hold.ms - 350) {
          target = { x: 50, y: 50 }
          opacity = Math.min(1, (elapsed - (hold.ms - 350)) / 250)
        }
      }
      // The ball on screen eases after its path lightly at 1x and more at speed, where a hop lasts a few
      // frames: at 4x it rounds the corners of the path rather than hopping, so nothing jumps
      if (settleUntil < 0) settleUntil = ball.p && Math.hypot(ball.p.x - target.x, ball.p.y - target.y) > 8 ? now + 900 : 0
      const tauBall = Math.max(s.speed >= 4 ? 85 : s.speed >= 2 ? 38 : 14, now < settleUntil ? 160 : 0)
      const prevBall = ball.p ?? target
      const cur: P = snapBall || !ball.p ? target : { x: approach(prevBall.x, target.x, dt, tauBall), y: approach(prevBall.y, target.y, dt, tauBall) }
      ball.p = cur
      kept.ball = cur
      ball.slow = ball.slow ? { x: approach(ball.slow.x, cur.x, dt, 260), y: approach(ball.slow.y, cur.y, dt, 260) } : cur
      ball.lean = ball.lean ? { x: approach(ball.lean.x, cur.x, dt, 700), y: approach(ball.lean.y, cur.y, dt, 700) } : cur
      const [bx, by] = map(cur.x, cur.y)
      const [px, py] = map(prevBall.x, prevBall.y)
      if (ballRef.current) {
        ballRef.current.setAttribute('transform', `translate(${bx.toFixed(2)} ${by.toFixed(2)})`)
        ballRef.current.setAttribute('opacity', opacity.toFixed(2))
      }
      if (bodyRef.current) bodyRef.current.setAttribute('transform', h > 0.005 ? `translate(0 ${(-h * 4.2).toFixed(2)}) scale(${(1 + h * 0.4).toFixed(3)})` : '')
      if (shadowRef.current) {
        shadowRef.current.setAttribute('transform', `translate(${(bx + 0.35 + h * 1.2).toFixed(2)} ${(by + 0.55).toFixed(2)}) scale(${(1 - h * 0.45).toFixed(3)})`)
        shadowRef.current.setAttribute('opacity', (opacity * (0.5 - h * 0.28)).toFixed(2))
      }
      // Roll: slide the patches the way the ball travels (a small share of the distance, so they never strobe)
      if (patchRef.current) {
        const L = portrait ? R * 2.3 : R * 1.55
        const clampStep = (d: number) => Math.max(-L * 0.28, Math.min(L * 0.28, d * 0.55))
        ball.u = (((ball.u + clampStep(bx - px)) % L) + L) % L
        ball.v = (((ball.v + clampStep(by - py)) % L) + L) % L
        patchRef.current.setAttribute('transform', `translate(${ball.u.toFixed(3)} ${ball.v.toFixed(3)})`)
      }

      // The blocks shift up and down with the ball, the nearest men drift towards it, everyone sways a little.
      // The man on the ball stands just behind it; the man it is going to runs to meet it.
      const lean = ball.lean ? (ball.lean.x - 50) * 0.08 : 0
      const i = b?.index ?? -1
      const curKf = i >= 0 ? path[i] : undefined
      const next = b?.next ?? null
      const f = b?.progress ?? 1
      let saveKf: BallKeyframe | null = null
      for (let k = i; k >= 0 && k >= i - 2; k--) if (path[k].kind === 'save' && Math.abs(T - path[k].t) < 0.5) saveKf = path[k]
      const env = hold ? celebrationEnvelope(elapsed, hold.ms, GOAL_FLIGHT_MS) : 0
      const ev = hold ? events[+hold.key] : undefined
      const scorerId = hold && ev && ev.type !== 'own_goal' && ev.playerId ? dotKey(hold.side, ev.playerId) : undefined
      const scorerAt = hold && shotKf ? scorerRun(shotKf, hold.side === 'home', (elapsed - GOAL_FLIGHT_MS) / (hold.ms * 0.55)) : null
      const tauDot = 150 * Math.min(2, Math.max(1, s.speed / 2))
      const has = (k: BallKeyframe | null | undefined, p: PlacedPlayer) => !!k && k.holder === p.psId && k.side === p.side
      for (const [key, el] of dots.current) {
        const p = placed.get(key)
        if (!p) continue
        let w = 0
        if (next?.kind === 'carry' && has(next, p)) w = 1
        else {
          if (has(curKf, p) && next?.kind !== 'carry') w = Math.max(w, 1 - f)
          if (has(next, p)) w = Math.max(w, f)
        }
        if (has(curKf, p) && !next) w = 1
        let x = p.x + lean * (p.position === 'GK' ? 0.35 : 1)
        let y = p.y
        if (ball.slow && p.position !== 'GK') {
          const pull = 0.2 * Math.max(0, 1 - metres(ball.slow, { x, y }) / 26)
          x += (ball.slow.x - x) * pull
          y += (ball.slow.y - y) * pull
        }
        const phase = phases.get(key) ?? 0
        x += Math.sin(T * 1.7 + phase) * 0.5
        y += Math.cos(T * 1.3 + phase) * 0.7
        if (w > 0 && b) {
          // Just behind the ball, as he faces the way his side attacks
          const ax = b.x - (p.side === 'home' ? 2.3 : -2.3)
          x += (ax - x) * w
          y += (b.y - y) * w
        }
        if (saveKf && has(saveKf, p)) {
          const prev = path[path.indexOf(saveKf) - 1]
          const dive = 1 - Math.abs(T - saveKf.t) / 0.5
          if (prev) {
            x += (prev.x - p.x) * 0.35 * dive
            y += (prev.y - p.y) * 0.5 * dive
          }
        }
        if (env > 0 && scorerAt && hold) {
          if (key === scorerId) {
            x += (scorerAt.x - x) * env
            y += (scorerAt.y - y) * env
          } else if (p.side === hold.side && p.position !== 'GK') {
            // Team-mates run to him, each to his own spot around the scorer
            const d = metres(p, scorerAt)
            const pullIn = 0.6 * env * Math.max(0, 1 - d / 55)
            const a = phase * 7
            x += (scorerAt.x + Math.cos(a) * 4 - x) * pullIn
            y += (scorerAt.y + Math.sin(a) * 6 - y) * pullIn
          }
        }
        let prev = shown.get(key)
        // A man new to the pitch (a substitute) walks on from the touchline, a little slower than the rest move
        if (!prev && !first) {
          prev = initial.get(key) ?? ENTRY_POINT
          entered.set(key, now)
        }
        const since = entered.get(key)
        const tau = since !== undefined && now - since < 1500 ? tauDot * 3 : tauDot
        const now2 = prev ? { x: approach(prev.x, x, dt, tau), y: approach(prev.y, y, dt, tau) } : { x, y }
        el.setAttribute('transform', at(now2.x, now2.y))
        shown.set(key, now2)
      }
      first = false
      for (const key of shown.keys()) if (!dots.current.has(key)) shown.delete(key)

      if (ringRef.current) {
        const holder = !hold && b?.holder ? shown.get(dotKey(b.side, b.holder)) : undefined
        if (holder) {
          const [sx, sy] = map(holder.x, holder.y)
          ringRef.current.setAttribute('cx', sx.toFixed(2))
          ringRef.current.setAttribute('cy', sy.toFixed(2))
          ringRef.current.setAttribute('opacity', '0.8')
        } else ringRef.current.setAttribute('opacity', '0')
      }
      if (celebRef.current) {
        const sc = scorerId ? shown.get(scorerId) : undefined
        if (sc && env > 0 && hold) {
          const [sx, sy] = map(sc.x, sc.y)
          const beat = ((elapsed - GOAL_FLIGHT_MS) / 420) % 1
          celebRef.current.setAttribute('cx', sx.toFixed(2))
          celebRef.current.setAttribute('cy', sy.toFixed(2))
          celebRef.current.setAttribute('r', (3.2 + beat * 3.2).toFixed(2))
          celebRef.current.setAttribute('stroke', colourOf[hold.side])
          celebRef.current.setAttribute('opacity', (env * (1 - beat) * (hold.tone === 'theirs' ? 0.55 : 0.95)).toFixed(2))
        } else celebRef.current.setAttribute('opacity', '0')
      }
      // The shot's line for a chance or a save (a goal has its own flight)
      if (shotRef.current) {
        let sk: BallKeyframe | null = null
        for (let k = i; k >= 0 && k >= i - 2; k--) if (path[k].kind === 'shot' && k < path.length - 1 && T - path[k].t < 0.5 && path[k + 1].kind !== 'goal') sk = path[k]
        if (sk) {
          const tgt = path[path.indexOf(sk) + 1]
          const [x1, y1] = map(sk.x, sk.y)
          const [x2, y2] = map(tgt.x, tgt.y)
          shotRef.current.setAttribute('x1', x1.toFixed(2))
          shotRef.current.setAttribute('y1', y1.toFixed(2))
          shotRef.current.setAttribute('x2', x2.toFixed(2))
          shotRef.current.setAttribute('y2', y2.toFixed(2))
          shotRef.current.setAttribute('opacity', String(Math.max(0, 0.7 - (T - sk.t) / 0.7)))
        } else shotRef.current.setAttribute('opacity', '0')
      }
      // The net bulges, the screen flashes and, for a goal worth shouting about, shakes
      const since = hold ? elapsed - GOAL_FLIGHT_MS : -1
      const bulge = hold && since >= 0 ? netBulge(since, hold.tone === 'theirs' ? 0.45 : 0.75) : 0
      const rightEnd = hold?.side === 'home'
      if (nets.current.right) nets.current.right.setAttribute('transform', hold && rightEnd && bulge ? `translate(105 34) scale(${(1 + bulge).toFixed(3)} ${(1 + bulge * 0.15).toFixed(3)}) translate(-105 -34)` : '')
      if (nets.current.left) nets.current.left.setAttribute('transform', hold && !rightEnd && bulge ? `translate(0 34) scale(${(1 + bulge).toFixed(3)} ${(1 + bulge * 0.15).toFixed(3)}) translate(0 -34)` : '')
      if (flashRef.current) flashRef.current.setAttribute('opacity', hold && since >= 0 ? (Math.exp(-since / 170) * (hold.tone === 'theirs' ? 0.16 : 0.42)).toFixed(3) : '0')
      if (stageRef.current) {
        const shake = hold && hold.tone !== 'theirs' && since >= 0 && since < 380 ? 0.7 * (1 - since / 380) : 0
        stageRef.current.setAttribute('transform', shake ? `translate(${(Math.sin(since / 17) * shake).toFixed(2)} ${(Math.cos(since / 23) * shake).toFixed(2)})` : '')
      }
    }
    const wake = () => {
      if (id) return
      // Waking from a sleep: the first frame back takes no time step, so nothing leaps by the time it slept
      ball.last = 0
      id = requestAnimationFrame(frame)
    }
    wake()
    const unsubscribe = useLiveClock.subscribe(wake)
    return () => {
      unsubscribe()
      cancelAnimationFrame(id)
    }
  }, [path, reduced, to, map, placed, phases, events, colourOf, portrait, R, seed, initial, from])

  const homeOn = onPitchAt(homePlaced, minute)
  const awayOn = onPitchAt(awayPlaced, minute)
  const booked = useMemo(() => new Set(events.filter((e) => e.type === 'yellow' && e.minute <= minute && e.playerId).map((e) => dotKey(e.side, e.playerId!))), [events, minute])
  const flashes = events.filter((e) => (e.type === 'red' || e.type === 'injury' || e.type === 'substitution') && e.minute <= minute && (minute < e.minute + 3 || minute >= to) && e.minute > minute - 6 && e.playerId)
  const stillBall = reduced ? ballAt(path, Math.min(to, minute) + 0.99, true) : null
  const hidden = useMemo(() => new Set(holds.slice(revealed).map((h) => +h.key)), [holds, revealed])
  const scoreNow = events.filter((e, i) => GOAL_TYPES.has(e.type) && e.minute <= minute && !hidden.has(i))
  const burst = celebrating >= 0 ? holds[celebrating] : undefined

  const dot = (p: PlacedPlayer, colour: string) => {
    const name = getPlayer(p.psId)?.name
    const key = dotKey(p.side, p.psId)
    // Drawn first where he stood when this match's pitch was last drawn, or walking on, or at his slot; the loop moves him from there
    const startAt = reduced ? p : initial.get(key) ?? (initial.size || p.onAt > Math.max(0, from) ? ENTRY_POINT : p)
    const [sx, sy] = map(startAt.x, startAt.y)
    return (
      <g key={key} ref={dotRef(key)} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`} className="live-dot" data-testid="live-dot">
        <title>{name ?? p.psId}</title>
        <g className="dot-body">
          <circle r="2.7" fill={colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
          <text y="0.85" textAnchor="middle" fontSize="2.3" fontWeight="700" fill={textColourFor(colour)}>
            {initials(name)}
          </text>
          {booked.has(key) && <rect x="1.7" y="-3.9" width="1.5" height="2.1" rx="0.2" fill="var(--gold)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.2" />}
        </g>
      </g>
    )
  }

  return (
    <div className="live-pitch" data-testid="live-pitch" data-minute={minute} data-score={`${scoreNow.filter((e) => e.side === 'home').length}-${scoreNow.filter((e) => e.side === 'away').length}`}>
      <PitchSvg portrait={portrait} label={`${home.name} against ${away.name}, minute ${minute}`}>
        <defs>
          <radialGradient id={`${uid}-base`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#eceef0" />
            <stop offset="100%" stopColor="#b9bec4" />
          </radialGradient>
          <radialGradient id={`${uid}-gloss`} cx="35%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="28%" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="78%" stopColor="#000000" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.38" />
          </radialGradient>
          <clipPath id={`${uid}-clip`}>
            <circle r={R * 0.97} />
          </clipPath>
        </defs>
        <g ref={stageRef}>
          <g transform={portrait ? 'translate(0 105) rotate(-90)' : undefined}>
            <Net right={false} innerRef={setLeftNet} />
            <Net right innerRef={setRightNet} />
          </g>
          <line ref={shotRef} stroke="#fff" strokeWidth="0.5" strokeLinecap="round" strokeDasharray="1.2 0.8" opacity="0" />
          <circle ref={ringRef} r="3.7" fill="none" stroke="#fff" strokeWidth="0.45" opacity="0" />
          <circle ref={celebRef} r="3.5" fill="none" stroke="#fff" strokeWidth="0.7" opacity="0" />
          <g>{homeOn.map((p) => dot(p, home.colour))}</g>
          <g>{awayOn.map((p) => dot(p, away.colour))}</g>
          {flashes.map((e, i) => {
            const p = placed.get(dotKey(e.side, e.playerId!))
            if (!p) return null
            const [sx, sy] = map(p.x, p.y)
            return (
              <g key={`${e.type}-${e.minute}-${i}`} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`}>
                <g className="live-flash">
                  {e.type === 'red' && <rect x="-1.4" y="-6.8" width="2.8" height="3.8" rx="0.3" fill="var(--danger)" stroke="#fff" strokeWidth="0.3" />}
                  {e.type === 'injury' && (
                    <g stroke="#fff" strokeWidth="0.8" strokeLinecap="round">
                      <circle r="2.2" cy="-5.6" fill="var(--warn)" stroke="none" />
                      <line x1="-1.1" y1="-5.6" x2="1.1" y2="-5.6" />
                      <line x1="0" y1="-6.7" x2="0" y2="-4.5" />
                    </g>
                  )}
                  {e.type === 'substitution' && (
                    <text y="-4.4" textAnchor="middle" fontSize="3.4" fontWeight="700" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.25">
                      ⇅
                    </text>
                  )}
                </g>
              </g>
            )
          })}
          {reduced ? (
            stillBall && (
              <g transform={(() => { const [sx, sy] = map(stillBall.x, stillBall.y); return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})` })()} data-testid="live-ball">
                <BallArt id={uid} r={R} simple={portrait} />
              </g>
            )
          ) : (
            <>
              <g ref={shadowRef} opacity="0">
                <ellipse rx={R * 1.05} ry={R * 0.55} fill="#000" />
              </g>
              <g ref={ballRef} data-testid="live-ball" opacity="0">
                <g ref={bodyRef}>
                  <BallArt id={uid} r={R} simple={portrait} patchRef={setPatch} />
                </g>
              </g>
            </>
          )}
          <rect ref={flashRef} x="-3" y="-3" width={portrait ? 74 : 111} height={portrait ? 111 : 74} fill="#fff" opacity="0" pointerEvents="none" />
        </g>
      </PitchSvg>
      {burst && <GoalBurst key={`${burst.key}-${celebrating}`} hold={burst} events={events} home={home} away={away} reduced={reduced} />}
      <div className="live-legend small">
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: home.colour }} />
          {home.shortName} <span className="muted">{portrait ? '↑' : '→'}</span>
        </span>
        <span className="muted">{portrait ? 'attacking up' : 'attacking right'}</span>
        <span className="row" style={{ gap: 6 }}>
          <span className="muted">{portrait ? '↓' : '←'}</span> {away.shortName}
          <span className="swatch" style={{ background: away.colour }} />
        </span>
      </div>
    </div>
  )
}

/** The "GOAL!" banner over the pitch, in the scoring club's colours, with confetti for a goal of ours. Rendered once per goal; CSS does the rest. */
function GoalBurst({ hold, events, home, away, reduced }: { hold: { key: string; side: Side; tone: 'ours' | 'theirs' | 'neutral'; ms: number }; events: MatchEvent[]; home: PitchSide; away: PitchSide; reduced: boolean }) {
  const idx = +hold.key
  const ev = events[idx]
  if (!ev) return null
  const goals = events.filter((e, i) => GOAL_TYPES.has(e.type) && (e.minute < ev.minute || (e.minute === ev.minute && i <= idx)))
  const hg = goals.filter((e) => e.side === 'home').length
  const ag = goals.filter((e) => e.side === 'away').length
  const colour = hold.side === 'home' ? home.colour : away.colour
  const ink = textColourFor(colour)
  const pieces = hold.tone !== 'theirs' && !reduced ? confetti([colour, '#ffffff', ink === '#fff' ? '#ffd54a' : '#111111']) : []
  const title = ev.type === 'own_goal' ? 'OWN GOAL!' : ev.type === 'penalty' ? 'GOAL! (PEN)' : 'GOAL!'
  const who = ev.type === 'own_goal' ? `${ev.playerName ?? 'A defender'} (og)` : ev.playerName ?? (hold.side === 'home' ? home.shortName : away.shortName)
  const style = { '--burst': colour, '--burst-ink': ink, '--burst-ms': `${hold.ms}ms`, '--flight': `${reduced ? 0 : GOAL_FLIGHT_MS}ms` } as CSSProperties
  return (
    <div className={`goal-burst ${hold.tone} ${reduced ? 'still' : ''}`} style={style} data-testid="goal-burst" data-tone={hold.tone} role="status" aria-live="polite">
      {pieces.length > 0 && (
        <div className="confetti" aria-hidden="true">
          {pieces.map((c, i) => (
            <span key={i} className={c.wide ? 'wide' : ''} style={{ '--dx': `${c.dx.toFixed(1)}cqw`, '--dy': `${c.dy.toFixed(1)}cqh`, '--rot': `${c.rot}deg`, '--delay': `${c.delay}ms`, background: c.colour } as CSSProperties} />
          ))}
        </div>
      )}
      <div className="banner">
        <div className="title">{title}</div>
        <div className="who">
          {who} <span className="min">{minuteLabel(ev.minute)}</span>
        </div>
        <div className="new-score">
          {home.shortName} {hg} - {ag} {away.shortName}
        </div>
      </div>
    </div>
  )
}
