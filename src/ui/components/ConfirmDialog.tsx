import { useId, useRef } from 'react'
import { answerConfirm, useConfirmRequest } from '../confirm'
import { useDialog } from '../useDialog'

/**
 * The game's yes-or-no dialog (`askConfirm` in confirm.ts), mounted once in App.tsx. The yes button takes the focus,
 * Escape and the backdrop answer no. Ids `confirm-dialog`, `confirm-ok`, `confirm-cancel`.
 */
export function ConfirmHost() {
  const req = useConfirmRequest()
  const backRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const textId = useId()
  const no = req ? () => answerConfirm(req.id, false) : undefined
  useDialog(backRef, boxRef, !!req, no, '[data-testid="confirm-ok"]')
  if (!req) return null
  return (
    <div ref={backRef} className="modal-back confirm-back" onClick={no}>
      <div ref={boxRef} className="modal confirm-dialog" role="dialog" aria-modal="true" aria-describedby={textId} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid="confirm-dialog">
        <p id={textId} className="confirm-text">
          {req.message}
        </p>
        <div className="row confirm-actions">
          <button type="button" className="btn ghost" onClick={no} data-testid="confirm-cancel">
            {req.cancel}
          </button>
          <button type="button" className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={() => answerConfirm(req.id, true)} data-testid="confirm-ok">
            {req.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
