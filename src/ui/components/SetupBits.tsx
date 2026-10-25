import { useRef, type ReactNode } from 'react'
import { seasonStop } from '@engine/era'
import { randomTeamName } from '@game/logic/teamNames'
import { seasonLabel } from '../format'
import { InfoTip } from './PowerUpButton'

export interface ChoiceOption<T extends string> {
  value: T
  title: string
  /** One short line under the title. */
  line: string
  /** An icon above the title. */
  icon?: string
}

/** A row of option cards, one of them chosen: the setup screen's Difficulty, Show ratings, Draft mode and Player ratings. */
export function ChoiceCards<T extends string>({ label, options, value, onChange, disabled, testId }: { label: string; options: Array<ChoiceOption<T>>; value: T; onChange: (v: T) => void; disabled?: boolean; testId?: string }) {
  return (
    <div className={`choice-cards n${options.length}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`choice-card ${o.value === value ? 'active' : ''}`} disabled={disabled} onClick={() => onChange(o.value)} data-value={o.value} title={o.line}>
          {o.icon && (
            <span className="cicon" aria-hidden="true">
              {o.icon}
            </span>
          )}
          <span className="ctitle">{o.title}</span>
          <span className="cline">{o.line}</span>
        </button>
      ))}
    </div>
  )
}

/** A setup section's heading: the title, an optional Info tip for the details, and anything to its right (a count, a chip). */
export function SectionHead({ title, info, right, testId }: { title: string; info?: string; right?: ReactNode; testId?: string }) {
  return (
    <div className="setup-head">
      <h3>{title}</h3>
      {info && <InfoTip label={title} text={info} testId={testId ? `${testId}-info` : undefined} />}
      {right && <span className="setup-head-right">{right}</span>}
    </div>
  )
}

/**
 * A team name field with Clear (empties it and puts the cursor in it) and Randomise (an invented name from our own list).
 * The dice is UI randomness only: a name never touches the seed. An empty field starts as `fallback`; the dice never
 * lands on a name in `taken`.
 */
export function TeamNameField({ label = 'Team name', value, onChange, fallback, maxLength = 28, testId = 'team-name', taken }: { label?: string; value: string; onChange: (v: string) => void; fallback: string; maxLength?: number; testId?: string; taken?: readonly string[] }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="field team-field">
      <label htmlFor={`${testId}-input`}>{label}</label>
      <div className="team-row">
        <input id={`${testId}-input`} ref={ref} className="input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={fallback} data-testid={testId} />
        <button
          type="button"
          className="btn sm ghost name-btn"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          aria-label={`Clear ${label.toLowerCase()}`}
          title="Clear"
          data-testid={`${testId}-clear`}
        >
          ✕<span className="name-btn-label">Clear</span>
        </button>
        <button type="button" className="btn sm name-btn" onClick={() => onChange(randomTeamName(Math.random(), value, taken).slice(0, maxLength))} aria-label={`Random ${label.toLowerCase()}`} title="Randomise" data-testid={`${testId}-random`}>
          🎲<span className="name-btn-label">Randomise</span>
        </button>
      </div>
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
