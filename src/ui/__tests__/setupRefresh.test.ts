import { beforeEach, describe, expect, it, vi } from 'vitest'
const disk = vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
    configurable: true,
  })
  return values
})
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { FORMATIONS, getFormation } from '@engine/formations'
import type { Mode } from '@game/types'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { defaultChoices, saveChoices } from '../setupMemory'
import { Setup } from '../screens/Setup'
import { markupProblems, show } from './qaSsr'

const universe = loadTestUniverse(['england'])
function renderSetup(mode: Mode) {
  show({ universe, loadedLeagues: ['england'], game: null, parked: {}, screen: 'setup', setupMode: mode, pendingChallenge: null, toast: null, digest: null, playback: null, offseason: null, h2h: null })
  return renderToString(createElement(Setup))
}

beforeEach(() => disk.clear())

describe('the compact setup team sheet', () => {
  it('opens with the team section and keeps optional rules closed even after an old expanded visit', () => {
    disk.set('touchline-setup-advanced', '1')
    const html = renderSetup('quick')
    expect(html).toContain('role="group" aria-label="Setup sections"')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Your team<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Rules<\/button>/)
    expect(html).toMatch(/aria-haspopup="dialog" aria-expanded="false"[^>]*data-testid="more-options-toggle"/)
    expect(html).not.toContain('data-testid="setup-options-dialog"')
    expect(markupProblems(html)).toEqual([])
  })
  it('puts the team name first and keeps every formation available behind a closed native chooser', () => {
    for (const mode of ['quick', 'season', 'dynasty'] as const) {
      const html = renderSetup(mode)
      const chooser = html.match(/<details[^>]*data-testid="formation-details"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? ''
      expect(chooser, mode).not.toBe('')
      expect(chooser.slice(0, chooser.indexOf('>')), mode).not.toMatch(/\bopen(?:=|\s|$)/)
      expect(html.indexOf('data-testid="team-name"'), mode).toBeLessThan(html.indexOf('data-testid="formation-details"'))
      expect(chooser.match(/<summary[\s\S]*?<\/summary>/)?.[0], mode).toContain(getFormation(defaultChoices(mode).formationId).name)
      for (const formation of FORMATIONS) expect(chooser, `${mode}: ${formation.id}`).toContain(`data-testid="formation-${formation.id}"`)
      expect(chooser.match(/aria-pressed="true"/g), mode).toHaveLength(1)
      expect(markupProblems(html), mode).toEqual([])
    }
  })

  it('shows remembered choices without expanding the special rules or changing their selected values', () => {
    saveChoices('quick', { ...defaultChoices('quick'), formationId: '4-4-2', modes: ['legends'], powerUps: false, endCase: false })
    const html = renderSetup('quick')
    const summary = html.match(/<summary[^>]*data-testid="formation-toggle"[\s\S]*?<\/summary>/)?.[0] ?? ''
    expect(summary).toContain('4-4-2')
    expect(html).not.toContain('data-testid="modes-panel"')
    expect(html).toContain('Legends')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-testid="formation-4-4-2"/)
  })

  it('keeps the fixed Daily and Weekly shape visible without offering a formation override', () => {
    for (const mode of ['daily', 'weekly'] as const) {
      const html = renderSetup(mode)
      expect(html, mode).toContain('data-testid="formation-preview"')
      expect(html, mode).not.toContain('data-testid="formation-details"')
      expect(html, mode).not.toContain('data-testid="formation-picker"')
      expect(html, mode).not.toContain('data-testid="modes-panel"')
      expect(html, mode).toContain('data-testid="setup-start"')
      expect(markupProblems(html), mode).toEqual([])
    }
  })
})
