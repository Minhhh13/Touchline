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
import type { GameSettings, QuickGameResult } from '@game/types'
import { CHEER_GOALS, FAST_BELOW_MS, MIN_RESULT_GAP_MS, TENSION_GAMES, finishOf, playbackCues, seasonStepCues, stingerAt, type PlaybackCueInput, type PlaybackGame, type SeasonCue } from '../sound/seasonCues'
import { RESULT_LEVEL, RESULT_NOTES, SEASON_MAX_LEVEL, STINGER_NOTES, THIN_RESULT_LEVEL, seasonScoreFor, type SeasonSoundRequest, type StingerKind } from '../sound/seasonScores'
import { peakOf, scoreFor, scoreLength } from '../sound/scores'
import { playScore } from '../sound/synth'

const u = loadTestUniverse(['england'])

/** A season from a string of W, D and L (2-0, 1-1 and 0-1). */
function shaped(shape: string, over: Record<number, Partial<PlaybackGame>> = {}): PlaybackGame[] {
  return [...shape].map((o, i) => ({ matchweek: i + 1, ...(o === 'W' ? { gf: 2, ga: 0 } : o === 'D' ? { gf: 1, ga: 1 } : { gf: 0, ga: 1 }), ...over[i + 1] }))
}

function input(results: PlaybackGame[], o: Partial<PlaybackCueInput> = {}): PlaybackCueInput {
  return { results, tables: [], userId: USER_TEAM, total: results.length, stopAt: results.length, january: false, clinch: null, finalPosition: 1, teams: 20, reduced: false, ...o }
}

/** Plays a playback through game by game at one speed, as the hook does (the clock moving one gap a game). */
function playThrough(inp: PlaybackCueInput, speed: PlaybackSpeed, from = 0): SeasonCue[][] {
  const out: SeasonCue[][] = []
  let lastResultAt = -Infinity
  for (let k = from + 1; k <= inp.stopAt; k++) {
    const r = playbackCues(inp, { from: k - 1, to: k, speed, lastResultAt, now: k * playbackDelay(speed) })
    lastResultAt = r.lastResultAt
    out.push(r.cues)
  }
  return out
}

const ids = (cues: SeasonCue[]) => cues.map((c) => c.req.id)
const count = (steps: SeasonCue[][], id: SeasonSoundRequest['id']) => steps.flat().filter((c) => c.req.id === id).length

function quickSeason(seed: string) {
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Cue XI', shortName: 'CUE', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], managers: false }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  const q = g.quickResult!
  const results: QuickGameResult[] = q.results!
  const tables: LiveRow[][] = q.rounds ? weeklyTables(q.rounds) : []
  const clinch = q.rounds ? clinchMatchweeks(roundsFixtures(q.rounds), q.rounds.ids, USER_TEAM) : null
  return input(results, { tables, clinch, finalPosition: q.position, teams: q.table.length })
}

