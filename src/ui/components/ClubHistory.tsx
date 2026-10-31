import { useState } from 'react'
import { Medal, Globe, Trophy, Crown } from 'lucide-react'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '@game/types'
import { bestXI, BEST_XI_MIN_APPS, honoursOf, legendAverage, legendsOf, targetMet } from '@game/logic/dynastyHistory'
import { ClubBadge, Pos, Segmented } from './bits'
import { LeagueFlag } from './Flag'
import { clubName, ordinal, seasonLabel } from '../format'
import { translator } from '../i18n'
import { history as historyText } from '../i18n/en/history'

const t = translator(historyText)

type View = 'seasons' | 'honours' | 'xi'

/** The Club tab's history box (Season and Dynasty): every season's line, the honours and the best XI of the dynasty. */
export function ClubHistory({ game, u }: { game: Game; u: LoadedUniverse }) {
  const [view, setView] = useState<View>('seasons')
  const lines = game.history
  return (
    <div className="panel fit-panel" data-testid="club-history" role="group" aria-label={t('clubHistory')}>
      <div className="panel-head">
        <h3>{t('clubHistory')}</h3>
        <Segmented
          label={t('historyView')}
          value={view}
          onChange={setView}
          options={[
            { value: 'seasons', label: t('viewSeasons'), testId: 'history-seasons' },
            { value: 'honours', label: t('viewHonours'), testId: 'history-honours' },
            { value: 'xi', label: t('viewBestXI'), testId: 'history-xi' },
          ]}
        />
      </div>
      <div className="fit-scroll">
        {lines.length === 0 && <p className="muted small">{t('noHistory')}</p>}
        {lines.length > 0 && view === 'seasons' && <SeasonLines game={game} u={u} />}
        {lines.length > 0 && view === 'honours' && <HonoursView game={game} />}
        {lines.length > 0 && view === 'xi' && <BestXIView game={game} u={u} />}
      </div>
    </div>
  )
}

