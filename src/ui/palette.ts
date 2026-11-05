import { useSyncExternalStore } from 'react'

/** Dark UI colours belong to this device, separately from the game's save and Light mode. */
export const PALETTE_KEY = 'touchline-dark-palette'
export const DARK_PALETTES = ['slate', 'midnight', 'warm'] as const
export type DarkPalette = (typeof DARK_PALETTES)[number]

export function normalisePalette(value: string | null): DarkPalette {
  return DARK_PALETTES.find((p) => p === value) ?? 'slate'
}

export function palettePreference(storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage) {
  let value: DarkPalette | undefined
  const listeners = new Set<() => void>()
  const get = () => {
    if (value !== undefined) return value
    try { return (value = normalisePalette(storage().getItem(PALETTE_KEY))) } catch { return (value = 'slate') }
  }
  const set = (next: DarkPalette) => {
    value = next
    try { storage().setItem(PALETTE_KEY, next) } catch { /* Keep the choice for this visit if storage is blocked. */ }
    listeners.forEach((f) => f())
  }
  const changed = (e: StorageEvent) => {
    if (e.key !== PALETTE_KEY && e.key !== null) return
    value = undefined
    listeners.forEach((f) => f())
  }
  return {
    get, set,
    subscribe(f: () => void) {
      if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', changed)
      listeners.add(f)
      return () => {
        listeners.delete(f)
        if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', changed)
      }
    },
  }
}

const preference = palettePreference()
export function useDarkPalette(): [DarkPalette, (next: DarkPalette) => void] {
  return [useSyncExternalStore(preference.subscribe, preference.get, () => 'slate'), preference.set]
}
