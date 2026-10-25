import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { advanceWindow, openWindow, type MarketContext } from '@engine/market'
import { newSquadPlayer } from '@engine/season'
import { tickWindow } from '../logic/marketOps'
import { seasonGame } from './seasonGame'

/**
 * The Recruitment batch adds a recruitment focus to the market, but a market with no focus set must list, price and
 * trickle exactly as before. The hashes were captured on origin/main at 3c577bc, before the batch, and every later
 * build must reproduce them (CLAUDE.md invariant 2: a change meant to move them needs an ENGINE_VERSION bump).
 */

const u = loadTestUniverse(['england'])
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** 200 seeded windows from the engine alone: opened, then three market days with a squad of our own on offer. */
function engineWindows(): string {
  const out: unknown[] = []
  const seasons = [2012, 2016, 2019, 2022, 2025]
  for (let i = 0; i < 200; i++) {
    const rng = new Rng(`market-pin-${i}`)
    const leagueSeason = seasons[i % seasons.length]
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason && !cs.classic)
    const own = clubs[i % clubs.length]
    const ownSquad = own.squad.slice(0, 18).map((p, k) => ({ p, s: newSquadPlayer(p.id, { morale: 40 + ((k * 7) % 50) }), listed: k % 5 === 0 }))
    const ctx: MarketContext = { u, rng, ownedPlayerIds: new Set(ownSquad.map((x) => x.p.playerId)), leagueSeason, priceLevel: 1.05, leagues: ['england'], fromSeason: i % 3 === 0 ? 2015 : undefined }
    const w = openWindow(ctx, i % 2 ? 'summer' : 'january', i % 4 === 0 ? 40 : 36)
    for (let d = 0; d < 3; d++) advanceWindow(ctx, w, ownSquad, clubs.map((c) => c.clubId).filter((id) => id !== own.clubId))
    out.push([w.listings, w.offers, rng.getState()])
  }
  return hash(out)
}

/** January windows of auto-managed Seasons, ticked by the game with a chief scout in post. */
function gameWindows(): string {
  const out: unknown[] = []
  for (const seed of ['market-pin-game-1', 'market-pin-game-2']) {
    const g = seasonGame(u, seed, 19)
    expect(g.window?.kind).toBe('january')
    g.staff = { scout: 2 }
    const rng = Rng.fromState(g.rngState)
    for (let d = 0; d < 5; d++) tickWindow(g, u, rng)
    out.push([g.window!.listings, g.window!.offers, rng.getState()])
  }
  return hash(out)
}

const ENGINE_BASELINE = '738c872e6bcc42f88fd9024547dcd47d0d4a3f8427b1c57b2b032e4841f26750'
const GAME_BASELINE = 'c5a423bcf32fc22a6a8a40f5a2a0d27a6dba0a05a28c37526fcaaaa99661a0e3'

describe('a market with no recruitment focus is unchanged', () => {
  it('opens and ticks 200 seeded windows exactly as before', () => {
    expect(engineWindows()).toBe(ENGINE_BASELINE)
  }, 120_000)

  it('ticks the game January window with a scout exactly as before', () => {
    expect(gameWindows()).toBe(GAME_BASELINE)
  }, 180_000)
})
