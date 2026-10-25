import { useSyncExternalStore } from 'react'
import type { Profile } from '@game/types'

/** The profile's setting: Auto follows the device, Light and Dark are fixed. */
export type ThemePreference = Profile['theme']
/** What is on screen: Daylight ('light') or Floodlit ('dark'). */
export type ResolvedTheme = 'light' | 'dark'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/**
 * The preference mirrored outside the save, for the script in index.html that paints the theme before the app loads:
 * the save itself is compressed (saveStorage.ts), so that script cannot read it. A per-viewer convenience, never read back by the game.
 */
export const THEME_KEY = 'touchline-theme'

export function rememberThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // No storage (a private window, blocked site data): the app still sets the theme once it loads
  }
}

/** Auto takes the device's setting; a device that says nothing gets Floodlit, as before. */
export function resolveTheme(pref: ThemePreference, deviceLight: boolean): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  return deviceLight ? 'light' : 'dark'
}

/** The top bar's switch flips what is on screen and stores the result, so Auto becomes a fixed choice after one tap. */
export function toggledTheme(current: ResolvedTheme): ResolvedTheme {
  return current === 'dark' ? 'light' : 'dark'
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  const mq = window.matchMedia(LIGHT_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function deviceIsLight(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LIGHT_QUERY).matches
}

/** The theme on screen, live: with Auto it changes the moment the device switches between light and dark. */
export function useResolvedTheme(pref: ThemePreference): ResolvedTheme {
  const light = useSyncExternalStore(subscribe, deviceIsLight, () => false)
  return resolveTheme(pref, light)
}
