import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Position } from '@engine/types'
import { POSITION_GROUP } from '@engine/positions'
import { ratingBand, textColourFor } from '../format'
import { useStore } from '@game/store'
import { tipSeen, type TipId } from '@game/logic/tips'

export function ClubBadge({ clubId, size = 32 }: { clubId: string; size?: number }) {
  const u = useStore((s) => s.universe)
  const club = u?.clubById[clubId]
  const primary = club?.colours.primary ?? '#555'
  const secondary = club?.colours.secondary ?? '#fff'
  const code = club?.code ?? clubId.slice(0, 3).toUpperCase()
  return (
    <span className="badge" title={club?.name ?? clubId} style={{ width: size, height: size, background: primary, color: textColourFor(primary), fontSize: size * 0.34, boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.07)}px ${secondary}` }}>
      {code}
    </span>
  )
}

export function Rating({ value, size, hidden }: { value: number; size?: 'lg'; hidden?: boolean }) {
  const v = Math.round(value)
  return (
    <span className={`rating ${hidden ? 'hidden' : ratingBand(v)} ${size ?? ''}`}>
      {hidden ? '?' : v}
    </span>
  )
}

export function Pos({ p }: { p: Position }) {
  return <span className={`pos ${POSITION_GROUP[p]}`}>{p}</span>
}

export function Flag({ nation }: { nation: string }) {
  const u = useStore((s) => s.universe)
  const n = u?.nations[nation]
  return (
    <span title={n?.name ?? nation} aria-label={n?.name ?? nation}>
      {n?.flag ?? '🏳️'}
    </span>
  )
}

export function Bar({ value, max = 100, colour, thick }: { value: number; max?: number; colour?: string; thick?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className={`bar ${thick ? 'thick' : ''}`}>
      <span style={{ width: `${pct}%`, background: colour }} />
    </span>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; hint?: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} title={o.hint} role="radio" aria-checked={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A dialog; `sheet` makes it a bottom sheet on a phone (<= 720px wide) and an ordinary centred modal on wider screens. */
export function Modal({ open, onClose, title, children, wide, sheet, testId }: { open: boolean; onClose?: () => void; title?: string; children: ReactNode; wide?: boolean; sheet?: boolean; testId?: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={`modal-back ${sheet ? 'sheet-back' : ''}`} onClick={onClose}>
      <div className={`modal ${sheet ? 'sheet' : ''}`} style={wide ? { width: 'min(960px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        {title && (
          <div className="panel-head">
            <h2>{title}</h2>
            {onClose && (
              <button className="btn sm ghost" onClick={onClose} aria-label="Close">
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function Toast() {
  const toast = useStore((s) => s.toast)
  const show = useStore((s) => s.showToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => show(null), 3200)
    return () => clearTimeout(t)
  }, [toast, show])
  if (!toast) return null
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  )
}

/**
 * An "i" button that shows a sentence or two of help: the place for the
 * explanation that would otherwise be a paragraph under a control. A mouse
 * opens it on hover, a tap toggles it, keyboard focus opens it; Escape, a tap
 * elsewhere, scrolling or leaving with the mouse closes it. The tip is portalled
 * to <body> with fixed positioning and clamped to the viewport, so it is never
 * clipped by a scrolling list and never widens the page. Keep the text short
 * and plain; no links or buttons inside.
 */
export function Info({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  // How the last press arrived: a mouse click keeps the tip open, a tap or a key toggles it
  const pointer = useRef('keyboard')
  const id = useId()
  useLayoutEffect(() => {
    if (!open) return
    const btn = btnRef.current
    const tip = tipRef.current
    if (!btn || !tip) return
    const r = btn.getBoundingClientRect()
    const gap = 8
    const vw = document.documentElement.clientWidth
    const left = Math.max(gap, Math.min(vw - gap - tip.offsetWidth, r.left + r.width / 2 - tip.offsetWidth / 2))
    const below = r.top - tip.offsetHeight - gap < gap
    setPos({ left, top: below ? r.bottom + gap : r.top - tip.offsetHeight - gap, below })
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // A tap anywhere else closes it; iOS never focuses a tapped button, so blur alone is not enough
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !btn.contains(e.target)) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])
  return (
    <span className="info">
      <button
        ref={btnRef}
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => {
          pointer.current = e.pointerType
        }}
        onKeyDown={() => {
          pointer.current = 'keyboard'
        }}
        onClick={() => setOpen((o) => (pointer.current === 'mouse' ? true : !o))}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <circle cx="8" cy="4" r="1.6" fill="currentColor" />
          <rect x="6.7" y="6.9" width="2.6" height="7" rx="1.3" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <span ref={tipRef} id={id} role="tooltip" className={`info-tip ${pos?.below ? 'below' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}

export function FormDots({ form }: { form: Array<'W' | 'D' | 'L'> }) {
  return (
    <span className="form">
      {form.map((f, i) => (
        <span key={i} className={f}>
          {f}
        </span>
      ))}
    </span>
  )
}

/** Tab strip; `alert` draws a dot, `badge` a count (which takes the dot's place when both are set). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; alert?: boolean; badge?: number }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge ? (
            <span className="tab-badge" data-testid={`badge-${t.id}`} aria-label={`${t.badge} new`}>
              {t.badge > 99 ? '99+' : t.badge}
            </span>
          ) : (
            t.alert && <span className="dot" />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * A coach mark: a short callout inline in the page flow, shown until its 'Got it'
 * is pressed (remembered on the profile). Never an overlay, never blocks a button.
 */
export function Tip({ id, children }: { id: TipId; children: ReactNode }) {
  const seen = useStore((s) => tipSeen(s.profile, id))
  const dismiss = useStore((s) => s.dismissTip)
  if (seen) return null
  return (
    <div className="tip" role="note" data-testid={`tip-${id}`}>
      <span className="tip-text">{children}</span>
      <button type="button" className="btn sm" onClick={() => dismiss(id)}>
        Got it
      </button>
    </div>
  )
}

/** An on/off preference kept per viewer in localStorage; blocked storage reads as off and still toggles for the visit. */
export function useViewerFlag(key: string): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        localStorage.setItem(key, v ? '0' : '1')
      } catch {
        // Storage blocked: the toggle still works for this visit
      }
      return !v
    })
  }, [key])
  return [on, toggle]
}
