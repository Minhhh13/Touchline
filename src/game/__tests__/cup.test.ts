import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { advanceArenaMatch, arenaBanner, arenaContinueLabel, arenaNeedsAllLeagues, arenaShareInput, arenaStepInfo, arenaTier, beginArena, closeArenaMatch, CUP_SQUAD, cupGameSettings, cupWinnerName, fieldLeagues, finishArena, gauntletGameSettings, nextArenaOpponent, playArenaStep, resolveArenaStep, simArenaToEnd, stepWon, takePenalties, type ArenaChoices } from '../logic/arena'
import { arenaFormatLabel, finishDraftLabel } from '../logic/modes'
import { playerLookup } from '../logic/players'
import { autoDraft } from '@engine/draft'
import { advanceMatch, finishMatch } from '@engine/match'
import { USER_TEAM } from '@engine/season'
import { arenaShareText } from '@engine/awards'
import { arenaPool, clubIdOfKey, giantsOf, teamStrengthOf, type ArenaField } from '@engine/knockout'
import { CUP_FIELD_TARGET, CUP_SIZES, cupField, cupImportance, cupRoundCount, cupRoundName, cupSeeds, DECADE_STRENGTH, drawFirstRound, europeStandings, roundTies, type CupSize } from '@engine/cup'
import { Rng } from '@engine/rng'
import type { Game } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse(['england'])
const keyOf = (cs: { clubId: string; season: number }) => `${cs.clubId}@${cs.season}`
const BIG: CupSize[] = [8, 16, 32]

