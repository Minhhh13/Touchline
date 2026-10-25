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

/** Two handles over a list of seasons (start years, ascending); either handle stops at the other. */
export function SeasonRange({ seasons, from, to, onChange }: { seasons: number[]; from: number; to: number; onChange: (from: number, to: number) => void }) {
  const lo = seasons[0] ?? from
  const hi = seasons[seasons.length - 1] ?? to
  const span = Math.max(1, hi - lo)
  const a = Math.min(Math.max(from, lo), hi)
  const b = Math.min(Math.max(to, lo), hi)
  return (
    <div className="season-range" data-testid="era-slider">
      <div className="track" />
      <div className="fill" style={{ left: `${((a - lo) / span) * 100}%`, right: `${((hi - b) / span) * 100}%` }} />
      <input type="range" min={lo} max={hi} step={1} value={a} aria-label="First season" aria-valuetext={seasonLabel(a)} onChange={(e) => onChange(Math.min(Number(e.target.value), b), b)} />
      <input type="range" min={lo} max={hi} step={1} value={b} aria-label="Last season" aria-valuetext={seasonLabel(b)} onChange={(e) => onChange(a, Math.max(Number(e.target.value), a))} />
    </div>
  )
}
