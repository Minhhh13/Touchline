import { useId, type ReactNode } from 'react'
import type { SeasonTier } from '@engine/types'

/*
 * TouchLine's own illustrations, drawn inline (no downloaded art): a neon flow of cyan-to-magenta curves, and
 * cartoon scenes in bold rounded shapes with slightly sketchy outlines. Every colour comes from the art tokens in
 * styles.css (--art-*, --cyan, --magenta, --neon-*), so Daylight gets a softer version for free. The art is
 * decoration (aria-hidden). No stars, no star patterns, no crests, no players: see docs/DESIGN_SYSTEM.md, section 7.
 */

/** useId is unique per instance; keep it to characters that are safe inside url(#…). */
function useArtId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

interface Defs {
  neon: string
  glow: string
  sketch: string
}

/** The gradients and filters every scene shares: the neon stroke, its glow, the hand-drawn wobble on outlines. */
function SharedDefs({ id, blur, wobble }: { id: Defs; blur: number; wobble: number }) {
  return (
    <>
      <linearGradient id={id.neon} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--cyan)' }} />
        <stop offset="0.55" style={{ stopColor: 'color-mix(in srgb, var(--cyan) 45%, var(--magenta))' }} />
        <stop offset="1" style={{ stopColor: 'var(--magenta)' }} />
      </linearGradient>
      <filter id={id.glow} x="-20%" y="-60%" width="140%" height="220%">
        <feGaussianBlur stdDeviation={blur} />
      </filter>
      <filter id={id.sketch} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={7} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={wobble} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </>
  )
}

function useDefs(prefix: string): Defs {
  const base = useArtId(prefix)
  return { neon: `${base}-neon`, glow: `${base}-glow`, sketch: `${base}-sketch` }
}

/** One neon curve: a blurred halo, the gradient core and a pale highlight; `run` adds a travelling light on the hero. */
function Neon({ d, id, w, run }: { d: string; id: Defs; w: number; run?: number }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path className="neon-halo" d={d} stroke={`url(#${id.neon})`} strokeWidth={w * 4} filter={`url(#${id.glow})`} />
      <path d={d} stroke={`url(#${id.neon})`} strokeWidth={w} />
      <path className="neon-core" d={d} stroke="var(--art-light)" strokeWidth={w * 0.32} />
      {run !== undefined && <path className="neon-run" d={d} stroke="var(--art-light)" strokeWidth={w * 0.9} pathLength={100} style={{ animationDelay: `${run}s` }} />}
    </g>
  )
}

/** Just the flowing curves, for a strip or a corner: the Draft reel window and the mode cards' accents. */
export function NeonFlow({ className = '' }: { className?: string }) {
  const id = useDefs('flow')
  return (
    <svg className={`art neon-flow ${className}`} viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <SharedDefs id={id} blur={3} wobble={0} />
      </defs>
      <Neon id={id} w={1.6} d="M-10 78 C 70 40, 140 96, 210 62 S 330 18, 410 44" />
      <Neon id={id} w={1.1} d="M-10 92 C 90 70, 170 104, 250 80 S 350 52, 410 66" />
    </svg>
  )
}

/** A scene: the sky, the neon behind, then the subject, all with the sketchy ink outline. */
/**
 * `split` draws the sky and the neon in one layer that fills its box (slice) and the subject in a second layer on top
 * that is always shown whole (meet): a mode card's picture squeezed into a short strip then keeps its calendar, board
 * or trophy entire instead of losing the top and bottom (the CSS sizes the two layers, `.mode-art`).
 */
