import type { ReactNode } from 'react'
import type { AttributeKey, PlayerSeason, SquadPlayer } from '@engine/types'
import type { MaskedView } from '@game/logic/scouting'
import { INJURY_RISK_LABEL, injuryRiskLevel } from '@engine/depth'
import { Bar } from './bits'
import { conditionColour, meterValue } from '../format'

/**
 * Football Manager-style attribute panel: labelled bars in five groups, the
 * hidden traits as bars with a word rather than a number, the injury risk as
 * a 1 to 5 scale and, for a squad player, his condition. With a masked `view`
 * (a player the club has not scouted) each attribute is a range and the hidden
 * traits and the injury risk read "Unknown" until he is scouted.
 */
export function AttributePanel({ p, state, view }: { p: PlayerSeason; state?: SquadPlayer; view?: MaskedView }) {
  const a = p.attributes
  const t = p.traits
  const risk = injuryRiskLevel(t)
  const masked = !!view && !view.exact
  const attr = (label: string, value: number, key: AttributeKey): ReactNode => (masked ? rangeAttr(label, view!.attrs[key]) : exactAttr(label, value))
  const trait = (label: string, value: number): ReactNode => (masked && !view!.scouted ? unknownTrait(label) : exactTrait(label, value))
  const groups: Array<{ title: string; rows: ReactNode[] }> = [
    { title: 'Technical', rows: [attr('Shooting', a.shooting, 'shooting'), attr('Passing', a.passing, 'passing'), attr('Dribbling', a.dribbling, 'dribbling')] },
    { title: 'Physical', rows: [attr('Pace', a.pace, 'pace'), attr('Stamina', a.stamina, 'stamina'), attr('Strength', a.strength, 'strength'), attr('Jumping', a.jumping, 'jumping')] },
    {
      title: 'Mental',
      rows: [attr('Mentality', a.mentality, 'mentality'), attr('Aggression', a.aggression, 'aggression'), attr('Work rate', a.workRate, 'workRate'), trait('Big match', t.bigMatch), trait('Consistency', t.consistency), trait('Professional', t.professionalism)],
    },
    { title: 'Defending', rows: [attr('Defending', a.defending, 'defending')] },
    { title: 'Goalkeeping', rows: [attr('Goalkeeping', a.goalkeeping, 'goalkeeping')] },
    {
      title: 'Fitness',
      rows: [
        masked && !view!.scouted ? unknownTrait('Injury risk') : <div key="risk" className="row attr-row" title={`Injury risk ${risk} of 5: ${INJURY_RISK_LABEL[risk]}`}>
          <span className="small attr-label">Injury risk</span>
          <span className="attr-pips" data-testid="injury-risk" data-level={risk}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`pip ${n <= risk ? (risk >= 4 ? 'bad' : risk === 3 ? 'warn' : 'good') : ''}`} />
            ))}
          </span>
          <span className="small muted attr-word">{INJURY_RISK_LABEL[risk]}</span>
        </div>,
        ...(state
          ? [
              <div key="cond" className="row attr-row">
                <span className="small attr-label">Condition</span>
                <Bar value={state.condition} colour={conditionColour(state.condition)} />
                <span className="mono small attr-value">{meterValue(state.condition)}</span>
              </div>,
            ]
          : []),
      ],
    },
  ]
  return (
    <div className="attr-panel" data-testid="attribute-panel">
      {groups.map((g) => (
        <section key={g.title} className="attr-group">
          <h4>{g.title}</h4>
          {g.rows}
        </section>
      ))}
    </div>
  )
}

/** An attribute the club can only see as a range: the bar spans it, the figure reads "62–70". */
function rangeAttr(label: string, r: { lo: number; hi: number }): ReactNode {
  const mid = (r.lo + r.hi) / 2
  return (
    <div key={label} className="row attr-row" title={`${label}: somewhere from ${r.lo} to ${r.hi}`}>
      <span className="small attr-label">{label}</span>
      <span className="bar range-bar">
        <span className="range-span" style={{ left: `${r.lo}%`, width: `${Math.max(2, r.hi - r.lo)}%`, background: mid >= 80 ? 'var(--good)' : mid >= 65 ? 'var(--meter-mid)' : 'var(--text-3)' }} />
      </span>
      <span className="mono small attr-value range-value">
        {r.lo}–{r.hi}
      </span>
    </div>
  )
}

/** A hidden trait before the scout has watched him. */
function unknownTrait(label: string): ReactNode {
  return (
    <div key={label} className="row attr-row" title={`${label}: scout him to find out`}>
      <span className="small attr-label">{label}</span>
      <span className="bar" />
      <span className="small muted attr-word">Unknown</span>
    </div>
  )
}

function exactAttr(label: string, value: number): ReactNode {
  return (
    <div key={label} className="row attr-row">
      <span className="small attr-label">{label}</span>
      <Bar value={value} colour={value >= 80 ? 'var(--good)' : value >= 65 ? 'var(--meter-mid)' : 'var(--text-3)'} />
      <span className="mono small attr-value">{value}</span>
    </div>
  )
}

/** Hidden traits are shown as a bar and a word, never as a number. */
function exactTrait(label: string, value: number): ReactNode {
  const word = value >= 0.7 ? 'High' : value >= 0.45 ? 'Average' : 'Low'
  return (
    <div key={label} className="row attr-row" title={`${label}: ${word.toLowerCase()}`}>
      <span className="small attr-label">{label}</span>
      <Bar value={Math.round(value * 100)} colour={value >= 0.7 ? 'var(--good)' : value >= 0.45 ? 'var(--meter-mid)' : 'var(--text-3)'} />
      <span className="small muted attr-word">{word}</span>
    </div>
  )
}

/** Attribute keys a squad list can show as an extra column. */
export const SQUAD_COLUMNS: Array<{ key: AttributeKey; label: string; short: string }> = [{ key: 'stamina', label: 'Stamina', short: 'Sta' }]
