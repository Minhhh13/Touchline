import { useSyncExternalStore } from 'react'

/*
 * Per-viewer on/off conveniences, each in its own localStorage key (never in
 * the save). Blocked storage keeps a choice for the page load only.
 */

export interface ViewerPref {
  key: string
  get(): boolean
  set(next: boolean): void
  subscribe(l: () => void): () => void
}

export function viewerPref(key: string, fallback: boolean): ViewerPref {
  let value: boolean | null = null
  const listeners = new Set<() => void>()
  const read = () => {
    try {
      const v = localStorage.getItem(key)
      return v === 'on' ? true : v === 'off' ? false : fallback
    } catch {
      return fallback
    }
  }
  return {
    key,
    get() {
      if (value === null) value = read()
      return value
    },
    set(next) {
      value = next
      try {
        localStorage.setItem(key, next ? 'on' : 'off')
      } catch {
        // Storage blocked: the choice lasts for this page load
      }
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

/** A pref as React state, shared by every control on the page. */
export function usePref(p: ViewerPref): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(p.subscribe, p.get, p.get)
  return [value, p.set]
}

/** Quick spin: the case reel runs in about 2.7 s instead of about 7 (`QUICK_TIMING` in reelCurve.ts). Off by default. */
export const quickSpinPref = viewerPref('touchline-quick-spin', false)
