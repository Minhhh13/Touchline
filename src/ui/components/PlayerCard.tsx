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
import { clubName, conditionColour, meterValue, money, moraleWord, seasonLabel } from '../format'
import { countPhrase } from '../screenText'

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
        <span className="chip">{p.age} years</span>
        <span className="chip">
          {clubName(u, p.clubId)} {seasonLabel(p.season)}
        </span>
        {peak > 0 && <span className="chip gold" data-testid="card-peak">Peak {peak}</span>}
        {titles > 0 && (
          <span className="chip gold icon-chip">
            <Trophy size={12} aria-hidden="true" /> {titles} title{titles === 1 ? '' : 's'}
          </span>
        )}
        {seasons.length > 0 && (
          <span className="chip">
            {points.length} season{points.length === 1 ? '' : 's'} · {clubs} club{clubs === 1 ? '' : 's'}
          </span>
        )}
        {anyEstimated && <EstimatedChip compact />}
        {headChips}
        {headExtra}
      </div>

      <div className="pc-body">
        <section className="pc-box pc-profile" aria-label="Profile">
          <h3 className="pc-title">
            Rating by season{anyEstimated && <span className="pc-hint"> · dashed: est.</span>}
          </h3>
          <SeasonChart points={points} u={u} />
          <h3 className="pc-title">
            Positions
            <span className="pc-key" aria-hidden="true">
              <i className="natural" /> Natural <i className="cover" /> Cover
            </span>
          </h3>
          <PositionMap spots={positionMap(p)} />
          {state && (
            <>
              <h3 className="pc-title">Form{form.length ? ` · last ${form.length}` : ''}</h3>
              <FormGraph points={form} avg={avg} />
              <div className="pc-form-foot">
                <FormPills ratings={state.recentRatings} />
              </div>
              <div className="small muted pc-season-line" data-testid="card-season-line">
                {countPhrase(state.seasonStats.apps, 'apps')} · {state.seasonStats.goals} g · {state.seasonStats.assists} a · avg {avg === null ? '–' : avg.toFixed(2)}
                {state.seasonStats.motm > 0 ? ` · ${state.seasonStats.motm} MOTM` : ''}
              </div>
            </>
          )}
        </section>

        <section className="pc-box pc-attrs" aria-label="Attributes">
          <h3 className="pc-title">Attributes{attrCaption && <span className="pc-hint"> · {attrCaption}</span>}</h3>
          <AttributePanel p={p} />
          {state && (
            <div className="pc-meters" data-testid="card-meters">
              <Meter label="Condition" value={state.condition} colour={conditionColour(state.condition)} />
              <Meter label="Morale" value={state.morale} colour="var(--info)" face={<MoraleFace value={state.morale} />} word={moraleWord(state.morale)} />
              <Meter label="Sharpness" value={state.sharpness} colour="var(--meter-sharpness)" />
              <Meter label="Familiarity" value={state.familiarity} colour="var(--meter-mid)" />
            </div>
          )}
        </section>

        <section className="pc-box pc-career" aria-label="Career">
          <div className="pc-career-main">
            {panels?.length ? (
              <div className="pc-tabs" role="tablist" aria-label="Career and more">
                {[{ id: 'career', label: 'Career' }, ...panels].map((x) => (
                  <button key={x.id} type="button" role="tab" aria-selected={(extra?.id ?? 'career') === x.id} className={(extra?.id ?? 'career') === x.id ? 'active' : ''} onClick={() => setTab(x.id)} data-testid={`card-tab-${x.id}`}>
                    {x.label}
                  </button>
                ))}
              </div>
            ) : (
              <h3 className="pc-title">Career</h3>
            )}
            <div className="pc-career-scroll" data-testid="career-table">
              {extra ? (
                <div className="pc-panel">{extra.content}</div>
              ) : seasons.length === 0 ? (
                <p className="small muted pc-empty">Not in the database: an academy player.</p>
              ) : (
                <table className="tbl pc-tbl">
                  <thead>
                    <tr>
                      <th className="c-season">Season</th>
                      <th>Club</th>
                      <th className="num c-age">Age</th>
                      <th className="num c-ovr">OVR</th>
                      <th className="num c-value">Value</th>
                      <th className="c-star">Shortlist</th>
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
                              {s.accolades.includes('Champion') && <Trophy size={13} className="gold-ic" aria-label="Champions" />}
                            </span>
                          </td>
                          <td className="num">{s.age}</td>
                          <td className="num">
                            <Rating value={s.overall} />
                            {isEstimated(u, s.id) && <> <EstimatedChip compact /></>}
                          </td>
                          <td className="num c-value">{money(s.value)}</td>
                          <td className="c-star">
                            <button type="button" className={`pc-star ${on ? 'on' : ''}`} onClick={() => toggleShortlist(s.id)} title={on ? 'On your shortlist' : 'Shortlist this season'} aria-label={on ? 'Remove from shortlist' : 'Shortlist this season'} aria-pressed={on}>
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
    <div className="pc-meter" title={word ? `${label}: ${word} (${v})` : `${label} ${v}`}>
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