function choices(seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices {
  return { teamName: 'Cup XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, size: 16, ...partial }
}

/** A drafted Cup on its hub, the assistant having drafted all sixteen. */
function cupGame(seed: string, partial: Partial<ArenaChoices> = {}, universe = u): Game {
  const g = createGame(cupGameSettings(universe, choices(seed, partial), 'CXI'))
  const rng = Rng.fromState(g.rngState)
  autoDraft(universe, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, universe)
  return g
}

/** The assistant plays the Cup to the end. */
function played(seed: string, partial: Partial<ArenaChoices> = {}, universe = u): Game {
  const g = cupGame(seed, partial, universe)
  simArenaToEnd(g, universe)
  return g
}

// The run's own state survives a save; a match result can hold a -0 the JSON turns into 0, so the arena is what is compared
const roundTrip = (g: Game) => expect(JSON.parse(JSON.stringify(g.arena))).toEqual(g.arena)
const entrants = (g: Game) => g.arena!.bracket!.rounds[0].flatMap((t) => [t.home, t.away]).filter((k) => k !== USER_TEAM)

describe('the Cup: field and draw', () => {
  it('draws size − 1 distinct club-seasons from the field’s leagues and era, the wheel one season per club', () => {
    const eras: Array<{ fromSeason?: number; toSeason?: number }> = [{}, { fromSeason: 2014, toSeason: 2019 }, { fromSeason: 2020 }]
    const fields: ArenaField[] = ['wheel', 'champions', 'giants', 'decade']
    for (const size of BIG) {
      for (const field of fields) {
        for (const era of eras) {
          for (let i = 0; i < 6; i++) {
            const scope = { leagues: ['england'], ...era, field, decade: 2010 }
            const xs = cupField(u, new Rng(`field-${size}-${field}-${i}`), scope, size - 1)
            const keys = xs.map(keyOf)
            expect(keys).toHaveLength(size - 1)
            expect(new Set(keys).size).toBe(size - 1)
            for (const cs of xs) {
              expect(cs.leagueId).toBe('england')
              if (field === 'decade') {
                expect(cs.season).toBeGreaterThanOrEqual(2010)
                expect(cs.season).toBeLessThanOrEqual(2019)
              } else {
                expect(cs.season).toBeGreaterThanOrEqual(era.fromSeason ?? -Infinity)
                expect(cs.season).toBeLessThanOrEqual(era.toSeason ?? Infinity)
              }
            }
            // Every era of the England wheel has more clubs than a 32-club cup needs only over all eras
            if (field === 'wheel' && !era.fromSeason) expect(new Set(xs.map((cs) => cs.clubId)).size).toBe(size - 1)
          }
        }
      }
    }
  }, 60_000)

  it('takes each field from its own slice: champions are champions, giants the strongest 5%, the decade 78 or more', () => {
    const pool = arenaPool(u, { leagues: ['england'] })
    const giants = new Set(giantsOf(u, pool).map(keyOf))
    for (let i = 0; i < 20; i++) {
      // England's 18 champions and 19 giants cover a cup of 16; the decade's 104 sides of 78+ cover 32
      for (const cs of cupField(u, new Rng(`slice-${i}`), { leagues: ['england'], field: 'champions' }, 15)) expect(cs.champions).toBe(true)
      for (const cs of cupField(u, new Rng(`slice-${i}`), { leagues: ['england'], field: 'giants' }, 15)) expect(giants.has(keyOf(cs))).toBe(true)
      for (const cs of cupField(u, new Rng(`slice-${i}`), { leagues: ['england'], field: 'decade', decade: 2010 }, 31)) expect(teamStrengthOf(u, cs)).toBeGreaterThanOrEqual(DECADE_STRENGTH)
    }
    // Too few champions for 32: the strongest of the pool fill the rest
    const filled = cupField(u, new Rng('fill'), { leagues: ['england'], field: 'champions' }, 31)
    expect(filled.filter((cs) => cs.champions)).toHaveLength(pool.filter((cs) => cs.champions).length)
    expect(new Set(filled.map(keyOf)).size).toBe(31)
  })

  it('keeps the seeds apart in round one and draws you against one a third of the time at 16 (200 seeds)', () => {
    const pool = arenaPool(u, { leagues: ['england'] })
    let metSeed = 0
    for (let i = 0; i < 200; i++) {
      for (const size of BIG) {
        const xs = cupField(u, new Rng(`draw-${i}#field`), { leagues: ['england'], field: 'wheel' }, size - 1)
        const seeds = cupSeeds(u, xs, size)
        expect(seeds).toHaveLength(size / 4)
        const strongest = [...xs].sort((a, b) => teamStrengthOf(u, b) - teamStrengthOf(u, a))[size / 4 - 1]
        for (const k of seeds) expect(teamStrengthOf(u, u.clubSeasonByKey[k])).toBeGreaterThanOrEqual(teamStrengthOf(u, strongest))
        const unseeded = [USER_TEAM, ...xs.map(keyOf).filter((k) => !seeds.includes(k))]
        const ties = drawFirstRound(new Rng(`draw-${i}#draw`), seeds, unseeded)
        expect(ties).toHaveLength(size / 2)
        const sides = ties.flatMap((t) => [t.home, t.away])
        expect(new Set(sides).size).toBe(size)
        for (const t of ties) expect(seeds.includes(t.home) && seeds.includes(t.away)).toBe(false)
        if (size === 16) {
          const mine = ties.find((t) => t.home === USER_TEAM || t.away === USER_TEAM)!
          if (seeds.includes(mine.home) || seeds.includes(mine.away)) metSeed++
        }
      }
    }
    expect(pool.length).toBeGreaterThan(31)
    // 4 seeds among 12 unseeded: one in three
    expect(metSeed / 200).toBeGreaterThan(0.22)
    expect(metSeed / 200).toBeLessThan(0.45)
  }, 30_000)

  it('gives two players on one seed the same field, the same round-one draw and the same AI results, whatever they drafted', () => {
    for (let i = 0; i < 6; i++) {
      const a = cupGame(`same-${i}`, { formationId: '4-3-3' })
      const b = cupGame(`same-${i}`, { formationId: '3-5-2', twists: false })
      expect(Object.keys(b.squad).sort()).not.toEqual(Object.keys(a.squad).sort())
      expect(b.arena!.bracket).toEqual(a.arena!.bracket)
      expect(b.arena!.next).toBe(a.arena!.next)
      playArenaStep(a, u, false)
      playArenaStep(b, u, false)
      const aiTies = (g: Game) => g.arena!.bracket!.rounds[0].filter((t) => t.home !== USER_TEAM && t.away !== USER_TEAM)
      expect(aiTies(a).every((t) => t.winner)).toBe(true)
      expect(aiTies(b)).toEqual(aiTies(a))
    }
  }, 30_000)

  it('names, weighs and places every round', () => {
    expect(BIG.map((s) => Array.from({ length: cupRoundCount(s) }, (_, r) => cupRoundName(s, r).code).join(' '))).toEqual(['QF SF F', 'R16 QF SF F', 'R32 R16 QF SF F'])
    expect(Array.from({ length: 5 }, (_, r) => cupImportance(32, r))).toEqual([1.1, 1.1, 1.15, 1.25, 1.4])
    expect(Array.from({ length: 3 }, (_, r) => cupImportance(8, r))).toEqual([1.1, 1.25, 1.4])
    expect(CUP_SIZES).toEqual([2, 8, 16, 32])
    expect(finishDraftLabel(createGame(cupGameSettings(u, choices('label'), 'CXI')))).toBe('On to the draw')
    expect(finishDraftLabel(createGame(cupGameSettings(u, choices('label', { size: 2 }), 'CXI')))).toBe('On to the final')
    const g = cupGame('venue')
    const info = arenaStepInfo(g.arena!)
    const mine = g.arena!.bracket!.rounds[0].find((t) => t.home === USER_TEAM || t.away === USER_TEAM)!
    expect(info).toMatchObject({ label: 'Round of 16', code: 'R16', importance: 1.1, neutral: false, home: mine.home === USER_TEAM })
    expect(arenaFormatLabel(g.settings.arena)).toBe('The Cup · 16 clubs')
    expect(Object.keys(g.squad)).toHaveLength(CUP_SQUAD)
    expect(nextArenaOpponent(g, u)!.offset).toBe(g.arena!.bracket!.offset)
  })
})

describe('the Cup: the run', () => {
  it('ends with one winner and every tie decided, the user’s log as long as the rounds he played, at every size and field', () => {
    const fields: ArenaField[] = ['wheel', 'champions', 'giants', 'decade']
    for (const size of BIG) {
      for (const field of fields) {
        for (let i = 0; i < 4; i++) {
          const g = played(`run-${size}-${field}-${i}`, { size, field })
          const a = g.arena!
          const b = a.bracket!
          expect(g.phase).toBe('summary')
          expect(b.rounds).toHaveLength(cupRoundCount(size))
          b.rounds.forEach((ties, r) => {
            expect(ties).toHaveLength(roundTies(size, r))
            for (const t of ties) {
              expect([t.home, t.away]).toContain(t.winner)
              expect(t.hg).toBeTypeOf('number')
              if (t.hg === t.ag) expect(t.pens!.home).not.toBe(t.pens!.away)
            }
            if (r > 0) expect(new Set(ties.flatMap((t) => [t.home, t.away]))).toEqual(new Set(b.rounds[r - 1].map((t) => t.winner)))
          })
          expect(b.winner).toBe(b.rounds[b.rounds.length - 1][0].winner)
          const userRounds = b.rounds.filter((ties) => ties.some((t) => t.home === USER_TEAM || t.away === USER_TEAM)).length
          expect(a.log).toHaveLength(userRounds)
          expect(a.won).toBe(b.winner === USER_TEAM)
          expect(a.log.filter(stepWon)).toHaveLength(a.won ? a.log.length : a.log.length - 1)
          // Only the clubs still alive keep a stored state; nobody waits to play
          for (const k of Object.keys(b.states)) expect(k).toBe(b.winner)
          expect(Object.keys(a.clubs)).toHaveLength(0)
          roundTrip(g)
        }
      }
    }
  }, 120_000)

  it('files the tier by the round it ended in and names the winner when it was not you', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 80; i++) {
      const g = played(`tier-${i}`, { size: 32 })
      const a = g.arena!
      const tier = arenaTier(a)
      seen.add(tier)
      const expected = a.won ? 'CUP WINNERS' : ['OUT IN THE FIRST ROUND', 'OUT IN THE ROUND OF 16', 'QUARTER-FINALISTS', 'SEMI-FINALISTS', 'FINALISTS'][a.log.length - 1]
      expect(tier).toBe(expected)
      expect(arenaBanner(a)).toBe(expected)
      const name = cupWinnerName(g, u)!
      if (a.won) expect(name).toBe('Cup XI')
      else expect(name).toMatch(/ \d{4}-\d{2}$/)
    }
    expect(seen.has('OUT IN THE FIRST ROUND')).toBe(true)
    expect(seen.has('CUP WINNERS')).toBe(true)
    expect(arenaTier({ format: 'cup', size: 16, won: false, log: [{} as never] })).toBe('OUT IN THE ROUND OF 16')
    expect(arenaTier({ format: 'cup', size: 8, won: false, log: [{} as never] })).toBe('QUARTER-FINALISTS')
  }, 60_000)

  it('plays the rest of the bracket after you go out, to a winner', () => {
    for (let i = 0; i < 60; i++) {
      const g = cupGame(`out-${i}`, { size: 32, field: 'giants', difficulty: 'realistic' })
      playArenaStep(g, u, false)
      const a = g.arena!
      if (!a.over) continue
      expect(a.won).toBe(false)
      expect(a.log).toHaveLength(1)
      expect(a.bracket!.rounds).toHaveLength(5)
      expect(a.bracket!.winner).toBeDefined()
      expect(a.bracket!.winner).not.toBe(USER_TEAM)
      closeArenaMatch(g)
      expect(g.phase).toBe('summary')
      return
    }
    throw new Error('never out in round one in 60 seeds')
  })

  it('makes a red card and a second booking of the run each a one-tie ban, served at the next tie', () => {
    for (let i = 0; i < 60; i++) {
      const g = cupGame(`cards-${i}`)
      playArenaStep(g, u, true)
      const live = g.live!
      const club = g.arena!.clubs[live.opponentId]
      const ours = { getPlayer: playerLookup(g, u), getState: (id: string) => g.squad[id] }
      const theirs = { getPlayer: (id: string) => u.index[id], getState: (id: string) => club.state[id] }
      const lookups = live.userIsHome ? { home: ours, away: theirs } : { home: theirs, away: ours }
      advanceMatch(live.mp, lookups, undefined, 70)
      const res = finishMatch(live.mp, lookups)
      const gf = live.userIsHome ? res.homeGoals : res.awayGoals
      const ga = live.userIsHome ? res.awayGoals : res.homeGoals
      if (gf <= ga) continue
      g.live = null
      const stats = (live.userIsHome ? res.homeStats : res.awayStats).filter((s) => !s.yellow && !s.red && u.index[s.playerSeasonId]?.positions[0] !== 'GK')
      const [booked, sentOff] = stats
      booked.yellow = true
      sentOff.red = true
      g.arena!.yellows[booked.playerSeasonId] = 1
      resolveArenaStep(g, u, res, live.mp, live.ctx, new Set(Object.values(g.lineup)), false)
      expect(g.arena!.over).toBe(false)
      expect(g.arena!.step).toBe(1)
      expect(g.squad[booked.playerSeasonId].suspension).toBe(1)
      expect(g.squad[sentOff.playerSeasonId].suspension).toBe(1)
      expect(arenaContinueLabel(g)).toBe('Next: Quarter-final →')
      closeArenaMatch(g)
      expect(g.phase).toBe('week')
      playArenaStep(g, u, false)
      const playedIds = new Set([...g.lastMatch!.homeStats, ...g.lastMatch!.awayStats].map((s) => s.playerSeasonId))
      expect(playedIds.has(booked.playerSeasonId)).toBe(false)
      expect(playedIds.has(sentOff.playerSeasonId)).toBe(false)
      expect(g.squad[booked.playerSeasonId].suspension).toBe(0)
      expect(g.squad[sentOff.playerSeasonId].suspension).toBe(0)
      return
    }
    throw new Error('no round-one win in 60 seeds')
  })

  it('tires an ever-present starter: worse condition before the semi-final than before the quarter-final', () => {
    let checked = 0
    for (let i = 0; i < 120 && checked < 5; i++) {
      const g = cupGame(`legs-${i}`)
      const xi = new Set(Object.values(g.lineup).filter((id) => u.index[id]?.positions[0] !== 'GK'))
      const before: Record<number, Record<string, number>> = {}
      while (!g.arena!.over) {
        const step = g.arena!.step
        before[step] = Object.fromEntries([...xi].map((id) => [id, g.squad[id].condition]))
        if (step === 2) break
        for (const id of [...xi]) if (!Object.values(g.lineup).includes(id)) xi.delete(id)
        playArenaStep(g, u, true)
        for (const id of [...xi]) if (!g.live!.mp[g.live!.userIsHome ? 'hLive' : 'aLive'].some((p) => p.psId === id && p.onAt === 0)) xi.delete(id)
        advanceArenaMatch(g, u)
        advanceArenaMatch(g, u)
        const p = g.arena!.pending?.shootout
        if (p) takePenalties(g, u, p.defaultOrder, p.keepers[0])
        const stats = g.lastMatch![g.arena!.log[g.arena!.log.length - 1].home ? 'homeStats' : 'awayStats']
        for (const id of [...xi]) if ((stats.find((s) => s.playerSeasonId === id)?.minutes ?? 0) < 90) xi.delete(id)
        closeArenaMatch(g)
      }
      if (g.arena!.step < 2 || !before[2] || !xi.size) continue
      const mean = (s: number) => [...xi].reduce((t, id) => t + before[s][id], 0) / xi.size
      expect(mean(2)).toBeLessThan(mean(1))
      checked++
    }
    expect(checked).toBe(5)
  }, 60_000)

  it('takes a level live tie to the manager’s penalties and writes the shoot-out into the bracket', () => {
    for (let i = 0; i < 300; i++) {
      const g = cupGame(`pens-${i}`, { size: 8 })
      playArenaStep(g, u, true)
      advanceArenaMatch(g, u)
      advanceArenaMatch(g, u)
      const p = g.arena!.pending?.shootout
      if (!p) continue
      roundTrip(g)
      expect(arenaContinueLabel(g)).toBe('Penalties first')
      const order = [...p.defaultOrder].reverse()
      expect(takePenalties(g, u, order, p.keepers[0]).ok).toBe(true)
      const row = g.arena!.log[0]
      expect(row.pens!.kicks.filter((k) => k.us).map((k) => k.takerId)).toEqual(order.slice(0, row.pens!.kicks.filter((k) => k.us).length))
      const tie = g.arena!.bracket!.rounds[0].find((t) => t.home === USER_TEAM || t.away === USER_TEAM)!
      const home = tie.home === USER_TEAM
      expect(tie.pens).toEqual(home ? { home: row.pens!.us, away: row.pens!.them } : { home: row.pens!.them, away: row.pens!.us })
      expect(tie.winner).toBe(stepWon(row) ? USER_TEAM : row.opponent)
      expect(g.arena!.handManaged).toBe(true)
      return
    }
    throw new Error('no level live tie in 300 seeds')
  }, 60_000)

  it('replays a run exactly on one seed, and a run saved and reloaded between ties plays on as if it never closed', () => {
    const a = played('replay')
    const again = played('replay')
    expect(again.arena).toEqual(a.arena)
    expect(again.squad).toEqual(a.squad)
    expect(again.rngState).toEqual(a.rngState)
    const g = cupGame('replay')
    while (g.phase !== 'summary') {
      const saved = normaliseGame(JSON.parse(JSON.stringify(g)) as Game)!
      expect(saved).toEqual(g)
      playArenaStep(g, u, false)
      closeArenaMatch(g)
    }
    expect(g.arena).toEqual(a.arena)
  }, 30_000)

  it('keeps a 32-club Cup’s save small: AI states only for clubs alive and only where they changed', () => {
    const g = cupGame('small', { size: 32 })
    playArenaStep(g, u, false)
    const b = g.arena!.bracket!
    if (!g.arena!.over) {
      const alive = new Set(b.rounds[1].flatMap((t) => [t.home, t.away]))
      for (const k of Object.keys(b.states)) expect(alive.has(k)).toBe(true)
      expect(Object.keys(b.states).length).toBeLessThanOrEqual(15)
    }
    // A whole bracket's run under 120 KB of JSON before compression
    simArenaToEnd(g, u)
    expect(JSON.stringify(g.arena).length).toBeLessThan(120_000)
  })

  it('unlocks the Cup’s achievements from the run', () => {
    const fake = (size: CupSize, field: ArenaField, conceded: number) => {
      const g = cupGame('badges', { size, field })
      const a = g.arena!
      a.over = true
      a.won = true
      a.log = Array.from({ length: cupRoundCount(size) }, (_, i) => ({ label: 'x', opponent: 'x@2010', neutral: false, home: true, gf: 1, ga: i === 0 ? conceded : 0, training: 'balanced', live: false, realStrength: 80, offset: 0 }))
      g.unlocked = []
      finishArena(g)
      return g.unlocked
    }
    expect(fake(16, 'wheel', 1)).toEqual(['cup-night'])
    expect(fake(32, 'giants', 0).sort()).toEqual(['clean-run', 'cup-32', 'cup-night', 'giant-slayers'])
    expect(fake(8, 'champions', 0).sort()).toEqual(['clean-run', 'cup-night'])
  })

  it('writes the share text: the field, a line per tie, the winner when it was not you, the final’s man of the match', () => {
    for (let i = 0; i < 40; i++) {
      const g = played(`share-${i}`, { field: 'champions' })
      const a = g.arena!
      const lines = arenaShareText(arenaShareInput(g, u)!).split('\n')
      expect(lines[0]).toBe('TouchLine · The Cup · 16 clubs · Champions')
      expect(lines[1]).toBe('Cup XI · 4-3-3 · Premier League wheel')
      expect(lines[2]).toBe(`${a.won ? '🏆' : a.log.length === 4 ? '🥈' : '🏟️'} ${arenaBanner(a)}`)
      a.log.forEach((s, k) => expect(lines[3 + k]).toMatch(new RegExp(`^${['R16', 'QF', 'SF', 'F'][k]} (🟩|🟨|🟥) ${s.gf}-${s.ga} .+ \\d{4}-\\d{2}${s.pens ? ` \\(${s.pens.us}-${s.pens.them} pens\\)` : ''}$`)))
      const rest = lines.slice(3 + a.log.length)
      if (!a.won && a.log.length < 4) expect(rest[0]).toBe(`🏆 Won by ${cupWinnerName(g, u)}`)
      else expect(rest.some((l) => l.startsWith('🏆 Won by'))).toBe(false)
      if (a.log.length === 4 && a.log[3].motmId) expect(rest.some((l) => l.startsWith('⭐ Final MOTM: '))).toBe(true)
      else expect(rest.some((l) => l.startsWith('⭐'))).toBe(false)
      expect(lines[lines.length - 1]).toBe(`Seed share-${i}`)
      if (a.won && a.log[3].motmId) return
    }
    throw new Error('no Cup won in 40 seeds')
  }, 30_000)
})

