/**
 * The live match's stop as a pop-up: a centred dialog over the match on a
 * wide screen, a bottom sheet on a phone, over a light scrim so the score,
 * clock and pitch stay visible. It scrolls inside itself when tall and keeps
 * its action row in view. Focus moves in when it opens and back when it goes;
 * Escape or the close button minimises it to a "Decisions" pill (the match
 * stays paused until a choice is made).
 */
import { useEffect, useRef, type ReactNode } from 'react'

export function DecisionSheet({ open, title, subtitle, onMinimise, children, actions, testId }: { open: boolean; title: string; subtitle?: string; onMinimise: () => void; children: ReactNode; actions: ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const sheet = ref.current
    const first = sheet?.querySelector<HTMLElement>('[data-autofocus]') ?? sheet
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onMinimise()
        return
      }
      if (e.key !== 'Tab' || !sheet) return
      // Keep Tab inside the sheet
      const items = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')]
      if (!items.length) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [open, onMinimise])
  if (!open) return null
  return (
    <div className="decision-back" onClick={onMinimise}>
      <div className="decision-sheet" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="decision-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          <button className="btn sm ghost" onClick={onMinimise} aria-label="Minimise" data-testid="decisions-close">
            ✕
          </button>
        </div>
        <div className="decision-body">{children}</div>
        <div className="decision-actions">{actions}</div>
      </div>
    </div>
  )
}
