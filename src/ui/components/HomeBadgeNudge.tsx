import { Award } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { badgeStates } from '@engine/badges'
import { emptyCabinet, leaguesWon } from '@game/logic/cabinet'
import { nextBadge } from '@game/logic/shareInvite'
import { badgeTitle, progressText } from '../i18n/trophyText'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'

const t = translator(home)

/** Once the Profile screen's chunk has rendered, bring the outlined badge into view (up to 3 s, then give up). */
function scrollToNextBadge(started = Date.now()) {
  const el = document.querySelector('[data-testid="badge-next"]')
  if (el) el.scrollIntoView({ block: 'center' })
  else if (Date.now() - started < 3000) requestAnimationFrame(() => scrollToNextBadge(started))
}

/**
 * Home's next-badge line: the badge nearest its next tier, opening the Trophy Room. Its own chunk (Home lazy-loads it),
 * so the trophies' catalogue stays out of the first download.
 */
export default function HomeBadgeNudge({ onOpen }: { onOpen: () => void }) {
  const { universe: u, profile } = useStorePick('universe', 'profile')
  const cabinet = profile.cabinet ?? emptyCabinet()
  const chase = nextBadge(badgeStates(cabinet, { leaguesWon: leaguesWon(cabinet, profile.leaderboard, (id) => u?.clubById[id]?.leagueId).leagues.length }))
  if (!chase) return null
  return (
    <button type="button" className="home-nudge linklike" onClick={() => {
        onOpen()
        requestAnimationFrame(() => scrollToNextBadge())
      }} data-testid="badge-nudge">
      <Award size={14} aria-hidden="true" />
      {t('nudgeBadge', { badge: badgeTitle(chase.state.badge), progress: progressText(chase.state.badge.tiers, chase.state.value) })}
    </button>
  )
}
