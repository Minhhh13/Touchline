import { useEffect, useRef, useState } from 'react'
import { textColourFor } from '../format'

export interface WheelSegment {
  id: string
  label: string
  colour: string
  secondary: string
}

/**
 * A spinning wheel of club segments. When `targetId` changes the rotor spins
 * several times and settles with that segment under the pointer, then the hub
 * reveals the season year after a short "reel" flicker.
 */
export function Wheel({ segments, targetId, year, onSettled, spinning }: { segments: WheelSegment[]; targetId: string | null; year: number | null; onSettled?: () => void; spinning: boolean }) {
  const [rotation, setRotation] = useState(0)
  const [reelDone, setReelDone] = useState(false)
  const rotRef = useRef(0)
  const n = Math.max(1, segments.length)
  const seg = 360 / n

  useEffect(() => {
    if (!targetId) return
    const idx = Math.max(0, segments.findIndex((s) => s.id === targetId))
    // Pointer is at the top (angle 0). Segment i spans [i*seg, (i+1)*seg) measured clockwise from top before rotation.
    const centre = idx * seg + seg / 2
    const current = rotRef.current % 360
    const extraTurns = 4 + Math.floor(Math.random() * 2)
    const target = rotRef.current - current + extraTurns * 360 + (360 - centre)
    rotRef.current = target
    setReelDone(false)
    setRotation(target)
    const t1 = setTimeout(() => setReelDone(true), 2400)
    const t2 = setTimeout(() => onSettled?.(), 2500)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  const r = 150
  const cx = 150
  const cy = 150
  const paths = segments.map((s, i) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    const large = seg > 180 ? 1 : 0
    const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
    const mid = ((i + 0.5) * seg - 90) * (Math.PI / 180)
    const tx = cx + r * 0.78 * Math.cos(mid)
    const ty = cy + r * 0.78 * Math.sin(mid)
    const rot = (i + 0.5) * seg
    return (
      <g key={s.id}>
        <path d={d} fill={s.colour} stroke={s.secondary} strokeWidth="1.5" />
        <text x={tx} y={ty} fill={textColourFor(s.colour)} fontSize={n > 24 ? 8 : 10} fontWeight="700" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${rot} ${tx} ${ty})`}>
          {s.label}
        </text>
      </g>
    )
  })

  return (
    <div className="wheel-wrap" aria-live="polite">
      <div className="pointer" />
      <svg viewBox="0 0 300 300">
        <g className="rotor" style={{ transform: `rotate(${rotation}deg)` }}>
          <circle cx={cx} cy={cy} r={r} fill="#111" />
          {paths}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--gold)" strokeWidth="4" />
        </g>
      </svg>
      <div className={`hub ${spinning && !reelDone ? 'rolling' : ''}`}>
        {year && (spinning ? reelDone : true) ? (
          <>
            <span className="lbl">Season</span>
            <span className="year">{year}</span>
          </>
        ) : spinning ? (
          <>
            <span className="lbl">Spinning</span>
            <span className="year">{1990 + Math.floor(Math.random() * 37)}</span>
          </>
        ) : (
          <>
            <span className="lbl">Ready</span>
            <span className="year">SPIN</span>
          </>
        )}
      </div>
    </div>
  )
}
