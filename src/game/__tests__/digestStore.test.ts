import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { newsTotal, unseenNews } from '../logic/news'
import type { Game, GameSettings } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()

function seasonGame(partial: Partial<GameSettings> = {}): Game {
  const g = createGame({
    mode: 'season',
    seed: 'digest-store',
    formationId: '4-3-3',
    teamName: 'Store XI',
    shortName: 'STO',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

function load(game: Game) {
  useStore.setState({ universe: u, loadedLeagues: ['england'], game, digest: null, toast: null, screen: 'game' })
}

describe('while you were away, through the store', () => {
  it('Sim 5 opens a digest of the run, the Inbox marks it read once, and the digest closes', () => {
    load(seasonGame())
    useStore.getState().simWeeks(5)
    const s = useStore.getState()
    expect(s.toast).toBeNull()
    expect(s.matchView).toBe('report')
    expect(s.game!.season!.matchweek).toBe(5)
    expect(s.digest).not.toBeNull()
    expect(s.digest!.fromMatchweek).toBe(0)
    expect(s.digest!.toMatchweek).toBe(5)
    expect(s.digest!.results.filter((r) => r.comp === 'league').length).toBe(5)
    expect(unseenNews(s.game!)).toBe(newsTotal(s.game!))
    // Opening the Inbox reads everything; a second visit to a read inbox leaves the save untouched
    s.markNewsSeen()
    const read = useStore.getState().game!
    expect(read.newsSeen).toBe(newsTotal(read))
    expect(unseenNews(read)).toBe(0)
    useStore.getState().markNewsSeen()
    expect(useStore.getState().game).toBe(read)
    useStore.getState().dismissDigest()
    expect(useStore.getState().digest).toBeNull()
  })

  it('a save without newsSeen counts as read, and opening its Inbox writes the field', () => {
    const g = seasonGame()
    delete g.newsSeen
    delete g.newsTotal
    load(g)
    expect(unseenNews(useStore.getState().game!)).toBe(0)
    useStore.getState().markNewsSeen()
    const after = useStore.getState().game!
    expect(after.newsSeen).toBe(after.season!.news.length)
    useStore.getState().simWeeks(1)
    const s = useStore.getState()
    expect(s.digest!.news.length).toBe(unseenNews(s.game!))
    expect(s.digest!.news.length).toBeGreaterThan(0)
  })

  it('Sim to end goes to the summary with no digest over it', () => {
    load(seasonGame())
    useStore.getState().simWeeks(2)
    expect(useStore.getState().digest).not.toBeNull()
    useStore.getState().dismissDigest()
    useStore.getState().simToEnd()
    const s = useStore.getState()
    expect(s.game!.phase).toBe('summary')
    expect(s.digest).toBeNull()
  })

  it('a run that ends in the sack goes to the summary with no digest', () => {
    load(seasonGame({ jobSecurity: true }))
    useStore.getState().simWeeks(10)
    useStore.setState({ digest: null, game: { ...useStore.getState().game!, season: { ...useStore.getState().game!.season!, confidence: 0 } } })
    useStore.getState().simWeeks(5)
    const s = useStore.getState()
    expect(s.game!.season!.sacked).toBe(true)
    expect(s.game!.phase).toBe('summary')
    expect(s.digest).toBeNull()
  })

  it('a digest never outlives its game: starting another game clears it', () => {
    load(seasonGame())
    useStore.getState().simWeeks(1)
    expect(useStore.getState().digest).not.toBeNull()
    useStore.getState().startGame(seasonGame({ seed: 'another' }).settings)
    expect(useStore.getState().digest).toBeNull()
    useStore.setState({ universe: null, loadedLeagues: [], game: null, parked: {}, toast: null, screen: 'home' })
  })
})
