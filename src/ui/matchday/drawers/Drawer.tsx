/**
 * A drawer: a panel under the top bar on a desktop, a bottom sheet on a phone.
 * It takes the focus when it opens, keeps Tab inside itself, closes on Escape
 * or a click outside, and gives the focus back to the control that opened it.
 */
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Drawer({ title, sub, onClose, children, foot, wide = false }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The dialog itself takes the focus, so its title is read first
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return (
    <div className="md-drawer-back" onClick={onClose}>
      <div ref={ref} className={`md-drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={trap}>
        <header className="md-drawer-head">
          <div>
            <h3 id={id}>{title}</h3>
            {sub && <div className="md-drawer-sub">{sub}</div>}
          </div>
          <button type="button" className="md-x" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="md-drawer-body">{children}</div>
        {foot && <footer className="md-drawer-foot">{foot}</footer>}
      </div>
    </div>
  )
}
