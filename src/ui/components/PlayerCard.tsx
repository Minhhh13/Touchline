import { useMemo, useState, type ReactNode } from 'react'
import { Trophy } from 'lucide-react'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { useStore } from '@game/store'
import { formSeries, positionMap, seasonSeries } from '@game/logic/playerCard'
import { roleSuitability } from '@game/logic/playerProfile'
import { MoraleFace } from '../matchday/MoraleFace'
import { AttributePanel } from './AttributePanel'
import { FormGraph, FormPills, PositionMap, SeasonChart } from './PlayerCharts'
import { BestSeasons, CareerTable, RoleList, SimilarList } from './PlayerProfile'
import { Bar, EstimatedChip, Flag, Modal, Pos, Rating } from './bits'
import { clubName, conditionColour, fixed, meterValue, moraleWord, seasonLabel } from '../format'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'
import { playerCard } from '../i18n/en/playerCard'

const t = translator(explore)
const tc = translator(playerCard)
import { onTabListKey } from '../a11y'

export interface PlayerCardProps {
  /** The season the card describes: its attributes, positions and map (the squad's copy in the Dugout, the peak season in Explore). */
  p: PlayerSeason
  /** Every database season of the player, oldest first (`careerSeasons`). */
  seasons: PlayerSeason[]
  /** Squad mode: the form graph, the meters and the morale face. */
  state?: SquadPlayer
  /** A line above the attributes, such as "At his peak · Chelsea 2016-17". */
  attrCaption?: ReactNode
  /** Chips the screen adds to the head strip (status, contract, wage, injury). */
  headChips?: ReactNode
  /** A slot at the end of the head strip for extra chips from other features (a personality chip). */
  headExtra?: ReactNode
  /** The actions row under the boxes (Start at, To bench, Make captain, Have a word). */
  actions?: ReactNode
  /** Extra cards from other features (Happiness, Contract), each a tab beside Career in the third box, so the box keeps one scroller. */
  panels?: Array<{ id: string; label: string; content: ReactNode }>
  /** Opens another player's card (Explore): makes the Similar tab's rows buttons. */
  onPlayer?: (playerId: string) => void
}

/**
 * The one player card, for the Dugout squad and the Explore database. A head strip over three boxes:
 * Profile (rating by season, position map, form), Attributes (three even columns) and Career (the
 * table, the card's only scroller). It fits one screen on a desktop; on a phone it is a full-height
 * sheet whose boxes stack and scroll together.
 */
