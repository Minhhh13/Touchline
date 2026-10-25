import type { Profile } from '../types'

export type Theme = Profile['theme']

/**
 * The top bar's one-tap switch between Floodlit (dark) and Daylight (light).
 * Auto renders as Floodlit (it does not follow the device), so one tap from
 * Auto goes to Daylight; the Record page keeps the three-way choice.
 */
export function toggledTheme(t: Theme): Theme {
  return t === 'light' ? 'dark' : 'light'
}

/** Whether a theme renders light: only Daylight does. */
export function rendersLight(t: Theme): boolean {
  return t === 'light'
}
