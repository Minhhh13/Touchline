import { Award } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { badgeStates } from '@engine/badges'
import { emptyCabinet, leaguesWon } from '@game/logic/cabinet'
import { nextBadge } from '@game/logic/shareInvite'
import { badgeCount, badgeTitle } from '../i18n/trophyText'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'

const t = translator(home)
/** The badges whose count reads badly before "to go" and so have words of their own */
type NudgeWords = 'globetrotter' | 'cup-collector' | 'ironman'

/** Once the Profile screen's chunk has rendered, bring the outlined badge into view (up to 3 s, then give up). */
function scrollToNextBadge(started = Date.now()) {
  const el = document.querySelector('[data-testid="badge-next"]')
  if (el) el.scrollIntoView({ block: 'center' })
  else if (Date.now() - started < 3000) requestAnimationFrame(() => scrollToNextBadge(started))
}

/**
 * Home's next-badge line: the badge nearest its next tier and what is left to earn it, in its own words ("1 league
 * title to go", not "0 of 1 for bronze"; a badge whose count reads badly before "to go" has its own `nudgeLeft_` words), opening the Trophy Room. Its own chunk (Home lazy-loads it),
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
      {t('nudgeBadge', { badge: badgeTitle(chase.state.badge), left: t.has(`nudgeLeft_${chase.state.badge.id}`) ? t(`nudgeLeft_${chase.state.badge.id as NudgeWords}`, { n: chase.left }) : badgeCount(chase.state.badge, chase.left) })}
    </button>
  )
}
