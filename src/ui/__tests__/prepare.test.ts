import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { beginMatch } from '@engine/match'
import { feedFromLive } from '@engine/matchFeed'
import { createGame, beginSeason } from '@game/logic/setup'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { matchPath } from '../match/epochs'
import { sampledMinutes, samplePlayers, samplePlayersIn } from '../match/heat'
import { liveFeed, liveFeedKey, pathOf, prepareMatchDay, samplesOf, SAMPLE_SLICE } from '../match/prepare'
import { changedLive, sides, u } from './feeds'

const now = async () => {}

function gameWith(mp: ReturnType<typeof beginMatch>, i: number): Game {
  return { live: { kind: 'league', mp, ctx: { competition: 'league', matchweek: 3 + i }, userIsHome: true, opponentId: `club-${i}` } } as unknown as Game
}

describe("the match day's first build ahead of its render (prepare.ts)", () => {
  it('builds exactly the feed, ball path and samples the dashboard would, and hands them back without building again', async () => {
    for (let i = 0; i < 6; i++) {
      // A first half held at its stop, and a match with changes in play held to the whistle
      for (const mp of [beginMatch({ rng: new Rng(`prep-${i}`), ...sides(i), detail: 'full' }), changedLive(i).mp]) {
        const g = gameWith(mp, i)
        const key = liveFeedKey(g.live!)
        const slices: number[] = []
        await prepareMatchDay(g, async () => void slices.push(1))
        const feed = liveFeed(mp, key)
        expect(feed).toEqual(feedFromLive(mp, key))
        const mpath = pathOf(feed)
        expect(pathOf(feed)).toBe(mpath)
        expect(mpath).toEqual(matchPath(feedFromLive(mp, key)))
        const samples = samplesOf(mpath, feed.lastMinute)
        expect(samplesOf(mpath, feed.lastMinute)).toBe(samples)
        expect(samples).toEqual(samplePlayers(matchPath(feedFromLive(mp, key)), feed.lastMinute))
        // One task per slice of minutes
        expect(slices.length).toBe(Math.ceil(sampledMinutes(mpath, feed.lastMinute) / SAMPLE_SLICE))
        expect(slices.length).toBeGreaterThan(1)
      }
    }
  })

  it('samples any split of the minutes into the same list as the whole', () => {
    const { feed } = changedLive(2)
    const mpath = matchPath(feed)
    const whole = samplePlayers(mpath, feed.lastMinute)
    const last = sampledMinutes(mpath, feed.lastMinute)
    for (const cut of [1, 7, 25, 45, 60]) {
      const parts = []
      for (let from = 1; from <= last; from += cut) parts.push(...samplePlayersIn(mpath, feed.lastMinute, from, from + cut - 1))
      expect(parts).toEqual(whole)
    }
    expect(samplePlayersIn(mpath, 30, 1, 99)).toEqual(samplePlayers(mpath, 30))
  })

  it('a game without a live match has nothing to build', async () => {
    let steps = 0
    await prepareMatchDay({ live: null } as unknown as Game, async () => void steps++)
    expect(steps).toBe(0)
    await now()
  })

  it('Play matchweek with the screen preparing the match day plays the same weeks as without', async () => {
    const start = (() => {
      const g = createGame({ mode: 'season', seed: 'prep-season', formationId: '4-3-3', teamName: 'Prep XI', shortName: 'PRE', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      return g
    })()
    const run = async (prepare?: (g: Game) => Promise<void>): Promise<string[]> => {
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false, liveAuto: false })
      const out: string[] = []
      for (let w = 0; w < 4; w++) {
        const ev = useStore.getState().game!.pendingEvent
        if (ev) useStore.getState().resolveEvent(ev.choices[0].id)
        useStore.getState().setMatchPlay('watch')
        await useStore.getState().playWeekSoon(prepare)
        if (useStore.getState().game!.live) useStore.getState().finishLiveNow()
        if (useStore.getState().game!.phase === 'match') useStore.getState().closeMatch()
        out.push(JSON.stringify(useStore.getState().game))
      }
      return out
    }
    const seen: Game[] = []
    const plain = await run()
    const prepared = await run(async (g) => {
      seen.push(g)
      await prepareMatchDay(g, now)
    })
    expect(prepared).toEqual(plain)
    expect(seen.length).toBe(4)
    expect(seen.every((g) => !!g.live)).toBe(true)
    // A prepare that fails changes nothing either
    const failed = await run(async () => {
      throw new Error('no')
    })
    expect(failed).toEqual(plain)
  }, 300_000)
})
