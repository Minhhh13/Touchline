/**
 * The phone and tablet tab strip: every panel of the dashboard behind one
 * sideways-scrolling tablist (class `md-tabs`, never `tabs`: the report's
 * Live/Report pair owns that). Arrow keys, Home and End move along it; the
 * choice is remembered per browser. A tablet shows the chosen panel and the
 * one after it side by side.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { readTab, tabAfter, tabKey, writeTab, type PhoneTab } from './controls'
import type { MatchdayData } from './types'
import { WIDGET_COMPONENT } from './widgets'

export function PhoneTabs({ d, tabs, twoUp }: { d: MatchdayData; tabs: PhoneTab[]; twoUp: boolean }) {
  const [active, setActive] = useState(() => readTab(tabs))
  const id = useId()
  const strip = useRef<HTMLDivElement>(null)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  const shown = twoUp ? [current, tabAfter(tabs, current.id)] : [current]
  const choose = (tab: string, focus = false) => {
    setActive(tab)
    writeTab(tab)
    if (focus) strip.current?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus()
  }
  // Keep the chosen tab in view in the sideways strip
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-tab="${current.id}"]`)
    const box = strip.current
    if (!el || !box) return
    const left = el.offsetLeft - box.offsetLeft
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, left - 16), behavior: 'auto' })
  }, [current.id])
  return (
    <section className="md-tabbed">
      <div ref={strip} className="md-tabs" role="tablist" aria-label="Match panels">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-tab-${t.id}`}
            data-tab={t.id}
            aria-selected={t.id === current.id}
            aria-controls={`${id}-panel-${t.id}`}
            tabIndex={t.id === current.id ? 0 : -1}
            className={t.id === current.id ? 'active' : shown.some((s) => s.id === t.id) ? 'also' : ''}
            onClick={() => choose(t.id)}
            onKeyDown={(e) => {
              const next = tabKey(tabs, current.id, e.key)
              if (next) {
                e.preventDefault()
                choose(next, true)
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={`md-tab-panels ${twoUp ? 'two' : ''}`}>
        {shown.map((t) => {
          const Widget = WIDGET_COMPONENT[t.widget]
          return (
            <div key={t.id} className="md-panel md-tab-panel" role="tabpanel" id={`${id}-panel-${t.id}`} aria-labelledby={`${id}-tab-${t.id}`} data-widget={t.widget}>
              {twoUp && (
                <header className="md-panel-head">
                  <b>{t.label}</b>
                </header>
              )}
              <div className="md-slot-body">
                <Widget d={d} compact />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
