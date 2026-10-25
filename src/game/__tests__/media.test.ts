import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper, eventContext, applyEventChoice } from '../logic/week'
import { rollEvent, resolveEvent } from '@engine/events'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { simulateMatch } from '@engine/match'
import { aiTeamInput, buildAiClubs, userTeamInput } from '@engine/season'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'media-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('press conferences and man-marking', () => {
  const u = loadTestUniverse()

  it('rolls post-match press conferences that match the result and resolves them', () => {
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    let wins = 0
    let losses = 0
    let seen = 0
    for (let i = 0; i < 12; i++) {
      playMatchweek(g, u, true)
      const ctx = eventContext(g, u, new Rng(`ctx${i}`))
      expect(ctx.lastResult).toBeTruthy()
      const { gf, ga } = ctx.lastResult!
      if (gf > ga) wins++
      if (gf < ga) losses++
      // Roll until the press turns up, then make sure the event fits the result
      for (let k = 0; k < 30; k++) {
        const ev = rollEvent(eventContext(g, u, new Rng(`roll${i}-${k}`)))
        if (!ev || !ev.id.startsWith('press-')) continue
        if (ev.id === 'press-win') expect(gf).toBeGreaterThan(ga)
        if (ev.id === 'press-loss') expect(gf).toBeLessThan(ga)
        seen++
        break
      }
    }
    expect(wins + losses).toBeGreaterThan(0)
    expect(seen).toBeGreaterThan(0)
    // Resolve a win conference by praising the squad: morale rises for everyone
    const ctx = eventContext(g, u, new Rng('res'))
    const ev = { id: 'press-win', title: 't', body: 'b', choices: [{ id: 'praise-team', label: '', hint: '' }] }
    const out = resolveEvent(ev, 'praise-team', ctx)
    expect(out.teamMoraleDelta).toBe(2)
    const loss = resolveEvent({ ...ev, id: 'press-loss' }, 'blame-players', ctx)
    expect(loss.moraleDelta!.length).toBe(ctx.squad.length)
    expect(loss.confidenceDelta).toBe(2)
    // Through the game layer
    g.pendingEvent = { ...ev, id: 'press-loss', choices: [{ id: 'blame-self', label: '', hint: '' }] }
    const conf = g.season!.confidence
    const m0 = Object.values(g.squad).map((s) => s.morale)
    applyEventChoice(g, u, 'blame-self')
    expect(g.season!.confidence).toBe(Math.max(0, conf - 2))
    expect(Object.values(g.squad).some((s, i) => s.morale > m0[i] || m0[i] === 100)).toBe(true)
  })

  it("man-marking cuts the target's output and is cleared after the match", () => {
    const g = createGame(settings({ seed: 'mark' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    const ai = buildAiClubs(u, 'england', 2023, 'everton')
    const club = Object.values(ai)[0]
    const opp = aiTeamInput(u, club, 10)
    const xi = Object.values(opp.lineup).map((id) => u.index[id]).filter((p) => p.positions[0] !== 'GK')
    const target = [...xi].sort((a, b) => b.attributes.shooting - a.attributes.shooting)[0]
    const base = userTeamInput(u, { teamName: 'T', shortName: 'T', tactics: g.tactics, lineup: g.lineup, bench: g.bench, state: g.squad, teamTalk: 'none' })
    // A 7 per cent cut to the opponent's expected goals needs the paired sample to be this big to clear the noise
    const run = (markTarget?: string) => {
      let goals = 0
      let conceded = 0
      for (let i = 0; i < 1000; i++) {
        const res = simulateMatch({ rng: new Rng(`mm-${i}`), home: { ...base, markTarget }, away: opp, detail: 'full' })
        goals += res.events.filter((e) => e.type === 'goal' && e.playerId === target.id).length
        conceded += res.awayGoals
      }
      return { goals, conceded }
    }
    const plain = run()
    const marked = run(target.id)
    expect(marked.goals).toBeLessThan(plain.goals)
    expect(marked.conceded).toBeLessThan(plain.conceded)
    const res = simulateMatch({ rng: new Rng('note'), home: { ...base, markTarget: target.id }, away: opp, detail: 'full' })
    expect(res.homeReport.modifiers.notes.some((n) => n.startsWith('Man-marking'))).toBe(true)
    // Game layer: set for the next match, used, then cleared
    g.markTarget = target.id
    playMatchweek(g, u, true)
    expect(g.markTarget).toBeUndefined()
  })
})
