/**
 * QA round 14 (docs/QA.md, r16), R16-1: a page loaded on a finished match opens on its report. The match view is
 * transient, and its first value used to be the replay, so a reload on a simmed arena rung (playtest P4) or a Season's
 * Sim result played the match again from 0-0 with the result already known. Every action that opens a match still sets
 * its own view: a live match is the dashboard, a match watched to its whistle the report.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
vi.setConfig({ testTimeout: 60_000 })
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { useStore } from '@game/store'
import { gauntletGameSettings } from '@game/logic/arena'
import { beginSeason, createGame } from '@game/logic/setup'
import type { Game } from '@game/types'
import { show } from './qaSsr'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()
// The store's first transient values, read before `show` copies the test's state over them (as a fresh page has them)
const FIRST = (({ matchView, liveAuto, playingWeek }) => ({ matchView, liveAuto, playingWeek }))(useStore.getInitialState())

/** A reload: the saved game read back from its JSON, every transient value at its first. */
function reload(): void {
  show({ game: JSON.parse(JSON.stringify(st().game)) as Game, ...FIRST })
}

async function matchScreen(): Promise<string> {
  const { MatchScreen } = await import('../screens/MatchScreen')
  return renderToString(createElement(MatchScreen)).replace(/<!-- -->/g, '')
}

describe('QA r16: a reload on a finished match opens on its report (R16-1)', () => {
  it('a simmed arena rung, on every rung of a Gauntlet', async () => {
    for (const seed of ['r16-reload-rung-0', 'r16-reload-rung-1']) {
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game' })
      st().startGame(gauntletGameSettings(u, { teamName: 'Sixteen FC', formationId: '4-3-3', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true }, 'SIX'))
      st().autoDraftRest()
      st().finishDraft()
      for (let rung = 0; rung < 4 && st().game!.phase !== 'summary'; rung++) {
        st().playArenaStep(false)
        const g = st().game!
        if (g.phase !== 'match') break
        expect(st().matchView, seed).toBe('report')
        reload()
        expect(st().matchView, seed).toBe('report')
        const html = await matchScreen()
        if (!g.arena?.pending) {
          expect(html, seed).toContain('data-testid="report-outcome"')
          expect(html, seed).not.toContain('class="matchday')
        }
        st().closeMatch()
        if (st().game!.phase === 'match') st().closeMatch()
      }
    }
  })

  it("a Season's Sim result, and a watched match still opens live", async () => {
    const g = createGame({ mode: 'season', seed: 'r16-reload-season', formationId: '4-3-3', teamName: 'Reload XI', shortName: 'REL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    show({ universe: u, loadedLeagues: ['england'], game: g, screen: 'game', playingWeek: false, liveAuto: false })
    st().setMatchPlay('sim')
    st().playWeek()
    while (st().game!.pendingEvent) st().resolveEvent(st().game!.pendingEvent!.choices[0].id)
    if (st().game!.phase !== 'match') st().playWeek()
    expect(st().game!.phase).toBe('match')
    expect(st().game!.live).toBeFalsy()
    reload()
    const report = await matchScreen()
    expect(report).toContain('data-testid="report-outcome"')
    expect(report).not.toContain('class="matchday')
    st().closeMatch()
    // Watch: the live match is the dashboard whatever the first view, before and after a reload
    st().setMatchPlay('watch')
    st().playWeek()
    while (st().game!.pendingEvent) st().resolveEvent(st().game!.pendingEvent!.choices[0].id)
    if (!st().game!.live) st().playWeek()
    expect(st().game!.live).toBeTruthy()
    reload()
    expect(await matchScreen()).not.toContain('data-testid="report-outcome"')
  })
})