function Scene({ prefix, viewBox, align, className, blur, wobble, children, flows, split }: { prefix: string; viewBox: string; align: string; className: string; blur: number; wobble: number; children: (id: Defs) => ReactNode; flows: (id: Defs) => ReactNode; split?: boolean }) {
  const id = useDefs(prefix)
  const sky = `${id.neon}-sky`
  const back = (
    <svg className={`art ${className}`} viewBox={viewBox} preserveAspectRatio={`${align} slice`} aria-hidden="true" focusable="false">
      <defs>
        <SharedDefs id={id} blur={blur} wobble={wobble} />
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--art-sky-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--art-sky-1)' }} />
        </linearGradient>
        <radialGradient id={`${id.neon}-hc`}>
          <stop offset="0" style={{ stopColor: 'var(--cyan)', stopOpacity: 0.75 }} />
          <stop offset="1" style={{ stopColor: 'var(--cyan)', stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={`${id.neon}-hm`}>
          <stop offset="0" style={{ stopColor: 'var(--magenta)', stopOpacity: 0.7 }} />
          <stop offset="1" style={{ stopColor: 'var(--magenta)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${id.neon}-beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--art-light)', stopOpacity: 0.34 }} />
          <stop offset="1" style={{ stopColor: 'var(--art-light)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" style={{ fill: `url(#${sky})` }} />
      {flows(id)}
      {!split && children(id)}
    </svg>
  )
  if (!split) return back
  return (
    <>
      {back}
      <svg className={`art ${className} scene-subject`} viewBox={viewBox} preserveAspectRatio={`${align} meet`} aria-hidden="true" focusable="false">
        {children(id)}
      </svg>
    </>
  )
}

const halo = (id: Defs, which: 'c' | 'm') => `url(#${id.neon}-h${which})`
const beam = (id: Defs) => `url(#${id.neon}-beam)`

/** A football: white with navy panels, drawn round a centre; `r` is its radius. No glint stroke: it crossed the top-left panel and read as a line through the ball. */
function Ball({ cx, cy, r, sw }: { cx: number; cy: number; r: number; sw: number }) {
  const p = (k: number, rr: number) => {
    const pts = Array.from({ length: 5 }, (_, i) => {
      const a = (-90 + i * 72 + k) * (Math.PI / 180)
      return `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`
    })
    return pts.join(' ')
  }
  const rim = [0, 72, 144, 216, 288].map((a) => {
    const t = (-90 + a) * (Math.PI / 180)
    return { x: cx + Math.cos(t + Math.PI / 5) * r * 0.8, y: cy + Math.sin(t + Math.PI / 5) * r * 0.8 }
  })
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className="a-light a-line" strokeWidth={sw} />
      <polygon points={p(0, r * 0.36)} className="a-ink" />
      {rim.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={r * 0.16} className="a-ink" />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="none" className="a-line" strokeWidth={sw} />
    </g>
  )
}

/** A floodlight: a pole and a head of lamps, its halo and its beam. */
function Floodlight({ x, top, foot, id, tone }: { x: number; top: number; foot: number; id: Defs; tone: 'c' | 'm' }) {
  return (
    <g>
      <circle cx={x} cy={top + 30} r={190} fill={halo(id, tone)} className="neon-halo" />
      <polygon points={`${x - 50},${top + 60} ${x + 50},${top + 60} ${x + 260},${foot + 120} ${x - 260},${foot + 120}`} fill={beam(id)} />
      <g filter={`url(#${id.sketch})`}>
        <path d={`M ${x - 9} ${top + 56} L ${x - 16} ${foot} L ${x + 16} ${foot} L ${x + 9} ${top + 56} Z`} className="a-body2 a-line" strokeWidth={6} />
        <path d={`M ${x - 12} ${top + 120} L ${x + 12} ${top + 170} M ${x + 12} ${top + 120} L ${x - 12} ${top + 170} M ${x - 14} ${top + 210} L ${x + 14} ${top + 260} M ${x + 14} ${top + 210} L ${x - 14} ${top + 260}`} className="a-line" strokeWidth={4} fill="none" />
        <rect x={x - 66} y={top} width={132} height={64} rx={16} className="a-body a-line" strokeWidth={7} />
        {[0, 1, 2, 3].map((i) =>
          [0, 1].map((j) => <circle key={`${i}${j}`} cx={x - 42 + i * 28} cy={top + 18 + j * 28} r={10} className="a-light" />),
        )}
      </g>
    </g>
  )
}

/** The Home hero: a floodlit ground at night, a ball flying into the net, neon flowing through the sky. */
export function HeroArt() {
  return (
    <Scene
      prefix="hero"
      viewBox="0 0 1600 700"
      align="xMaxYMid"
      className="hero-art"
      blur={9}
      wobble={3}
      flows={(id) => (
        <g>
          <Neon id={id} w={4} d="M -60 330 C 200 240, 470 420, 760 300 S 1260 120, 1700 210" run={0} />
          <Neon id={id} w={3} d="M -60 430 C 250 300, 520 520, 880 370 S 1380 210, 1700 300" />
          <Neon id={id} w={2.2} d="M -60 510 C 300 420, 620 600, 1000 450 S 1460 330, 1700 400" run={-3.5} />
        </g>
      )}
    >
      {(id) => (
        <g>
          <Floodlight x={720} top={178} foot={420} id={id} tone="c" />
          <Floodlight x={1470} top={150} foot={380} id={id} tone="m" />
          {/* Everything on the ground sits 70 units up, inside the band the hero's crop shows */}
          <g transform="translate(0 -70)">
          {/* The stand: a rounded bowl with its rows and a roof over the far end */}
          <g filter={`url(#${id.sketch})`}>
            <path d="M 560 560 C 640 470, 820 430, 1040 420 L 1720 400 L 1720 560 Z" className="a-body a-line" strokeWidth={8} strokeLinejoin="round" />
            <path d="M 640 520 C 760 470, 900 455, 1060 450 L 1720 432" fill="none" stroke="var(--art-body-2)" strokeWidth={12} strokeLinecap="round" />
            <path d="M 720 548 C 820 505, 950 492, 1090 488 L 1720 472" fill="none" stroke="var(--art-body-2)" strokeWidth={12} strokeLinecap="round" />
            <path d="M 1000 412 C 1150 360, 1400 340, 1720 330 L 1720 362 C 1420 372, 1180 392, 1010 432 Z" className="a-body2 a-line" strokeWidth={7} strokeLinejoin="round" />
          </g>
          {/* The pitch, in night teal, with its stripes and lines */}
          <rect x="-200" y="556" width="2000" height="300" style={{ fill: 'var(--art-grass)' }} />
          <path d="M -200 600 L 1800 600 L 1800 640 L -200 640 Z M -200 680 L 1800 680 L 1800 760 L -200 760 Z" style={{ fill: 'var(--art-grass-2)' }} />
          <g fill="none" stroke="var(--art-light)" strokeLinecap="round" opacity="0.75">
            <path d="M -200 566 L 1800 566" strokeWidth={5} />
            <path d="M 1150 566 L 1100 700 M 1600 566 L 1640 700" strokeWidth={4} />
            <path d="M 420 566 L 330 700" strokeWidth={4} />
            <path d="M 250 640 C 330 600, 500 600, 560 640" strokeWidth={4} />
          </g>
          {/* The goal and its net */}
          <g filter={`url(#${id.sketch})`}>
            <g stroke="var(--art-light)" strokeWidth={2.4} opacity="0.5" fill="none">
              {Array.from({ length: 11 }, (_, i) => (
                <path key={`v${i}`} d={`M ${1258 + i * 23} 458 L ${1268 + i * 21} 578`} />
              ))}
              {Array.from({ length: 6 }, (_, i) => (
                <path key={`h${i}`} d={`M 1256 ${474 + i * 20} L 1496 ${474 + i * 20}`} />
              ))}
            </g>
            <path d="M 1244 584 L 1244 452 Q 1244 440 1256 440 L 1498 440 Q 1510 440 1510 452 L 1510 584" fill="none" stroke="var(--art-ink)" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 1244 584 L 1244 452 Q 1244 440 1256 440 L 1498 440 Q 1510 440 1510 452 L 1510 584" fill="none" stroke="var(--art-light)" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
          </g>
          {/* The ball's flight: a neon trail from the kick to the net */}
          <Neon id={id} w={5} d="M 700 640 Q 930 330 1150 466" />
          <g filter={`url(#${id.sketch})`}>
            <Ball cx={1176} cy={480} r={36} sw={6} />
          </g>
          <g fill="none" stroke="var(--art-light)" strokeWidth={5} strokeLinecap="round" opacity="0.8">
            <path d="M 1112 430 q -26 4 -44 18" />
            <path d="M 1106 512 q -24 -2 -40 -16" />
          </g>
          </g>
        </g>
      )}
    </Scene>
  )
}

export type ModeArtKind = 'quick' | 'daily' | 'season' | 'dynasty'

/** The two low curves behind every mode card's subject, so the four read as one set. */
function CardFlows({ id }: { id: Defs }) {
  return (
    <g>
      <Neon id={id} w={1.8} d="M -20 150 C 70 110, 140 175, 220 140 S 340 90, 420 112" />
      <Neon id={id} w={1.1} d="M -20 172 C 90 150, 170 196, 260 168 S 360 136, 420 146" />
    </g>
  )
}

/** A club card from the reel: a generic two-colour kit pattern on a rounded card, never a real crest. */
function ClubCard({ x, y, w, h, rot, a, b, pattern, glow, id }: { x: number; y: number; w: number; h: number; rot: number; a: string; b: string; pattern: 'halves' | 'stripes' | 'sash'; glow?: boolean; id: Defs }) {
  const clip = `${id.neon}-card-${pattern}`
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      {glow && <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={16} fill="none" stroke={`url(#${id.neon})`} strokeWidth={8} filter={`url(#${id.glow})`} className="neon-halo" />}
      <clipPath id={clip}>
        <rect x={x} y={y} width={w} height={h} rx={11} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={w} height={h} fill={a} />
        {pattern === 'halves' && <rect x={x + w / 2} y={y} width={w / 2} height={h} fill={b} />}
        {pattern === 'stripes' && [0.2, 0.5, 0.8].map((f) => <rect key={f} x={x + w * f - w * 0.08} y={y} width={w * 0.16} height={h} fill={b} />)}
        {pattern === 'sash' && <path d={`M ${x - 10} ${y + h * 0.15} L ${x + w * 0.4} ${y - 10} L ${x + w + 10} ${y + h * 0.85} L ${x + w * 0.6} ${y + h + 10} Z`} fill={b} />}
      </g>
      <rect x={x} y={y} width={w} height={h} rx={11} fill="none" className="a-line" strokeWidth={4} />
      <rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={8} fill="none" stroke="var(--art-light)" strokeWidth={2} opacity="0.7" />
      <circle cx={x + w / 2} cy={y + h * 0.42} r={w * 0.2} className="a-paper a-line" strokeWidth={3} />
      <rect x={x + w * 0.24} y={y + h * 0.72} width={w * 0.52} height={7} rx={3.5} className="a-paper" opacity="0.9" />
    </g>
  )
}

/** Each mode card's picture: the reel of club cards, the daily calendar ball, the tactics board, the crowned trophy. */
export function ModeArt({ kind }: { kind: ModeArtKind }) {
  return (
    <Scene prefix={`mode-${kind}`} viewBox="0 0 400 200" align="xMidYMid" className={`mode-scene ${kind}`} blur={3.5} wobble={1.8} split flows={(id) => <CardFlows id={id} />}>
      {(id) => (
        // the subject sits inside x 117-283, so a phone's square crop of the card still shows all of it
        <g transform="translate(200 100) scale(0.86) translate(-200 -100)">
          {kind === 'quick' && (
            <g filter={`url(#${id.sketch})`}>
              <ClubCard id={id} x={112} y={58} w={58} h={80} rot={-12} a="#e0475b" b="var(--art-paper)" pattern="halves" />
              <ClubCard id={id} x={232} y={58} w={58} h={80} rot={12} a="#1b2f78" b="#38d9f5" pattern="stripes" />
              <ClubCard id={id} x={166} y={40} w={68} h={94} rot={0} a="#7b3fe4" b="#f5c542" pattern="sash" glow />
              <path d="M 188 20 L 212 20 L 200 36 Z" style={{ fill: 'var(--gold)' }} className="a-line" strokeWidth={3} strokeLinejoin="round" />
              <Ball cx={300} cy={150} r={17} sw={3} />
              <path d="M 270 160 q -12 -2 -20 4 M 274 146 q -12 -6 -22 -4" fill="none" stroke="var(--art-light)" strokeWidth={3} strokeLinecap="round" opacity="0.8" />
            </g>
          )}
          {kind === 'daily' && (
            <g filter={`url(#${id.sketch})`}>
              <circle cx={250} cy={130} r={70} fill={halo(id, 'c')} className="neon-halo" />
              <rect x={136} y={38} width={128} height={124} rx={18} className="a-paper a-line" strokeWidth={4.5} />
              <path d="M 136 74 L 136 56 Q 136 38 154 38 L 246 38 Q 264 38 264 56 L 264 74 Z" fill={`url(#${id.neon})`} />
              <path d="M 136 74 L 264 74" className="a-line" strokeWidth={4} />
              <rect x={136} y={38} width={128} height={124} rx={18} fill="none" className="a-line" strokeWidth={4.5} />
              {[164, 236].map((x) => (
                <rect key={x} x={x - 5} y={28} width={10} height={22} rx={5} className="a-body2 a-line" strokeWidth={3} />
              ))}
              {[0, 1, 2, 3].map((i) =>
                [0, 1].map((j) => <rect key={`${i}${j}`} x={152 + i * 25} y={86 + j * 24} width={17} height={15} rx={4} className="a-body" opacity="0.55" />),
              )}
              <Ball cx={242} cy={140} r={30} sw={4} />
            </g>
          )}
          {kind === 'season' && (
            <g filter={`url(#${id.sketch})`}>
              <rect x={104} y={30} width={192} height={140} rx={18} className="a-body2 a-line" strokeWidth={4.5} />
              <rect x={116} y={42} width={168} height={116} rx={10} style={{ fill: 'var(--art-grass)' }} className="a-line" strokeWidth={3} />
              <g fill="none" stroke="var(--art-light)" strokeWidth={2.5} opacity="0.8">
                <path d="M 200 42 L 200 158" />
                <circle cx={200} cy={100} r={18} />
                <rect x={116} y={74} width={26} height={52} />
                <rect x={258} y={74} width={26} height={52} />
              </g>
              {[
                [146, 70],
                [146, 130],
                [176, 100],
              ].map(([x, y]) => (
                <circle key={`${x}${y}`} cx={x} cy={y} r={9} style={{ fill: 'var(--cyan)' }} className="a-line" strokeWidth={3} />
              ))}
              {[
                [238, 72],
                [250, 124],
              ].map(([x, y]) => (
                <path key={`${x}${y}`} d={`M ${x - 7} ${y - 7} L ${x + 7} ${y + 7} M ${x + 7} ${y - 7} L ${x - 7} ${y + 7}`} stroke="var(--magenta)" strokeWidth={5} strokeLinecap="round" />
              ))}
              <path d="M 180 92 C 200 60, 236 60, 262 92" fill="none" stroke="var(--art-light)" strokeWidth={3.5} strokeDasharray="7 7" strokeLinecap="round" />
              <path d="M 252 84 L 264 94 L 250 98" fill="none" stroke="var(--art-light)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
          {kind === 'dynasty' && (
            <g filter={`url(#${id.sketch})`}>
              <circle cx={200} cy={92} r={86} fill={halo(id, 'm')} className="neon-halo" />
              {/* The cup */}
              <path d="M 166 74 q -30 0 -28 22 q 2 20 32 22" fill="none" className="a-line" strokeWidth={11} />
              <path d="M 234 74 q 30 0 28 22 q -2 20 -32 22" fill="none" className="a-line" strokeWidth={11} />
              <path d="M 166 74 q -30 0 -28 22 q 2 20 32 22" fill="none" style={{ stroke: 'var(--gold)' }} strokeWidth={5} />
              <path d="M 234 74 q 30 0 28 22 q -2 20 -32 22" fill="none" style={{ stroke: 'var(--gold)' }} strokeWidth={5} />
              <path d="M 160 68 L 240 68 Q 240 128 200 134 Q 160 128 160 68 Z" style={{ fill: 'var(--gold)' }} className="a-line" strokeWidth={4.5} strokeLinejoin="round" />
              <path d="M 192 132 L 208 132 L 212 152 L 188 152 Z" style={{ fill: 'var(--gold)' }} className="a-line" strokeWidth={4} strokeLinejoin="round" />
              <rect x={170} y={150} width={60} height={16} rx={5} className="a-body2 a-line" strokeWidth={4} />
              <path d="M 174 80 Q 176 112 196 122" fill="none" stroke="#fff6d6" strokeWidth={5} strokeLinecap="round" opacity="0.85" />
              {/* The crown above it: a band and three rounded points, gems as discs */}
              <path d="M 170 58 L 166 26 Q 166 22 170 25 L 184 38 L 197 16 Q 200 12 203 16 L 216 38 L 230 25 Q 234 22 234 26 L 230 58 Z" style={{ fill: 'var(--gold)' }} className="a-line" strokeWidth={4} strokeLinejoin="round" />
              <circle cx={185} cy={48} r={5} style={{ fill: 'var(--cyan)' }} />
              <circle cx={200} cy={46} r={6} style={{ fill: 'var(--magenta)' }} />
              <circle cx={215} cy={48} r={5} style={{ fill: 'var(--cyan)' }} />
            </g>
          )}
        </g>
      )}
    </Scene>
  )
}

export type ResultArtKind = 'trophy' | 'stadium' | 'rain'

/** The scene for a season's tier: a trophy for a title (or better), rain for the drop zone, the ground for the rest. */
export function resultArtKind(tier: SeasonTier): ResultArtKind {
  if (tier === 'PERFECT' || tier === 'INVINCIBLE' || tier === 'CHAMPIONS') return 'trophy'
  if (tier === 'RELEGATED' || tier === 'RELEGATION_BATTLE') return 'rain'
  return 'stadium'
}

/** A ball in outline only, for the sketches: the rim, the centre panel and the seams out to the edge. */
function SketchBall({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const pt = (deg: number, rr: number) => {
    const a = (deg - 90) * (Math.PI / 180)
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]
  }
  const centre = [0, 72, 144, 216, 288].map((d) => pt(d, r * 0.38))
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      <polygon points={centre.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')} />
      {[0, 72, 144, 216, 288].map((d, i) => {
        const [x1, y1] = centre[i]
        const [x2, y2] = pt(d, r * 0.97)
        return <path key={d} d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`} />
      })}
    </g>
  )
}

/** A floodlight in outline: the lattice pole, the lamp head and two dashed beams. */
function SketchFloodlight({ x, top, foot, lean }: { x: number; top: number; foot: number; lean: 1 | -1 }) {
  return (
    <g>
      <path d={`M ${x - 5} ${top + 30} L ${x - 9} ${foot} M ${x + 5} ${top + 30} L ${x + 9} ${foot}`} />
      {[0, 1, 2, 3].map((i) => {
        const y = top + 44 + i * ((foot - top - 50) / 4)
        return <path key={i} d={`M ${x - 6} ${y} L ${x + 7} ${y + 22} M ${x + 6} ${y} L ${x - 7} ${y + 22}`} />
      })}
      <rect x={x - 26} y={top} width={52} height={30} rx={7} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={x - 15 + i * 15} cy={top + 15} r={5} />
      ))}
      <path className="sk-faint" d={`M ${x + lean * 10} ${top + 34} L ${x + lean * 90} ${foot + 30} M ${x - lean * 6} ${top + 34} L ${x + lean * 40} ${foot + 44}`} strokeDasharray="6 9" />
    </g>
  )
}

/** The bowl of a ground in outline: the rim, two rows of seats, the roof over the far side and the pitch inside. */
function SketchBowl({ y }: { y: number }) {
  return (
    <g>
      <path d={`M 30 ${y} C 40 ${y - 70}, 360 ${y - 70}, 370 ${y} C 370 ${y + 50}, 30 ${y + 50}, 30 ${y} Z`} />
      <path d={`M 52 ${y - 2} C 64 ${y - 50}, 336 ${y - 50}, 348 ${y - 2}`} />
      <path d={`M 76 ${y + 2} C 90 ${y - 32}, 310 ${y - 32}, 324 ${y + 2}`} />
      <path d={`M 96 ${y + 8} C 110 ${y - 16}, 290 ${y - 16}, 304 ${y + 8} C 296 ${y + 30}, 104 ${y + 30}, 96 ${y + 8} Z`} />
      <path d={`M 200 ${y - 10} L 200 ${y + 26}`} />
      <ellipse cx={200} cy={y + 9} rx={18} ry={7} />
      <path d={`M 60 ${y - 40} C 120 ${y - 86}, 280 ${y - 86}, 340 ${y - 40} L 334 ${y - 30} C 276 ${y - 70}, 124 ${y - 70}, 66 ${y - 30} Z`} />
      {[110, 160, 200, 240, 290].map((x) => (
        <path key={x} d={`M ${x} ${y - 66 + Math.abs(x - 200) * 0.12} L ${x} ${y - 52 + Math.abs(x - 200) * 0.12}`} />
      ))}
    </g>
  )
}

/** A cloud in outline, three bumps on a flat base, with its rain falling at a slant. */
function SketchCloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M -60 20 C -78 20, -80 -6, -58 -8 C -58 -32, -24 -38, -14 -20 C -4 -44, 40 -42, 42 -14 C 66 -16, 72 20, 50 20 Z" />
      {[-44, -22, 0, 22, 44].map((dx, i) => (
        <path key={dx} className="sk-faint" d={`M ${dx} ${32 + (i % 2) * 10} l -8 22`} />
      ))}
      {[-34, -10, 14, 36].map((dx, i) => (
        <path key={dx} className="sk-faint" d={`M ${dx} ${70 + (i % 2) * 12} l -8 22`} />
      ))}
    </g>
  )
}

/**
 * The summary banner's faint sketch: line art only, in one ink (--sketch-line), kept back by --sketch-opacity so
 * the result reads over it. A trophy and confetti for a title, the floodlit ground for a season in between, rain
 * clouds over the ground for the drop. Every scene stands on the same pitch arc with a ball. Decoration only.
 */
export function ResultArt({ kind }: { kind: ResultArtKind }) {
  const id = useDefs('result')
  return (
    <svg className={`art result-art ${kind}`} viewBox="0 0 400 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" data-testid="result-art" data-kind={kind}>
      <defs>
        <SharedDefs id={id} blur={0} wobble={2.2} />
      </defs>
      <g className="sk" filter={`url(#${id.sketch})`}>
        {/* The pitch arc and the box line it sits on, with the ball beside it */}
        <path d="M 10 520 L 390 520" />
        <path d="M 120 520 C 130 470, 270 470, 280 520" />
        <path d="M 60 520 L 60 556 M 340 520 L 340 556" />
        <circle cx={200} cy={538} r={2.5} />
        <SketchBall cx={330} cy={486} r={20} />
        <path className="sk-faint" d="M 300 478 q -16 -2 -28 6 M 302 494 q -14 0 -24 8" />
        {kind === 'stadium' && (
          <g>
            <SketchFloodlight x={56} top={150} foot={350} lean={1} />
            <SketchFloodlight x={344} top={150} foot={350} lean={-1} />
            <SketchBowl y={400} />
          </g>
        )}
        {kind === 'rain' && (
          <g>
            <SketchBowl y={420} />
            <SketchCloud x={130} y={190} s={1.15} />
            <SketchCloud x={290} y={250} s={0.9} />
            <path className="sk-faint" d="M 150 470 c 10 -6 30 -6 40 0 M 230 478 c 8 -5 22 -5 30 0" />
          </g>
        )}
        {kind === 'trophy' && (
          <g>
            {/* The cup: bowl, handles, stem, the plinth and a shine on the bowl */}
            <path d="M 140 170 L 260 170 C 262 250, 240 290, 200 298 C 160 290, 138 250, 140 170 Z" />
            <path d="M 142 186 C 100 184, 96 244, 152 252 M 258 186 C 300 184, 304 244, 248 252" />
            <path d="M 186 298 L 214 298 L 220 340 L 180 340 Z" />
            <rect x={160} y={340} width={80} height={26} rx={5} />
            <rect x={150} y={366} width={100} height={30} rx={6} />
            <path className="sk-faint" d="M 162 190 C 162 230, 172 258, 190 274" />
            <path d="M 176 380 L 224 380" />
            {/* The confetti: strips, discs and curls, never stars */}
            <g className="confetti">
              {[[70, 120, 20], [118, 70, -30], [300, 96, 40], [340, 160, -15], [58, 230, 60], [330, 250, -50], [240, 60, 10], [96, 320, 25], [312, 336, -35]].map(([x, y, r], i) => (
                <rect key={i} className={`cf c${i % 3}`} x={x - 7} y={y - 3} width={14} height={6} rx={2} transform={`rotate(${r} ${x} ${y})`} />
              ))}
              {[[150, 110], [270, 130], [40, 170], [366, 210], [80, 280], [350, 300], [200, 92]].map(([x, y], i) => (
                <circle key={i} className={`cf c${(i + 1) % 3}`} cx={x} cy={y} r={4} />
              ))}
              <path className="cf-curl" d="M 100 160 q 10 -14 20 0 t 20 0" />
              <path className="cf-curl" d="M 270 200 q 10 -14 20 0 t 20 0" />
              <path className="cf-curl" d="M 180 50 q 10 -14 20 0 t 20 0" />
            </g>
          </g>
        )}
      </g>
    </svg>
  )
}
