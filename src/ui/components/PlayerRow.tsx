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
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'

const t = translator(draft)

/**
 * `showLabels` prints Cond, Shp and Mor under the two state bars and the morale face (the Key toggle), for screens that cannot hover; `highlight` marks a row that fits the slot being filled (Position First).
 * With `state`, the name line carries one form arrow (`FormArrow`, from `squadDisplay.formTrend`), the sparkline and the MOTM star; the morale face (`data-testid="morale-face"`) replaces the morale bar.
 * `hideChampion` drops the title-winner flag where the whole list shares it (a champion squad on the draft).
 */
export function PlayerRow({ p, state, right, onClick, dim, selected, highlight, hideRatings, showClub, extra, showLabels, hideChampion, range }: { p: PlayerSeason; state?: SquadPlayer; right?: ReactNode; onClick?: () => void; dim?: boolean; selected?: boolean; highlight?: boolean; hideRatings?: boolean; showClub?: boolean; extra?: ReactNode; showLabels?: boolean; hideChampion?: boolean; range?: { lo: number; hi: number } }) {
  const u = useStore((s) => s.universe)
  const flags: ReactNode[] = []
  if (state?.injury) flags.push(<span key="inj" className="chip bad icon-chip" title={state.injury.description}><Bandage size={12} aria-hidden="true" /> {t('weeksOut', { n: state.injury.weeksOut })}</span>)
  if (state && state.suspension > 0) flags.push(<span key="sus" className="chip bad icon-chip" title={t('suspendedFor', { n: state.suspension })}><RedCard size={12} /> {state.suspension}</span>)
  if (!hideChampion && p.accolades.includes('Champion')) flags.push(<span key="ch" className="chip gold icon-chip" title={t('wonLeague')} role="img" aria-label={t('champion')}><Trophy size={12} aria-hidden="true" /></span>)
  if (u && isEstimated(u, p)) flags.push(<EstimatedChip key="est" compact />)
  return (
    <button type="button" className={`prow ${dim ? 'dim' : ''} ${selected ? 'selected' : ''} ${highlight ? 'fit' : ''} ${range && range.hi > range.lo && !hideRatings ? 'ranged' : ''}`} onClick={dim ? undefined : onClick} disabled={dim && !onClick} aria-disabled={dim || undefined}>
      <Rating value={p.overall} hidden={hideRatings} range={range} label={t('overall')} />
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
          <span>{t('ageYears', { n: p.age })}</span>
          {showClub && (
            <span>
              {clubShort(u, p.clubId)} {seasonLabel(p.season)}
            </span>
          )}
          {extra}
        </span>
        {state && (
          <span className="state-bars" title={t('stateBars', { c: meterValue(state.condition), s: meterValue(state.sharpness), m: meterValue(state.morale) })}>
            <Bar value={state.condition} colour={conditionColour(state.condition)} />
            <Bar value={state.sharpness} colour="var(--meter-sharpness)" />
            <span className="state-face" data-testid="morale-face">
              <MoraleFace value={state.morale} />
            </span>
          </span>
        )}
        {state && showLabels && (
          <span className="state-bars state-labels" data-testid="state-labels" aria-hidden="true">
            <span>{t('condShort')}</span>
            <span>{t('shpShort')}</span>
            <span>{t('morShort')}</span>
          </span>
        )}
      </span>
      <span className="right">{right}</span>
    </button>
  )
}
