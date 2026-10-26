import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { arenaStatus, beginArena, finalGameSettings } from '../logic/arena'
import { resumeStatus } from '../logic/resume'
import { countPhrase } from '../../ui/screenText'
import { influenceOf } from '../logic/dynamics'
import { playerLookup } from '../logic/players'
import { seasonGame, seasonSettings } from './seasonGame'

const u = loadTestUniverse(['england'])

describe("Home's resume strips", () => {
  it('names where a waiting game stands, phase by phase', () => {
    const g = createGame(seasonSettings('resume-1'))
    expect(resumeStatus(g)).toBe('Drafting')
    g.phase = 'kickoff'
    expect(resumeStatus(g)).toBe('Kick-off')
    g.phase = 'january'
    expect(resumeStatus(g)).toBe('January window')
    g.phase = 'summary'
    expect(resumeStatus(g)).toBe('Season complete')
  })

  it('gives a season its matchweek and season', () => {
    const g = seasonGame(u, 'resume-2', 3)
    expect(resumeStatus(g)).toBe(`Matchweek ${g.season!.matchweek} of ${g.season!.matchweeks} · 2025-26`)
    expect(g.season!.matchweek).toBe(3)
  })

  it("gives an arena run the arena's own line", () => {
    const g = createGame(finalGameSettings(u, { teamName: 'Arena XI', formationId: '4-3-3', field: 'giants', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'resume-3', hardMode: false, twists: true }, 'AXI'))
    expect(resumeStatus(g)).toBe('Drafting')
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginArena(g, u)
    expect(resumeStatus(g)).toBe(arenaStatus(g))
    expect(resumeStatus(g)).toMatch(/next$/)
  })

  it('counts one season in the singular on the Profile tile', () => {
    expect(countPhrase(1, 'seasons')).toBe('1 season')
    expect(countPhrase(0, 'achievements')).toBe('0 achievements')
    expect(countPhrase(1, 'achievements')).toBe('1 achievement')
  })
  it("counts one appearance as \"1 app\" on squad rows and in the dressing room", () => {
    expect(countPhrase(1, 'apps')).toBe('1 app')
    expect(countPhrase(0, 'apps')).toBe('0 apps')
    const g = seasonGame(u, 'resume-apps', 1)
    const get = playerLookup(g, u)
    const reasons = Object.entries(g.squad).map(([id, s]) => influenceOf(g, get(id)!, s).reasons).flat()
    expect(reasons.some((r) => /^1 apps$/.test(r))).toBe(false)
  })
})