describe('the Cup: Europe this season', () => {
  const three = loadTestUniverse(['england', 'spain', 'italy'])

  it('needs every pack, and takes the top of each loaded league’s latest complete season', () => {
    expect(arenaNeedsAllLeagues({ arena: { format: 'cup', size: 16, field: 'europe' } })).toBe(true)
    expect(arenaNeedsAllLeagues({ arena: { format: 'cup', size: 16, field: 'decade' } })).toBe(false)
    const g = cupGame('europe', { field: 'europe' }, three)
    expect(fieldLeagues(g, three)).toEqual(three.available.map((l) => l.id))
    const standings = europeStandings(three, ['england', 'spain', 'italy'])
    expect(standings).toHaveLength(3)
    const latest = new Map(standings.map((l) => [l[0].leagueId, l[0].season]))
    // Twelve top-four sides for fifteen places: all twelve, then the three strongest fifths
    const keys = entrants(g)
    expect(keys).toHaveLength(15)
    for (const l of standings) for (const cs of l.slice(0, 4)) expect(keys).toContain(keyOf(cs))
    for (const k of keys) {
      const cs = three.clubSeasonByKey[k]
      expect(cs.season).toBe(latest.get(cs.leagueId))
    }
    // An eight-club cup draws its seven from the twelve
    for (let i = 0; i < 20; i++) {
      const top = new Set(standings.flatMap((l) => l.slice(0, 4)).map(keyOf))
      for (const cs of cupField(three, new Rng(`eu-${i}`), { leagues: ['england', 'spain', 'italy'], field: 'europe' }, 7)) expect(top.has(keyOf(cs))).toBe(true)
    }
  }, 30_000)
})

