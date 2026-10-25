import { describe, expect, it } from 'vitest'
import { rendersLight, toggledTheme } from '../logic/theme'

describe('the top bar theme switch', () => {
  it('flips Floodlit and Daylight, and takes Auto (which renders dark) to Daylight', () => {
    expect(toggledTheme('dark')).toBe('light')
    expect(toggledTheme('light')).toBe('dark')
    expect(toggledTheme('auto')).toBe('light')
    // Two taps always come back to what renders the same
    for (const t of ['auto', 'dark', 'light'] as const) expect(rendersLight(toggledTheme(toggledTheme(t)))).toBe(rendersLight(t))
    expect(rendersLight('auto')).toBe(false)
  })
})
