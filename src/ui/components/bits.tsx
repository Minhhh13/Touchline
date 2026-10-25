import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
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

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose?: () => void; title?: string; children: ReactNode; wide?: boolean }) {
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
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={wide ? { width: 'min(960px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
