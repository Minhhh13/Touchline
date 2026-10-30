/**
 * QA round 14 (docs/QA.md, r16), R16-2: playtest P6's place over a reload for a season with no bench. The first
 * draft (no bench) after the January window, or any Quick Draft with no bench, is in phase `summary` while it plays its
 * games, and the shell sent a reload there to the summary with every game shown: the playback's mark was never read.
 * Now a mark this device left part way through that playback brings it back; a finished or skipped one does not.
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
import { useStore } from '@game/store'
import { firstDraftSettings } from '@game/logic/onboarding'
import { createGame } from '@game/logic/setup'
import type { Game } from '@game/types'
import { App } from '../App'
import { show } from './qaSsr'
import { PLAYBACK_RESUME_KEY, playbackKey, playbackUnfinished, writePlaybackMark } from '../playbackResume'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

/** The shell's nav entry for the game: "Season" while the playback holds the screen, "Summary" once it has closed. */
function navAfterReload(): string {
  show({ game: JSON.parse(JSON.stringify(st().game)) as Game, playback: null, screen: 'game' })
  const html = renderToString(createElement(App)).replace(/<!-- -->/g, '')
  return html.includes('>Season<') ? 'Season' : html.includes('>Summary<') ? 'Summary' : 'none'
}

describe('QA r16: a season with no bench keeps its playback over a reload (R16-2)', () => {
  it('after the January window and to the end', () => {
    for (const seed of ['r16-pb-0', 'r16-pb-1', 'r16-pb-2']) {
      localStorage.removeItem(PLAYBACK_RESUME_KEY)
      show({ universe: u, loadedLeagues: ['england'], game: createGame(firstDraftSettings(u, seed)!), playback: null, screen: 'game' })
      st().autoDraftRest()
      st().finishDraft()
      st().kickOff()
      if (st().game!.phase === 'january') st().closeJanuary(null)
      const g = st().game!
      expect(g.phase, seed).toBe('summary')
      expect(g.quickOpen, seed).toBeFalsy()
      const n = g.quickResult!.results!.length
      // No mark: as before, the summary
      expect(playbackUnfinished(g.id, n), seed).toBe(false)
      expect(navAfterReload(), seed).toBe('Summary')
      // Part way (paused or playing): back to the playback
      for (const [revealed, paused] of [[19, false], [27, true], [n - 1, false]] as const) {
        writePlaybackMark({ key: playbackKey(g.id, 'summary', n), revealed, paused })
        expect(playbackUnfinished(g.id, n), `${seed} ${revealed}`).toBe(true)
        expect(navAfterReload(), `${seed} ${revealed}`).toBe('Season')
      }
      // Every game shown (the end, or Skip): the summary
      writePlaybackMark({ key: playbackKey(g.id, 'summary', n), revealed: n, paused: false })
      expect(navAfterReload(), seed).toBe('Summary')
      // The first half's mark, or another game's, is not this playback's
      writePlaybackMark({ key: playbackKey(g.id, 'january', 19), revealed: 3, paused: true })
      expect(navAfterReload(), seed).toBe('Summary')
      writePlaybackMark({ key: playbackKey('another-game', 'summary', n), revealed: 3, paused: true })
      expect(navAfterReload(), seed).toBe('Summary')
    }
  })
})
