import { useStore } from '@game/store'
import { surnameOf } from '@game/logic/talks'
import { leagueAwards, type LeagueAward } from '@game/logic/leagueAwards'
import { AWARD_ICON } from './icons'
import { Info, Pos } from './bits'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

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
        <span className={`chip ${w.mine ? 'info' : ''} one-line`}>{w.mine ? t('yours') : w.teamName}</span>
      </div>
    )
  }
  return (
    <div className="panel" data-testid="league-awards">
      <div className="panel-head">
        <span className="head-title">
          <h3>{t('leagueAwards')}</h3>
          <Info label={t('aboutLeagueAwards')}>{t('leagueAwardsInfo')}</Info>
        </span>
        <span className="small muted">{t('mineInTeam', { n: a.mineInTeam })}</span>
      </div>
      <div className="league-awards">
        {row('pots', t('award_pots'), a.playerOfTheSeason)}
        {row('boot', t('award_boot'), a.goldenBoot)}
        {row('playmaker', t('award_playmaker'), a.playmaker)}
        {row('glove', t('award_glove'), a.goldenGlove)}
        {row('young', t('award_young'), a.youngPlayer)}
      </div>
      <h4 style={{ marginTop: 'var(--space-3)' }}>{t('teamOfSeason')}</h4>
      <div className="tots">
        {a.teamOfTheSeason.map((x) => (
          <span key={x.playerSeasonId} className={`chip ${x.mine ? 'info' : ''}`} title={t('totsTip', { name: x.name, team: x.teamName, avg: x.avgRating.toFixed(2) })}>
            <Pos p={x.position} /> {surnameOf(x.name)}
          </span>
        ))}
      </div>
    </div>
  )
}
