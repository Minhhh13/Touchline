/**
 * The rest of the round and the occasion: latest scores elsewhere, the live
 * league table as it stands at the clock, and the matchday info card.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { USER_TEAM } from '@engine/season'
import { roundTable } from '@game/logic/matchday'
import { minuteLabel } from '../../format'
import { freshGoal } from '../model'
import type { PanelProps } from '../types'
import { Empty } from './bits'
import { translator } from '../../i18n'
import { match } from '../../i18n/en/match'
import { rich } from '../../i18n/rich'

const tx = translator(match)

const MONO = { b: (c: ReactNode) => <b className="mono">{c}</b> }

export function LatestScores({ d }: PanelProps) {
  if (!d.ref || d.ref.friendly) return <Empty>{tx('noOtherFriendly')}</Empty>
  if (!d.scores.length) return <Empty>{tx('noOtherRound')}</Empty>
  const status = (s: (typeof d.scores)[number]) => (s.status === 'FT' ? tx('ft') : s.status === 'HT' ? tx('ht') : s.status === 'pre' ? '–' : minuteLabel(Math.max(1, d.minute)))
  return (
    <ul className="md-scores">
      {d.scores.map((s) => {
        const last = s.goals.filter((g) => g.minute <= d.minute || s.status === 'FT').slice(-1)[0]
        return (
          <li key={`${s.homeTeamId}-${s.awayTeamId}`} className={`md-score ${freshGoal(s, d.minute) ? 'fresh' : ''}`}>
            <span className="code h" title={s.homeName}>
              {s.homeCode}
            </span>
            <span className="res mono">
              {s.home}-{s.away}
              {s.penalties && (
                <span className="muted small">
                  {' '}
                  {tx('pensShort', { score: `${s.penalties.home}-${s.penalties.away}` })}
                </span>
              )}
            </span>
            <span className="code a" title={s.awayName}>
              {s.awayCode}
            </span>
            <span className="st mono">{status(s)}</span>
            {last?.scorer && (
              <span className="scorer small muted">
                {last.scorer} {minuteLabel(last.minute)}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function LiveTable({ d }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const userPos = d.table?.find((r) => r.isUser)?.position
  // Keep our row in view as the table moves
  useEffect(() => {
    const box = ref.current
    const row = box?.querySelector<HTMLElement>('.user')
    if (!box || !row) return
    const top = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2
    box.scrollTop = Math.max(0, top)
  }, [userPos])
  // An arena knockout has no league around it; only a friendly is a friendly
  if (!d.table) return <Empty>{tx(d.ref && !d.ref.friendly ? 'noTableComp' : 'noTableFriendly')}</Empty>
  const league = d.ref?.competition === 'league'
  return (
    <div className="md-table" ref={ref}>
      {!league && <div className="small muted md-note">{tx('tableKnockout')}</div>}
      <table className="md-tbl">
        <thead>
          <tr>
            <th className="num">#</th>
            <th aria-label={tx('movement')} />
            <th>{tx('colTeam')}</th>
            <th className="num">{tx('colPlayed')}</th>
            <th className="num">{tx('colGd')}</th>
            <th className="num">{tx('colPts')}</th>
          </tr>
        </thead>
        <tbody>
          {d.table.map((r) => (
            <tr key={r.teamId} className={`${r.isUser ? 'user' : ''} ${r.playing ? 'playing' : ''}`}>
              <td className="num mono">{r.position}</td>
              <td className={`mv ${r.movement > 0 ? 'up' : r.movement < 0 ? 'down' : ''}`} aria-label={tx(r.movement > 0 ? 'moveUp' : r.movement < 0 ? 'moveDown' : 'moveNone')}>
                {r.movement > 0 ? '▲' : r.movement < 0 ? '▼' : ''}
              </td>
              <td className="team">
                {r.playing && <span className="md-playing" title={tx('playingNow')} />}
                <b>{r.code}</b> <span className="nm">{r.name}</span>
              </td>
              <td className="num mono">{r.played}</td>
              <td className="num mono">{r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}{r.goalsFor - r.goalsAgainst}</td>
              <td className="num mono pts">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MatchdayInfo({ d }: PanelProps) {
  const { feed, ctx, game, u } = d
  const competition = ctx.roundLabel ?? (ctx.competition === 'cup' ? tx('cup') : ctx.competition === 'league' ? tx('matchweek', { n: ctx.matchweek }) : tx('continentalCup'))
  const clubOf = (teamId: string) => u.clubById[teamId === USER_TEAM ? game.settings.hostClubId : teamId.replace(/^friendly-/, '')]
  const venue = feed.neutral ? tx('neutralVenue') : (clubOf(feed.home.teamId)?.city ?? '–')
  const before = d.ref && !d.ref.friendly ? roundTable(game, d.ref) : []
  const posOf = (teamId: string) => {
    const i = before.findIndex((r) => r.teamId === teamId)
    return i < 0 ? null : { pos: i + 1, form: before[i].form }
  }
  const earlier = game.season?.fixtures.find((f) => f.result && f.matchweek < ctx.matchweek && ((f.homeTeamId === feed.home.teamId && f.awayTeamId === feed.away.teamId) || (f.homeTeamId === feed.away.teamId && f.awayTeamId === feed.home.teamId)))
  const captain = game.captainId ? d.getName(game.captainId) : undefined
  const unit = (s: typeof feed.home.strength) => tx('unitLine', { gk: s.goalkeeping.toFixed(0), def: s.defence.toFixed(0), mid: s.midfield.toFixed(0), att: s.attack.toFixed(0) })
  const side = (which: 'home' | 'away') => {
    const fs = which === 'home' ? feed.home : feed.away
    const view = which === 'home' ? d.home : d.away
    const p = posOf(fs.teamId)
    return (
      <div className="md-info-side">
        <b>{view.code}</b> <span className="muted">{view.name}</span>
        <div className="small">
          {tx('ratingLine', { r: fs.strength.overall.toFixed(1), units: unit(fs.strength) })}
        </div>
        {p && (
          <div className="small muted">
            {tx('beforeRound', { pos: p.pos })}{p.form.length ? tx('formLine', { form: p.form.join('') }) : ''}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="md-info small">
      <div>
        <b>{competition}</b>
        {feed.importanceLabel || ctx.importanceLabel ? <span className="muted"> · {feed.importanceLabel ?? ctx.importanceLabel}</span> : null}
      </div>
      <div className="muted">{tx('venue', { venue })}</div>
      <div>
        {rich(tx('xgBefore', { home: feed.xgPreMatch.home.toFixed(2), away: feed.xgPreMatch.away.toFixed(2) }), MONO)}
      </div>
      {side('home')}
      {side('away')}
      {earlier?.result && (
        <div className="muted">
          {tx('earlier', { home: earlier.homeTeamId === feed.home.teamId ? d.home.code : d.away.code, score: `${earlier.result.homeGoals}-${earlier.result.awayGoals}`, away: earlier.homeTeamId === feed.home.teamId ? d.away.code : d.home.code, week: earlier.matchweek })}
        </div>
      )}
      {captain && <div>{tx('captain', { name: captain })}</div>}
    </div>
  )
}
