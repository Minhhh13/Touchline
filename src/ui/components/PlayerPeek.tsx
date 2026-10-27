/**
 * The hover card (FM's hover-for-stats): after 350 ms of a mouse over a player's name, a small card with his rating,
 * positions, age and club-season, his form and morale when he is in a squad, and his three best attributes. It closes
 * as the mouse leaves or the page scrolls; touch and keyboard keep the tap-through to the full card. Never a layer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { topAttributes } from '@game/logic/squadDisplay'
import { useStore } from '@game/store'
import { clubShort, seasonLabel } from '../format'
import { MoraleFace } from '../matchday/MoraleFace'
import { Pos, Rating } from './bits'
import { FormArrow, Sparkline } from './FormBits'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'

const t = translator(explore)

export const PEEK_DELAY = 350

export function PlayerPeek({ p, s, children }: { p: PlayerSeason | undefined; s?: SquadPlayer; children: ReactNode }) {
  const u = useStore((st) => st.universe)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  useLayoutEffect(() => {
    if (!open) return
    const a = anchor.current?.getBoundingClientRect()
    const c = card.current
    if (!a || !c) return
    const gap = 8
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const left = Math.max(gap, Math.min(vw - gap - c.offsetWidth, a.left))
    const top = a.bottom + gap + c.offsetHeight > vh - gap ? Math.max(gap, a.top - gap - c.offsetHeight) : a.bottom + gap
    setPos({ left, top })
    const close = () => setOpen(false)
    // Hover content can be dismissed without moving the mouse (WCAG 1.4.13)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!p) return <>{children}</>
  return (
    <span
      className="peek-anchor"
      ref={anchor}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        clear()
        timer.current = setTimeout(() => setOpen(true), PEEK_DELAY)
      }}
      onPointerLeave={() => {
        clear()
        setOpen(false)
      }}
      onPointerDown={() => {
        clear()
        setOpen(false)
      }}
    >
      {children}
      {open &&
        createPortal(
          <div ref={card} className="peek-card" role="tooltip" data-testid="player-peek" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
            <div className="peek-head">
              <Rating value={p.overall} />
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <b className="one-line">{p.name}</b>
                <span className="peek-meta">
                  {p.positions.map((x) => (
                    <Pos key={x} p={x} />
                  ))}
                  <span>{t('ageShort', { n: p.age })}</span>
                  <span>
                    {clubShort(u, p.clubId)} {seasonLabel(p.season)}
                  </span>
                </span>
              </span>
            </div>
            {s && (
              <div className="peek-form">
                <span className="small muted">{t('form')}</span>
                <Sparkline ratings={s.recentRatings} />
                <FormArrow s={s} />
                <MoraleFace value={s.morale} />
              </div>
            )}
            <div className="peek-attrs">
              {topAttributes(p).map((a) => (
                <span key={a.key}>
                  <span className="muted">{a.label}</span> <b className="mono">{a.value}</b>
                </span>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}