describe('the Cup: saves and the store', () => {
  it('a final and a Gauntlet saved before the Cup (no bracket) normalise and play on', () => {
    const final = createGame(cupGameSettings(u, choices('old-final', { size: 2, field: 'giants' }), 'CXI'))
    const ladder = createGame(gauntletGameSettings(u, choices('old-ladder'), 'CXI'))
    for (const g of [final, ladder]) {
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginArena(g, u)
      const old = JSON.parse(JSON.stringify(g)) as Game
      expect('bracket' in old.arena!).toBe(false)
      const n = normaliseGame(old)!
      playArenaStep(n, u, false)
      expect(n.arena!.log).toHaveLength(1)
      expect(n.arena!.bracket).toBeUndefined()
    }
    expect(final.settings.arena).toEqual({ format: 'cup', size: 2, field: 'giants' })
  })

  it('Sim to the end files the run once: Best runs with its size, the arena cups shelf, never the leaderboard or a season cup', () => {
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {} })
    useStore.getState().openArenaSetup('cup')
    useStore.getState().startGame(cupGameSettings(u, choices('store-cup', { size: 8, field: 'decade', decade: 2020 }), 'CXI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    expect(useStore.getState().game!.phase).toBe('week')
    expect(useStore.getState().game!.settings.arena).toEqual({ format: 'cup', size: 8, field: 'decade', decade: 2020 })
    for (const k of entrants(useStore.getState().game!)) expect(u.clubSeasonByKey[k].season).toBeGreaterThanOrEqual(2020)
    const before = useStore.getState().profile
    useStore.getState().simArenaToEnd()
    const g = useStore.getState().game!
    expect(g.phase).toBe('summary')
    useStore.getState().recordResult()
    const p = useStore.getState().profile
    expect(p.arenaRuns).toHaveLength((before.arenaRuns?.length ?? 0) + 1)
    const run = p.arenaRuns!.find((e) => e.format === 'cup' && e.size === 8)!
    expect(run.tier).toBe(arenaTier(g.arena!))
    expect(run.score).toBe(g.arena!.log.filter(stepWon).length)
    expect(run.field).toBe('decade')
    expect(p.leaderboard).toHaveLength(before.leaderboard.length)
    expect(p.cabinet!.cups.runs).toBe((before.cabinet?.cups.runs ?? 0) + 1)
    expect(p.cabinet!.cups.bySize['8'] ?? 0).toBe((before.cabinet?.cups.bySize['8'] ?? 0) + (g.arena!.won ? 1 : 0))
    expect(p.cabinet!.cup).toBe(before.cabinet?.cup ?? 0)
    expect(p.cabinet!.league).toBe(before.cabinet?.league ?? 0)
  })

  it('a training focus changed on the hub makes the run the manager’s, as every other decision does', () => {
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {} })
    useStore.getState().openArenaSetup('cup')
    useStore.getState().startGame(cupGameSettings(u, choices('store-training'), 'CXI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    const g = () => useStore.getState().game!
    expect(g().training).toBe('balanced')
    useStore.getState().setTraining('balanced')
    expect(g().arena!.handManaged).toBe(false)
    useStore.getState().setTraining('fitness')
    expect(g().training).toBe('fitness')
    expect(g().arena!.handManaged).toBe(true)
  })
})

