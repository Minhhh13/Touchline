import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { seasonGame, seasonSettings } from '@game/__tests__/seasonGame'
import { Summary } from '../screens/Summary'
import { show } from './qaSsr'

describe('continuing from an accepted Dynasty job offer', () => {
  it('offers next season only on the chosen job, and waits for required league data', () => {
    const u = loadTestUniverse(['england'])
    const game = seasonGame(u, 'ios-job', 38, seasonSettings('ios-job', { mode: 'dynasty', continental: false }))
    game.jobOffers = [{ leagueId: 'england', clubId: 'arsenal', budgetBonus: 30, pitch: 'A new challenge.' }]
    game.pendingMove = null
    show({ universe: u, loadedLeagues: ['england'], game, screen: 'game', loadingLeagues: false, playback: null })
    expect(renderToString(createElement(Summary))).not.toContain('data-testid="job-next-season"')
    show({ game: { ...game, pendingMove: { leagueId: 'england', clubId: 'arsenal' } } })
    const chosen = renderToString(createElement(Summary))
    expect(chosen.match(/data-testid="job-next-season"/g)).toHaveLength(1)
    expect(chosen).toMatch(/data-testid="job-next-season">Join Arsenal/)
    show({ loadingLeagues: true })
    expect(renderToString(createElement(Summary))).toMatch(/disabled="" data-testid="job-next-season"/)
  })
})