describe('the season playback’s cues', () => {
  it('lands one result blip per game at 1x, each W, D or L, with a cheer for two goals or more (never under a defeat)', () => {
    const res = shaped('WDLWWLDW', { 4: { gf: 4, ga: 1 }, 6: { gf: 2, ga: 3 } })
    const steps = playThrough(input(res, { finalPosition: 7 }), 1)
    expect(steps).toHaveLength(8)
    steps.forEach((cues, i) => {
      const r = cues.find((c) => c.req.id === 'result')!
      expect(r.at).toBe(0)
      expect(r.req).toEqual({ id: 'result', outcome: 'WDLWWLDW'[i] })
      const cheer = cues.find((c) => c.req.id === 'goals')
      const g = res[i]
      expect(!!cheer, `game ${i + 1}`).toBe(g.gf >= CHEER_GOALS && g.gf >= g.ga)
      if (cheer && cheer.req.id === 'goals') expect(cheer.req.goals).toBe(g.gf)
    })
  })

  it('marks the perfect run every fifth win and its end, the crowd holding its breath over the last five, and the perfect season’s fanfare', () => {
    const steps = playThrough(input(shaped('W'.repeat(38))), 1)
    const stingers = steps.map((c) => c.find((x) => x.req.id === 'stinger')?.req).map((r) => (r && r.id === 'stinger' ? r.kind : null))
    expect(stingers.flatMap((s, i) => (s ? [`${i + 1}:${s}`] : []))).toEqual([5, 10, 15, 20, 25, 30, 35].map((k) => `${k}:perfect-alive`))
    const beds = steps.flatMap((c, i) => (c.some((x) => x.req.id === 'tension') ? [i + 1] : []))
    expect(beds).toEqual([33, 34, 35, 36, 37])
    expect(beds).toHaveLength(TENSION_GAMES)
    // The bed rises as the end comes nearer, and lasts the gap to the next result
    const levels = beds.map((k) => steps[k - 1].find((x) => x.req.id === 'tension')!.req).map((r) => (r.id === 'tension' ? r : null)!)
    for (let i = 1; i < levels.length; i++) expect(levels[i].level).toBeGreaterThan(levels[i - 1].level)
    expect(levels.every((l) => l.dur === playbackDelay(1) / 1000)).toBe(true)
    expect(steps[37].map((c) => c.req)).toContainEqual({ id: 'season-end', finish: 'champion', perfect: true, reduced: false })
    expect(steps[37].some((c) => c.req.id === 'stinger')).toBe(false)
    // One draw breaks it: the stinger on that game, and no bed after
    const broken = playThrough(input(shaped('W'.repeat(34) + 'D' + 'WWW'), { finalPosition: 1 }), 1)
    expect(broken[34].find((c) => c.req.id === 'stinger')?.req).toEqual({ id: 'stinger', kind: 'perfect-broken', reduced: false })
    expect(broken.slice(34).some((c) => c.some((x) => x.req.id === 'tension'))).toBe(false)
    expect(broken[37].map((c) => c.req)).toContainEqual({ id: 'season-end', finish: 'champion', perfect: false, reduced: false })
  })

  it('thins at 4x: short blips, never closer than the gap unless the outcome changed, no cheer and no bed', () => {
    expect(playbackDelay(4)).toBeLessThan(FAST_BELOW_MS)
    expect(playbackDelay(2)).toBeGreaterThanOrEqual(FAST_BELOW_MS)
    const res = shaped('W'.repeat(20) + 'LLLLWDWDWW' + 'W'.repeat(8))
    const slow = playThrough(input(res, { finalPosition: 2 }), 1)
    const fast = playThrough(input(res, { finalPosition: 2 }), 4)
    expect(count(slow, 'result')).toBe(38)
    const blips = count(fast, 'result')
    expect(blips).toBeLessThan(30)
    expect(blips).toBeGreaterThanOrEqual(19)
    expect(count(fast, 'goals') + count(fast, 'tension')).toBe(0)
    expect(fast.flat().every((c) => c.req.id !== 'result' || (c.req.id === 'result' && c.req.thin))).toBe(true)
    // Two blips in a row only where the outcome changed (or a stinger took the place of one)
    for (let k = 2; k <= 38; k++) {
      const both = fast[k - 1].some((c) => c.req.id === 'result') && fast[k - 2].some((c) => c.req.id === 'result' || c.req.id === 'stinger')
      if (both && k < 38) expect(res[k - 1].gf > res[k - 1].ga ? 'W' : res[k - 1].gf < res[k - 1].ga ? 'L' : 'D', `game ${k}`).not.toBe(res[k - 2].gf > res[k - 2].ga ? 'W' : res[k - 2].gf < res[k - 2].ga ? 'L' : 'D')
    }
    // At most one cue a game, and the fanfare still closes the season
    expect(fast.slice(0, 37).every((c) => c.length <= 1)).toBe(true)
    expect(ids(fast[37])).toContain('season-end')
    expect(MIN_RESULT_GAP_MS).toBeGreaterThan(playbackDelay(4))
  })

  it('batches a skip: one riffle for every game skipped and the closing cue, at any speed', () => {
    const res = shaped('WWDLWWWDWWLWWWWDWWWWWLWWWWDWWWWWWLWWWW')
    for (const speed of PLAYBACK_SPEEDS) {
      const r = playbackCues(input(res, { finalPosition: 3 }), { from: 9, to: 38, speed, lastResultAt: 0, now: 10 })
      expect(r.cues.map((c) => c.req)).toEqual([
        { id: 'batch', won: 24, drawn: 2, lost: 3 },
        { id: 'season-end', finish: 'top4', perfect: false, reduced: false },
      ])
    }
    // Skip to January: the riffle and the window's chime
    const half = res.slice(0, 19)
    const jan = playbackCues(input(half, { total: 38, stopAt: 19, january: true }), { from: 3, to: 19, speed: 1, lastResultAt: 0, now: 1 })
    expect(ids(jan.cues)).toEqual(['batch', 'halfway'])
    // The playback ticking into the window (a 2-0): the result and its cheer, then the chime
    expect(ids(playThrough(input(half, { total: 38, stopAt: 19, january: true }), 1).at(-1)!)).toEqual(['result', 'goals', 'halfway'])
  })

  it('plays nothing for no step, a step back or past the results', () => {
    const inp = input(shaped('WWW'))
    for (const [from, to] of [[2, 2], [3, 1], [2, 4]]) expect(playbackCues(inp, { from, to, speed: 1, lastResultAt: 0, now: 0 }).cues).toEqual([])
  })

  it('sounds the title and the drop on the game that settles them, over any other moment', () => {
    const res = shaped('W'.repeat(4) + 'DWWWW')
    expect(stingerAt(input(res, { clinch: { clinchedAt: 5, doomedAt: null } }), 5)).toBe('title')
    expect(stingerAt(input(res), 5)).toBe('perfect-broken')
    expect(stingerAt(input(res, { clinch: { clinchedAt: null, doomedAt: 7 } }), 7)).toBe('relegated')
    // A bye: the week falls between two of the user's games, so the next game carries it, and only that one
    const bye = shaped('WWWWWW').map((g, i) => ({ ...g, matchweek: i < 3 ? i + 1 : i + 2 }))
    expect([1, 2, 3, 4, 5, 6].map((k) => stingerAt(input(bye, { clinch: { clinchedAt: 4, doomedAt: null } }), k))).toEqual([null, null, null, 'title', 'perfect-alive', null])
    expect(finishOf(1, 20)).toBe('champion')
    expect(finishOf(4, 20)).toBe('top4')
    expect(finishOf(17, 20)).toBe('mid')
    expect(finishOf(18, 20)).toBe('drop')
  })

  it('over real seeded quick seasons: one cue a game at 1x, fewer at 4x, each big moment at most once, the fanfare by the final place', () => {
    const seen = new Set<StingerKind>()
    for (const seed of ['cue-1', 'cue-2', 'cue-3', 'cue-4', 'cue-5', 'cue-6']) {
      const inp = quickSeason(seed)
      const slow = playThrough(inp, 1)
      const fast = playThrough(inp, 4)
      expect(count(slow, 'result'), seed).toBe(inp.total)
      expect(count(fast, 'result') + count(fast, 'stinger'), seed).toBeLessThan(inp.total)
      // The cues in one game never pile up: a blip, a cheer, a stinger and the closing cue or a bed at most
      expect(slow.every((c) => c.length <= 4), seed).toBe(true)
      const stingers = slow.flat().flatMap((c) => (c.req.id === 'stinger' ? [c.req.kind] : []))
      for (const once of ['title', 'relegated', 'perfect-broken'] as const) expect(stingers.filter((s) => s === once).length, `${seed} ${once}`).toBeLessThanOrEqual(1)
      stingers.forEach((s) => seen.add(s))
      // The title stinger plays when it was sealed before the last day; on the last day the fanfare has it
      const sealedEarly = inp.clinch?.clinchedAt !== null && inp.clinch?.clinchedAt !== undefined && inp.results.findIndex((g) => g.matchweek >= inp.clinch!.clinchedAt!) < inp.total - 1
      expect(stingers.includes('title'), seed).toBe(sealedEarly)
      const end = slow.at(-1)!.find((c) => c.req.id === 'season-end')!.req
      expect(end.id === 'season-end' && end.finish, seed).toBe(finishOf(inp.finalPosition, inp.teams))
    }
    expect(seen.size).toBeGreaterThan(0)
  }, 120_000)
})