describe('the Cup: balance guard (300 assistant runs, England wheel unless stated)', () => {
  // The same 300 seeds in order; the sweep hands the worker's event loop a turn every 25 runs, so its reports to the
  // runner never time out ("Timeout calling onTaskUpdate") while four 20-second sweeps run back to back on a loaded machine
  const lifted = async (partial: Partial<ArenaChoices>, universe = u) => {
    let won = 0
    for (let i = 0; i < 300; i++) {
      if (played(`cup-guard-${i}`, partial, universe).arena!.won) won++
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0))
    }
    return won / 300
  }

  it('the wheel, 16 clubs, Calibrated: lifted 12% to 32% of the time', async () => {
    expect(CUP_FIELD_TARGET.wheel).toBe(73.5)
    const share = await lifted({})
    expect(share).toBeGreaterThan(0.12)
    expect(share).toBeLessThan(0.32)
  }, 300_000)

  it('the giants on Realistic: lifted under 3% of the time', async () => {
    expect(await lifted({ field: 'giants', difficulty: 'realistic' })).toBeLessThan(0.03)
  }, 300_000)

  it('a decade (the 2010s) on Calibrated: lifted 6% to 30% of the time', async () => {
    const share = await lifted({ field: 'decade', decade: 2010 })
    expect(share).toBeGreaterThan(0.06)
    expect(share).toBeLessThan(0.3)
  }, 300_000)

  it('Europe this season (all seven packs) on Calibrated: lifted 6% to 30% of the time', async () => {
    const all = loadTestUniverse(['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'])
    const share = await lifted({ field: 'europe' }, all)
    expect(share).toBeGreaterThan(0.06)
    expect(share).toBeLessThan(0.3)
    expect(clubIdOfKey(entrants(cupGame('eu-key', { field: 'europe' }, all))[0])).not.toContain('@')
  }, 300_000)
})
