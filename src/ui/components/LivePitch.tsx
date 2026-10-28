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
 * A caption over the pitch names what the side on the ball is doing (building
 * from the back, a switch of play, a corner being set up), and a faint trail
 * follows a long ball, a through ball or a cross while it is in flight.
 * With prefers-reduced-motion the loop is off: once a minute the dots are
 * drawn where the shape has them and the ball on its last keyframe, and a
 * goal is a still banner.
 *
 * After Football Manager's 2D view (each part in its own helper below, so the
 * loop stays one read of the clock): the ball flies by the kind of ball it
 * is, growing as it rises over a shadow that stays on the grass (flight.ts);
 * the man on the ball has his name under his dot, a pass flashes its line
 * and a shot leaves a line coloured by its expected goals (overlays.ts); the
 * camera leans in on a big chance and a goal is replayed in slow motion after
 * its celebration (keyMoments.ts, the `keyMoments` prop). `highlightId`
 * rings one man and keeps his name on (the Squad strip's selection).
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import type { Appearance } from '@engine/match'
import type { MatchEvent, PlayerSeason, Tactics } from '@engine/types'
import { GOAL_FLIGHT_MS, skipHold, timeline, useLiveClock, type GoalHold } from '../match/clockStore'
import { initials, metres, onPitchAt, placeSide, separateSides, type PlacedPlayer, type Side } from '../match/pitchGeometry'
import { dotPosition, swayPhase } from '../match/movement'
import { ballAt, buildBallPath, type BallKeyframe, type BallState, type PlayTag } from '../match/possession'
import { styleOf } from '../match/playbook'
import { phaseCaption, sceneAt } from '../match/shape'
import { epochAt, type MatchPath } from '../match/epochs'
import { celebrationEnvelope, confetti, flightProgress, netBulge, scorerRun } from '../match/celebration'
import { finishOf, goalFlightAt } from '../match/finish'
import { ballSprite, ballView } from '../match/flight'
import { capFrame, frameCap, wakeCap } from '../match/frameCap'
import { cornerDelivery, dotName, passFlash, shotMarks, shotTrailAt, xgBand, type ShotMark } from '../match/overlays'
import { BUILD_UP, CAMERA, REPLAY, buildUpAt, cameraTransform, celebrationMs, focusAt, focusMoments, replayFrame, shooterRing, type FocusMoment, type ReplayFrame, type ViewBox } from '../match/keyMoments'
import { shotXg } from '@engine/matchStats'
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
  /** What each dot shows (shirt numbers); initials when absent. */
  labels?: Record<string, number | string>
  /** The whole match's placements and ball path (epochs.ts): the shape moves from the minute a change was made and the ball carries on. Without it the pitch lays out its own path for `from`..`to`. */
  track?: MatchPath
  /** Goalkeepers' shirts, by side. */
  keepers?: { home: string; away: string }
  /** The camera leans in on big chances and goals are replayed after their celebration (the viewer's Key moments setting; the dashboard adds the replay to the goals' holds). */
  keyMoments?: boolean
  /** A man to pick out (the Squad strip's selection): a ring on his dot and his name always shown. */
  highlightId?: string | null
  /** Drawn over the pitch beside the goal celebration (the match day's half-time and full-time card); presentation only. */
  overlay?: ReactNode
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
export function PitchSvg({ portrait = false, children, label, camera, overlay }: { portrait?: boolean; children: ReactNode; label: string; camera?: Ref<SVGGElement>; overlay?: ReactNode }) {
  if (camera) {
    // A pitch the camera can move: the turf and the lines go inside the camera's group with everything on them
    return (
      <svg className={`pitch-svg ${portrait ? 'portrait' : ''}`} viewBox={portrait ? '-3 -3 74 111' : '-3 -3 111 74'} role="img" aria-label={label}>
        <g ref={camera}>
          <PitchTurf portrait={portrait} />
          <PitchMarkings portrait={portrait} />
          {children}
        </g>
        {overlay}
      </svg>
    )
  }
  return (
    <svg className={`pitch-svg ${portrait ? 'portrait' : ''}`} viewBox={portrait ? '-3 -3 74 111' : '-3 -3 111 74'} role="img" aria-label={label}>
      <PitchMarkings portrait={portrait} />
      {children}
    </svg>
  )
}

/** The pitch's stripes as SVG (the same bands as the `.pitch-svg` background), so they move with the camera. */
const PitchTurf = memo(function PitchTurf({ portrait }: { portrait: boolean }) {
  const box = viewBoxOf(portrait)
  const band = box.w / 8
  return (
    <g aria-hidden="true">
      {Array.from({ length: 8 }, (_, k) => (
        <rect key={k} x={box.x + k * band} y={box.y} width={band + 0.02} height={box.h} fill={k % 2 ? 'var(--pitch-2)' : 'var(--pitch)'} />
      ))}
    </g>
  )
})

/** The SVG box a pitch draws in, for its orientation. */
export function viewBoxOf(portrait: boolean): ViewBox {
  return portrait ? { x: -3, y: -3, w: 74, h: 111 } : { x: -3, y: -3, w: 111, h: 74 }
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const NONE: PlacedPlayer[] = []
/** Balls that leave a faint trail while in flight. */
const TRAILED = new Set<PlayTag>(['switch', 'long', 'through', 'cross', 'cutback', 'clearance'])

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

/** A dot's element id inside this pitch (`uid` keeps two pitches apart): the build-up draws the shooter's again on top. */
function dotDomId(uid: string, key: string): string {
  return `${uid}-dot-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

/** The goal mouth's glow at one end (landscape units), brightened by the loop as a big chance or a goal is built up there. */
const MouthGlow = memo(function MouthGlow({ right, fill, innerRef }: { right: boolean; fill: string; innerRef: (el: SVGEllipseElement | null) => void }) {
  return <ellipse ref={innerRef} className="mouth-glow" cx={right ? 105 : 0} cy="34" rx="17" ry="21" fill={fill} opacity="0" pointerEvents="none" />
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
  /** The ball on screen. */
  p: P | null
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

/** Frame-time thresholds for the pitch's lite mode: on once frames average over `on` ms (under 25 fps) after `warm` frames, off again under `off` ms. */
export const LITE = { on: 40, off: 26, warm: 90, keep: 0.97 } as const

/** Track the running mean of the frame time (`dt` ms; 0 is a frame that took no time step and is skipped) and switch lite mode with hysteresis. */
export function liteMode(perf: { mean: number; frames: number; lite: boolean }, dt: number): void {
  if (dt <= 0) return
  perf.frames++
  perf.mean = perf.mean * LITE.keep + dt * (1 - LITE.keep)
  if (perf.frames < LITE.warm) return
  if (!perf.lite && perf.mean > LITE.on) perf.lite = true
  else if (perf.lite && perf.mean < LITE.off) perf.lite = false
}

/**
 * What the loop last wrote to each element's attributes, so an unchanged value costs neither a read nor a write. React
 * writes these attributes only on mount (they are fixed in the JSX, or the dots' starting place), so the loop's own
 * record is what the element holds.
 */
const written = new WeakMap<Element, Map<string, string>>()

/** Set an attribute only when it changes: the overlays mostly sit hidden, and an unchanged write still costs the browser a style pass. */
function put(el: Element, name: string, value: string): void {
  let attrs = written.get(el)
  if (!attrs) written.set(el, (attrs = new Map()))
  if (attrs.get(name) === value) return
  attrs.set(name, value)
  el.setAttribute(name, value)
}

/** Where the ball flies on a goal: from the strike into the net, `x` of the way through the flight's time, shaped by how the goal was scored (finish.ts), and `after` ms past the landing. */
function goalFlight(path: BallKeyframe[], b: BallState, side: Side, ev: MatchEvent | undefined, x: number, after: number): { at: P; h: number; shot: BallKeyframe } {
  // The strike: the keyframe the ball reached at the hold's moment (or the last shot just before it)
  let si = b.index
  while (si > 0 && path[si].kind !== 'shot' && path[si].kind !== 'goal' && b.index - si < 3) si--
  if (path[si]?.kind === 'goal' && si > 0) si--
  const shot = path[si] ?? path[b.index]
  const goalKf = path[si + 1]
  const mouth = goalKf && goalKf.kind === 'goal' ? { x: goalKf.x, y: goalKf.y } : { x: side === 'home' ? 100 : 0, y: 50 }
  return { ...goalFlightAt(shot, mouth, side, finishOf(ev), x, after), shot }
}

/** A name tag under a dot: a dark pill with the name in white, drawn at (0, 0) of its group. The loop writes the text and sizes the pill. */
function NameTag({ groupRef, textRef, bgRef, className, testId }: { groupRef: Ref<SVGGElement>; textRef: Ref<SVGTextElement>; bgRef: Ref<SVGRectElement>; className: string; testId: string }) {
  return (
    <g ref={groupRef} className={className} opacity="0" pointerEvents="none" data-testid={testId}>
      <rect ref={bgRef} x="-4" y="-1.45" width="8" height="2.9" rx="1.45" fill="var(--pitch-disc)" />
      <text ref={textRef} y="0.78" textAnchor="middle" fontSize="2.1" fontWeight="600" fill="#fff" />
    </g>
  )
}

/** Write a tag's name (only when it changes) and size its pill to it (an estimate from the letters, so the loop never measures text). */
function writeTag(text: SVGTextElement | null, bg: SVGRectElement | null, name: string, prev: string): string {
  if (name === prev || !text || !bg) return prev
  text.textContent = name
  const w = Math.max(5, name.length * 1.22 + 2.4)
  bg.setAttribute('x', (-w / 2).toFixed(2))
  bg.setAttribute('width', w.toFixed(2))
  return name
}

/** The camera this frame: eased towards where it wants to be, as a transform on the pitch's group. */
interface Camera {
  x: number
  y: number
  s: number
}
function aimCamera(cam: Camera, want: Camera, dt: number, snap: boolean): void {
  if (snap) {
    cam.x = want.x
    cam.y = want.y
    cam.s = want.s
    return
  }
  cam.x = approach(cam.x, want.x, dt, 220)
  cam.y = approach(cam.y, want.y, dt, 220)
  cam.s = approach(cam.s, want.s, dt, want.s > cam.s ? 320 : 420)
}

export function LivePitch({ home, away, events, momentum, from, to, seed, getPlayer, labels, track, keepers, keyMoments = false, highlightId = null, overlay }: LivePitchProps) {
  const portrait = useMediaQuery('(max-width: 720px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const clock = useLiveClock((s) => s.clock)
  const holds = useLiveClock((s) => s.holds)
  const revealed = useLiveClock((s) => s.revealed)
  const celebrating = useLiveClock((s) => s.celebrating)
  const minute = Math.min(clock, to)
  const own = useMemo(() => (track ? null : separateSides(placeSide(home.appearances, home.tactics, 'home'), placeSide(away.appearances, away.tactics, 'away'))), [track, home.appearances, home.tactics, away.appearances, away.tactics])
  // With a track, the placements of the spell the clock stands in
  const epoch = track && track.epochs.length ? epochAt(track, Math.max(minute, 0) + 0.5) : null
  const homePlaced = epoch?.home ?? own?.home ?? NONE
  const awayPlaced = epoch?.away ?? own?.away ?? NONE
  const homeTactics = home.tactics
  const awayTactics = away.tactics
  const path = useMemo(() => track?.path ?? buildBallPath({ from, to, momentum, events, home: homePlaced, away: awayPlaced, seed, styles: { home: styleOf(homeTactics), away: styleOf(awayTactics) } }), [track, from, to, momentum, events, homePlaced, awayPlaced, seed, homeTactics, awayTactics])
  const map = useMemo(() => pitchMapper(portrait), [portrait])
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const R = portrait ? 1.75 : 1.5

  const stageRef = useRef<SVGGElement>(null)
  const cameraRef = useRef<SVGGElement>(null)
  const ballRef = useRef<SVGGElement>(null)
  const bodyRef = useRef<SVGGElement>(null)
  const patchRef = useRef<SVGGElement | null>(null)
  const shadowRef = useRef<SVGGElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const celebRef = useRef<SVGCircleElement>(null)
  const spotRef = useRef<SVGGElement>(null)
  const liftRef = useRef<SVGUseElement>(null)
  const glows = useRef<{ left: SVGEllipseElement | null; right: SVGEllipseElement | null }>({ left: null, right: null })
  const setLeftGlow = useCallback((el: SVGEllipseElement | null) => void (glows.current.left = el), [])
  const setRightGlow = useCallback((el: SVGEllipseElement | null) => void (glows.current.right = el), [])
  const shotRef = useRef<SVGLineElement>(null)
  const trailRef = useRef<SVGLineElement>(null)
  const passRef = useRef<SVGLineElement>(null)
  const tagRef = useRef<SVGGElement>(null)
  const tagTextRef = useRef<SVGTextElement>(null)
  const tagBgRef = useRef<SVGRectElement>(null)
  const markRef = useRef<SVGCircleElement>(null)
  const markTagRef = useRef<SVGGElement>(null)
  const markTextRef = useRef<SVGTextElement>(null)
  const markBgRef = useRef<SVGRectElement>(null)
  const cutRef = useRef<SVGRectElement>(null)
  const replayRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLDivElement>(null)
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
  // A fixed sway phase per man, from his id, so the picture is the same on every replay (and matches the heat maps)
  const phases = useMemo(() => new Map([...placed].map(([key, p]) => [key, swayPhase(p.psId)])), [placed])
  const colourOf = useMemo(() => ({ home: home.colour, away: away.colour }), [home.colour, away.colour])
  const codes = useMemo(() => ({ home: home.shortName, away: away.shortName }), [home.shortName, away.shortName])
  // The overlays' inputs: each man's name tag, every shot's xG band, the moments the camera leans in on
  const names = useMemo(() => new Map([...placed].map(([key, p]) => [key, dotName(getPlayer(p.psId)?.name)])), [placed, getPlayer])
  const ranges = useMemo(() => (track && track.epochs.length ? track.epochs.map((e) => ({ from: e.from, to: e.to })) : [{ from, to }]), [track, from, to])
  const marks = useMemo(() => shotMarks(path, events, ranges), [path, events, ranges])
  // The big moments: the build-up marks them at every speed, the camera (Key moments) leans in on them
  const chances = useMemo(() => focusMoments(events, ranges), [events, ranges])
  const moments = useMemo(() => (keyMoments ? chances : []), [keyMoments, chances])
  const markKey = useMemo(() => (highlightId ? [...placed.keys()].find((k) => placed.get(k)!.psId === highlightId) : undefined), [highlightId, placed])

  // The animation: one frame reads the shared clock, works out where everything should be and
  // eases what is on screen towards it. It runs while the clock does (a goal's hold counts):
  // paused, or stood at a stop, the last frame stays on screen and the loop sleeps until the
  // clock store changes again.
  useEffect(() => {
    if (reduced) return
    const kept = frameFor(seed, from)
    const shown = kept.dots
    // Carry on from the last frame drawn for this match, so a re-render, a remount or a new segment never moves anyone at once
    const ball: BallMotion = kept.motion ?? { p: kept.ball, u: 0, v: 0, last: 0 }
    kept.motion = ball
    ball.last = 0
    /** A new segment that finds the ball far from its kick-off (the second half): it rolls to the spot over a moment rather than snapping there. */
    let settleUntil = -1
    /** The first frame of a brand-new match places everyone; after that a man new to the pitch walks on. */
    let first = shown.size === 0
    const entered = new Map<string, number>()
    let id = 0
    let caption = ''
    const box = viewBoxOf(portrait)
    const cam: Camera = { x: box.x + box.w / 2, y: box.y + box.h / 2, s: 1 }
    let tag = ''
    let markTag = ''
    let inReplay = false
    let leftReplay = -1
    // A device that cannot keep up drops the camera and the pass lines while it struggles (liteMode: a running mean of the frame time, with hysteresis)
    const perf = { mean: 16.7, frames: 0, lite: false }
    // One that keeps missing 60 fps draws every other frame (frameCap.ts): the same picture at fewer moments
    const cap = frameCap()
    const at = (x: number, y: number) => {
      const [sx, sy] = map(x, y)
      return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`
    }
    const frame = (now: number) => {
      id = 0
      const s = useLiveClock.getState()
      if (s.running) id = requestAnimationFrame(frame)
      const wasCapped = cap.capped
      const slot = capFrame(cap, now)
      if (cap.capped !== wasCapped && stageRef.current) stageRef.current.setAttribute('data-capped', String(cap.capped))
      if (s.running && !slot.draw) return
      // Time moves things only while the clock runs; stood at a stop or paused, a wake-up redraws without moving anyone
      const dt = s.running && ball.last ? Math.min(80, Math.max(0, now - ball.last)) : 0
      ball.last = now
      // Capped, the step between drawn frames is the cap's own: the frame's cost is the interval since the one before
      liteMode(perf, cap.capped ? Math.min(80, slot.interval) : dt)
      const lite = perf.lite
      const tl = timeline(s, now)
      const holdAny = tl.hold ? s.holds[tl.hold.index] : undefined
      const elapsed = tl.hold?.elapsed ?? 0
      // The goal's replay, once its celebration is over: the picture plays the build-up again from the same path
      const rf: ReplayFrame | null = keyMoments && holdAny ? replayFrame(holdAny, elapsed, holdAny.t) : null
      // `hold` is the celebration (not its replay); T is the match time drawn
      const hold = rf ? undefined : holdAny
      const celeb = hold ? celebrationMs(hold) : 0
      const T = rf ? rf.T : Math.min(to + 1, tl.t)
      const b = ballAt(path, T)
      const snapAll = (!!rf && rf.cut > 0.85) || (inReplay && !rf)
      if (inReplay && !rf) leftReplay = now
      inReplay = !!rf

      // Where the ball should be: on its path (flown by the kind of ball it is), or, during a goal's hold, flying into the net and then back to the centre spot
      const view = b && !hold ? ballView(path, T, b) : null
      let target: P = view ? { x: view.x, y: view.y } : b ? { x: b.x, y: b.y } : { x: 50, y: 50 }
      let h = view?.h ?? b?.h ?? 0
      let opacity = b ? (b.next?.kind === 'reset' && (b.progress ?? 0) < 1 ? 0.55 : 1) : 0
      let snapBall = !!rf
      let shotKf: BallKeyframe | undefined
      let flying: { at: P; band: ReturnType<typeof xgBand>; f: number } | null = null
      // Just past a goal's hold the path still runs from the strike into the net and back to the spot: the ball is on the spot
      if (!holdAny && b && (b.next?.kind === 'goal' || path[b.index]?.kind === 'goal')) target = { x: 50, y: 50 }
      if (hold && b) {
        const fp = flightProgress(elapsed, GOAL_FLIGHT_MS)
        const ev = events[+hold.key]
        const g = goalFlight(path, b, hold.side, ev, elapsed / GOAL_FLIGHT_MS, elapsed - GOAL_FLIGHT_MS)
        shotKf = g.shot
        target = g.at
        h = g.h
        snapBall = true
        if (ev) flying = { at: g.at, band: xgBand(shotXg(ev)), f: fp }
        if (elapsed > celeb - 700 && elapsed <= celeb - 350) opacity = Math.max(0, (celeb - 350 - elapsed) / 350)
        else if (elapsed > celeb - 350) {
          target = { x: 50, y: 50 }
          opacity = Math.min(1, (elapsed - (celeb - 350)) / 250)
        }
      }
      if (rf && holdAny && b && rf.flight > 0) {
        // The replay's strike: the same flight, slower
        const ev = events[+holdAny.key]
        const fp = flightProgress(rf.flight, 1)
        const g = goalFlight(path, b, holdAny.side, ev, rf.flight, rf.landed)
        target = g.at
        h = g.h
        if (ev) flying = { at: g.at, band: xgBand(shotXg(ev)), f: fp }
      }
      // The ball on screen eases after its path lightly at 1x and more at speed, where a hop lasts a few
      // frames: at 4x it rounds the corners of the path rather than hopping, so nothing jumps
      if (settleUntil < 0) settleUntil = ball.p && Math.hypot(ball.p.x - target.x, ball.p.y - target.y) > 8 ? now + 900 : 0
      const tauBall = Math.max(s.speed >= 4 ? 85 : s.speed >= 2 ? 38 : 14, now < settleUntil ? 160 : 0)
      const prevBall = ball.p ?? target
      const cur: P = snapBall || snapAll || !ball.p ? target : { x: approach(prevBall.x, target.x, dt, tauBall), y: approach(prevBall.y, target.y, dt, tauBall) }
      ball.p = cur
      kept.ball = cur
      const [bx, by] = map(cur.x, cur.y)
      const [px, py] = map(prevBall.x, prevBall.y)
      paintBall(ballRef.current, bodyRef.current, shadowRef.current, bx, by, h, opacity, R)
      // Roll: slide the patches the way the ball travels (a small share of the distance, so they never strobe)
      if (patchRef.current) {
        const L = portrait ? R * 2.3 : R * 1.55
        const clampStep = (d: number) => Math.max(-L * 0.28, Math.min(L * 0.28, d * 0.55))
        ball.u = (((ball.u + clampStep(bx - px)) % L) + L) % L
        ball.v = (((ball.v + clampStep(by - py)) % L) + L) % L
        put(patchRef.current, 'transform', `translate(${ball.u.toFixed(3)} ${ball.v.toFixed(3)})`)
      }

      // Everyone by the one movement formula the heat maps sample (movement.ts): the blocks shift with
      // the ball, the nearest men drift to it, everyone sways, the man on the ball has it, a keeper dives.
      // What is on screen eases towards that, and a goal's celebration pulls the scorer's side to him.
      // One scene a frame (who has it, how settled, a set piece being set up, a cross coming in): every dot reads it
      const scene = sceneAt(path, b, T)
      const env = hold ? celebrationEnvelope(elapsed, celeb, GOAL_FLIGHT_MS) : 0
      const ev = hold ? events[+hold.key] : undefined
      const scorerId = hold && ev && ev.type !== 'own_goal' && ev.playerId ? dotKey(hold.side, ev.playerId) : undefined
      const scorerAt = hold && shotKf ? scorerRun(shotKf, hold.side === 'home', (elapsed - GOAL_FLIGHT_MS) / (celeb * 0.55)) : null
      const tauDot = rf ? 0 : 150 * Math.min(2, Math.max(1, s.speed / 2))
      for (const [key, el] of dots.current) {
        const p = placed.get(key)
        if (!p) continue
        const phase = phases.get(key) ?? 0
        let { x, y } = dotPosition(p, path, b, T, phase, scene)
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
        const now2 = prev && !snapAll ? { x: approach(prev.x, x, dt, tau), y: approach(prev.y, y, dt, tau) } : { x, y }
        put(el, 'transform', at(now2.x, now2.y))
        shown.set(key, now2)
      }
      first = false
      for (const key of shown.keys()) if (!dots.current.has(key)) shown.delete(key)

      const holderKey = !hold && b?.holder ? dotKey(b.side, b.holder) : undefined
      const holder = holderKey ? shown.get(holderKey) : undefined
      if (ringRef.current) {
        if (holder) {
          const [sx, sy] = map(holder.x, holder.y)
          put(ringRef.current, 'cx', sx.toFixed(2))
          put(ringRef.current, 'cy', sy.toFixed(2))
          put(ringRef.current, 'opacity', '0.8')
        } else put(ringRef.current, 'opacity', '0')
      }
      // The man on the ball's name under his dot, and the picked-out man's ring and name
      tag = paintTag(tagRef.current, tagTextRef.current, tagBgRef.current, holder && holderKey !== markKey ? map(holder.x, holder.y) : null, holderKey ? names.get(holderKey) ?? '' : '', tag)
      const marked = markKey ? shown.get(markKey) : undefined
      const mxy = marked ? map(marked.x, marked.y) : null
      if (markRef.current) {
        if (mxy) {
          put(markRef.current, 'cx', mxy[0].toFixed(2))
          put(markRef.current, 'cy', mxy[1].toFixed(2))
          put(markRef.current, 'opacity', '1')
        } else put(markRef.current, 'opacity', '0')
      }
      markTag = paintTag(markTagRef.current, markTextRef.current, markBgRef.current, mxy, markKey ? names.get(markKey) ?? '' : '', markTag)
      if (celebRef.current) {
        const sc = scorerId ? shown.get(scorerId) : undefined
        if (sc && env > 0 && hold) {
          const [sx, sy] = map(sc.x, sc.y)
          const beat = ((elapsed - GOAL_FLIGHT_MS) / 420) % 1
          put(celebRef.current, 'cx', sx.toFixed(2))
          put(celebRef.current, 'cy', sy.toFixed(2))
          put(celebRef.current, 'r', (3.2 + beat * 3.2).toFixed(2))
          put(celebRef.current, 'stroke', colourOf[hold.side])
          put(celebRef.current, 'opacity', (env * (1 - beat) * (hold.tone === 'theirs' ? 0.55 : 0.95)).toFixed(2))
        } else put(celebRef.current, 'opacity', '0')
      }
      // The build-up to a big chance or a goal: the goal mouth under attack brightens and a ring closes on the shooter (not in a goal's hold or its replay, nor on a slow device)
      const pace = s.speed * (s.boost ?? 1)
      const perMinute = s.period / Math.max(0.01, pace)
      const bu = hold || rf || lite ? null : buildUpAt(chances, T, BUILD_UP.leadMs / perMinute, BUILD_UP.tailMs / perMinute)
      const attackRight = bu?.moment.side === 'home'
      if (glows.current.right) put(glows.current.right, 'opacity', bu && attackRight ? (BUILD_UP.glow * bu.w).toFixed(3) : '0')
      if (glows.current.left) put(glows.current.left, 'opacity', bu && !attackRight ? (BUILD_UP.glow * bu.w).toFixed(3) : '0')
      const shooterKey = bu?.moment.shooter ? dotKey(bu.moment.side, bu.moment.shooter) : undefined
      const shooterAt = shooterKey ? shown.get(shooterKey) : undefined
      if (spotRef.current) {
        if (bu && shooterAt) {
          const ring = shooterRing(bu.w)
          const [sx, sy] = map(shooterAt.x, shooterAt.y)
          put(spotRef.current, 'transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${ring.scale.toFixed(3)})`)
          put(spotRef.current, 'opacity', ring.opacity.toFixed(2))
        } else put(spotRef.current, 'opacity', '0')
      }
      // The shooter drawn again on top of everyone, so the men closing him down never hide him as he strikes it (and the scorer through his goal's hold)
      const liftKey = bu && shooterAt ? shooterKey : hold ? scorerId : undefined
      if (liftRef.current) {
        if (liftKey && shown.has(liftKey)) {
          put(liftRef.current, 'href', `#${dotDomId(uid, liftKey)}`)
          put(liftRef.current, 'opacity', '1')
        } else put(liftRef.current, 'opacity', '0')
      }
      // The shot's line, coloured by its expected goals: a chance or a save as it flies and a moment after, a goal while it goes in
      paintShot(shotRef.current, path, b, T, marks, flying, cur, map)
      // The pass line: a short flash of where the ball is being played (up to 2x, where a pass lasts long enough to read; not on a slow device),
      // and at any speed for the last ball to the man about to shoot
      const finalBall = !!shooterKey && !!b?.next?.holder && b.next.holder === bu?.moment.shooter && b.next.side === bu?.moment.side
      paintPass(passRef.current, lite || !!hold || (pace > 2 && !finalBall) ? null : passFlash(path, b), map)
      // A faint trail behind a long ball, a ball in behind or a cross while it flies
      if (trailRef.current) {
        const kf = b && !hold ? path[b.index] : undefined
        const nx = b?.next
        if (kf && nx && nx.play && TRAILED.has(nx.play) && b!.progress < 1) {
          const [x1, y1] = map(kf.x, kf.y)
          put(trailRef.current, 'x1', x1.toFixed(2))
          put(trailRef.current, 'y1', y1.toFixed(2))
          put(trailRef.current, 'x2', bx.toFixed(2))
          put(trailRef.current, 'y2', by.toFixed(2))
          put(trailRef.current, 'opacity', (0.5 * (1 - b!.progress * 0.5)).toFixed(2))
        } else put(trailRef.current, 'opacity', '0')
      }
      // The caption: what the side on the ball is doing, written only when it changes (a replay names itself instead)
      if (captionRef.current) {
        const c = hold || rf ? null : phaseCaption(path, b, scene)
        // A corner on its way in says where it is going
        const where = c && c.text === 'Corner' ? cornerDelivery(path, b) : null
        const text = c ? `${codes[c.side]} · ${c.text}${where ? ` · ${where}` : ''}` : ''
        if (text !== caption) {
          caption = text
          captionRef.current.textContent = text
          captionRef.current.dataset.side = c?.side ?? ''
          captionRef.current.style.setProperty('--caption-kit', c ? colourOf[c.side] : 'transparent')
          captionRef.current.classList.toggle('on', !!c)
        }
      }
      if (replayRef.current) {
        const on = !!rf
        if (replayRef.current.classList.contains('on') !== on) replayRef.current.classList.toggle('on', on)
      }
      // The net bulges (in the replay too), the screen flashes and, for a goal worth shouting about, shakes
      const since = hold ? elapsed - GOAL_FLIGHT_MS : -1
      const replayLanded = rf && rf.landed >= 0 ? rf.landed : -1
      const bulge = hold && since >= 0 ? netBulge(since, hold.tone === 'theirs' ? 0.45 : 0.75) : rf && replayLanded >= 0 ? netBulge(replayLanded, 0.6) : 0
      const netSide = holdAny?.side
      const rightEnd = netSide === 'home'
      if (nets.current.right) put(nets.current.right, 'transform', netSide && rightEnd && bulge ? `translate(105 34) scale(${(1 + bulge).toFixed(3)} ${(1 + bulge * 0.15).toFixed(3)}) translate(-105 -34)` : '')
      if (nets.current.left) put(nets.current.left, 'transform', netSide && !rightEnd && bulge ? `translate(0 34) scale(${(1 + bulge).toFixed(3)} ${(1 + bulge * 0.15).toFixed(3)}) translate(0 -34)` : '')
      if (flashRef.current) put(flashRef.current, 'opacity', hold && since >= 0 ? (Math.exp(-since / 170) * (hold.tone === 'theirs' ? 0.16 : 0.42)).toFixed(3) : '0')
      if (stageRef.current) {
        const shake = hold && hold.tone !== 'theirs' && since >= 0 && since < 380 ? 0.7 * (1 - since / 380) : 0
        put(stageRef.current, 'transform', shake ? `translate(${(Math.sin(since / 17) * shake).toFixed(2)} ${(Math.cos(since / 23) * shake).toFixed(2)})` : '')
      }
      // The cut to and from a replay: a quick dip to dark
      if (cutRef.current) {
        const out = leftReplay > 0 && now - leftReplay < REPLAY.cut ? 1 - (now - leftReplay) / REPLAY.cut : 0
        put(cutRef.current, 'opacity', (rf ? rf.cut : out).toFixed(3))
      }
      // The camera: leaning in on a big chance or a goal, closer still in the replay, otherwise the whole pitch
      if (cameraRef.current) {
        const want = cameraWant(keyMoments && !lite, rf, moments, T, s, cur, holdAny, box, map)
        aimCamera(cam, want, dt, snapAll || (!!rf && rf.cut > 0.85))
        const ct = cameraTransform(cam, cam.s, box)
        put(cameraRef.current, 'transform', ct.s === 1 ? '' : `translate(${ct.tx.toFixed(2)} ${ct.ty.toFixed(2)}) scale(${ct.s.toFixed(4)})`)
      }
    }
    const wake = () => {
      if (id) return
      // Waking from a sleep: the first frame back takes no time step, so nothing leaps by the time it slept
      ball.last = 0
      wakeCap(cap)
      id = requestAnimationFrame(frame)
    }
    wake()
    const unsubscribe = useLiveClock.subscribe(wake)
    return () => {
      unsubscribe()
      cancelAnimationFrame(id)
    }
  }, [path, reduced, to, map, placed, phases, events, colourOf, codes, portrait, R, seed, initial, from, keyMoments, marks, moments, chances, names, markKey, uid])

  const homeOn = onPitchAt(homePlaced, minute)
  const awayOn = onPitchAt(awayPlaced, minute)
  const booked = useMemo(() => new Set(events.filter((e) => e.type === 'yellow' && e.minute <= minute && e.playerId).map((e) => dotKey(e.side, e.playerId!))), [events, minute])
  const flashes = events.filter((e) => (e.type === 'red' || e.type === 'yellow' || e.type === 'injury' || e.type === 'substitution') && e.minute <= minute && (minute < e.minute + 3 || minute >= to) && e.minute > minute - 6 && e.playerId)
  // Reduced motion: once a minute, the ball on its last keyframe and everyone where the shape has them then
  const stillT = Math.min(to, minute) + 0.99
  const stillBall = reduced ? ballAt(path, stillT, true) : null
  const stillScene = reduced ? sceneAt(path, stillBall, stillT) : null
  const stillCaption = stillScene ? phaseCaption(path, stillBall, stillScene) : null
  const hidden = useMemo(() => new Set(holds.slice(revealed).map((h) => +h.key)), [holds, revealed])
  const scoreNow = events.filter((e, i) => GOAL_TYPES.has(e.type) && e.minute <= minute && !hidden.has(i))
  const burst = celebrating >= 0 ? holds[celebrating] : undefined
  const skipReplay = useCallback(() => {
    const st = useLiveClock.getState()
    const next = skipHold(st, performance.now())
    if (next) useLiveClock.setState(next)
  }, [])

  const dot = (p: PlacedPlayer, kit: string) => {
    const name = getPlayer(p.psId)?.name
    const key = dotKey(p.side, p.psId)
    const colour = keepers && p.position === 'GK' ? keepers[p.side] : kit
    const label = labels?.[p.psId]
    // Drawn first where he stood when this match's pitch was last drawn, or walking on, or at his slot; the loop moves him from there
    const startAt = reduced && stillScene ? dotPosition(p, path, stillBall, stillT, phases.get(key) ?? 0, stillScene) : initial.get(key) ?? (initial.size || p.onAt > Math.max(0, from) ? ENTRY_POINT : p)
    const [sx, sy] = map(startAt.x, startAt.y)
    return (
      <g key={key} id={dotDomId(uid, key)} ref={dotRef(key)} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`} className={`live-dot ${key === markKey ? 'marked' : ''}`} data-testid="live-dot">
        <title>{name ?? p.psId}</title>
        <g className="dot-body">
          <circle r="2.7" fill={colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
          <text y="0.85" textAnchor="middle" fontSize={label !== undefined ? 2.5 : 2.3} fontWeight="700" fill={textColourFor(colour)}>
            {label !== undefined ? String(label) : initials(name)}
          </text>
          {booked.has(key) && <rect className="dot-card" x="1.7" y="-3.9" width="1.5" height="2.1" rx="0.2" fill="var(--gold)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.2" />}
        </g>
      </g>
    )
  }
  // Reduced motion: the picked-out man's ring where he stands
  const stillMarkAt = reduced && markKey && stillScene && placed.get(markKey) ? dotPosition(placed.get(markKey)!, path, stillBall, stillT, phases.get(markKey) ?? 0, stillScene) : null
  const stillMark = stillMarkAt ? map(stillMarkAt.x, stillMarkAt.y) : null

  return (
    <div className="live-pitch" data-testid="live-pitch" data-minute={minute} data-score={`${scoreNow.filter((e) => e.side === 'home').length}-${scoreNow.filter((e) => e.side === 'away').length}`}>
      <div className="pitch-svg-box">
      <PitchSvg
        portrait={portrait}
        label={`${home.name} against ${away.name}, minute ${minute}`}
        camera={cameraRef}
        overlay={!reduced && <rect ref={cutRef} className="pitch-cut" x="-3" y="-3" width={portrait ? 74 : 111} height={portrait ? 111 : 74} opacity="0" pointerEvents="none" />}
      >
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
          {/* The goal mouth's glow: brightest on the goal line, gone by the edge of the box */}
          <radialGradient id={`${uid}-mouth-l`} cx="0%" cy="50%" r="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-mouth-r`} cx="100%" cy="50%" r="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-clip`}>
            <circle r={R * 0.97} />
          </clipPath>
        </defs>
        <g ref={stageRef}>
          <g transform={portrait ? 'translate(0 105) rotate(-90)' : undefined}>
            <MouthGlow right={false} fill={`url(#${uid}-mouth-l)`} innerRef={setLeftGlow} />
            <MouthGlow right fill={`url(#${uid}-mouth-r)`} innerRef={setRightGlow} />
            <Net right={false} innerRef={setLeftNet} />
            <Net right innerRef={setRightNet} />
          </g>
          <line ref={passRef} className="pass-flash" stroke="#fff" strokeWidth="0.32" strokeLinecap="round" opacity="0" />
          <line ref={shotRef} className="shot-trail" data-band="low" stroke="#fff" strokeWidth="0.55" strokeLinecap="round" opacity="0" />
          <line ref={trailRef} className="ball-trail" stroke="#fff" strokeWidth="0.35" strokeLinecap="round" strokeDasharray="0.6 0.9" opacity="0" />
          <circle ref={ringRef} r="3.7" fill="none" stroke="#fff" strokeWidth="0.45" opacity="0" />
          <circle ref={celebRef} r="3.5" fill="none" stroke="#fff" strokeWidth="0.7" opacity="0" />
          <g ref={spotRef} className="shooter-ring" opacity="0" pointerEvents="none">
            <circle r="4.2" fill="none" stroke="#fff" strokeWidth="0.45" strokeDasharray="1.6 1.1" />
          </g>
          {markKey && (reduced ? stillMark && <circle className="pitch-mark" cx={stillMark[0]} cy={stillMark[1]} r="4.3" fill="none" strokeWidth="0.6" data-testid="pitch-mark" /> : <circle ref={markRef} className="pitch-mark" r="4.3" fill="none" strokeWidth="0.6" opacity="0" data-testid="pitch-mark" />)}
          <g>{homeOn.map((p) => dot(p, home.colour))}</g>
          <g>{awayOn.map((p) => dot(p, away.colour))}</g>
          {!reduced && <use ref={liftRef} opacity="0" pointerEvents="none" aria-hidden="true" />}
          {!reduced && <NameTag groupRef={tagRef} textRef={tagTextRef} bgRef={tagBgRef} className="dot-tag" testId="dot-tag" />}
          {!reduced && markKey && <NameTag groupRef={markTagRef} textRef={markTextRef} bgRef={markBgRef} className="dot-tag marked" testId="mark-tag" />}
          {flashes.map((e, i) => {
            const p = placed.get(dotKey(e.side, e.playerId!))
            if (!p) return null
            const [sx, sy] = map(p.x, p.y)
            return (
              <g key={`${e.type}-${e.minute}-${i}`} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`}>
                <g className={`live-flash ${e.type}`}>
                  {e.type === 'yellow' && <rect x="-1.4" y="-6.8" width="2.8" height="3.8" rx="0.3" fill="var(--gold)" stroke="#fff" strokeWidth="0.3" />}
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
      {reduced ? (
        <div className={`pitch-caption ${stillCaption ? 'on' : ''}`} data-testid="pitch-caption" aria-hidden="true" style={{ '--caption-kit': stillCaption ? colourOf[stillCaption.side] : 'transparent' } as CSSProperties}>
          {stillCaption ? `${codes[stillCaption.side]} · ${stillCaption.text}` : ''}
        </div>
      ) : (
        <div ref={captionRef} className="pitch-caption" data-testid="pitch-caption" aria-hidden="true" />
      )}
      {!reduced && keyMoments && <ReplayBadge innerRef={replayRef} onSkip={skipReplay} />}
      </div>
      {burst && <GoalBurst key={`${burst.key}-${celebrating}`} hold={burst} events={events} home={home} away={away} reduced={reduced} />}
      {overlay}
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

/** The replay's badge over the pitch, with a button to skip it. The loop shows it (class `on`) while a replay plays. */
function ReplayBadge({ innerRef, onSkip }: { innerRef: Ref<HTMLDivElement>; onSkip: () => void }) {
  return (
    <div ref={innerRef} className="pitch-replay" data-testid="pitch-replay">
      <span className="pitch-replay-label">Replay</span>
      <button type="button" className="pitch-replay-skip" onClick={onSkip} data-testid="replay-skip">
        Skip
      </button>
    </div>
  )
}

/** Draw the football at (bx, by) on the grass, `h` high: the ball lifts off and grows, its shadow stays on the grass, shrinks and fades (flight.ts `ballSprite`). */
function paintBall(ballEl: SVGGElement | null, body: SVGGElement | null, shadow: SVGGElement | null, bx: number, by: number, h: number, opacity: number, R: number): void {
  const sp = ballSprite(h, R)
  if (ballEl) {
    put(ballEl, 'transform', `translate(${bx.toFixed(2)} ${by.toFixed(2)})`)
    put(ballEl, 'opacity', opacity.toFixed(2))
  }
  if (body) put(body, 'transform', h > 0.005 ? `translate(0 ${sp.lift.toFixed(2)}) scale(${sp.scale.toFixed(3)})` : '')
  if (shadow) {
    put(shadow, 'transform', `translate(${(bx + sp.shadowDx).toFixed(2)} ${(by + sp.shadowDy).toFixed(2)}) scale(${sp.shadowScale.toFixed(3)})`)
    put(shadow, 'opacity', (opacity * sp.shadowOpacity).toFixed(2))
  }
}

/** Move a name tag under a dot at (x, y) SVG units, or hide it; returns the name now written. */
function paintTag(g: SVGGElement | null, text: SVGTextElement | null, bg: SVGRectElement | null, xy: [number, number] | null, name: string, prev: string): string {
  if (!g) return prev
  if (!xy || !name) {
    put(g, 'opacity', '0')
    return prev
  }
  const out = writeTag(text, bg, name, prev)
  put(g, 'transform', `translate(${xy[0].toFixed(2)} ${(xy[1] + 4.6).toFixed(2)})`)
  put(g, 'opacity', '0.92')
  return out
}

/** The pass line from where it was played to where it is going, fading as the ball travels. */
function paintPass(line: SVGLineElement | null, pf: ReturnType<typeof passFlash>, map: (x: number, y: number) => [number, number]): void {
  if (!line) return
  if (!pf) {
    put(line, 'opacity', '0')
    return
  }
  const [x1, y1] = map(pf.from.x, pf.from.y)
  const [x2, y2] = map(pf.to.x, pf.to.y)
  put(line, 'x1', x1.toFixed(2))
  put(line, 'y1', y1.toFixed(2))
  put(line, 'x2', x2.toFixed(2))
  put(line, 'y2', y2.toFixed(2))
  put(line, 'stroke-dasharray', pf.air ? '1.3 0.9' : 'none')
  put(line, 'opacity', pf.alpha.toFixed(2))
}

/** The shot's line, coloured by its xG band: from the strike to the ball while it flies, then to where it ended, fading; a goal's while it goes in. */
function paintShot(line: SVGLineElement | null, path: BallKeyframe[], b: BallState | null, T: number, marks: Map<number, ShotMark>, flying: { at: P; band: ReturnType<typeof xgBand>; f: number } | null, ballNow: P, map: (x: number, y: number) => [number, number]): void {
  if (!line) return
  let from: P | null = null
  let to: P | null = null
  let band: ReturnType<typeof xgBand> = 'low'
  let alpha = 0
  if (flying && b) {
    let si = b.index
    while (si > 0 && path[si].kind !== 'shot' && b.index - si < 3) si--
    from = path[si]
    to = flying.at
    band = flying.band
    alpha = 0.9
  } else {
    const st = shotTrailAt(path, b, T)
    if (st && b) {
      from = path[st.index]
      to = b.index === st.index ? ballNow : path[st.index + 1]
      band = marks.get(st.index)?.band ?? 'low'
      alpha = st.alpha
    }
  }
  if (!from || !to || alpha <= 0.01) {
    put(line, 'opacity', '0')
    return
  }
  const [x1, y1] = map(from.x, from.y)
  const [x2, y2] = map(to.x, to.y)
  put(line, 'x1', x1.toFixed(2))
  put(line, 'y1', y1.toFixed(2))
  put(line, 'x2', x2.toFixed(2))
  put(line, 'y2', y2.toFixed(2))
  if (line.dataset.band !== band) line.dataset.band = band
  put(line, 'opacity', alpha.toFixed(2))
}

/** Where the camera wants to be (SVG units and scale): in on the replay, leaning in on a big chance or a goal, otherwise the whole pitch. */
function cameraWant(on: boolean, rf: ReplayFrame | null, moments: FocusMoment[], T: number, s: { period: number; speed: number; boost?: number }, ball: P, hold: GoalHold | undefined, box: ViewBox, map: (x: number, y: number) => [number, number]): Camera {
  const whole: Camera = { x: box.x + box.w / 2, y: box.y + box.h / 2, s: 1 }
  if (!on) return whole
  if (rf && hold) {
    // The replay: close on the ball, drawn a little towards the goal it is going into
    const gx = hold.side === 'home' ? 100 : 0
    const [x, y] = map(ball.x * 0.75 + gx * 0.25, ball.y * 0.8 + 50 * 0.2)
    return { x, y, s: CAMERA.replay }
  }
  // In play the camera leans in up to 2x; quicker, a moment is over before a move would read (and the whole pitch would repaint every frame)
  const pace = s.speed * (s.boost ?? 1)
  if (pace > 2) return whole
  const perMinute = s.period / Math.max(0.01, pace)
  const f = focusAt(moments, T, CAMERA.leadMs / perMinute, CAMERA.tailMs / perMinute)
  if (!f.at || f.w <= 0) return whole
  // 2x leans in a little less than 1x, so the picture does not lurch
  const k = pace > 1 ? 0.75 : 1
  const [x, y] = map(f.at.x * 0.55 + ball.x * 0.45, f.at.y * 0.55 + ball.y * 0.45)
  return { x, y, s: 1 + (CAMERA.chance - 1) * f.w * k }
}

/** The "GOAL!" banner over the pitch, in the scoring club's colours, with confetti for a goal of ours. Rendered once per goal; CSS does the rest. */
function GoalBurst({ hold, events, home, away, reduced }: { hold: { key: string; side: Side; tone: 'ours' | 'theirs' | 'neutral'; ms: number; replay?: number }; events: MatchEvent[]; home: PitchSide; away: PitchSide; reduced: boolean }) {
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
  const style = { '--burst': colour, '--burst-ink': ink, '--burst-ms': `${celebrationMs(hold)}ms`, '--flight': `${reduced ? 0 : GOAL_FLIGHT_MS}ms` } as CSSProperties
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
