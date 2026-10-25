import type { ReactNode } from 'react'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { Flag, Pos, Rating, Bar } from './bits'
import { conditionColour, seasonLabel, clubShort } from '../format'
import { useStore } from '@game/store'

/** `showLabels` prints Cond, Mor and Shp under the three state bars (the Key toggle), for screens that cannot hover; `highlight` marks a row that fits the slot being filled (Position First). */
export function PlayerRow({ p, state, right, onClick, dim, selected, highlight, hideRatings, showClub, extra, showLabels }: { p: PlayerSeason; state?: SquadPlayer; right?: ReactNode; onClick?: () => void; dim?: boolean; selected?: boolean; highlight?: boolean; hideRatings?: boolean; showClub?: boolean; extra?: ReactNode; showLabels?: boolean }) {
  const u = useStore((s) => s.universe)
  const flags: ReactNode[] = []
  if (state?.injury) flags.push(<span key="inj" className="chip bad" title={state.injury.description}>🩹 {state.injury.weeksOut}w</span>)
  if (state && state.suspension > 0) flags.push(<span key="sus" className="chip bad">🟥 {state.suspension}</span>)
  if (p.accolades.includes('Champion')) flags.push(<span key="ch" className="chip gold" title="Won the league that season">🏆</span>)
  return (
    <button type="button" className={`prow ${dim ? 'dim' : ''} ${selected ? 'selected' : ''} ${highlight ? 'fit' : ''}`} onClick={dim ? undefined : onClick} disabled={dim && !onClick}>
      <Rating value={p.overall} hidden={hideRatings} />
      <span className="col" style={{ gap: 2 }}>
        <span className="name">
          <Flag nation={p.nationality} /> {p.name}
          {flags}
        </span>
        <span className="meta">
          {p.positions.map((pos) => (
            <Pos key={pos} p={pos} />
          ))}
          <span>{p.age}y</span>
          {showClub && (
            <span>
              {clubShort(u, p.clubId)} {seasonLabel(p.season)}
            </span>
          )}
          {extra}
        </span>
        {state && (
          <span className="state-bars" title={`Condition ${state.condition} · Morale ${state.morale} · Sharpness ${state.sharpness}`}>
            <Bar value={state.condition} colour={conditionColour(state.condition)} />
            <Bar value={state.morale} colour="var(--info)" />
            <Bar value={state.sharpness} colour="var(--meter-sharpness)" />
          </span>
        )}
        {state && showLabels && (
          <span className="state-bars state-labels" data-testid="state-labels" aria-hidden="true">
            <span>Cond</span>
            <span>Mor</span>
            <span>Shp</span>
          </span>
        )}
      </span>
      <span className="right">{right}</span>
    </button>
  )
}
