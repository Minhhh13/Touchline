import { FORMATIONS } from '@engine/formations'
import type { Formation } from '@engine/types'
import { THUMB_DOT_R, THUMB_H, THUMB_PAD, THUMB_W, formationThumb } from '@game/logic/formationThumb'

/** A small drawn pitch with the shape's eleven slots as dots, attack pointing up. A picture, hidden from screen readers. */
export function FormationThumb({ formation }: { formation: Formation }) {
  const w = THUMB_W - THUMB_PAD * 2
  const h = THUMB_H - THUMB_PAD * 2
  const midY = THUMB_H / 2
  const boxW = w * 0.56
  const boxH = h * 0.16
  return (
    <svg className="fthumb" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true" focusable="false" data-testid="formation-thumb">
      <rect className="fthumb-grass" x="0" y="0" width={THUMB_W} height={THUMB_H} rx="4" />
      <g className="fthumb-lines" fill="none">
        <rect x={THUMB_PAD - 3} y={THUMB_PAD - 3} width={w + 6} height={h + 6} />
        <line x1={THUMB_PAD - 3} y1={midY} x2={THUMB_W - THUMB_PAD + 3} y2={midY} />
        <circle cx={THUMB_W / 2} cy={midY} r={w * 0.16} />
        <rect x={(THUMB_W - boxW) / 2} y={THUMB_PAD - 3} width={boxW} height={boxH} />
        <rect x={(THUMB_W - boxW) / 2} y={THUMB_H - THUMB_PAD + 3 - boxH} width={boxW} height={boxH} />
      </g>
      {formationThumb(formation).map((d) => (
        <circle key={d.slotId} className={`fthumb-dot g-${d.group}`} cx={d.cx} cy={d.cy} r={THUMB_DOT_R} data-slot={d.slotId} />
      ))}
    </svg>
  )
}

/** The shape's name with any word after the numbers ("Diamond") on a line of its own on a small tile, so a word never breaks. */
function FormationName({ name }: { name: string }) {
  const gap = name.indexOf(' ')
  if (gap < 0) return <span className="fname">{name}</span>
  return (
    <span className="fname">
      {name.slice(0, gap)}
      <span className="fname-sub"> {name.slice(gap + 1)}</span>
    </span>
  )
}

export interface FormationPickerProps {
  value: string
  onChange: (id: string) => void
  /** Show each shape's one-line description beside the picture (the Dugout's Tactics tab has the room). */
  blurbs?: boolean
  /** Names the group for screen readers, e.g. "Manager 1 formation". */
  label?: string
  testId?: string
}

/** The one formation chooser: a tile per shape with its mini pitch, the chosen tile highlighted. */
export function FormationPicker({ value, onChange, blurbs, label = 'Formation', testId = 'formation-picker' }: FormationPickerProps) {
  return (
    <div className={`formations${blurbs ? ' with-blurbs' : ''}`} role="group" aria-label={label} data-testid={testId}>
      {FORMATIONS.map((f) => (
        <button key={f.id} type="button" className={f.id === value ? 'active' : ''} aria-pressed={f.id === value} onClick={() => onChange(f.id)} data-testid={`formation-${f.id}`}>
          <FormationThumb formation={f} />
          <span className="ftext">
            <FormationName name={f.name} />
            {blurbs && <span className="fblurb">{f.blurb}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
