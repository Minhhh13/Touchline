/**
 * The live pitch: both XIs by formation slot and instructions, a ball that
 * follows the ticker's clock through possession phases, shots, saves and goals,
 * and markers for cards, injuries and substitutions. Everything that moves is
 * an SVG transform set from a requestAnimationFrame loop, so React renders only
 * when the minute changes. With prefers-reduced-motion the loop is off: the
 * dots stand still and the ball jumps from keyframe to keyframe.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Appearance } from '@engine/match'
import type { MatchEvent, PlayerSeason, Tactics } from '@engine/types'
import { fractionalClock, useLiveClock } from '../match/clockStore'
import { initials, onPitchAt, placeSide, separateSides, type PlacedPlayer } from '../match/pitchGeometry'
import { dotPosition, swayPhase } from '../match/movement'
import { ballAt, buildBallPath, type BallKeyframe } from '../match/possession'
import { textColourFor } from '../format'

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
export function PitchMarkings({ portrait = false }: { portrait?: boolean }) {
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
}

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

export function LivePitch({ home, away, events, momentum, from, to, seed, getPlayer }: LivePitchProps) {
  const portrait = useMediaQuery('(max-width: 720px)')
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const clock = useLiveClock((s) => s.clock)
  const minute = Math.min(clock, to)
  const { home: homePlaced, away: awayPlaced } = useMemo(() => separateSides(placeSide(home.appearances, home.tactics, 'home'), placeSide(away.appearances, away.tactics, 'away')), [home.appearances, home.tactics, away.appearances, away.tactics])
  const path = useMemo(() => buildBallPath({ from, to, momentum, events, home: homePlaced, away: awayPlaced, seed }), [from, to, momentum, events, homePlaced, awayPlaced, seed])
  const map = useMemo(() => pitchMapper(portrait), [portrait])

  const ballRef = useRef<SVGGElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const shotRef = useRef<SVGLineElement>(null)
  const rippleRef = useRef<SVGCircleElement>(null)
  const dots = useRef(new Map<string, SVGGElement>())
  const placed = useMemo(() => new Map<string, PlacedPlayer>([...homePlaced, ...awayPlaced].map((p) => [p.psId, p])), [homePlaced, awayPlaced])
  // A fixed sway phase per man, from his id, so the picture is the same on every replay
  const phases = useMemo(() => new Map([...placed.keys()].map((id) => [id, swayPhase(id)])), [placed])

  const shownRef = useRef(new Map<string, { x: number; y: number }>())
  // The animation: one frame reads the shared clock, interpolates the ball and sets transforms.
  // It runs only while the clock does: paused, or stood at a stop, the last frame stays on
  // screen and the loop sleeps until the clock store changes again.
  useEffect(() => {
    if (reduced) return
    const shown = shownRef.current
    let id = 0
    let lastT = Number.NaN
    let lastDots = -1
    const frame = () => {
      id = 0
      const s = useLiveClock.getState()
      if (s.running) id = requestAnimationFrame(frame)
      const stopped = !s.running && s.clock >= to
      const T = stopped ? to + 0.99 : Math.min(to + 0.99, fractionalClock(s, performance.now()))
      // Nothing has moved since the last frame (a dot mounting for a substitute counts as a move)
      if (T === lastT && dots.current.size === lastDots) return
      lastT = T
      lastDots = dots.current.size
      const b = ballAt(path, T)
      const at = (x: number, y: number) => {
        const [sx, sy] = map(x, y)
        return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`
      }
      if (ballRef.current) {
        ballRef.current.setAttribute('transform', b ? at(b.x, b.y) : at(50, 50))
        ballRef.current.setAttribute('opacity', b ? '1' : '0')
      }
      const i = b?.index ?? -1
      let shotKf: BallKeyframe | null = null
      for (let k = i; k >= 0 && k >= i - 2; k--) {
        const kf = path[k]
        if (kf.kind === 'shot' && k < path.length - 1 && T - kf.t < 0.6) shotKf = kf
      }
      shown.clear()
      // Everyone by the one movement formula the heat maps sample (movement.ts)
      for (const [psId, el] of dots.current) {
        const p = placed.get(psId)
        if (!p) continue
        const { x, y } = dotPosition(p, path, b, T, phases.get(psId) ?? 0)
        el.setAttribute('transform', at(x, y))
        shown.set(psId, { x, y })
      }
      if (ringRef.current) {
        const holder = b?.holder ? shown.get(b.holder) : undefined
        if (holder) {
          const [sx, sy] = map(holder.x, holder.y)
          ringRef.current.setAttribute('cx', sx.toFixed(2))
          ringRef.current.setAttribute('cy', sy.toFixed(2))
          ringRef.current.setAttribute('opacity', '0.85')
        } else ringRef.current.setAttribute('opacity', '0')
      }
      if (shotRef.current) {
        if (shotKf) {
          const target = path[path.indexOf(shotKf) + 1]
          const [x1, y1] = map(shotKf.x, shotKf.y)
          const [x2, y2] = map(target.x, target.y)
          shotRef.current.setAttribute('x1', x1.toFixed(2))
          shotRef.current.setAttribute('y1', y1.toFixed(2))
          shotRef.current.setAttribute('x2', x2.toFixed(2))
          shotRef.current.setAttribute('y2', y2.toFixed(2))
          shotRef.current.setAttribute('opacity', String(Math.max(0, 1 - (T - shotKf.t) / 0.6)))
        } else shotRef.current.setAttribute('opacity', '0')
      }
      if (rippleRef.current) {
        let goal: BallKeyframe | null = null
        for (let k = i; k >= 0 && k >= i - 3; k--) if (path[k].kind === 'goal' && T - path[k].t < 1.2) goal = path[k]
        if (goal) {
          const f = (T - goal.t) / 1.2
          const [cx, cy] = map(goal.x, goal.y)
          rippleRef.current.setAttribute('cx', cx.toFixed(2))
          rippleRef.current.setAttribute('cy', cy.toFixed(2))
          rippleRef.current.setAttribute('r', (2 + 9 * f).toFixed(2))
          rippleRef.current.setAttribute('opacity', String(0.9 * (1 - f)))
        } else rippleRef.current.setAttribute('opacity', '0')
      }
    }
    const wake = () => {
      if (!id) id = requestAnimationFrame(frame)
    }
    wake()
    const unsubscribe = useLiveClock.subscribe(wake)
    return () => {
      unsubscribe()
      cancelAnimationFrame(id)
    }
  }, [path, reduced, to, map, placed, phases])

  const homeOn = onPitchAt(homePlaced, minute)
  const awayOn = onPitchAt(awayPlaced, minute)
  const booked = useMemo(() => new Set(events.filter((e) => e.type === 'yellow' && e.minute <= minute).map((e) => e.playerId)), [events, minute])
  const flashes = events.filter((e) => (e.type === 'red' || e.type === 'injury' || e.type === 'substitution') && e.minute <= minute && (minute < e.minute + 3 || minute >= to) && e.minute > minute - 6 && e.playerId)
  const stillBall = reduced ? ballAt(path, Math.min(to, minute) + 0.99, true) : null
  const scoreNow = events.filter((e) => GOAL_TYPES.has(e.type) && e.minute <= minute)

  const dot = (p: PlacedPlayer, colour: string) => {
    const name = getPlayer(p.psId)?.name
    const [sx, sy] = map(p.x, p.y)
    return (
      <g key={p.psId} ref={(el) => { if (el) dots.current.set(p.psId, el); else dots.current.delete(p.psId) }} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`} className="live-dot" data-testid="live-dot">
        <title>{name ?? p.psId}</title>
        <circle r="2.7" fill={colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
        <text y="0.85" textAnchor="middle" fontSize="2.3" fontWeight="700" fill={textColourFor(colour)}>
          {initials(name)}
        </text>
        {booked.has(p.psId) && <rect x="1.7" y="-3.9" width="1.5" height="2.1" rx="0.2" fill="var(--gold)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.2" />}
      </g>
    )
  }

  return (
    <div className="live-pitch" data-testid="live-pitch" data-minute={minute} data-score={`${scoreNow.filter((e) => e.side === 'home').length}-${scoreNow.filter((e) => e.side === 'away').length}`}>
      <PitchSvg portrait={portrait} label={`${home.name} against ${away.name}, minute ${minute}`}>
        <line ref={shotRef} stroke="#fff" strokeWidth="0.6" strokeLinecap="round" opacity="0" />
        <circle ref={rippleRef} fill="none" stroke="#fff" strokeWidth="0.7" opacity="0" />
        <circle ref={ringRef} r="3.7" fill="none" stroke="#fff" strokeWidth="0.5" opacity="0" />
        <g>{homeOn.map((p) => dot(p, home.colour))}</g>
        <g>{awayOn.map((p) => dot(p, away.colour))}</g>
        {flashes.map((e, i) => {
          const p = placed.get(e.playerId!)
          if (!p) return null
          const [sx, sy] = map(p.x, p.y)
          return (
            <g key={`${e.type}-${e.minute}-${i}`} transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`} className="live-flash">
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
          )
        })}
        {reduced ? (
          stillBall && (
            <g transform={(() => { const [sx, sy] = map(stillBall.x, stillBall.y); return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})` })()} data-testid="live-ball">
              <circle r="1.3" fill="#fff" stroke="#111" strokeWidth="0.3" />
            </g>
          )
        ) : (
          <g ref={ballRef} data-testid="live-ball" opacity="0">
            <circle r="1.3" fill="#fff" stroke="#111" strokeWidth="0.3" />
          </g>
        )}
      </PitchSvg>
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
