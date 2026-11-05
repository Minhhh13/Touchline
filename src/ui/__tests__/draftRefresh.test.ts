import { beforeEach, describe, expect, it, vi } from 'vitest'
// Render the settled surface in SSR; its deferred odds calculation normally completes after the first paint.
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useDeferredValue: <T>(value: T) => value }))
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
import { assistantChoice, QUICK_RULES, SEASON_RULES, spinClubSeason, type DraftRules } from '@engine/draft'
import { useStore } from '@game/store'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { seasonLabel } from '../format'
import { Draft } from '../screens/Draft'
import { markupProblems, show } from './qaSsr'

const universe = loadTestUniverse(['england'])
const state = () => useStore.getState()
const draftState = () => state().game!.draft!
const rowsOf = (html: string) => html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? []
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
const sheetOf = (html: string) => html.match(/<ol\b[^>]*data-testid="draft-team-sheet"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? ''
const historyOf = (html: string) => html.match(/<details\b[^>]*data-testid="draft-history"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? ''

function startDraft(mode: 'quick' | 'season' | 'dynasty' = 'quick', rules: Partial<DraftRules> = {}): void {
  show({ universe, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game', toast: null, digest: null, playback: null, offseason: null, h2h: null })
  state().startGame({
    mode, seed: 'design-refresh-draft', formationId: '4-3-3', teamName: 'Birchmere United', shortName: 'BIR',
    leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024,
    rules: { ...(mode === 'quick' ? QUICK_RULES : SEASON_RULES), leagues: ['england'], twists: false, managers: false, managerSpin: false, endCase: false, powerUps: false, ...rules },
    jobSecurity: false, difficulty: 'calibrated', continental: false,
  })
}

function pickCurrent(): void {
  const d = draftState()
  const club = spinClubSeason(universe, d)
  expect(club).toBeDefined()
  const choice = club && assistantChoice(universe, d, club)
  if (!choice) throw new Error('The seeded spin must offer a player for the XI')
  state().pickPlayer(choice.id, choice.slot)
  expect(draftState().current).toBeNull()
}

function renderDraft(): string {
  show({})
  return renderToString(createElement(Draft))
}

beforeEach(() => disk.clear())

describe('the refreshed draft team sheet and history', () => {
  it('lets Position First open the slot picker without spending a spin or changing the seed', () => {
    startDraft('quick', { draftMode: 'position' })
    const before = JSON.stringify(state().game)
    const html = renderDraft()
    const button = html.match(/<button[^>]*class="[^"]*spin-btn[^"]*"[^>]*>/)?.[0] ?? ''
    expect(button).toContain('aria-haspopup="dialog"')
    expect(button).not.toContain('disabled')
    expect(html).toContain('Choose a slot')
    expect(JSON.stringify(state().game)).toBe(before)
    expect(draftState().spins).toBe(0)
  })
  it('keeps the reel and Spin together before the secondary odds in reading order', () => {
    startDraft()
    const html = renderDraft()
    const reel = html.indexOf('data-testid="case-reel"')
    const spin = html.indexOf('spin-btn')
    const odds = html.indexOf('data-testid="spin-odds"')
    expect(reel).toBeGreaterThan(0)
    expect(spin).toBeGreaterThan(reel)
    expect(odds).toBeGreaterThan(spin)
    const disclosure = html.match(/<details[^>]*data-testid="draft-odds"[^>]*>/)?.[0] ?? ''
    expect(disclosure).not.toBe('')
    expect(disclosure).not.toMatch(/\bopen(?:=|\s|>)/)
  })

  it('shows all eleven formation positions before the first spin in each draft mode', () => {
    for (const mode of ['quick', 'season', 'dynasty'] as const) {
      startDraft(mode)
      const html = renderDraft()
      const sheet = sheetOf(html)
      const rows = rowsOf(sheet)
      expect(sheet, mode).toContain('aria-label="Team sheet"')
      expect(sheet, mode).toContain('tabindex="0"')
      expect(rows, mode).toHaveLength(11)
      expect(rows.map(textOf), mode).toEqual(draftState().formation.slots.map((slot) => `${slot.position} To be drafted`))
      expect(html, mode).toContain('0/11 starters')
      expect(historyOf(html), mode).toBe('')
      expect(markupProblems(html), mode).toEqual([])
    }
  })

  it('keeps signed players in their slots and preserves every pick and re-spin inside a closed history disclosure', () => {
    startDraft()
    state().spin()
    state().respin()
    pickCurrent()
    state().spin()
    pickCurrent()
    const d = draftState()
    expect(d.history).toHaveLength(3)
    const html = renderDraft()
    const sheetRows = rowsOf(sheetOf(html))
    expect(sheetRows).toHaveLength(11)
    expect(sheetRows.filter((row) => row.includes('To be drafted'))).toHaveLength(9)
    d.formation.slots.forEach((slot, index) => {
      const player = universe.index[d.lineup[slot.id]]
      const text = textOf(sheetRows[index])
      expect(text).toContain(slot.position)
      expect(text).toContain(player?.name ?? 'To be drafted')
      if (player) expect(sheetRows[index]).toMatch(new RegExp(`class="rating [^"]*">${player.overall}</span>`))
    })
    const history = historyOf(html)
    expect(history).not.toBe('')
    expect(history.match(/^<details[^>]*>/)?.[0]).not.toMatch(/\bopen(?:=|\s|>)/)
    expect(history.match(/<summary>[\s\S]*?<\/summary>/)?.[0]).toContain('2 picks made')
    const logRows = rowsOf(history)
    expect(logRows).toHaveLength(d.history.length)
    ;[...d.history].reverse().forEach((entry, index) => {
      const text = textOf(logRows[index])
      expect(text).toContain(entry.pickedId ? universe.index[entry.pickedId].name : 'Re-spun')
      expect(text).toContain(seasonLabel(entry.season))
    })
    expect(markupProblems(html)).toEqual([])
  })

  it('reveals a signed player’s rating in the team sheet and history even when offers are blind', () => {
    for (const rules of [{ showRatings: false }, { difficulty: 'hard', hardMode: true, showRatings: false }] satisfies Partial<DraftRules>[]) {
      startDraft('quick', rules)
      state().spin()
      pickCurrent()
      const player = universe.index[Object.values(draftState().lineup)[0]]
      const html = renderDraft()
      for (const region of [sheetOf(html), historyOf(html)]) {
        expect(textOf(region)).toContain(player.name)
        expect(region).toMatch(new RegExp(`class="rating [^"]*">${player.overall}</span>`))
        expect(region).not.toContain('rating hidden')
      }
    }
  })
})
