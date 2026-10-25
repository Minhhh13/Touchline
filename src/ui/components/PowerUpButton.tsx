import { useEffect, useId, useRef, useState } from 'react'

/** A small "i" that opens a one-line description on tap or focus (and on hover through `title`). */
export function InfoTip({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span className="info-tip" ref={ref}>
      <button
        type="button"
        className="info-tip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        title={text}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        onBlur={() => setOpen(false)}
        data-testid={testId}
      >
        i
      </button>
      {open && (
        <span className="info-tip-bubble" role="tooltip" id={id}>
          {text}
        </span>
      )}
    </span>
  )
}

/** One power-up in the draft's tray: its icon, name, state line and an Info tip; dimmed once used. */
export function PowerUpButton({ icon, title, line, status, used, disabled, onClick, testId }: { icon: string; title: string; line: string; status: string; used: boolean; disabled: boolean; onClick: () => void; testId: string }) {
  return (
    <div className={`pu-item${used ? ' used' : ''}`} data-testid={testId} data-used={used ? 'yes' : 'no'}>
      <button type="button" className="pu-btn" disabled={disabled || used} onClick={onClick} data-testid={`${testId}-use`}>
        <span className="pu-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="pu-title">{title}</span>
        <span className="pu-status">{status}</span>
      </button>
      <InfoTip text={line} label={title} testId={`${testId}-info`} />
    </div>
  )
}
