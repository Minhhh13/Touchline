import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeTip, tipWidth, type TipPlace } from '../tipPlacement'

const viewport = () => ({ vw: document.documentElement.clientWidth || window.innerWidth, vh: document.documentElement.clientHeight || window.innerHeight })
const placed = (p: TipPlace | null, width?: number): CSSProperties => (p ? { left: p.left, top: p.top, maxHeight: p.maxHeight, width } : { left: 0, top: 0, width, visibility: 'hidden' })

/**
 * A small "i" that opens a description: a mouse shows it while over the button, a click, tap or Enter keeps it open.
 * The bubble is portalled to <body>, fixed to the window beside the button and kept inside it (`placeTip`), so a box
 * that scrolls or clips never squeezes or cuts it. Escape closes it and gives the focus back to the button; a press
 * anywhere else or leaving the button closes it too.
 */
export function InfoTip({ text, label, testId }: { text: string; label: string; testId?: string }) {
  // 'hover': shown while the mouse is over the button; 'pinned': opened by a click, a tap or a key
  const [open, setOpen] = useState<null | 'hover' | 'pinned'>(null)
  const [place, setPlace] = useState<TipPlace | null>(null)
  const [width, setWidth] = useState(320)
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      return
    }
    const measure = () => {
      const r = btn.current?.getBoundingClientRect()
      const b = bubble.current
      if (!r || !b) return
      const { vw, vh } = viewport()
      const w = tipWidth(vw)
      b.style.width = `${w}px`
      setWidth(w)
      setPlace(placeTip(r, w, b.scrollHeight, vw, vh))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node) || btn.current?.contains(t) || bubble.current?.contains(t)) return
      setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      const pinned = open === 'pinned'
      setOpen(null)
      if (pinned) btn.current?.focus()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return (
    <span className="qinfo">
      <button
        ref={btn}
        type="button"
        className="qinfo-btn"
        aria-label={`About ${label}`}
        aria-expanded={open !== null}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => (o === 'pinned' ? null : 'pinned'))
        }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen((o) => o ?? 'hover')}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen((o) => (o === 'hover' ? null : o))}
        onBlur={() => setOpen((o) => (o === 'pinned' ? null : o))}
        data-testid={testId}
      >
        i
      </button>
      {open &&
        createPortal(
          // A press on the bubble keeps the focus on the button, so reading or scrolling it does not close it
          <span className="qinfo-bubble" role="tooltip" id={id} ref={bubble} style={placed(place, width)} onMouseDown={(e) => e.preventDefault()} data-testid={testId ? `${testId}-bubble` : undefined}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

/**
 * A row of controls that explain themselves: any descendant with a `data-tip` shows that text in a tip under it (over
 * it near the foot of the window) while the mouse is over it, while it has the keyboard focus, or for a few seconds
 * after a tap. Escape, leaving, a press elsewhere or scrolling its control out of view hides it. One tip for the whole row, portalled and fixed
 * like InfoTip's bubble, in the `.info-tip` look of `Info` (bits.tsx). Use it in place of a bare `title`.
 */
export function HoverTips({ children, testId = 'hover-tip', ...rest }: { children: ReactNode; testId?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const [tip, setTip] = useState<{ el: HTMLElement; text: string; via: 'mouse' | 'focus' | 'tap' } | null>(null)
  const [place, setPlace] = useState<TipPlace | null>(null)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const node = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setTip(null)
  }, [])
  const targetOf = (t: EventTarget | null): HTMLElement | null => {
    const el = t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null
    return el && box.current?.contains(el) ? el : null
  }
  const show = (el: HTMLElement | null, via: 'mouse' | 'focus' | 'tap') => {
    window.clearTimeout(timer.current)
    const text = el?.dataset.tip
    if (!el || !text) return setTip(null)
    setTip((t) => (t && t.el === el && t.text === text ? t : { el, text, via }))
  }
  useLayoutEffect(() => {
    if (!tip) {
      setPlace(null)
      return
    }
    const el = tip.el
    // Follows its anchor when the page or a box scrolls (a toggle can shift the layout); gone once the anchor is out of view
    const measure = () => {
      const r = el.getBoundingClientRect()
      const n = node.current
      if (!n) return
      const { vw, vh } = viewport()
      if (r.bottom < 0 || r.top > vh || !el.isConnected) return setTip(null)
      setPlace(placeTip(r, n.offsetWidth, n.offsetHeight, vw, vh, 'center'))
    }
    measure()
    el.setAttribute('aria-describedby', id)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      el.removeAttribute('aria-describedby')
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [tip, id])
  useEffect(() => {
    if (!tip) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !tip.el.contains(e.target)) hide()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [tip, hide])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <div
      {...rest}
      ref={box}
      onPointerOver={(e: ReactPointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && show(targetOf(e.target), 'mouse')}
      onPointerLeave={(e: ReactPointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && hide()}
      onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse') return
        const el = targetOf(e.target)
        show(el, 'tap')
        if (el) timer.current = window.setTimeout(() => setTip(null), 4000)
      }}
      onFocus={(e: FocusEvent<HTMLDivElement>) => {
        if (e.target instanceof Element && e.target.matches(':focus-visible')) show(targetOf(e.target), 'focus')
      }}
      onBlur={() => setTip((t) => (t?.via === 'focus' ? null : t))}
    >
      {children}
      {tip &&
        createPortal(
          <span ref={node} id={id} role="tooltip" className="info-tip" style={placed(place)} data-testid={testId}>
            {tip.text}
          </span>,
          document.body,
        )}
    </div>
  )
}

/** One power-up in the draft's tray: its icon, name, state line and an Info tip; dimmed once used. */
export function PowerUpButton({ icon, title, short, line, status, used, disabled, onClick, testId }: { icon: ReactNode; title: string; /** A shorter name for the tray's narrow button ("Re-roll"); the full one stays for screen readers. */ short?: string; line: string; status: string; used: boolean; disabled: boolean; onClick: () => void; testId: string }) {
  return (
    <div className={`pu-item${used ? ' used' : ''}`} data-testid={testId} data-used={used ? 'yes' : 'no'}>
      <button type="button" className="pu-btn" disabled={disabled || used} onClick={onClick} data-testid={`${testId}-use`}>
        <span className="pu-icon" aria-hidden="true">
          {icon}
        </span>
        {short ? (
          <span className="pu-title" title={title}>
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{title}</span>
          </span>
        ) : (
          <span className="pu-title">{title}</span>
        )}
        <span className="pu-status">{status}</span>
      </button>
      <InfoTip text={line} label={title} testId={`${testId}-info`} />
    </div>
  )
}
