import { useState, type ReactNode } from 'react'
import { Star, Trophy } from 'lucide-react'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { useStore } from '@game/store'
import { formSeries, positionMap, seasonSeries, shortSeason } from '@game/logic/playerCard'
import { isEstimated } from '@game/logic/era'
import { MoraleFace } from '../matchday/MoraleFace'
import { AttributePanel } from './AttributePanel'
import { FormGraph, FormPills, PositionMap, SeasonChart } from './PlayerCharts'
import { Bar, ClubBadge, EstimatedChip, Flag, Modal, Pos, Rating } from './bits'
import { clubName, conditionColour, fixed, meterValue, money, moraleWord, seasonLabel } from '../format'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'

const t = translator(explore)
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
}

/**
 * The one player card, for the Dugout squad and the Explore database. A head strip over three boxes:
 * Profile (rating by season, position map, form), Attributes (three even columns) and Career (the
 * table, the card's only scroller). It fits one screen on a desktop; on a phone it is a full-height
 * sheet whose boxes stack and scroll together.
 */
export function PlayerCard({ p, seasons, state, attrCaption, headChips, headExtra, actions, panels }: PlayerCardProps) {
  const { universe: u, shortlist, toggleShortlist } = useStore()
  const [tab, setTab] = useState('career')
  if (!u) return null
  const extra = panels?.find((x) => x.id === tab)
  const points = seasonSeries(u, seasons)
  const peak = points.reduce((m, x) => Math.max(m, x.overall), 0)
  const titles = seasons.filter((s) => s.accolades.includes('Champion')).length
  const clubs = new Set(seasons.map((s) => s.clubId)).size
  const anyEstimated = points.some((x) => x.estimated)
  const form = state ? formSeries(state) : []
  const avg = state && state.seasonStats.apps ? state.seasonStats.ratingSum / state.seasonStats.apps : null
  const peakSeasonId = points.find((x) => x.peak)
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
            {panels?.length ? (
              <div className="pc-tabs" role="tablist" aria-label={t('careerMore')} onKeyDown={onTabListKey}>
                {[{ id: 'career', label: t('career') }, ...panels].map((x) => (
                  <button key={x.id} type="button" role="tab" aria-selected={(extra?.id ?? 'career') === x.id} tabIndex={(extra?.id ?? 'career') === x.id ? 0 : -1} className={(extra?.id ?? 'career') === x.id ? 'active' : ''} onClick={() => setTab(x.id)} data-testid={`card-tab-${x.id}`}>
                    {x.label}
                  </button>
                ))}
              </div>
            ) : (
              <h3 className="pc-title">{t('career')}</h3>
            )}
            <div className="pc-career-scroll" data-testid="career-table">
              {extra ? (
                <div className="pc-panel">{extra.content}</div>
              ) : seasons.length === 0 ? (
                <p className="small muted pc-empty">{t('notInDatabase')}</p>
              ) : (
                <table className="tbl pc-tbl">
                  <thead>
                    <tr>
                      <th className="c-season">{t('colSeason')}</th>
                      <th>{t('colClub')}</th>
                      <th className="num c-age">{t('colAge')}</th>
                      <th className="num c-ovr">{t('colOvr')}</th>
                      <th className="num c-value">{t('colValue')}</th>
                      <th className="c-star">{t('shortlist')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasons.map((s) => {
                      const on = shortlist.includes(s.id)
                      const best = !!peakSeasonId && s.season === peakSeasonId.season && s.overall === peak
                      return (
                        <tr key={s.id} className={`${s.id === p.id ? 'me' : ''} ${best ? 'best' : ''}`} title={`${seasonLabel(s.season)} · ${clubName(u, s.clubId)} · ${s.overall} · ${money(s.value)}`}>
                          <td>
                            <span className="pc-season-long">{seasonLabel(s.season)}</span>
                            <span className="pc-season-short">{shortSeason(s.season)}</span>
                          </td>
                          <td>
                            <span className="pc-club">
                              <ClubBadge clubId={s.clubId} size={18} />
                              <span className="pc-club-name">{clubName(u, s.clubId)}</span>
                              {s.accolades.includes('Champion') && <Trophy size={13} className="gold-ic" role="img" aria-label={t('champions')} />}
                            </span>
                          </td>
                          <td className="num">{s.age}</td>
                          <td className="num">
                            <Rating value={s.overall} />
                            {isEstimated(u, s.id) && <> <EstimatedChip compact /></>}
                          </td>
                          <td className="num c-value">{money(s.value)}</td>
                          <td className="c-star">
                            <button type="button" className={`pc-star ${on ? 'on' : ''}`} onClick={() => toggleShortlist(s.id)} title={t(on ? 'onShortlist' : 'shortlistSeason')} aria-label={t(on ? 'removeShortlist' : 'shortlistSeason')} aria-pressed={on}>
                              <Star size={16} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
