import { seasonStop } from '@engine/era'
import { seasonLabel } from '../format'

export interface ChoiceOption<T extends string> {
  value: T
  title: string
  /** One short line under the title. */
  line: string
}

/** A row of option cards, one of them chosen: the setup screen's Difficulty, Show ratings, Draft mode and Player ratings. */
export function ChoiceCards<T extends string>({ label, options, value, onChange, disabled, testId }: { label: string; options: Array<ChoiceOption<T>>; value: T; onChange: (v: T) => void; disabled?: boolean; testId?: string }) {
  return (
    <div className={`choice-cards n${options.length}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`choice-card ${o.value === value ? 'active' : ''}`} disabled={disabled} onClick={() => onChange(o.value)} data-value={o.value}>
          <span className="ctitle">{o.title}</span>
          <span className="cline">{o.line}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Two handles over a list of seasons (start years, ascending); either handle stops at the other.
 * The inputs step through the list's stops, not the years, so a gap in the data is never a stop.
 */
export function SeasonRange({ seasons, from, to, onChange }: { seasons: number[]; from: number; to: number; onChange: (from: number, to: number) => void }) {
  if (!seasons.length) return null
  const top = seasons.length - 1
  const span = Math.max(1, top)
  const a = Math.max(0, seasonStop(seasons, Math.min(from, to)))
  const b = Math.max(a, seasonStop(seasons, Math.max(from, to)))
  return (
    <div className="season-range" data-testid="era-slider">
      <div className="track" />
      <div className="fill" style={{ left: `${(a / span) * 100}%`, right: `${((top - b) / span) * 100}%` }} />
      <input type="range" min={0} max={top} step={1} value={a} aria-label="First season" aria-valuetext={seasonLabel(seasons[a])} onChange={(e) => onChange(seasons[Math.min(Number(e.target.value), b)], seasons[b])} />
      <input type="range" min={0} max={top} step={1} value={b} aria-label="Last season" aria-valuetext={seasonLabel(seasons[b])} onChange={(e) => onChange(seasons[a], seasons[Math.max(Number(e.target.value), a)])} />
    </div>
  )
}

/**
 * The Quick Draft's Modes row: icon cards that switch on and off, several at once. What a tap does to the others (Hard
 * linked to the difficulty, Underdog and Legends exclusive) is the caller's `toggleModeCard`; this only renders.
 */
export function ModeCards<T extends string>({ cards, on, info, onToggle }: { cards: readonly T[]; on: readonly T[]; info: Record<T, { icon: string; title: string; line: string }>; onToggle: (card: T) => void }) {
  return (
    <div className="qmode-row" role="group" aria-label="Modes" data-testid="modes">
      {cards.map((c) => {
        const active = on.includes(c)
        return (
          <button key={c} type="button" className={`qmode ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => onToggle(c)} data-testid={`mode-${c}`} title={info[c].line}>
            <span className="micon" aria-hidden="true">
              {info[c].icon}
            </span>
            <span className="ctitle">{info[c].title}</span>
            <span className="cline">{info[c].line}</span>
          </button>
        )
      })}
    </div>
  )
}
