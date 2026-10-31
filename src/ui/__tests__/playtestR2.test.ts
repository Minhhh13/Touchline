/**
 * Playtest round 2 (docs/PLAYTEST.md, round 15): the proposals built without moving a draw. P4 a simmed arena step
 * reads as a result, P5 the 38-0 chase never prints a run as a score, P6 a reload keeps the playback's place, P7 a
 * landed reel stays landed after a reload, P10 the small words. P8 (head-to-head Auto-complete) is
 * `src/game/__tests__/h2hAutoDraft.test.ts`.
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
import { arenaContinueLabel, gauntletGameSettings } from '@game/logic/arena'
import { chaseAt, chaseLine, runsLine } from '@game/logic/perfect'
import { matchLogicLine } from '../i18n/logicText'
import { show } from './qaSsr'
import { parsePlaybackMark, playbackKey, PLAYBACK_RESUME_KEY, readPlaybackMark, resumePlayback, writePlaybackMark } from '../playbackResume'
import { landedBefore, readLandedReel, REEL_LANDED_KEY, reelMark, rememberLandedReel } from '../reelLanded'
import { keepRunInSeed, readRunInSeed, RUN_IN_SEED_KEY, startingRunInSeed } from '../runInSeed'
import { makeLeaveFiler } from '../trophyReveal'
import { ClubBadge } from '../components/bits'
import { translator } from '../i18n'
import { setup } from '../i18n/en/setup'
import { arena } from '../i18n/en/arena'

const u = loadTestUniverse(['england'])
const ts = translator(setup)
const ta = translator(arena)
const st = () => useStore.getState()
const choices = (seed: string) => ({ teamName: 'Fifteen FC', formationId: '4-3-3', wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed, hardMode: false, twists: true })

describe('P4: Sim this rung reads like a result', () => {
  it('opens on the report, and the replay keeps the next rung to itself', async () => {
    const { MatchScreen } = await import('../screens/MatchScreen')
    show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game', matchView: 'ticker' })
    st().startGame(gauntletGameSettings(u, choices('r15-sim-rung'), 'FIF'))
    st().autoDraftRest()
    st().finishDraft()
    // P10: the arena hub's captain list names the number it shows, as Quick Draft's kick-off and the Dugout do
    show({ matchView: 'ticker' })
    const { Arena } = await import('../screens/Arena')
    const hub = renderToString(createElement(Arena)).replace(/<!-- -->/g, '')
    expect(hub).toMatch(/\(mentality \d+\)/)
    expect(hub).not.toContain('composure')
    st().playArenaStep(false)
    const g = st().game!
    expect(g.phase).toBe('match')
    expect(st().matchView).toBe('report')
    const next = arenaContinueLabel(g)
    if (!g.arena!.pending) {
      // The server render reads the store's initial state: hand it the state the actions reached
      show({ matchView: 'report' })
      const report = renderToString(createElement(MatchScreen)).replace(/<!-- -->/g, '')
      expect(report).toContain('data-testid="report-outcome"')
      // The pens' reveal holds the label; otherwise the report says where the run goes next
      if (!g.arena!.log.at(-1)?.pens) expect(report).toContain(next)
      show({ matchView: 'ticker' })
      const replay = renderToString(createElement(MatchScreen)).replace(/<!-- -->/g, '')
      expect(replay).not.toContain(next)
      expect(replay).toContain('Continue →')
    }
  })
})

describe('P5: the chase lines read as counts', () => {
  it('says them in words the screens mirror', () => {
    const won = Array.from({ length: 12 }, () => ({ gf: 2, ga: 1 }))
    const head = chaseLine(chaseAt(won), 38).headline
    expect(head).toBe('Still perfect: 12 wins from 12')
    expect(matchLogicLine(head)?.key).toBe('perfect_stillPerfectWinsFrom')
    expect(matchLogicLine('Still perfect: 1 win from 1')?.key).toBe('perfect_stillPerfectWinsFrom')
    expect(matchLogicLine(runsLine({ perfectRun: 12, unbeatenRun: 15 }, 38)!)?.key).toBe('perfect_perfectRunOfWinsUnbeatenFor')
    expect(matchLogicLine(runsLine({ perfectRun: 12, unbeatenRun: 12 }, 38)!)?.key).toBe('perfect_perfectRunOfWins')
  })
})

describe('P6: a reload keeps the playback\'s place', () => {
  const key = playbackKey('game-1', 'january', 19)
  it('resumes the same playback at the game reached, paused as it was', () => {
    expect(resumePlayback({ key, revealed: 0, paused: true }, key, 19)).toEqual({ from: 0, paused: true })
    expect(resumePlayback({ key, revealed: 7.6, paused: false }, key, 19)).toEqual({ from: 7, paused: false })
    expect(resumePlayback({ key, revealed: -3, paused: true }, key, 19)).toEqual({ from: 0, paused: true })
  })
  it('keeps the old behaviour for no mark, another playback or a finished one', () => {
    expect(resumePlayback(null, key, 19)).toBeNull()
    expect(resumePlayback({ key: playbackKey('game-1', 'summary', 38), revealed: 3, paused: true }, key, 19)).toBeNull()
    expect(resumePlayback({ key: playbackKey('game-2', 'january', 19), revealed: 3, paused: true }, key, 19)).toBeNull()
    expect(resumePlayback({ key, revealed: 19, paused: false }, key, 19)).toBeNull()
  })
  it('reads what it wrote, and nothing from damage', () => {
    writePlaybackMark({ key, revealed: 4, paused: true })
    expect(readPlaybackMark()).toEqual({ key, revealed: 4, paused: true })
    for (const bad of ['', '{', 'null', '[]', '{"key":1,"revealed":2}', '{"key":"k","revealed":"2"}', '{"key":"k","revealed":null}']) expect(parsePlaybackMark(bad), bad).toBeNull()
    expect(parsePlaybackMark('{"key":"k","revealed":2,"paused":"yes"}')).toEqual({ key: 'k', revealed: 2, paused: false })
    localStorage.removeItem(PLAYBACK_RESUME_KEY)
    expect(readPlaybackMark()).toBeNull()
  })
})

describe('P7: a landed reel stays landed after a reload', () => {
  it('knows the last run that landed, and only that run', () => {
    const run = reelMark('game-1', 4, { clubId: 'arsenal', season: 2015 })
    expect(landedBefore(run, readLandedReel())).toBe(false)
    rememberLandedReel(run)
    expect(localStorage.getItem(REEL_LANDED_KEY)).toBe(run)
    expect(landedBefore(run, readLandedReel())).toBe(true)
    // The next spin, a re-spin onto the same club (a new spin count), another draft: each runs its reel
    expect(landedBefore(reelMark('game-1', 5, { clubId: 'arsenal', season: 2015 }), readLandedReel())).toBe(false)
    expect(landedBefore(reelMark('game-1', 4, { clubId: 'arsenal', season: 2016 }), readLandedReel())).toBe(false)
    expect(landedBefore(reelMark('h2h:seed', 4, { clubId: 'arsenal', season: 2015 }), readLandedReel())).toBe(false)
    expect(landedBefore('', '')).toBe(false)
  })
})

describe('P10: the small words', () => {
  it('says what calibrated means on the Weekly and a challenge, with no bare "difficulty"', () => {
    expect(ts('weeklyNotice', { week: 'W44', theme: 'x', formation: '4-3-3', article: 'the ', league: 'Premier League', season: '2024-25', difficulty: ts('diff_calibrated') })).not.toMatch(/difficulty/)
    expect(ts('challengeRules', { difficulty: ts('diff_calibrated'), extras: '', seed: 'S' })).toBe('Same seed, same wheel, its clubs calibrated so an average draft finishes mid-table. Seed S.')
    expect(ts('diff_realistic')).toBe('its clubs at their real strength')
  })

  it('names the arena colours as colours only', () => {
    expect(ta('coloursOnly')).toMatch(/colours only/)
    expect(ta('captainOption', { name: 'A', n: 80 })).toBe('A (mentality 80)')
  })

  it('a live table badge carries colours, not a two-letter cut of the code', () => {
    useStore.setState({ universe: u })
    const plain = renderToString(createElement(ClubBadge, { clubId: 'arsenal', size: 16 }))
    const blank = renderToString(createElement(ClubBadge, { clubId: 'arsenal', size: 16, blank: true }))
    expect(plain).toMatch(/>AR<\/span>/)
    expect(blank).toMatch(/><\/span>$/)
    expect(blank).toContain('title="Arsenal"')
  })

  it('files a shown badge when its result is left, but not for the Trophy Room or a StrictMode remount', async () => {
    const tick = () => new Promise<void>((r) => queueMicrotask(r))
    let filed = 0
    const left = makeLeaveFiler(() => filed++)
    left.mount()
    left.unmount()
    await tick()
    expect(filed).toBe(1)
    const strict = makeLeaveFiler(() => filed++)
    strict.mount()
    strict.unmount()
    strict.mount()
    await tick()
    expect(filed).toBe(1)
    const room = makeLeaveFiler(() => filed++)
    room.mount()
    room.toRoom()
    room.unmount()
    await tick()
    expect(filed).toBe(1)
  })

  it('keeps the Run-in setup\'s seed until a run starts', () => {
    let made = 0
    const fresh = () => `fresh-${++made}`
    expect(startingRunInSeed(null, fresh)).toBe('fresh-1')
    expect(startingRunInSeed('  ', fresh)).toBe('fresh-2')
    expect(startingRunInSeed('x'.repeat(65), fresh)).toBe('fresh-3')
    expect(startingRunInSeed('ABC123', fresh)).toBe('ABC123')
    keepRunInSeed('ABC123')
    expect(readRunInSeed()).toBe('ABC123')
    keepRunInSeed(null)
    expect(localStorage.getItem(RUN_IN_SEED_KEY)).toBeNull()
    keepRunInSeed('')
    expect(readRunInSeed()).toBeNull()
  })
})
