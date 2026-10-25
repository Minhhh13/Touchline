/**
 * A pitch standing up for the formation panels and the heat map: our own
 * markings, attacking up. It is its own SVG class (`md-vpitch`), never the
 * live pitch's portrait frame, so there is only ever one live pitch on a page.
 * Children are HTML laid over it in per cent of its box.
 */
import type { ReactNode } from 'react'

/** Shared coordinates (x along towards the attacked goal, y across from the side's left) to per cent of the standing pitch. */
export function upright(along: number, across: number): { left: number; top: number } {
  return { left: across, top: 100 - along }
}

export function VerticalPitch({ children, overlay, label, ratio = 1.18 }: { children?: ReactNode; overlay?: ReactNode; label: string; ratio?: number }) {
  // Lines on a 68 by 105 pitch, squashed to the panel's ratio
  const H = 68 * ratio
  const k = H / 105
  return (
    <div className="md-vpitch-wrap" style={{ aspectRatio: `68 / ${H.toFixed(1)}` }}>
      <svg className="md-vpitch" viewBox={`0 0 68 ${H.toFixed(2)}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.45" vectorEffect="non-scaling-stroke">
          <rect x="0.4" y="0.4" width="67.2" height={H - 0.8} />
          <line x1="0.4" y1={H / 2} x2="67.6" y2={H / 2} />
          <ellipse cx="34" cy={H / 2} rx="9.15" ry={9.15 * k} />
          <rect x="13.85" y="0.4" width="40.3" height={16.5 * k} />
          <rect x="24.85" y="0.4" width="18.3" height={5.5 * k} />
          <rect x="13.85" y={H - 0.4 - 16.5 * k} width="40.3" height={16.5 * k} />
          <rect x="24.85" y={H - 0.4 - 5.5 * k} width="18.3" height={5.5 * k} />
        </g>
        {overlay}
      </svg>
      {children && <div className="md-vpitch-layer">{children}</div>}
    </div>
  )
}
