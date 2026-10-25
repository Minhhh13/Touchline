import { useEffect, useRef, useState } from 'react'
import { textColourFor } from '../format'
import { EstimatedChip } from './bits'

export interface WheelSegment {
  id: string
  label: string
  colour: string
  secondary: string
}

/** Cards in one run of the reel and where the winner sits. */
const COUNT = 52
const LAND = 44
/** The strip slides for this long, then the winner is highlighted and the pick opens. */
const SPIN_MS = 2300
const SETTLE_MS = 2500
const GAP = 6

interface Run {
  cards: WheelSegment[]
  /** Pixels the strip travels left so the winner sits under the marker. */
  offset: number
  card: number
}

/**
 * The wheel as a case opening: a strip of club cards shoots past the marker,
 * slows and lands on the club-season the engine already chose. When `targetId`
 * (or `spinKey`) changes a fresh run is dealt, the winner is placed deep in the
 * strip and the strip is slid so that card stops under the marker, with a little
 * jitter so it rarely stops dead centre. The season year flickers while the strip
 * moves and settles with the card.
 */
export function CaseReel({ segments, targetId, year, onSettled, spinning, spinKey, twist, estimated }: { segments: WheelSegment[]; targetId: string | null; year: number | null; onSettled?: () => void; spinning: boolean; spinKey?: number; /** Name of the twist on this spin, shown while the reel runs. */ twist?: string | null; /** The landed club-season is a classic one: its ratings are TouchLine's estimate. */ estimated?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [moving, setMoving] = useState(false)
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    if (!targetId || !segments.length) return
    const target = segments.find((s) => s.id === targetId) ?? segments[0]
    const cards: WheelSegment[] = []
    let last = ''
    for (let i = 0; i < COUNT; i++) {
      if (i === LAND) {
        cards.push(target)
        last = target.id
        continue
      }
      let pick = segments[Math.floor(Math.random() * segments.length)]
      // No two identical cards in a row, so the strip reads as a shuffle rather than a stutter
      if (segments.length > 1 && pick.id === last) pick = segments[(segments.indexOf(pick) + 1) % segments.length]
      cards.push(pick)
      last = pick.id
    }
    const width = wrapRef.current?.clientWidth ?? 320
    const card = width < 360 ? 68 : 84
    const jitter = (Math.random() - 0.5) * card * 0.7
    const offset = LAND * (card + GAP) + card / 2 - width / 2 + jitter
    // Deal the new run at rest, then slide it on the next frame so the transition runs from zero every time
    setLanded(false)
    setMoving(false)
    setRun({ cards, offset, card })
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMoving(true))
    })
    const t1 = setTimeout(() => setLanded(true), SPIN_MS + 80)
    const t2 = setTimeout(() => onSettled?.(), SETTLE_MS)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // spinKey changes on every spin, so landing on the same club twice running still runs the reel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, spinKey])

  const rolling = spinning && !landed
  const idle = run ? null : segments.slice(0, 16)
  const card = run?.card ?? 84
  const cards = run?.cards ?? idle ?? []

  return (
    <div className="wheel-wrap reel-wrap" aria-live="polite" ref={wrapRef}>
      <div className="reel-window">
        <div className="reel-marker" />
        <div className={`reel-strip ${moving ? 'moving' : ''}`} style={{ '--card': `${card}px`, '--gap': `${GAP}px`, transform: `translateX(${moving && run ? -run.offset : 0}px)` } as React.CSSProperties}>
          {cards.map((s, i) => (
            <div key={`${i}-${s.id}`} className={`reel-card ${run && landed && i === LAND ? 'landed' : ''}`} style={{ background: s.colour, color: textColourFor(s.colour), '--secondary': s.secondary } as React.CSSProperties}>
              {s.label}
            </div>
          ))}
        </div>
      </div>
      <div className={`reel-hub hub ${rolling ? 'rolling' : ''}`}>
        {year && (spinning ? landed : true) ? (
          <>
            <span className="lbl">Season</span>
            <span className="year">{year}</span>
            {estimated && <EstimatedChip compact />}
          </>
        ) : spinning ? (
          <>
            <span className={`lbl ${twist ? 'twist' : ''}`}>{twist ?? 'Opening'}</span>
            <span className="year">{1990 + Math.floor(Math.random() * 37)}</span>
          </>
        ) : (
          <>
            <span className="lbl">Ready</span>
            <span className="year">Spin</span>
          </>
        )}
      </div>
    </div>
  )
}
