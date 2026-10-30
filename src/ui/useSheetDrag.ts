import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { SHEET_DRAG_START, sheetCloses, sheetOffset } from './sheetDrag'

/** Where a sheet is pulled from: the generic Modal's grip and header (bits.tsx) */
export const MODAL_SHEET_HANDLE = '.sheet-grip, .modal > .panel-head'
/** The match day's drawers on a phone (matchday/drawers/Drawer.tsx): the grip and the drawer's header */
export const DRAWER_SHEET_HANDLE = '.sheet-grip, .md-drawer-head'
/** A press on one of these inside the handle stays theirs */
export const SHEET_HANDLE_CONTROLS = 'button, a, input, select, textarea, [role=tab]'

/**
 * A phone's bottom sheet follows a finger pulled down from its handle and closes when let go far or fast enough
 * (`sheetCloses`); a tap on the handle's own buttons stays a tap. The close button and Escape still work. Only on a
 * phone (`(max-width: 720px)`, where these dialogs are bottom sheets) and only with an `onClose`.
 */
export function useSheetDrag(boxRef: RefObject<HTMLDivElement | null>, onClose: (() => void) | undefined, handle: string) {
  const start = useRef<{ id: number; y: number; t: number; dragging: boolean } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current
    if (!onClose || !box || e.button !== 0 || typeof window === 'undefined' || !window.matchMedia('(max-width: 720px)').matches) return
    const target = e.target as HTMLElement
    if (!target.closest(handle) || target.closest(SHEET_HANDLE_CONTROLS)) return
    start.current = { id: e.pointerId, y: e.clientY, t: e.timeStamp, dragging: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    const box = boxRef.current
    if (!s || !box || s.id !== e.pointerId) return
    const dy = e.clientY - s.y
    if (!s.dragging) {
      if (dy < SHEET_DRAG_START) return
      s.dragging = true
      box.setPointerCapture?.(e.pointerId)
      box.classList.add('dragging')
    }
    box.style.transform = `translateY(${sheetOffset(dy)}px)`
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    const box = boxRef.current
    start.current = null
    if (!s || !box || s.id !== e.pointerId || !s.dragging) return
    box.classList.remove('dragging')
    box.style.transform = ''
    if (e.type === 'pointerup' && sheetCloses(e.clientY - s.y, e.timeStamp - s.t, box.getBoundingClientRect().height)) onClose?.()
  }
  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}