describe('Season and Dynasty’s cues', () => {
  const base = { fromMatchweek: 10, toMatchweek: 11, results: [{ matchweek: 11, gf: 3, ga: 1 }], digest: false, clinch: null, ended: false, sacked: false, reduced: false }

  it('gives Play matchweek one result cue and its cheer, and a run of weeks (the digest) one riffle', () => {
    expect(seasonStepCues(base).map((c) => c.req)).toEqual([{ id: 'result', outcome: 'W' }, { id: 'goals', goals: 3 }])
    expect(seasonStepCues({ ...base, results: [{ matchweek: 11, gf: 0, ga: 2 }] }).map((c) => c.req)).toEqual([{ id: 'result', outcome: 'L' }])
    const run = [{ matchweek: 11, gf: 2, ga: 0 }, { matchweek: 12, gf: 1, ga: 1 }, { matchweek: 13, gf: 0, ga: 1 }, { matchweek: 14, gf: 1, ga: 0 }, { matchweek: 15, gf: 4, ga: 0 }]
    expect(seasonStepCues({ ...base, toMatchweek: 15, results: run, digest: true }).map((c) => c.req)).toEqual([{ id: 'batch', won: 3, drawn: 1, lost: 1 }])
    // A bye week alone: nothing to hear; no step: nothing
    expect(seasonStepCues({ ...base, results: [] })).toEqual([])
    expect(seasonStepCues({ ...base, toMatchweek: 10 })).toEqual([])
  })

  it('adds the title or relegation stinger when the step settled it, never for a sacking, and leaves a title on the last day to the summary', () => {
    const titled = seasonStepCues({ ...base, toMatchweek: 15, digest: true, clinch: { clinchedAt: 13, doomedAt: null } })
    expect(titled.map((c) => c.req.id)).toEqual(['batch', 'stinger'])
    expect(titled[1].req).toEqual({ id: 'stinger', kind: 'title', reduced: false })
    expect(titled[1].at).toBeGreaterThan(0)
    expect(seasonStepCues({ ...base, clinch: { clinchedAt: 9, doomedAt: null } }).some((c) => c.req.id === 'stinger')).toBe(false)
    expect(seasonStepCues({ ...base, clinch: { clinchedAt: null, doomedAt: 11 } }).at(-1)!.req).toEqual({ id: 'stinger', kind: 'relegated', reduced: false })
    expect(seasonStepCues({ ...base, sacked: true, clinch: { clinchedAt: null, doomedAt: 11 } }).some((c) => c.req.id === 'stinger')).toBe(false)
    expect(seasonStepCues({ ...base, toMatchweek: 38, ended: true, clinch: { clinchedAt: 38, doomedAt: null } })).toEqual([])
    expect(seasonStepCues({ ...base, toMatchweek: 38, ended: true, clinch: { clinchedAt: null, doomedAt: 38 } }).map((c) => c.req.id)).toEqual(['result', 'goals', 'stinger'])
  })
})

