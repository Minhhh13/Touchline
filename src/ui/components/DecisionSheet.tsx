/**
 * The live match's stop as a pop-up: a centred dialog over the match on a
 * wide screen, a bottom sheet on a phone, over a light scrim so the score,
 * clock and pitch stay visible. It scrolls inside itself when tall and keeps
 * its action row in view. Focus moves in when it opens and back when it goes;
 * Escape or the close button minimises it to a "Decisions" pill (the match
 * stays paused until a choice is made).
 */
import { useId, useRef, type ReactNode } from 'react'
import { useDialog } from '../useDialog'

export function DecisionSheet({ open, title, subtitle, onMinimise, children, actions, testId }: { open: boolean; title: string; subtitle?: string; onMinimise: () => void; children: ReactNode; actions: ReactNode; testId: string }) {
  const backRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // A modal dialog (`useDialog`): the focus in (on `[data-autofocus]` when there is one), Tab kept inside, Escape
  // minimises, the match behind inert, the focus back where it was when the sheet goes
  useDialog(backRef, ref, open, onMinimise, '[data-autofocus]')
  if (!open) return null
  return (
    <div className="decision-back" ref={backRef} onClick={onMinimise}>
      <div className="decision-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="decision-head">
          <div>
            <h2 id={titleId}>{title}</h2>
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