export function PlayerCard({ p, seasons, state, attrCaption, headChips, headExtra, actions, panels, onPlayer }: PlayerCardProps) {
  const u = useStore((s) => s.universe)
  const shortlist = useStore((s) => s.shortlist)
  const toggleShortlist = useStore((s) => s.toggleShortlist)
  const [tab, setTab] = useState('career')
  const bestRole = useMemo(() => roleSuitability(p, 1)[0], [p])
  if (!u) return null
  const extra = panels?.find((x) => x.id === tab)
  // Career first, then the card's own deeper tabs (only with seasons to read), then the other features' panels
  const own = seasons.length ? [{ id: 'best', label: tc('tabBest') }, { id: 'roles', label: tc('tabRoles') }, { id: 'similar', label: tc('tabSimilar') }] : []
  const tabs = [{ id: 'career', label: t('career') }, ...own, ...(panels ?? []).map((x) => ({ id: x.id, label: x.label }))]
  const shownTab = tabs.some((x) => x.id === tab) ? tab : 'career'
  const points = seasonSeries(u, seasons)
  const peak = points.reduce((m, x) => Math.max(m, x.overall), 0)
  const titles = seasons.filter((s) => s.accolades.includes('Champion')).length
  const clubs = new Set(seasons.map((s) => s.clubId)).size
  const anyEstimated = points.some((x) => x.estimated)
  const form = state ? formSeries(state) : []
  const avg = state && state.seasonStats.apps ? state.seasonStats.ratingSum / state.seasonStats.apps : null
  const peakPoint = points.find((x) => x.peak)
  const peakRow = peakPoint ? seasons.find((s) => s.season === peakPoint.season && s.overall === peak) : undefined
  return (
    <div className={`player-card ${state ? 'squad' : 'career'}`} data-testid="player-card">
      <div className="pc-head">
        <Rating value={p.overall} size="lg" />
        <Flag nation={p.nationality} />
        <span className="pc-pos">
          {p.positions.map((x) => (
            <Pos key={x} p={x} />
          ))}
        </span>
        <span className="chip">{t('years', { n: p.age })}</span>
        <span className="chip">
          {clubName(u, p.clubId)} {seasonLabel(p.season)}
        </span>
        {peak > 0 && <span className="chip gold" data-testid="card-peak">{t('peak', { n: peak })}</span>}
        {titles > 0 && (
          <span className="chip gold icon-chip">
            <Trophy size={12} aria-hidden="true" /> {t('titles', { n: titles })}
          </span>
        )}
        {seasons.length > 0 && (
          <span className="chip">
            {t('seasonsClubs', { seasons: points.length, clubs })}
          </span>
        )}
        {bestRole && (
          <span className="chip info" data-testid="card-best-role" title={`${bestRole.position} · ${bestRole.rating}`}>
            {tc('bestRole', { role: bestRole.name })}
          </span>
        )}
        {anyEstimated && <EstimatedChip compact />}
        {headChips}
        {headExtra}
      </div>

      <div className="pc-body">
        <section className="pc-box pc-profile" aria-label={t('profile')}>
          <h3 className="pc-title">
            {t('ratingBySeason')}{anyEstimated && <span className="pc-hint">{t('dashedEst')}</span>}
          </h3>
          <SeasonChart points={points} u={u} />
          <h3 className="pc-title">
            {t('positions')}
            <span className="pc-key" aria-hidden="true">
              <i className="natural" /> {t('natural')} <i className="cover" /> {t('cover')}
            </span>
          </h3>
          <PositionMap spots={positionMap(p)} />
          {/* The map's figures are his attributes weighed for each position, not the overall on his badge */}
          <p className="small muted pc-map-note" data-testid="card-map-note">{t('positionsNote')}</p>
          {state && (
            <>
              <h3 className="pc-title">{form.length ? t('formLast', { n: form.length }) : t('form')}</h3>
              <FormGraph points={form} avg={avg} />
              <div className="pc-form-foot">
                <FormPills ratings={state.recentRatings} />
              </div>
              <div className="small muted pc-season-line" data-testid="card-season-line">
                {t('seasonLine', { apps: state.seasonStats.apps, goals: state.seasonStats.goals, assists: state.seasonStats.assists, avg: avg === null ? '–' : fixed(avg, 2) })}
                {state.seasonStats.motm > 0 ? t('motm', { n: state.seasonStats.motm }) : ''}
              </div>
            </>
          )}
        </section>

        <section className="pc-box pc-attrs" aria-label={t('attributes')}>
          <h3 className="pc-title">{t('attributes')}{attrCaption && <span className="pc-hint">{t('captionSep')}{attrCaption}</span>}</h3>
          <AttributePanel p={p} />
          {state && (
            <div className="pc-meters" data-testid="card-meters">
              <Meter label={t('condition')} value={state.condition} colour={conditionColour(state.condition)} />
              <Meter label={t('morale')} value={state.morale} colour="var(--info)" face={<MoraleFace value={state.morale} />} word={moraleWord(state.morale)} />
              <Meter label={t('sharpness')} value={state.sharpness} colour="var(--meter-sharpness)" />
              <Meter label={t('familiarity')} value={state.familiarity} colour="var(--meter-mid)" />
            </div>
          )}
        </section>

        <section className="pc-box pc-career" aria-label={t('career')}>
          <div className="pc-career-main">
            <div className="pc-tabs" role="tablist" aria-label={t('careerMore')} onKeyDown={onTabListKey}>
              {tabs.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={shownTab === x.id} tabIndex={shownTab === x.id ? 0 : -1} className={shownTab === x.id ? 'active' : ''} onClick={() => setTab(x.id)} data-testid={`card-tab-${x.id}`}>
                  {x.label}
                </button>
              ))}
            </div>
            <div className="pc-career-scroll" data-testid="career-table">
              {extra ? (
                <div className="pc-panel">{extra.content}</div>
              ) : seasons.length === 0 ? (
                <p className="small muted pc-empty">{t('notInDatabase')}</p>
              ) : shownTab === 'best' ? (
                <BestSeasons u={u} seasons={seasons} />
              ) : shownTab === 'roles' ? (
                <RoleList p={p} />
              ) : shownTab === 'similar' ? (
                <SimilarList u={u} p={p} onPlayer={onPlayer} />
              ) : (
                <CareerTable u={u} seasons={seasons} current={p.id} peakId={peakRow?.id} shortlist={shortlist} onStar={toggleShortlist} />
              )}
            </div>
          </div>
        </section>
      </div>

      {actions && <div className="pc-actions">{actions}</div>}
    </div>
  )
}

function Meter({ label, value, colour, face, word }: { label: string; value: number; colour: string; face?: ReactNode; word?: string }) {
  const v = meterValue(value)
  return (
    <div className="pc-meter" title={word ? t('meterWord', { label, word, v }) : t('meter', { label, v })}>
      <span className="pc-meter-top">
        <span className="pc-meter-label">{label}</span>
        <span className="pc-meter-val">
          {face}
          <span className="mono">{v}</span>
        </span>
      </span>
      <Bar value={value} colour={colour} />
    </div>
  )
}

/** The card in its modal: one dialog that fits the window on a desktop, a full-height sheet on a phone. */
export function PlayerCardModal({ title, onClose, ...card }: PlayerCardProps & { title: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title} className="card-modal">
      <PlayerCard {...card} />
    </Modal>
  )
}
