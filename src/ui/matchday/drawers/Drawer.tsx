/**
 * A drawer: a panel under the top bar on a desktop, a bottom sheet on a phone.
 * It takes the focus when it opens, keeps Tab inside itself, closes on Escape
 * or a click outside, and gives the focus back to the control that opened it.
 */
import { useId, useRef, type ReactNode } from 'react'
import { useDialog } from '../../useDialog'

export function Drawer({ title, sub, onClose, children, foot, wide = false, className = '' }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean; className?: string }) {
  const backRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  // The dialog itself takes the focus, so its title is read first; the match behind is inert while it is open
  useDialog(backRef, ref, true, onClose)
  return (
    <div className="md-drawer-back" ref={backRef} onClick={onClose}>
      <div ref={ref} className={`md-drawer ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
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
