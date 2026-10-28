import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { roundsFixtures } from '@game/logic/story'
import { weeklyTables, type LiveRow } from '@game/logic/liveTable'
import { playbackDelay, PLAYBACK_SPEEDS, type PlaybackSpeed } from '@game/logic/gameByGame'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { clinchMatchweeks } from '@engine/story'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import type { GameSettings } from '@game/types'
import { playbackCues, type PlaybackCueInput, type PlaybackGame } from '../sound/seasonCues'
import { BEAT_KINDS, beatConfetti, beatLength, beatTone, playbackBeat } from '../seasonBeats'

const u = loadTestUniverse(['england'])

function shaped(shape: string): PlaybackGame[] {
  return [...shape].map((o, i) => ({ matchweek: i + 1, ...(o === 'W' ? { gf: 2, ga: 0 } : o === 'D' ? { gf: 1, ga: 1 } : { gf: 0, ga: 1 }) }))
}

function input(results: PlaybackGame[], o: Partial<PlaybackCueInput> = {}): PlaybackCueInput {
  return { results, tables: [], userId: USER_TEAM, total: results.length, stopAt: results.length, january: false, clinch: null, finalPosition: 1, teams: 20, reduced: false, ...o }
}

function quickSeason(seed: string): PlaybackCueInput {
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Beat XI', shortName: 'BEA', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  const q = g.quickResult!
  const tables: LiveRow[][] = q.rounds ? weeklyTables(q.rounds) : []
  const clinch = q.rounds ? clinchMatchweeks(roundsFixtures(q.rounds), q.rounds.ids, USER_TEAM) : null
  return input(q.results!, { tables, clinch, finalPosition: q.position, teams: q.table.length })
}

describe('the playback’s beats', () => {
  it('land on the stinger the sound plays, at the same offset, for every heavy moment and at every speed', () => {
    let beats = 0
    for (const seed of ['beat-a', 'beat-b', 'beat-c', 'beat-d']) {
      const inp = quickSeason(seed)
      for (const speed of PLAYBACK_SPEEDS as readonly PlaybackSpeed[]) {
        for (let k = 1; k <= inp.stopAt; k++) {
          const b = playbackBeat(inp, k - 1, k, speed)
          const cues = playbackCues(inp, { from: k - 1, to: k, speed, lastResultAt: -Infinity, now: k * playbackDelay(speed) }).cues
          const sting = cues.find((c) => c.req.id === 'stinger')
          const end = cues.find((c) => c.req.id === 'season-end' || c.req.id === 'halfway')
          if (!b) {
            // No card: no heavy sting either (the light ones keep the moment chip)
            if (sting?.req.id === 'stinger') expect(BEAT_KINDS).not.toContain(sting.req.kind)
            expect(end).toBeUndefined()
            continue
          }
          beats++
          if (b.kind === 'season-end') {
            expect(end?.req.id).toBe('season-end')
            expect(b.delayMs).toBe(Math.round(end!.at * 1000))
          } else {
            expect(sting?.req.id === 'stinger' && sting.req.kind).toBe(b.kind)
            expect(b.delayMs).toBe(Math.round(sting!.at * 1000))
          }
        }
      }
    }
    expect(beats).toBeGreaterThan(4)
  })

  it('shows the January stop and the season’s end, and only those on a skip', () => {
    const res = shaped('WWWWWWWWWD')
    expect(playbackBeat(input(res, { stopAt: 5, january: true, total: 10 }), 4, 5, 1)?.kind).toBe('halfway')
    expect(playbackBeat(input(res), 3, 10, 1)?.kind).toBe('season-end')
    expect(playbackBeat(input(res), 0, 6, 1)).toBeNull()
    const end = playbackBeat(input(shaped('WWWW')), 3, 4, 1)
    expect(end).toMatchObject({ kind: 'season-end', finish: 'champion', perfect: true })
    expect(beatConfetti(end!)).toBe(true)
    expect(beatTone(end!)).toBe('good')
    // The broken run is a blow, never confetti
    const broke = playbackBeat(input(shaped('WWLWW')), 2, 3, 1)
    expect(broke?.kind).toBe('perfect-broken')
    expect(beatTone(broke!)).toBe('bad')
    expect(beatConfetti(broke!)).toBe(false)
  })

  it('stays short enough at speed and never steps backwards', () => {
    const b = playbackBeat(input(shaped('WWLWW')), 2, 3, 4)!
    expect(beatLength(b, 4)).toBeLessThanOrEqual(1800)
    expect(beatLength(b, 0.5)).toBeLessThanOrEqual(1800)
    expect(b.delayMs).toBe(0)
    expect(playbackBeat(input(shaped('WWLWW')), 3, 3, 1)).toBeNull()
    expect(playbackBeat(input(shaped('WWLWW')), 3, 2, 1)).toBeNull()
  })
})
