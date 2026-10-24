import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { bidFor, loanFor, enquireFor, advanceDay, acceptOffer } from '../logic/marketOps'
import { talkTo } from '../logic/talks'
import { advanceToNextSeason } from '../logic/dynasty'
import { enquire, exchangeCredit, loanable, openWindow } from '@engine/market'
import { newSquadPlayer } from '@engine/season'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'market-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function gameAtWindow(u: ReturnType<typeof loadTestUniverse>, seed = 'market-test'): Game {
  const g = createGame(settings({ seed }))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  while (g.season!.matchweek < 19) playMatchweek(g, u, true)
  expect(g.window?.kind).toBe('january')
  return g
}

describe('transfer market depth', () => {
  const u = loadTestUniverse()

  it('lists loanable fringe players and signs one on loan until the summer', () => {
    const g = gameAtWindow(u)
    g.finances.budget = 200
    g.finances.wageCap = 99999
    const loan = g.window!.listings.find((l) => l.loanFee !== undefined && l.status === 'available')!
    expect(loan).toBeTruthy()
    expect(loanable(u.index[loan.playerSeasonId])).toBe(true)
    const before = Object.keys(g.squad).length
    const out = loanFor(g, u, loan.playerSeasonId)
    expect(out.accepted).toBe(true)
    expect(Object.keys(g.squad).length).toBe(before + 1)
    expect(g.contracts[loan.playerSeasonId]).toEqual({ years: 1, loan: true })
    expect(g.finances.budget).toBeCloseTo(200 - loan.loanFee!, 1)
    // He goes home in the summer
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const report = advanceToNextSeason(g, u)
    expect(report.returned).toContain(u.index[loan.playerSeasonId].name)
    expect(Object.keys(g.squad).some((id) => id.startsWith(loan.playerSeasonId.split('@')[0] + '@'))).toBe(false)
  })

  it('takes a player in part-exchange and credits his value', () => {
    const g = gameAtWindow(u, 'market-swap')
    g.finances.budget = 500
    g.finances.wageCap = 99999
    const rng = new Rng('x')
    const ctx = { u, rng, ownedPlayerIds: new Set<string>(), leagueSeason: 2025, priceLevel: 1 }
    const target = g.window!.listings.find((l) => l.status === 'available')!
    const targetP = u.index[target.playerSeasonId]
    // Our best outfielder near his level is acceptable; a kid 20 points worse is not
    const squad = Object.keys(g.squad).map((id) => ({ p: u.index[id], s: g.squad[id] })).filter((x) => x.p)
    const good = squad.filter((x) => x.p.overall >= targetP.overall - 8 && x.p.age < 31).sort((a, b) => b.p.overall - a.p.overall)[0]
    if (good) {
      const credit = exchangeCredit(ctx, targetP, good)
      expect(credit.credit).toBeGreaterThan(0)
      expect(credit.credit).toBeLessThan(good.p.value * 1.5)
      const before = Object.keys(g.squad).length
      const out = bidFor(g, u, target.playerSeasonId, Math.max(0.1, target.asking - credit.credit), { exchangeId: good.p.id, years: 4 })
      expect(out.accepted).toBe(true)
      expect(g.squad[good.p.id]).toBeUndefined()
      expect(g.squad[target.playerSeasonId]).toBeTruthy()
      expect(Object.keys(g.squad).length).toBe(before)
      expect(g.contracts[target.playerSeasonId].years).toBe(targetP.age >= 33 ? 2 : 4)
    }
    const weak = { p: { ...targetP, overall: targetP.overall - 20, age: 20 }, s: newSquadPlayer('x') }
    expect(exchangeCredit(ctx, targetP, weak).credit).toBe(0)
  })

  it('lets you approach any player and quotes a premium over his value', () => {
    const g = gameAtWindow(u, 'market-enquire')
    g.finances.budget = 999
    g.finances.wageCap = 99999
    const owned = new Set(Object.keys(g.squad).map((id) => u.index[id]?.playerId))
    const onMarket = new Set(g.window!.listings.map((l) => u.index[l.playerSeasonId]?.playerId))
    // A squad player from a mid-table club of a different era: never refused, so the quote is deterministic
    const cs = u.clubSeasonByKey['everton@2015']!
    const squadSorted = [...cs.squad].sort((a, b) => b.overall - a.overall)
    const fringe = squadSorted.slice(8).find((p) => !owned.has(p.playerId) && !onMarket.has(p.playerId) && p.overall < 86)!
    const out = enquireFor(g, u, fringe.id)
    expect(out.ok).toBe(true)
    const listing = g.window!.listings.find((l) => l.playerSeasonId === fringe.id)!
    expect(listing.source).toBe('enquiry')
    expect(listing.asking).toBeGreaterThan(fringe.value)
    expect(listing.tags).toContain('Unsolicited approach')
    // Asking again just points at the listing
    expect(enquireFor(g, u, fringe.id).message).toMatch(/already on the market/)
    // And we can buy him at the quoted price
    const before = Object.keys(g.squad).length
    const bid = bidFor(g, u, fringe.id, listing.asking)
    expect(bid.accepted).toBe(true)
    expect(Object.keys(g.squad).length).toBe(before + 1)
    // Stars get refused sometimes: over many seeds at least one refusal and one quote
    const star = [...u.clubSeasonByKey['manchester-city@2018']!.squad].sort((a, b) => b.overall - a.overall)[0]
    let refused = 0
    let quoted = 0
    for (let i = 0; i < 40; i++) {
      const w = openWindow({ u, rng: new Rng(`w${i}`), ownedPlayerIds: new Set(), leagueSeason: 2025, priceLevel: 1 }, 'january', 2)
      const r = enquire({ u, rng: new Rng(`e${i}`), ownedPlayerIds: new Set(), leagueSeason: 2025, priceLevel: 1 }, w, star)
      if (r.listing) quoted++
      else refused++
    }
    expect(refused).toBeGreaterThan(0)
    expect(quoted).toBeGreaterThan(0)
  })

  it('moves players AI clubs sign into their squads so the league changes', () => {
    const g = gameAtWindow(u, 'market-ai')
    const sizes = Object.fromEntries(Object.values(g.season!.ai).map((c) => [c.id, c.squad.length]))
    // Give every listing suitors so somebody moves this window
    for (const l of g.window!.listings) l.suitors = 3
    let moved = 0
    for (let i = 0; i < 6 && g.window; i++) {
      advanceDay(g, u)
    }
    for (const c of Object.values(g.season!.ai)) moved += c.squad.length - sizes[c.id]
    expect(moved).toBeGreaterThan(0)
    for (const c of Object.values(g.season!.ai)) for (const id of c.squad) expect(u.index[id]).toBeTruthy()
    // Selling one of ours to a rival puts him in their squad too
    const g2 = gameAtWindow(u, 'market-sell')
    const ours = Object.keys(g2.squad)[0]
    const club = Object.keys(g2.season!.ai)[0]
    g2.window!.offers.push({ playerSeasonId: ours, fromClubId: club, amount: 5, day: 1, status: 'open' })
    const idx = g2.window!.offers.length - 1
    const budget = g2.finances.budget
    acceptOffer(g2, u, idx)
    expect(g2.squad[ours]).toBeUndefined()
    expect(g2.season!.ai[club].squad).toContain(ours)
    expect(g2.finances.budget).toBeCloseTo(budget + 5, 0)
  })

  it('player conversations move morale once a week and promises are tracked', () => {
    const g = createGame(settings({ mode: 'season' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    const id = Object.values(g.lineup)[0]
    const s = g.squad[id]
    s.recentRatings = [7.8, 7.9, 8.1]
    s.morale = 60
    expect(talkTo(g, u, id, 'praise').message).toMatch(/appreciates/)
    expect(s.morale).toBeGreaterThan(60)
    expect(talkTo(g, u, id, 'criticise').message).toMatch(/already spoken/)
    const benchId = g.bench[0]
    g.squad[benchId].morale = 40
    expect(talkTo(g, u, benchId, 'reassure').message).toMatch(/chance will come/)
    expect(g.squad[benchId].morale).toBe(47)
    const other = g.bench[1]
    const m0 = g.squad[other].morale
    talkTo(g, u, other, 'promise')
    expect(g.promisedStart).toBe(other)
    expect(g.squad[other].morale).toBe(Math.min(100, m0 + 6))
    expect(talkTo(g, u, g.bench[2], 'promise').message).toMatch(/already promised/)
    // Criticising a player in poor form who is a professional sharpens him up
    const poor = g.bench[3]
    g.squad[poor].recentRatings = [6.0, 6.2]
    const sharp = g.squad[poor].sharpness
    const msg = talkTo(g, u, poor, 'criticise').message
    if (msg.includes('chin')) expect(g.squad[poor].sharpness).toBe(Math.min(100, sharp + 6))
  })
})
