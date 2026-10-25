import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Bandage, Trophy } from 'lucide-react'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { EstimatedChip, Flag, Pos, Rating, Bar } from './bits'
import { conditionColour, seasonLabel, clubShort } from '../format'
import { useStore } from '@game/store'
import { RedCard } from './icons'
import { isEstimated } from '@game/logic/era'
import { formTrend } from '@game/logic/playerCard'
import { MoraleFace } from '../matchday/MoraleFace'

/**
 * `showLabels` prints Cond, Mor and Shp under the state strip (condition bar, morale face, sharpness bar) for screens that cannot hover (the Key toggle); `highlight` marks a row that fits the slot being filled (Position First).
 * With `state`, a form arrow follows the name: the last three ratings against the season average (`formTrend`).
 * `hideChampion` drops the title-winner flag where the whole list shares it (a champion squad on the draft).
 */
export function PlayerRow({ p, state, right, onClick, dim, selected, highlight, hideRatings, showClub, extra, showLabels, hideChampion }: { p: PlayerSeason; state?: SquadPlayer; right?: ReactNode; onClick?: () => void; dim?: boolean; selected?: boolean; highlight?: boolean; hideRatings?: boolean; showClub?: boolean; extra?: ReactNode; showLabels?: boolean; hideChampion?: boolean }) {
  const u = useStore((s) => s.universe)
  const flags: ReactNode[] = []
  if (state?.injury) flags.push(<span key="inj" className="chip bad icon-chip" title={state.injury.description}><Bandage size={12} aria-hidden="true" /> {state.injury.weeksOut}w</span>)
  if (state && state.suspension > 0) flags.push(<span key="sus" className="chip bad icon-chip" title={`Suspended for ${state.suspension}`}><RedCard size={12} /> {state.suspension}</span>)
  if (!hideChampion && p.accolades.includes('Champion')) flags.push(<span key="ch" className="chip gold icon-chip" title="Won the league that season" aria-label="Champion"><Trophy size={12} aria-hidden="true" /></span>)
  if (u && isEstimated(u, p)) flags.push(<EstimatedChip key="est" compact />)
  const trend = state ? formTrend(state) : null
  const Arrow = trend?.dir === 'up' ? ArrowUp : trend?.dir === 'down' ? ArrowDown : ArrowRight
  return (
    <button type="button" className={`prow ${dim ? 'dim' : ''} ${selected ? 'selected' : ''} ${highlight ? 'fit' : ''}`} onClick={dim ? undefined : onClick} disabled={dim && !onClick}>
      <Rating value={p.overall} hidden={hideRatings} />
      <span className="col" style={{ gap: 2 }}>
        <span className="name">
          <Flag nation={p.nationality} /> {p.name}
          {trend && (
            <span className={`form-arrow ${trend.dir}`} title={trend.title} aria-label={trend.title} data-testid="form-arrow" data-dir={trend.dir}>
              <Arrow size={12} strokeWidth={2.6} aria-hidden="true" />
            </span>
          )}
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
          <span className="state-bars" title={`Condition ${Math.round(state.condition)} · Morale ${Math.round(state.morale)} · Sharpness ${Math.round(state.sharpness)}`}>
            <Bar value={state.condition} colour={conditionColour(state.condition)} />
            <span className="state-face" data-testid="morale-face">
              <MoraleFace value={state.morale} />
            </span>
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
