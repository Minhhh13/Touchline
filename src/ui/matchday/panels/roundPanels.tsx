/**
 * The rest of the round and the occasion: latest scores elsewhere, the live
 * league table as it stands at the clock, and the matchday info card.
 */
import { useEffect, useRef } from 'react'
import { USER_TEAM } from '@engine/season'
import { roundTable } from '@game/logic/matchday'
import { minuteLabel, ordinal } from '../../format'
import { freshGoal } from '../model'
import type { PanelProps } from '../types'
import { Empty } from './bits'

export function LatestScores({ d }: PanelProps) {
  if (!d.ref || d.ref.friendly) return <Empty>No other matches: this is a friendly.</Empty>
  if (!d.scores.length) return <Empty>No other matches in this round.</Empty>
  const status = (s: (typeof d.scores)[number]) => (s.status === 'FT' ? 'FT' : s.status === 'HT' ? 'HT' : s.status === 'pre' ? '–' : minuteLabel(Math.max(1, d.minute)))
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
                  ({s.penalties.home}-{s.penalties.away} p)
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
  if (!d.table) return <Empty>{d.ref && !d.ref.friendly ? 'No league table in this competition.' : 'No table: this is a friendly.'}</Empty>
  const league = d.ref?.competition === 'league'
  return (
    <div className="md-table" ref={ref} tabIndex={0}>
      {!league && <div className="small muted md-note">League table as it stands: this is a knockout tie.</div>}
      <table className="md-tbl">
        <thead>
          <tr>
            <th className="num">#</th>
            <th aria-label="Movement" />
            <th>Team</th>
            <th className="num">P</th>
            <th className="num">GD</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {d.table.map((r) => (
            <tr key={r.teamId} className={`${r.isUser ? 'user' : ''} ${r.playing ? 'playing' : ''}`}>
              <td className="num mono">{r.position}</td>
              <td className={`mv ${r.movement > 0 ? 'up' : r.movement < 0 ? 'down' : ''}`} aria-label={r.movement > 0 ? 'up' : r.movement < 0 ? 'down' : 'no change'}>
                {r.movement > 0 ? '▲' : r.movement < 0 ? '▼' : ''}
              </td>
              <td className="team">
                {r.playing && <span className="md-playing" title="Playing now" />}
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
  const competition = ctx.roundLabel ?? (ctx.competition === 'cup' ? 'Cup' : ctx.competition === 'league' ? `Matchweek ${ctx.matchweek}` : 'Continental Cup')
  const clubOf = (teamId: string) => u.clubById[teamId === USER_TEAM ? game.settings.hostClubId : teamId.replace(/^friendly-/, '')]
  const venue = feed.neutral ? 'Neutral venue' : (clubOf(feed.home.teamId)?.city ?? '–')
  const before = d.ref && !d.ref.friendly ? roundTable(game, d.ref) : []
  const posOf = (teamId: string) => {
    const i = before.findIndex((r) => r.teamId === teamId)
    return i < 0 ? null : { pos: i + 1, form: before[i].form }
  }
  const earlier = game.season?.fixtures.find((f) => f.result && f.matchweek < ctx.matchweek && ((f.homeTeamId === feed.home.teamId && f.awayTeamId === feed.away.teamId) || (f.homeTeamId === feed.away.teamId && f.awayTeamId === feed.home.teamId)))
  const captain = game.captainId ? d.getName(game.captainId) : undefined
  const unit = (s: typeof feed.home.strength) => `GK ${s.goalkeeping.toFixed(0)} · DEF ${s.defence.toFixed(0)} · MID ${s.midfield.toFixed(0)} · ATT ${s.attack.toFixed(0)}`
  const side = (which: 'home' | 'away') => {
    const fs = which === 'home' ? feed.home : feed.away
    const view = which === 'home' ? d.home : d.away
    const p = posOf(fs.teamId)
    return (
      <div className="md-info-side">
        <b>{view.code}</b> <span className="muted">{view.name}</span>
        <div className="small">
          Rating {fs.strength.overall.toFixed(1)} · {unit(fs.strength)}
        </div>
        {p && (
          <div className="small muted">
            {ordinal(p.pos)} before the round{p.form.length ? ` · form ${p.form.join('')}` : ''}
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
      <div className="muted">Venue: {venue}</div>
      <div>
        Expected goals before kick-off <b className="mono">{feed.xgPreMatch.home.toFixed(2)}</b> - <b className="mono">{feed.xgPreMatch.away.toFixed(2)}</b>
      </div>
      {side('home')}
      {side('away')}
      {earlier?.result && (
        <div className="muted">
          Earlier this season: {earlier.homeTeamId === feed.home.teamId ? d.home.code : d.away.code} {earlier.result.homeGoals}-{earlier.result.awayGoals} {earlier.homeTeamId === feed.home.teamId ? d.away.code : d.home.code} (matchweek {earlier.matchweek})
        </div>
      )}
      {captain && <div>Captain: {captain}</div>}
    </div>
  )
}
