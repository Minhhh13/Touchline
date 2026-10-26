import type { ReactNode } from 'react'
import { Bandage, Trophy } from 'lucide-react'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { EstimatedChip, Flag, Pos, Rating, Bar } from './bits'
import { conditionColour, seasonLabel, clubShort, meterValue } from '../format'
import { useStore } from '@game/store'
import { RedCard } from './icons'
import { isEstimated } from '@game/logic/era'
import { MoraleFace } from '../matchday/MoraleFace'
import { FormArrow, MotmStar, Sparkline } from './FormBits'

/**
 * `showLabels` prints Cond, Shp and Mor under the two state bars and the morale face (the Key toggle), for screens that cannot hover; `highlight` marks a row that fits the slot being filled (Position First).
 * With `state`, the name line carries one form arrow (`FormArrow`, from `squadDisplay.formTrend`), the sparkline and the MOTM star; the morale face (`data-testid="morale-face"`) replaces the morale bar.
 * `hideChampion` drops the title-winner flag where the whole list shares it (a champion squad on the draft).
 */
export function PlayerRow({ p, state, right, onClick, dim, selected, highlight, hideRatings, showClub, extra, showLabels, hideChampion, range }: { p: PlayerSeason; state?: SquadPlayer; right?: ReactNode; onClick?: () => void; dim?: boolean; selected?: boolean; highlight?: boolean; hideRatings?: boolean; showClub?: boolean; extra?: ReactNode; showLabels?: boolean; hideChampion?: boolean; range?: { lo: number; hi: number } }) {
  const u = useStore((s) => s.universe)
  const flags: ReactNode[] = []
  if (state?.injury) flags.push(<span key="inj" className="chip bad icon-chip" title={state.injury.description}><Bandage size={12} aria-hidden="true" /> {state.injury.weeksOut}w</span>)
  if (state && state.suspension > 0) flags.push(<span key="sus" className="chip bad icon-chip" title={`Suspended for ${state.suspension}`}><RedCard size={12} /> {state.suspension}</span>)
  if (!hideChampion && p.accolades.includes('Champion')) flags.push(<span key="ch" className="chip gold icon-chip" title="Won the league that season" aria-label="Champion"><Trophy size={12} aria-hidden="true" /></span>)
  if (u && isEstimated(u, p)) flags.push(<EstimatedChip key="est" compact />)
  return (
    <button type="button" className={`prow ${dim ? 'dim' : ''} ${selected ? 'selected' : ''} ${highlight ? 'fit' : ''} ${range && range.hi > range.lo && !hideRatings ? 'ranged' : ''}`} onClick={dim ? undefined : onClick} disabled={dim && !onClick}>
      <Rating value={p.overall} hidden={hideRatings} range={range} label="Overall" />
      <span className="col" style={{ gap: 2 }}>
        <span className="name">
          <Flag nation={p.nationality} /> {p.name}
          {flags}
          {state && <MotmStar count={state.seasonStats.motm} />}
          {state && <FormArrow s={state} />}
          {state && <Sparkline ratings={state.recentRatings} />}
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
          <span className="state-bars" title={`Condition ${meterValue(state.condition)} · Sharpness ${meterValue(state.sharpness)} · Morale ${meterValue(state.morale)}`}>
            <Bar value={state.condition} colour={conditionColour(state.condition)} />
            <Bar value={state.sharpness} colour="var(--meter-sharpness)" />
            <span className="state-face" data-testid="morale-face">
              <MoraleFace value={state.morale} />
            </span>
          </span>
        )}
        {state && showLabels && (
          <span className="state-bars state-labels" data-testid="state-labels" aria-hidden="true">
            <span>Cond</span>
            <span>Shp</span>
            <span>Mor</span>
          </span>
        )}
      </span>
      <span className="right">{right}</span>
    </button>
  )
}
