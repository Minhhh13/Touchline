import { describe, expect, it } from 'vitest'
import { DARK_PALETTES, normalisePalette, PALETTE_KEY, palettePreference } from '../palette'

describe('device-local Dark colours', () => {
  it('defaults to gentle Slate and rejects stale or unknown choices', () => {
    for (const value of [null, '', 'neon', 'light']) expect(normalisePalette(value)).toBe('slate')
    for (const value of DARK_PALETTES) expect(normalisePalette(value)).toBe(value)
  })
  it('restores a choice, notifies every mounted control, and persists across a fresh visit', () => {
    const disk = new Map<string, string>([[PALETTE_KEY, 'midnight']])
    const storage = () => ({ getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => { disk.set(key, value) } })
    const pref = palettePreference(storage)
    let notifications = 0
    const stop = pref.subscribe(() => { notifications++ })
    expect(pref.get()).toBe('midnight')
    pref.set('warm')
    expect(pref.get()).toBe('warm')
    expect(notifications).toBe(1)
    expect(palettePreference(storage).get()).toBe('warm')
    stop()
    pref.set('slate')
    expect(notifications).toBe(1)
  })
  it('retains the choice for the visit when browser storage is unavailable', () => {
    const pref = palettePreference(() => { throw new Error('storage blocked') })
    expect(pref.get()).toBe('slate')
    expect(() => pref.set('warm')).not.toThrow()
    expect(pref.get()).toBe('warm')
  })
})