describe('the season’s scores', () => {
  const REQUESTS: SeasonSoundRequest[] = [
    ...(['W', 'D', 'L'] as const).flatMap((outcome): SeasonSoundRequest[] => [{ id: 'result', outcome }, { id: 'result', outcome, thin: true }]),
    ...[1, 2, 3, 4, 5, 9].map((goals): SeasonSoundRequest => ({ id: 'goals', goals })),
    ...(Object.keys(STINGER_NOTES) as StingerKind[]).flatMap((kind): SeasonSoundRequest[] => [{ id: 'stinger', kind }, { id: 'stinger', kind, reduced: true }]),
    ...(['champion', 'top4', 'mid', 'drop'] as const).map((finish): SeasonSoundRequest => ({ id: 'season-end', finish, perfect: false })),
    { id: 'season-end', finish: 'champion', perfect: true },
    { id: 'season-end', finish: 'champion', perfect: true, reduced: true },
    { id: 'batch', won: 3, drawn: 1, lost: 1 },
    { id: 'batch', won: 0, drawn: 1, lost: 4 },
    { id: 'batch', won: 1, drawn: 5, lost: 0 },
    { id: 'tension', level: 0, dur: 1.5 },
    { id: 'tension', level: 1, dur: 3 },
    { id: 'halfway' },
  ]
  const name = (r: SeasonSoundRequest) => JSON.stringify(r)

  it('is well formed and normalised, every cue far under the match day: the loudest half a goal’s roar', () => {
    const goal = scoreFor({ id: 'goal', tone: 'ours' }).level
    for (const req of REQUESTS) {
      const s = seasonScoreFor(req)
      expect(s.id, name(req)).toBe(req.id)
      expect(s.voices.length, name(req)).toBeGreaterThan(0)
      for (const v of s.voices) {
        expect(v.at, name(req)).toBeGreaterThanOrEqual(0)
        expect(v.attack, name(req)).toBeGreaterThan(0)
        expect(v.attack + (v.hold ?? 0), name(req)).toBeLessThan(v.dur)
        expect(v.freq, name(req)).toBeGreaterThanOrEqual(20)
        expect(v.freq, name(req)).toBeLessThanOrEqual(16000)
      }
      expect(peakOf(s.voices), name(req)).toBeCloseTo(s.level, 6)
      expect(s.level, name(req)).toBeLessThanOrEqual(SEASON_MAX_LEVEL)
      expect(s.level, name(req)).toBeLessThanOrEqual(goal / 2)
      expect(seasonScoreFor(req)).toEqual(seasonScoreFor(req))
    }
  })

  it('keeps the 38 results quiet and short, a win high, a draw in the middle, a loss low', () => {
    for (const o of ['W', 'D', 'L'] as const) {
      const full = seasonScoreFor({ id: 'result', outcome: o })
      const thin = seasonScoreFor({ id: 'result', outcome: o, thin: true })
      expect(full.level).toBe(RESULT_LEVEL[o])
      expect(full.level).toBeLessThanOrEqual(scoreFor({ id: 'click' }).level + 0.03)
      expect(thin.level).toBe(THIN_RESULT_LEVEL)
      expect(scoreLength(full.voices)).toBeLessThan(0.6)
      expect(scoreLength(thin.voices)).toBeLessThan(scoreLength(full.voices))
      expect(scoreLength(thin.voices)).toBeLessThan(playbackDelay(4) / 1000)
      expect(full.voices[0].kind === 'tone' && full.voices[0].freq).toBe(RESULT_NOTES[o])
    }
    expect(RESULT_NOTES.W).toBeGreaterThan(RESULT_NOTES.D)
    expect(RESULT_NOTES.D).toBeGreaterThan(RESULT_NOTES.L)
    // The cheer grows with the goals, and is never a roar: under a second and a fraction of a goal's level
    const cheer = (g: number) => seasonScoreFor({ id: 'goals', goals: g })
    expect(cheer(5).level).toBeGreaterThan(cheer(2).level)
    expect(scoreLength(cheer(5).voices)).toBeLessThan(1)
    expect(cheer(9)).toEqual(cheer(5))
  })

  it('ranks the moments: the title louder than the top four, the season’s fanfare shorter than the Cup’s, the bed barely there', () => {
    const lvl = (r: SeasonSoundRequest) => seasonScoreFor(r).level
    expect(lvl({ id: 'stinger', kind: 'title' })).toBeGreaterThan(lvl({ id: 'stinger', kind: 'top' }))
    expect(lvl({ id: 'stinger', kind: 'top' })).toBeGreaterThan(lvl({ id: 'stinger', kind: 'top4' }))
    expect(lvl({ id: 'season-end', finish: 'champion', perfect: true })).toBeGreaterThanOrEqual(lvl({ id: 'season-end', finish: 'champion', perfect: false }))
    expect(lvl({ id: 'season-end', finish: 'champion', perfect: false })).toBeGreaterThan(lvl({ id: 'season-end', finish: 'mid', perfect: false }))
    expect(scoreLength(seasonScoreFor({ id: 'season-end', finish: 'champion', perfect: true }).voices)).toBeLessThan(scoreLength(scoreFor({ id: 'fanfare', treble: false }).voices))
    expect(lvl({ id: 'tension', level: 1, dur: 2 })).toBeLessThan(0.1)
    expect(lvl({ id: 'tension', level: 1, dur: 2 })).toBeGreaterThan(lvl({ id: 'tension', level: 0, dur: 2 }))
    // Reduced motion drops the sparkle, not the sound
    expect(seasonScoreFor({ id: 'stinger', kind: 'title', reduced: true }).voices.length).toBeLessThan(seasonScoreFor({ id: 'stinger', kind: 'title' }).voices.length)
    expect(seasonScoreFor({ id: 'stinger', kind: 'title', reduced: true }).voices.length).toBeGreaterThan(0)
  })

  it('plays nothing and throws nothing without Web Audio', () => {
    for (const req of REQUESTS) expect(playScore(seasonScoreFor(req), 0.1)).toEqual([])
  })
})
