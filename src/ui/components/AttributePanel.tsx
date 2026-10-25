import type { ReactNode } from 'react'
import type { AttributeKey, PlayerSeason, SquadPlayer } from '@engine/types'
import { INJURY_RISK_LABEL, injuryRiskLevel } from '@engine/depth'
import { Bar } from './bits'
import { conditionColour } from '../format'

/**
 * Football Manager-style attribute panel: labelled bars in five groups, the
 * hidden traits as bars with a word rather than a number, the injury risk as
 * a 1 to 5 scale and, for a squad player, his condition.
 */
export function AttributePanel({ p, state }: { p: PlayerSeason; state?: SquadPlayer }) {
  const a = p.attributes
  const t = p.traits
  const risk = injuryRiskLevel(t)
  const groups: Array<{ title: string; rows: ReactNode[] }> = [
    { title: 'Technical', rows: [attr('Shooting', a.shooting), attr('Passing', a.passing), attr('Dribbling', a.dribbling)] },
    { title: 'Physical', rows: [attr('Pace', a.pace), attr('Stamina', a.stamina), attr('Strength', a.strength), attr('Jumping', a.jumping)] },
    {
      title: 'Mental',
      rows: [attr('Mentality', a.mentality), attr('Aggression', a.aggression), attr('Work rate', a.workRate), trait('Big match', t.bigMatch), trait('Consistency', t.consistency), trait('Professional', t.professionalism)],
    },
    { title: 'Defending', rows: [attr('Defending', a.defending)] },
    { title: 'Goalkeeping', rows: [attr('Goalkeeping', a.goalkeeping)] },
    {
      title: 'Fitness',
      rows: [
        <div key="risk" className="row attr-row" title={`Injury risk ${risk} of 5: ${INJURY_RISK_LABEL[risk]}`}>
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
                <span className="mono small attr-value">{state.condition}</span>
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

function attr(label: string, value: number): ReactNode {
  return (
    <div key={label} className="row attr-row">
      <span className="small attr-label">{label}</span>
      <Bar value={value} colour={value >= 80 ? 'var(--accent)' : value >= 65 ? 'var(--gold)' : 'var(--text-3)'} />
      <span className="mono small attr-value">{value}</span>
    </div>
  )
}

/** Hidden traits are shown as a bar and a word, never as a number. */
function trait(label: string, value: number): ReactNode {
  const word = value >= 0.7 ? 'High' : value >= 0.45 ? 'Average' : 'Low'
  return (
    <div key={label} className="row attr-row" title={`${label}: ${word.toLowerCase()}`}>
      <span className="small attr-label">{label}</span>
      <Bar value={Math.round(value * 100)} colour={value >= 0.7 ? 'var(--accent)' : value >= 0.45 ? 'var(--gold)' : 'var(--text-3)'} />
      <span className="small muted attr-word">{word}</span>
    </div>
  )
}

/** Attribute keys a squad list can show as an extra column. */
export const SQUAD_COLUMNS: Array<{ key: AttributeKey; label: string; short: string }> = [{ key: 'stamina', label: 'Stamina', short: 'Sta' }]
