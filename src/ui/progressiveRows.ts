import { startTransition, useEffect, useState } from 'react'
import { runAfterPaint } from './afterPaint'

/**
 * A long list drawn a slice at a time (presentation only): the first rows with the render that brings the list, the
 * rest a step after each paint once the list has stood for a moment, so a keystroke in Explore's search paints its top rows within a frame on a slow phone
 * instead of laying out 200 rows first. A new list starts again from the first slice; the rows shown are always the
 * list's first `shown`, in its order, and every row is drawn once the steps run out.
 */

/** Rows drawn with the list: about a phone's screenful; the next step follows a frame later. */
export const FIRST_ROWS = 12
/** Rows added after each paint. */
export const ROW_STEP = 24
/** How long a new list waits before it grows: a keystroke inside it replaces the list, so typing never meets a step. */
export const GROW_DELAY_MS = 250

/** How many of `total` rows the first render draws. */
export function firstShown(total: number): number {
  return Math.min(FIRST_ROWS, total)
}

/** How many rows the next step draws. */
export function nextShown(shown: number, total: number): number {
  return Math.min(total, shown + ROW_STEP)
}

/** How many of `rows` to draw now: the first slice for a new list, growing after each paint to all of them. */
export function useProgressiveRows<T>(rows: readonly T[]): number {
  const [state, setState] = useState(() => ({ rows, shown: firstShown(rows.length) }))
  const shown = state.rows === rows ? state.shown : firstShown(rows.length)
  if (state.rows !== rows) setState({ rows, shown })
  useEffect(() => {
    if (shown >= rows.length) return
    let live = true
    const step = () =>
      runAfterPaint(() => {
        if (!live) return
        // A step yields to typing: the next keystroke's list replaces it
        startTransition(() => setState((s) => (s.rows === rows ? { rows, shown: nextShown(s.shown, rows.length) } : s)))
      })
    const wait = shown <= FIRST_ROWS ? setTimeout(step, GROW_DELAY_MS) : undefined
    if (wait === undefined) step()
    return () => {
      live = false
      clearTimeout(wait)
    }
  }, [rows, shown])
  return shown
}

const listKeys = new WeakMap<object, number>()
let lastKey = 0

/**
 * A key for the element that holds a list, new for each list: a new search swaps the whole box of rows for another
 * (one removal) instead of taking its 200 rows out one at a time.
 */
export function listKey(rows: object): number {
  let key = listKeys.get(rows)
  if (key === undefined) {
    key = ++lastKey
    listKeys.set(rows, key)
  }
  return key
}
