import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeWorld } from '../components/HomeWorld'
import { viewerPref } from '../viewerPrefs'

afterEach(() => vi.unstubAllGlobals())

describe('the living Home world', () => {
  it('has a finished still without motion, with all scenery decorative and unable to steal a tap', () => {
    const html = renderToStaticMarkup(createElement(HomeWorld, { paused: true }))
    expect(html).toContain('data-paused="true" aria-hidden="true"')
    expect(html).toContain('/art/touchline-ground-day.webp')
    expect(html).toContain('/art/touchline-ground-night.webp')
    expect(html).toContain('/art/touchline-player-run.webp')
    expect(html).toContain('/art/touchline-oak.webp')
    expect(html).toContain('/art/touchline-clouds.svg')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<canvas')
    expect(html).not.toContain('.png')
  })

  it('remembers a scenery pause across visits without writing to the game save', () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) })
    const preference = viewerPref('touchline-home-motion', true)
    expect(preference.get()).toBe(true)
    preference.set(false)
    expect(viewerPref('touchline-home-motion', true).get()).toBe(false)
    expect([...saved.keys()]).toEqual(['touchline-home-motion'])
  })
})
