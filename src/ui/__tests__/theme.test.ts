import { describe, expect, it } from 'vitest'
import { resolveTheme, toggledTheme, type ThemePreference } from '../theme'

describe('the theme setting', () => {
  it('Auto follows the device in both directions', () => {
    expect(resolveTheme('auto', true)).toBe('light')
    expect(resolveTheme('auto', false)).toBe('dark')
  })

  it('Light and Dark ignore the device', () => {
    for (const device of [true, false]) {
      expect(resolveTheme('light', device)).toBe('light')
      expect(resolveTheme('dark', device)).toBe('dark')
    }
  })

  it('the top bar switch always lands on the other theme, whatever the setting was', () => {
    const prefs: ThemePreference[] = ['auto', 'light', 'dark']
    for (const pref of prefs) {
      for (const device of [true, false]) {
        const shown = resolveTheme(pref, device)
        const next = toggledTheme(shown)
        expect(next).not.toBe(shown)
        // The stored choice is fixed, so a later change on the device does not undo the tap
        expect(resolveTheme(next, !device)).toBe(next)
        expect(toggledTheme(next)).toBe(shown)
      }
    }
  })
})
