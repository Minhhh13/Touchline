/**
 * The dashboard under 1200 px. A phone (720 px and narrower): the live pitch
 * standing up first, the stop panel under it, the commentary banner, an
 * always-on pulse row (the momentum strip and the xG graph story), the tab
 * strip with every panel, and our XI as a sideways scroller. A tablet (721 to
 * 1199 px) has the same structure with the pitch lying down, capped at 860 px,
 * and two panels side by side.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useMediaQuery } from '../components/LivePitch'
import { phoneTabs } from './controls'
import { XgStory } from './panels/XgStory'
import { PhoneTabs } from './PhoneTabs'
import type { MatchdayData } from './types'

/** `pulse` and `panels` are the Boxes control's choices (both on by default); a hidden banner comes in as null. */
export function CompactLayout({ d, crumb, top, pitch, stop, banner, momentum, strip, drawer, friendly, pulse = true, panels = true }: { d: MatchdayData; crumb: ReactNode; top: ReactNode; pitch: ReactNode; stop: ReactNode; banner: ReactNode; momentum: ReactNode; strip: ReactNode; drawer: ReactNode; friendly: boolean; pulse?: boolean; panels?: boolean }) {
  const tablet = useMediaQuery('(min-width: 721px)')
  const root = useRef<HTMLDivElement>(null)
  // A phone keeps the scoreboard in view while the page scrolls to the commentary, the tabs and the strip: the top bar
  // sticks with only its last row (the scoreboard) showing. A tablet sizes the lying pitch by the window's height under
  // what stands above it, so the commentary line under the pitch is in view too. Presentation only
  useLayoutEffect(() => {
    const el = root.current
    const bar = el?.querySelector<HTMLElement>('.md-topbar')
    const board = bar?.querySelector<HTMLElement>('.scoreboard')
    const pitch = el?.querySelector<HTMLElement>('.md-pitch')
    if (!el || !bar || !board || !pitch) return
    const measure = () => {
      if (tablet) el.style.setProperty('--md-above', `${Math.ceil(pitch.getBoundingClientRect().top + window.scrollY)}px`)
      else el.style.setProperty('--md-stick', `${-Math.max(0, board.offsetTop - 4)}px`)
    }
    measure()
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    watch?.observe(bar)
    window.addEventListener('resize', measure)
    // The app's top bar folds away and comes back (a class on .app): the pitch's top moves with it
    const app = el.closest('.app')
    const folds = app ? new MutationObserver(() => requestAnimationFrame(measure)) : null
    if (app && folds) folds.observe(app, { attributes: true, attributeFilter: ['class'] })
    return () => {
      watch?.disconnect()
      folds?.disconnect()
      window.removeEventListener('resize', measure)
      el.style.removeProperty('--md-stick')
      el.style.removeProperty('--md-above')
    }
  }, [tablet])
  return (
    <div ref={root} className={`matchday compact ${tablet ? 'tablet' : 'phone'}`}>
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
