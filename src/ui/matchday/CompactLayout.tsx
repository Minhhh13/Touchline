/**
 * The dashboard under 1200 px. A phone (720 px and narrower): the live pitch
 * standing up first, the stop panel under it, the commentary banner, an
 * always-on pulse row (the momentum strip and the xG graph story), the tab
 * strip with every panel, and our XI as a sideways scroller. A tablet (721 to
 * 1199 px) has the same structure with the pitch lying down, capped at 860 px,
 * and two panels side by side.
 */
import type { ReactNode } from 'react'
import { useMediaQuery } from '../components/LivePitch'
import { phoneTabs } from './controls'
import { XgStory } from './panels/XgStory'
import { PhoneTabs } from './PhoneTabs'
import type { MatchdayData } from './types'

/** `pulse` and `panels` are the Boxes control's choices (both on by default); a hidden banner comes in as null. */
export function CompactLayout({ d, crumb, top, pitch, stop, banner, momentum, strip, drawer, friendly, pulse = true, panels = true }: { d: MatchdayData; crumb: ReactNode; top: ReactNode; pitch: ReactNode; stop: ReactNode; banner: ReactNode; momentum: ReactNode; strip: ReactNode; drawer: ReactNode; friendly: boolean; pulse?: boolean; panels?: boolean }) {
  const tablet = useMediaQuery('(min-width: 721px)')
  return (
    <div className={`matchday compact ${tablet ? 'tablet' : 'phone'}`}>
      {crumb}
      {top}
      <div className="md-pitch">{pitch}</div>
      {stop}
      {banner}
      {pulse && (
        <div className="md-pulse">
          {momentum}
          <XgStory story={d.story} events={d.feed.events} minute={d.minute} span={Math.max(95, d.feed.lastMinute)} home={d.home} away={d.away} dense />
        </div>
      )}
      {panels && <PhoneTabs d={d} tabs={phoneTabs(friendly)} twoUp={tablet} />}
      <div className="md-strip-scroll">{strip}</div>
      {drawer}
    </div>
  )
}
