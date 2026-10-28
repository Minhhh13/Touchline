/**
 * Under 1200 px. Phones keep the score and controls above three views:
 * Pitch, Stats and Squad. Tablets retain the stacked dashboard with two panels
 * side by side. Decisions and drawers stay outside the selected phone view.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMediaQuery } from '../components/LivePitch'
import { phoneTabs } from './controls'
import { XgStory } from './panels/XgStory'
import { PhoneTabs } from './PhoneTabs'
import type { MatchdayData } from './types'
import { FormationPanel } from './panels/FormationPanel'
import './mobileMatch.css'

const PHONE_VIEWS = ['pitch', 'stats', 'squad'] as const
const VIEW_LABEL = { pitch: 'Pitch', stats: 'Stats', squad: 'Squad' }

/** `pulse` and `panels` are the Boxes control's choices (both on by default); a hidden banner comes in as null. */
export function CompactLayout({ d, crumb, top, pitch, stop, banner, momentum, strip, drawer, friendly, pulse = true, panels = true }: { d: MatchdayData; crumb: ReactNode; top: ReactNode; pitch: ReactNode; stop: ReactNode; banner: ReactNode; momentum: ReactNode; strip: ReactNode; drawer: ReactNode; friendly: boolean; pulse?: boolean; panels?: boolean }) {
  const tablet = useMediaQuery('(min-width: 721px) and (min-height: 500px), (min-width: 721px) and (pointer: fine)')
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const [selectedView, setView] = useState<(typeof PHONE_VIEWS)[number]>('pitch')
  const views = PHONE_VIEWS.filter((view) => view !== 'stats' || pulse || panels)
  const view = selectedView === 'stats' && !pulse && !panels ? 'pitch' : selectedView
  const choose = (next: (typeof PHONE_VIEWS)[number], focus = false) => {
    setView(next)
    if (focus) root.current?.querySelector<HTMLButtonElement>(`[data-view-tab="${next}"]`)?.focus()
  }
  // A tablet sizes its lying pitch by the room below the chrome. The phone uses a flex viewport instead.
  useLayoutEffect(() => {
    const el = root.current
    const bar = el?.querySelector<HTMLElement>('.md-topbar')
    const pitch = el?.querySelector<HTMLElement>('.md-pitch')
    if (!tablet || !el || !bar || !pitch) return
    const measure = () => el.style.setProperty('--md-above', `${Math.ceil(pitch.getBoundingClientRect().top + window.scrollY)}px`)
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
      el.style.removeProperty('--md-above')
    }
  }, [tablet])
  if (!tablet) return (
    <div ref={root} className="matchday compact phone" data-view={view} data-testid="match-mobile">
      {crumb}
      {top}
      <div className="md-mobile-tabs" role="tablist" aria-label="Match view">
        {views.map((tab) => (
          <button key={tab} type="button" role="tab" id={`${id}-tab-${tab}`} data-view-tab={tab} data-testid={`match-view-${tab}`} aria-selected={view === tab} aria-controls={`${id}-panel-${tab}`} tabIndex={view === tab ? 0 : -1} onClick={() => choose(tab)} onKeyDown={(e) => {
            const i = views.indexOf(view)
            const next = e.key === 'ArrowRight' ? views[(i + 1) % views.length] : e.key === 'ArrowLeft' ? views[(i - 1 + views.length) % views.length] : e.key === 'Home' ? views[0] : e.key === 'End' ? views[views.length - 1] : null
            if (next) { e.preventDefault(); choose(next, true) }
          }}>{VIEW_LABEL[tab]}</button>
        ))}
      </div>
      {stop}
      <div className="md-mobile-body">
        {/* Keep the live pitch mounted while another view is open, so changing tabs never restarts its clock. */}
        <section className="md-mobile-view md-mobile-pitch" role="tabpanel" id={`${id}-panel-pitch`} aria-labelledby={`${id}-tab-pitch`} hidden={view !== 'pitch'}>
          <div className="md-pitch">{pitch}</div>
          {banner}
        </section>
        {(pulse || panels) && (
          <section className="md-mobile-view md-mobile-stats" role="tabpanel" id={`${id}-panel-stats`} aria-labelledby={`${id}-tab-stats`} hidden={view !== 'stats'}>
            {pulse && <div className="md-pulse">{momentum}<XgStory story={d.story} events={d.feed.events} minute={d.minute} span={Math.max(95, d.feed.lastMinute)} home={d.home} away={d.away} dense /></div>}
            {panels && <PhoneTabs d={d} tabs={phoneTabs(friendly)} twoUp={false} />}
          </section>
        )}
        <section className="md-mobile-view md-mobile-squad" role="tabpanel" id={`${id}-panel-squad`} aria-labelledby={`${id}-tab-squad`} hidden={view !== 'squad'}>
          <div className="md-strip-scroll">{strip}</div>
          <div className="md-two"><FormationPanel d={d} side="home" /><FormationPanel d={d} side="away" /></div>
        </section>
      </div>
      {drawer}
    </div>
  )
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
