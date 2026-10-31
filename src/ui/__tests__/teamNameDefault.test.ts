/**
 * The team name a setup screen opens with (src/ui/teamName.ts): an invented club name, never Touchline XI, unless
 * this viewer typed one of their own and played with it, which is kept for next time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { generateTeamName, generatedTeamCode } from '@game/logic/teamNames'
import { shortNameFor } from '@game/logic/setup'
import type { Mode } from '@game/types'
import { show } from './qaSsr'
import { Setup } from '../screens/Setup'
import { ArenaSetup } from '../screens/ArenaSetup'
import { TEAM_NAME_KEY, rememberTeamName, savedTeamName, startingTeam, startingTeamName, teamShortName } from '../teamName'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { puzzleOf } from '../../online/server/dailyVerify'

const u = loadTestUniverse(['england'])
const base = { universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, offseason: null, h2h: null, pendingChallenge: null }

/** The value and placeholder of a rendered team name field, and whether its Shuffle button is there. */
function field(C: ComponentType, testId = 'team-name'): { value: string; placeholder: string; shuffle: boolean } {
  const html = renderToString(createElement(C))
  const input = new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? ''
  const attr = (name: string) => (new RegExp(`\\b${name}="([^"]*)"`).exec(input)?.[1] ?? '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
  return { value: attr('value'), placeholder: attr('placeholder'), shuffle: html.includes(`data-testid="${testId}-shuffle"`) }
}

beforeEach(() => localStorage.removeItem(TEAM_NAME_KEY))

describe('the setup screens open with an invented team name', () => {
  it('every mode with the field: an invented club name, never Touchline XI, with Shuffle beside it', () => {
    for (const mode of ['quick', 'daily', 'season', 'dynasty', 'weekly'] as Mode[]) {
      show({ ...base, screen: 'setup', setupMode: mode })
      const f = field(Setup)
      expect(f.value, mode).not.toBe('Touchline XI')
      expect(generatedTeamCode(f.value), `${mode}: ${f.value}`).toMatch(/^[A-Z]{3}$/)
      expect(f.shuffle, mode).toBe(true)
    }
    show({ ...base, screen: 'setup', setupMode: 'arena' })
    const arena = field(ArenaSetup)
    expect(arena.value).not.toBe('Touchline XI')
    expect(generatedTeamCode(arena.value)).not.toBeNull()
    expect(arena.shuffle).toBe(true)
  })

  it('a fresh name each time a setup opens', () => {
    show({ ...base, screen: 'setup', setupMode: 'quick' })
    const names = new Set(Array.from({ length: 12 }, () => field(Setup).value))
    expect(names.size).toBeGreaterThan(1)
  })

  it('Shuffle always lands on another invented name', () => {
    show({ ...base, screen: 'setup', setupMode: 'quick' })
    const { value } = field(Setup)
    for (let i = 0; i < 200; i++) {
      const next = generateTeamName(Math.random, [value]).name
      expect(next).not.toBe(value)
      expect(generatedTeamCode(next)).not.toBeNull()
    }
  })

  it('a name the player typed and played with comes back next time; an invented one does not stick', () => {
    rememberTeamName('  Dad FC  ')
    expect(savedTeamName()).toBe('Dad FC')
    show({ ...base, screen: 'setup', setupMode: 'quick' })
    const f = field(Setup)
    expect(f.value).toBe('Dad FC')
    // The placeholder is an invented spare, which a blank field starts with
    expect(generatedTeamCode(f.placeholder)).not.toBeNull()
    expect(startingTeamName()).toBe('Dad FC')
    // Starting with an invented name clears it: the next setup invents again
    rememberTeamName('Ashvale United')
    expect(savedTeamName()).toBeNull()
    expect(generatedTeamCode(field(Setup).value)).not.toBeNull()
    expect(generatedTeamCode(startingTeamName())).not.toBeNull()
  })

  it('an invented name takes its own three letters, a typed one the initials it always had', () => {
    expect(teamShortName('Ashvale United')).toBe('ASH')
    expect(teamShortName('St Oswin Town')).toBe('STO')
    for (const typed of ['Touchline XI', 'Dad FC', 'QA XI']) expect(teamShortName(typed)).toBe(shortNameFor(typed))
  })
})

describe('the Daily Arena from Home takes the manager\'s team name (r9)', () => {
  it('an invented name with its own code, or the remembered one, and the same puzzle either way', () => {
    let k = 0
    const random = () => ((k = (k * 9301 + 49297) % 233280) / 233280)
    for (let i = 0; i < 20; i++) {
      const team = startingTeam(random)
      expect(team.teamName).not.toBe('Touchline XI')
      expect(team.shortName).toBe(generatedTeamCode(team.teamName))
      const s = { ...dailyArenaGameSettings(u, 'arena-2026-10-29', team.teamName), shortName: team.shortName }
      expect(s.teamName).toBe(team.teamName)
      expect(puzzleOf(s)).toEqual(puzzleOf(dailyArenaGameSettings(u, 'arena-2026-10-29')))
    }
    rememberTeamName('Hackney Wanderers')
    expect(startingTeam()).toEqual({ teamName: 'Hackney Wanderers', shortName: shortNameFor('Hackney Wanderers') })
  })
})
