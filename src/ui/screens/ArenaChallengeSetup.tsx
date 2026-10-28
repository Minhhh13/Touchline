import { slotOf, useStore } from '@game/store'
import { LeagueRetry, LeagueWait } from '../components/LeagueRetry'
import { isArenaPayload } from '@engine/challenge'
import { cupRoundName } from '@engine/cup'
import { rememberTeamName, useTeamName } from '../teamName'
import { TeamNameField } from '../components/SetupBits'
import { settingsFromChallenge, arenaVerifiedLine } from '@game/logic/challenge'
import { claimLine, claimWon, stepText } from '@game/logic/arenaClaim'
import { summariseArena } from '@game/logic/arena'
import { arenaFormatText } from '../i18n/modeText'
import { rich, B } from '../i18n/rich'
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'

const t = translator(arena)
import { askConfirm } from '../confirm'

/**
 * A challenge link for the arena, opened: everything is fixed by the link
 * (seed, rules, format, field, formation, colours) but the team name. The
 * banner states the challenger's run and how far it verified.
 */
export function ArenaChallengeSetup() {
  const { universe: u, pendingChallenge, startGame, go, game, parked, loadingLeagues } = useStore()
  // An invented club name, or the one this viewer last typed (teamName.ts)
  const team = useTeamName()
  if (!u || !pendingChallenge || !isArenaPayload(pendingChallenge.payload)) return null
  const c = pendingChallenge.payload
  const ch = pendingChallenge.challenge
  const claim = ch.arena?.claim ?? c.ac
  const format = c.arena.f
  const size = c.arena.n ?? 2
  const settings = settingsFromChallenge(c, team.name, team.shortName, ch)
  const ready = [settings.leagueId, ...settings.wheelLeagues].every((l) => u.leagues.some((x) => x.id === l))
  const unfinished = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
  const start = async () => {
    if (unfinished && !(await askConfirm(t('takeChallengeConfirm', { format: arenaFormatText(unfinished.settings.arena), team: unfinished.settings.teamName }), { ok: t('takeItOn'), danger: true }))) return
    rememberTeamName(settings.teamName)
    startGame(settings)
  }
  const code = (i: number) => (format === 'gauntlet' ? `R${i + 1}` : cupRoundName(size, i).code)
  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>{t('challengeTitle', { format: arenaFormatText(settings.arena) })}</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          {t('back')}
        </button>
      </div>
      <div className={`notice ${ch.verified === 'yes' ? '' : 'warn'}`} data-testid="arena-challenge-banner">
        {rich(t('challengeBanner', { name: ch.name, claim: claimLine(ch.name, claim, format, size), daily: c.arena.dl ? 'yes' : 'no', day: c.arena.dl, format }), B)}
        <div className="small" style={{ marginTop: 6 }} data-testid="arena-challenge-verified">
          {arenaVerifiedLine(ch, format)}
        </div>
      </div>
      <div className="panel col" style={{ marginTop: 12 }}>
        <h3>{t('runOf', { name: ch.name })}</h3>
        <div className="row wrap" style={{ gap: 6 }} data-testid="arena-challenge-steps">
          {claim.g.map((g, i) => (
            <span key={i} className={`chip ${claimWon(g) ? 'good' : 'bad'}`}>
              {code(i)} {stepText(g)}
            </span>
          ))}
        </div>
      </div>
      <div className="panel col" style={{ marginTop: 12 }}>
        <TeamNameField label={t('teamName')} value={team.value} onChange={team.setValue} fallback={team.fallback} testId="arena-challenge-name" />
        <div className="small muted" data-testid="arena-summary">
          {summariseArena(u, settings)}
        </div>
        <LeagueRetry needs={[settings.leagueId, ...settings.wheelLeagues]} />
        <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues} data-testid="arena-challenge-start">
          {ready ? t('takeOn', { name: ch.name }) : <LeagueWait needs={[settings.leagueId, ...settings.wheelLeagues]} />}
        </button>
      </div>
    </div>
  )
}
