import { useStore } from '@game/store'
import { surnameOf } from '@game/logic/talks'
import { leagueAwards, type LeagueAward } from '@game/logic/leagueAwards'
import { AWARD_ICON } from './icons'
import { Info, Pos } from './bits'

/**
 * The league's end-of-season awards on the summary of a Season or Dynasty
 * season: the squad awards judged across every club, with the user's players
 * marked. Derived (`src/game/logic/leagueAwards.ts`), never saved.
 */
export function LeagueAwards() {
  const { universe: u, game } = useStore()
  if (!u || !game?.season || (game.settings.mode !== 'season' && game.settings.mode !== 'dynasty')) return null
  const a = leagueAwards(game, u)
  if (!a) return null
  const row = (key: keyof typeof AWARD_ICON, label: string, w?: LeagueAward) => {
    if (!w) return null
    const Icon = AWARD_ICON[key]
    return (
      <div className="league-award" key={key}>
        <Icon size={16} aria-hidden="true" />
        <span className="who">
          <b>{w.name}</b>
          <span className="small muted">
            {label} · {w.value}
          </span>
        </span>
        <span className={`chip ${w.mine ? 'info' : ''} one-line`}>{w.mine ? 'Yours' : w.teamName}</span>
      </div>
    )
  }
  return (
    <div className="panel" data-testid="league-awards">
      <div className="panel-head">
        <span className="head-title">
          <h3>League awards</h3>
          <Info label="About league awards">The same awards as your squad's, judged across every club in the league, all competitions.</Info>
        </span>
        <span className="small muted">{a.mineInTeam} of yours in the team</span>
      </div>
      <div className="league-awards">
        {row('pots', 'Player of the season', a.playerOfTheSeason)}
        {row('boot', 'Golden boot', a.goldenBoot)}
        {row('playmaker', 'Playmaker', a.playmaker)}
        {row('glove', 'Golden glove', a.goldenGlove)}
        {row('young', 'Young player', a.youngPlayer)}
      </div>
      <h4 style={{ marginTop: 'var(--space-3)' }}>Team of the season</h4>
      <div className="tots">
        {a.teamOfTheSeason.map((t) => (
          <span key={t.playerSeasonId} className={`chip ${t.mine ? 'info' : ''}`} title={`${t.name}, ${t.teamName}: ${t.avgRating.toFixed(2)} average`}>
            <Pos p={t.position} /> {surnameOf(t.name)}
          </span>
        ))}
      </div>
    </div>
  )
}