function SeasonLines({ game, u }: { game: Game; u: LoadedUniverse }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl" data-testid="history-lines">
        <thead>
          <tr>
            <th className="num">{t('colYear')}</th>
            <th>{t('colSeason')}</th>
            <th className="num">{t('colPos')}</th>
            <th className="num" title={t('colTargetTip')}>{t('colTarget')}</th>
            <th className="num">{t('colRecord')}</th>
            <th className="num">{t('colGoals')}</th>
            <th>{t('colHonours')}</th>
            <th>{t('colTopScorer')}</th>
          </tr>
        </thead>
        <tbody>
          {[...game.history].reverse().map((h) => {
            const met = targetMet(h)
            const champion = h.position === 1 && h.tier !== 'RELEGATED' && !h.notes?.sacked
            return (
              <tr key={h.year} data-testid="history-line">
                <td className="num">{h.year}</td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <LeagueFlag leagueId={h.leagueId} label={u.leagues.find((l) => l.id === h.leagueId)?.name ?? h.leagueId} />
                    <ClubBadge clubId={h.hostClubId} size={18} />
                    <span title={clubName(u, h.hostClubId)}>{seasonLabel(h.leagueSeason)}</span>
                  </span>
                </td>
                <td className="num">{ordinal(h.position)}</td>
                <td className="num">
                  {h.notes ? (
                    <span className={met ? 'res-w' : 'res-l'} title={t(met ? 'targetMet' : 'targetMissed', { pos: ordinal(h.notes.target) })}>
                      {ordinal(h.notes.target)} {met ? '✓' : '✗'}
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
                <td className="num">{t('wdl', { w: h.won, d: h.drawn, l: h.lost })}</td>
                <td className="num">{t('goalsFor', { f: h.goalsFor, a: h.goalsAgainst })}</td>
                <td>
                  <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {h.notes?.sacked && <span className="chip bad">{t('sackedChip')}</span>}
                    {champion && (
                      <span className="chip gold icon-chip">
                        <Trophy size={12} aria-hidden="true" /> {t('championsChip')}
                      </span>
                    )}
                    {h.cupWon && (
                      <span className="chip gold icon-chip">
                        <Medal size={12} aria-hidden="true" /> {t('cupChip')}
                      </span>
                    )}
                    {h.continentalWon && (
                      <span className="chip gold icon-chip">
                        <Globe size={12} aria-hidden="true" /> {t('europeChip')}
                      </span>
                    )}
                  </span>
                </td>
                <td>{h.bootName ? t('scorer', { name: h.bootName, n: h.bootGoals ?? 0 }) : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HonoursView({ game }: { game: Game }) {
  const h = honoursOf(game.history)
  const rows: Array<[string, string | number, string]> = [
    [t('seasons'), h.seasons, 'seasons'],
    [t('titles'), h.titles, 'titles'],
    [t('cups'), h.cups, 'cups'],
    [t('continental'), h.continental, 'continental'],
    [t('doubles'), h.doubles, 'doubles'],
    [t('trebles'), h.trebles, 'trebles'],
    [t('titleRun'), h.titleRun, 'title-run'],
    [t('bestFinish'), h.bestFinish === null ? t('none') : ordinal(h.bestFinish), 'best'],
    [t('relegations'), h.relegations, 'relegations'],
    ...(h.targetsSet ? [[t('targetsMet'), t('targetsMetValue', { met: h.targetsMet, set: h.targetsSet }), 'targets'] as [string, string, string]] : []),
  ]
  return (
    <dl className="kv tight" data-testid="history-honours-list">
      {rows.map(([label, value, id]) => (
        <div key={id} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd data-testid={`honour-${id}`}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BestXIView({ game, u }: { game: Game; u: LoadedUniverse }) {
  const xi = bestXI(game, u)
  return (
    <div className="col" style={{ gap: 'var(--space-2)' }}>
      <h4 className="head-title">{t('bestXITitle')}</h4>
      <p className="muted small">{t('bestXINote', { n: BEST_XI_MIN_APPS })}</p>
      <ul className="plain-list col" style={{ gap: 'var(--space-1)' }} data-testid="history-best-xi">
        {xi.map((s) => (
          <li key={s.slotId} className="row" style={{ gap: 8 }}>
            <Pos p={s.position} />
            {s.legend ? (
              <>
                <b>{s.legend.name}</b>
                <span className="small muted">{t('bestXIRow', { apps: s.legend.apps, peak: s.legend.peak ?? 0 })}</span>
              </>
            ) : (
              <span className="muted small">{t('bestXIEmpty')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The Club tab's legends table: a career each, with his position, peak, average, first season and the armband. */
export function LegendsTable({ game, u, labels }: { game: Game; u: LoadedUniverse; labels: { player: string; seasons: string; apps: string; goals: string; assists: string; motm: string; titles: string } }) {
  const legends = legendsOf(game, u).slice(0, 12)
  return (
    <div className="tbl-wrap">
      <table className="tbl" data-testid="legends-table">
        <thead>
          <tr>
            <th>{labels.player}</th>
            <th>{t('legendPos')}</th>
            <th className="num" title={t('legendPeakTip')}>{t('legendPeak')}</th>
            <th className="num" title={t('legendAvgTip')}>{t('legendAvg')}</th>
            <th className="num">{labels.seasons}</th>
            <th className="num">{labels.apps}</th>
            <th className="num">{labels.goals}</th>
            <th className="num">{labels.assists}</th>
            <th className="num">{labels.motm}</th>
            <th className="num">{labels.titles}</th>
            <th>{t('legendJoined')}</th>
          </tr>
        </thead>
        <tbody>
          {legends.map((r) => {
            const avg = legendAverage(r)
            return (
              <tr key={r.playerId}>
                {/* Positioned, so the screen-reader label stays inside the box that scrolls it (else it lengthens the page) */}
                <td style={{ position: 'relative' }}>
                  <span className="row" style={{ gap: 4 }}>
                    {r.current ? <b>{r.name}</b> : r.name}
                    {r.current && <span className="sr-only">{t('legendCurrent')}</span>}
                    {(r.captainSeasons ?? 0) > 0 && (
                      <span title={t('legendCaptain', { n: r.captainSeasons ?? 0 })} role="img" aria-label={t('legendCaptain', { n: r.captainSeasons ?? 0 })}>
                        <Crown size={12} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                </td>
                <td>{r.pos ? <Pos p={r.pos} /> : '–'}</td>
                <td className="num">{r.peak ?? '–'}</td>
                <td className="num">{avg === null ? '–' : avg.toFixed(2)}</td>
                <td className="num">{r.seasons}</td>
                <td className="num">{r.apps}</td>
                <td className="num">{r.goals}</td>
                <td className="num">{r.assists}</td>
                <td className="num">{r.motm}</td>
                <td className="num">{r.titles}</td>
                <td className="small" title={r.firstAge !== undefined && r.firstOverall !== undefined && r.firstYear !== undefined ? t('legendJoinedTip', { year: r.firstYear, age: r.firstAge, overall: r.firstOverall }) : undefined}>
                  {r.firstYear !== undefined ? t('legendJoinedValue', { year: r.firstYear }) : '–'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The board box's line on last season: what was asked and where the side finished. */
export function boardLastLine(target: number, position: number, met: boolean): string {
  return t('boardLastValue', { met: met ? 'yes' : 'no', target: ordinal(target), pos: ordinal(position) })
}

export const boardLastLabel = () => t('boardLast')
