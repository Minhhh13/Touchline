import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/** A small "i" that opens a one-line description on tap or focus (and on hover through `title`). */
export function InfoTip({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  // The bubble hangs left from the button; near either edge of a phone screen, slide it back inside (8 px margin)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open || !bubble.current) {
      setShift(0)
      return
    }
    const r = bubble.current.getBoundingClientRect()
    const edge = document.documentElement.clientWidth
    setShift(r.left < 8 ? 8 - r.left : r.right > edge - 8 ? edge - 8 - r.right : 0)
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span className="qinfo" ref={ref}>
      <button
        type="button"
        className="qinfo-btn"
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
        <span className="qinfo-bubble" role="tooltip" id={id} ref={bubble} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
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
