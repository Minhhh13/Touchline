/**
 * Our own cartoon trophies, drawn in the style of the art (`Art.tsx`): bold rounded shapes in gold with a navy ink
 * outline, a pale shine and a plinth in the art's body colour. Never a real trophy or anyone's mark: the league's is a
 * tall banded cup with a disc on its lid, the Cup's a two-handled cup with a lid, the Continental Cup's a globe held in
 * a cradle (meridians in cyan, no stars). `TrebleArt` stands the three together under a crown with rounded points and
 * disc gems. Decoration only (aria-hidden); colours come from the tokens (`--gold`, `--art-*`, `--cyan`).
 */
export type TrophyKind = 'league' | 'cup' | 'continental'

function Plinth({ y }: { y: number }) {
  return (
    <g>
      <rect x={38} y={y} width={44} height={14} rx={4} className="a-body2 a-line" strokeWidth={4} />
      <rect x={30} y={y + 14} width={60} height={18} rx={5} className="a-body2 a-line" strokeWidth={4} />
      <rect x={48} y={y + 19} width={24} height={8} rx={2} className="tr-gold" />
    </g>
  )
}

/** One trophy's drawing in a 120 × 160 box, the plinth's foot at y 158. */
function TrophyShape({ kind }: { kind: TrophyKind }) {
  if (kind === 'cup')
    return (
      <g>
        {/* The handles: an ink loop under a gold one */}
        <path d="M 37 46 C 12 42, 12 78, 42 80 M 83 46 C 108 42, 108 78, 78 80" fill="none" className="a-line" strokeWidth={12} />
        <path d="M 37 46 C 12 42, 12 78, 42 80 M 83 46 C 108 42, 108 78, 78 80" fill="none" className="tr-gold-stroke" strokeWidth={5} />
        <path d="M 34 38 L 86 38 C 86 74, 76 94, 60 98 C 44 94, 34 74, 34 38 Z" className="tr-gold a-line" strokeWidth={4.5} />
        {/* The lid and its disc knob */}
        <path d="M 38 38 Q 60 16 82 38 Z" className="tr-gold a-line" strokeWidth={4} />
        <circle cx={60} cy={18} r={6} className="tr-gold a-line" strokeWidth={3.5} />
        <path d="M 53 98 L 67 98 L 71 112 L 49 112 Z" className="tr-gold a-line" strokeWidth={4} />
        <path d="M 43 46 Q 44 72 56 86" fill="none" className="tr-shine" strokeWidth={5} />
        <Plinth y={112} />
      </g>
    )
  if (kind === 'continental')
    return (
      <g>
        {/* The globe: a gold disc with cyan meridians and parallels, held in a cradle */}
        <circle cx={60} cy={44} r={28} className="tr-gold a-line" strokeWidth={4.5} />
        <ellipse cx={60} cy={44} rx={12} ry={28} fill="none" className="tr-meridian" strokeWidth={3} />
        <path d="M 32 44 L 88 44 M 36 30 Q 60 36 84 30 M 36 58 Q 60 52 84 58" fill="none" className="tr-meridian" strokeWidth={3} />
        <path d="M 30 60 C 30 86, 46 98, 60 100 C 74 98, 90 86, 90 60" fill="none" className="a-line" strokeWidth={12} />
        <path d="M 30 60 C 30 86, 46 98, 60 100 C 74 98, 90 86, 90 60" fill="none" className="tr-gold-stroke" strokeWidth={5} />
        <path d="M 53 100 L 67 100 L 71 112 L 49 112 Z" className="tr-gold a-line" strokeWidth={4} />
        <path d="M 44 28 Q 40 40 44 52" fill="none" className="tr-shine" strokeWidth={4} />
        <Plinth y={112} />
      </g>
    )
  return (
    <g>
      {/* The league's: a tall cup with no handles, two bands and a disc on its lid */}
      <path d="M 36 30 L 84 30 L 77 92 Q 60 102 43 92 Z" className="tr-gold a-line" strokeWidth={4.5} />
      <path d="M 38 46 L 82 46 M 41 76 L 79 76" fill="none" className="a-line" strokeWidth={3.5} />
      <circle cx={60} cy={61} r={8} className="tr-meridian-fill a-line" strokeWidth={3} />
      <path d="M 40 30 Q 60 12 80 30 Z" className="tr-gold a-line" strokeWidth={4} />
      <circle cx={60} cy={13} r={6} className="tr-gold a-line" strokeWidth={3.5} />
      <path d="M 53 98 L 67 98 L 71 112 L 49 112 Z" className="tr-gold a-line" strokeWidth={4} />
      <path d="M 45 52 L 48 86" fill="none" className="tr-shine" strokeWidth={5} />
      <Plinth y={112} />
    </g>
  )
}

/** One trophy. `muted` draws it faint (a cup still to be won). */
export function TrophyArt({ kind, size = 96, muted = false, className = '' }: { kind: TrophyKind; size?: number; muted?: boolean; className?: string }) {
  return (
    <svg className={`art trophy-art ${muted ? 'muted' : ''} ${className}`} viewBox="0 0 120 160" width={size * 0.75} height={size} aria-hidden="true" focusable="false" data-testid="trophy-art" data-kind={kind}>
      <TrophyShape kind={kind} />
    </svg>
  )
}

/** The Treble: the Cup, the league's trophy and the Continental Cup side by side, a crown over the middle one. */
export function TrebleArt({ size = 150, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`art treble-art ${className}`} viewBox="0 0 340 220" width={size * (340 / 220)} height={size} aria-hidden="true" focusable="false" data-testid="treble-art">
      {/* Placed by the outer group, animated by the inner one (a CSS transform would replace the SVG one) */}
      <g transform="translate(4 64) scale(0.95)">
        <g className="tr-piece p0">
          <TrophyShape kind="cup" />
        </g>
      </g>
      <g transform="translate(222 64) scale(0.95)">
        <g className="tr-piece p2">
          <TrophyShape kind="continental" />
        </g>
      </g>
      <g transform="translate(110 46) scale(1.05)">
        <g className="tr-piece p1">
          <TrophyShape kind="league" />
        </g>
      </g>
      {/* The crown: a band and three rounded points, gems as discs (never a star) */}
      <g className="tr-piece p3">
        <path d="M 138 44 L 133 14 Q 133 9 138 12 L 153 26 L 167 4 Q 170 0 173 4 L 187 26 L 202 12 Q 207 9 207 14 L 202 44 Z" className="tr-gold a-line" strokeWidth={4} />
        <circle cx={154} cy={35} r={5} className="tr-gem-a" />
        <circle cx={170} cy={33} r={6} className="tr-gem-b" />
        <circle cx={186} cy={35} r={5} className="tr-gem-a" />
      </g>
    </svg>
  )
}
