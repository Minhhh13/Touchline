import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { createGame } from '@game/logic/setup'
import { playMatchweek } from '@game/logic/week'
import { beginRunIn, runInGameSettings, runInVerdict, seedRunInDraft } from '@game/logic/runin'
import { marginText } from '../runInText'

const u = loadTestUniverse()
const name = (id: string) => u.clubById[id]?.shortName ?? id

describe('marginText: how close a run-in came (r9)', () => {
  it('names the club across the line and the gap, goal difference when level, over played run-ins', () => {
    const jobs = (['survival', 'title', 'europe'] as const).map((tpl) => suggestRunIns(runInCatalogue(u, tpl).filter((j) => j.leagueId === 'england'), `r9-margin-${tpl}`)[0])
    expect(jobs.every(Boolean)).toBe(true)
    for (const job of jobs)
      for (const seed of ['r9-margin-1', 'r9-margin-2', 'r9-margin-3']) {
        const g = createGame(runInGameSettings(u, job, { seed }))
        seedRunInDraft(g, u)
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        g.rngState = rng.getState()
        beginRunIn(g, u)
        for (let w = 0; w < 40 && g.phase !== 'summary'; w++) {
          playMatchweek(g, u, true)
          if (g.phase === 'match') g.phase = 'week'
        }
        const s = g.season!
        const rows = seasonTable(s)
        const line = marginText(rows, USER_TEAM, s.boardTarget, { sacked: !!s.sacked, playOff: false, name })
        if (s.sacked) {
          expect(line).toBeNull()
          continue
        }
        const v = runInVerdict(g, u)!
        const pos = positionOf(rows, USER_TEAM)
        const rival = v.met ? rows[s.boardTarget] : rows[s.boardTarget - 1]
        const gap = Math.abs(rows[pos - 1].points - rival.points)
        expect(line).toContain(name(rival.teamId))
        if (gap === 0) expect(line).toMatch(v.met ? /through on goal difference$/ : /out on goal difference$/)
        else expect(line).toMatch(new RegExp(`^${gap} points? ${v.met ? 'clear of' : 'short of'} `))
      }
  }, 120_000)

  it('is null when sacked, after a play-off, or with nobody across the line', () => {
    const rows = [{ teamId: USER_TEAM, points: 50 }, { teamId: 'b', points: 50 }, { teamId: 'c', points: 40 }]
    expect(marginText(rows, USER_TEAM, 1, { sacked: true, playOff: false, name })).toBeNull()
    expect(marginText(rows, USER_TEAM, 1, { sacked: false, playOff: true, name })).toBeNull()
    expect(marginText(rows, USER_TEAM, 3, { sacked: false, playOff: false, name })).toBeNull()
    expect(marginText(rows, USER_TEAM, 1, { sacked: false, playOff: false, name: (id) => id.toUpperCase() })).toBe('Level on points with B in 2nd: through on goal difference')
    expect(marginText([{ teamId: 'a', points: 60 }, { teamId: USER_TEAM, points: 59 }], USER_TEAM, 1, { sacked: false, playOff: false, name: (id) => id })).toBe('1 point short of a in 1st')
  })
})
