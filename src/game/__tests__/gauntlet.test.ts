import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { advanceArenaMatch, arenaContinueLabel, arenaShareInput, arenaStepInfo, beginArena, changeTheDraw, closeArenaMatch, finalGameSettings, finishArena, gauntletGameSettings, GAUNTLET_SQUAD, nextArenaOpponent, playArenaStep, resolveArenaStep, rungOpponent, simArenaToEnd, stepWon, takePenalties, type ArenaChoices } from '../logic/arena'
import { finishDraftLabel } from '../logic/modes'
import { playerLookup } from '../logic/players'
import { autoDraft } from '@engine/draft'
import { advanceMatch, finishMatch } from '@engine/match'
import { newSquadPlayer } from '@engine/season'
import { arenaShareText } from '@engine/awards'
import { arenaPool, arenaTierLabel, clubIdOfKey, teamStrengthOf } from '@engine/knockout'
import { buildLadder, gauntletBands, gauntletCeiling, gauntletHome, gauntletImportance, gauntletOffset, GAUNTLET_RUNGS, rungBandLabel, rungLabels } from '@engine/gauntlet'
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
const pool = arenaPool(u, { leagues: ['england'] })
const keyOf = (cs: { clubId: string; season: number }) => `${cs.clubId}@${cs.season}`

function choices(seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices {
  return { teamName: 'Ladder XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, ...partial }
}

/** A drafted Gauntlet on its hub, the assistant having drafted all fourteen. */
function gauntletGame(seed: string, partial: Partial<ArenaChoices> = {}, tweak?: (g: Game) => void): Game {
  const g = createGame(gauntletGameSettings(u, choices(seed, partial), 'LXI'))
  tweak?.(g)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, u)
  return g
}

/** The assistant climbs to the end. */
function climbed(seed: string, partial: Partial<ArenaChoices> = {}): Game {
  const g = gauntletGame(seed, partial)
  simArenaToEnd(g, u)
  return g
}

const roundTrip = (g: Game) => expect(JSON.parse(JSON.stringify(g))).toEqual(g)
const rungsWon = (g: Game) => g.arena!.log.filter(stepWon).length

describe('the Gauntlet: the ladder', () => {
  it('cuts the pool into ten disjoint bands that cover it, with rising medians', () => {
    const b = gauntletBands(u, pool)
    const keys = b.bands.flat().map(keyOf)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(keys)).toEqual(new Set(pool.map(keyOf)))
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]
    const medians = b.bands.map((band) => median(band.map((cs) => teamStrengthOf(u, cs))))
    for (let i = 1; i < medians.length; i++) expect(medians[i]).toBeGreaterThan(medians[i - 1])
    // Every club-season of a band is at least as strong as every one of the band below
    for (let i = 1; i < b.bands.length; i++) expect(Math.min(...b.bands[i].map((cs) => teamStrengthOf(u, cs)))).toBeGreaterThanOrEqual(Math.max(...b.bands[i - 1].map((cs) => teamStrengthOf(u, cs))))
    expect(b.top.length).toBe(Math.ceil(pool.length * 0.05))
  })

  it('over 200 seeds: rung r draws from band r, the top rungs from the strongest, no club twice, each alternate from its band and never a main', () => {
    const b = gauntletBands(u, pool)
    const ranked = [...pool].sort((x, y) => teamStrengthOf(u, y) - teamStrengthOf(u, x))
    const top5 = new Set(b.top.map(keyOf))
    const top10 = new Set(ranked.slice(0, Math.ceil(pool.length * 0.1)).map(keyOf))
    const topClubs = new Set(b.top.map((cs) => cs.clubId)).size
    for (let i = 0; i < 200; i++) {
      const l = buildLadder(u, new Rng(`ladder-${i}`), pool)
      expect(l.mains).toHaveLength(GAUNTLET_RUNGS)
      expect(l.alternates).toHaveLength(GAUNTLET_RUNGS)
      for (let r = 1; r <= 10; r++) {
        const band = new Set(b.bands[r - 1].map(keyOf))
        expect(band.has(l.mains[r - 1])).toBe(true)
        expect(band.has(l.alternates[r - 1])).toBe(true)
      }
      for (let r = 11; r <= 15; r++) {
        expect(top10.has(l.mains[r - 1])).toBe(true)
        expect(top5.has(l.alternates[r - 1])).toBe(true)
      }
      // The top rungs take the strongest 5% while it has a club left (England's has four)
      expect(l.mains.slice(10).filter((k) => top5.has(k)).length).toBeGreaterThanOrEqual(Math.min(5, topClubs))
      expect(new Set(l.mains.map(clubIdOfKey)).size).toBe(GAUNTLET_RUNGS)
      const mains = new Set(l.mains)
      for (const k of l.alternates) expect(mains.has(k)).toBe(false)
      expect(new Set(l.alternates).size).toBe(GAUNTLET_RUNGS)
    }
  }, 30_000)

  it('gives two players on one seed the same ladder and the same opponents, whatever they drafted', () => {
    for (let i = 0; i < 6; i++) {
      const a = climbed(`same-ladder-${i}`)
      const b = gauntletGame(`same-ladder-${i}`, { formationId: '3-5-2' }, (g) => {
        g.rngState = new Rng(`other-draft-${i}`).getState()
      })
      expect(Object.values(b.lineup).sort()).not.toEqual(Object.values(a.lineup).sort())
      simArenaToEnd(b, u)
      expect(b.arena!.ladder).toEqual(a.arena!.ladder)
      const both = Math.min(a.arena!.log.length, b.arena!.log.length)
      for (let r = 0; r < both; r++) expect(b.arena!.log[r].opponent).toBe(a.arena!.log[r].opponent)
      for (let r = 0; r < both; r++) expect(a.arena!.log[r].opponent).toBe(a.arena!.ladder!.mains[r])
    }
  }, 30_000)

  it('replays a run exactly on one seed, and a run saved and reloaded mid-climb plays on as if it never closed', () => {
    for (let i = 0; i < 4; i++) {
      const seed = `replay-${i}`
      const a = climbed(seed)
      const b = climbed(seed)
      expect(b.arena!.log).toEqual(a.arena!.log)
      expect(b.rngState).toEqual(a.rngState)
      // Three rungs (or the end) by the assistant, then a save and a reload through normaliseGame
      const c = gauntletGame(seed)
      while (!c.arena!.over && c.arena!.step < 3) {
        if (c.phase === 'draft') {
          const rng = Rng.fromState(c.rngState)
          autoDraft(u, c.draft!, rng)
          c.rngState = rng.getState()
          beginArena(c, u)
          continue
        }
        playArenaStep(c, u, false)
        closeArenaMatch(c)
      }
      const reloaded = normaliseGame(JSON.parse(JSON.stringify(c)))!
      simArenaToEnd(reloaded, u)
      expect(reloaded.arena!.log).toEqual(a.arena!.log)
      expect(reloaded.rngState).toEqual(a.rngState)
    }
  }, 60_000)

  it('labels a rung by its band and billing, and calibrates it to the rising ceiling', () => {
    expect(rungBandLabel(1)).toBe('the weakest 10% of the wheel')
    expect(rungBandLabel(8)).toBe('top 30% of the wheel')
    expect(rungBandLabel(12)).toBe('the strongest 5% of the wheel')
    expect(rungLabels(2, 80)).toEqual({ label: 'Rung 2' })
    expect(rungLabels(5, 80)).toEqual({ label: 'Rung 5', billing: 'Gauntlet night' })
    expect(rungLabels(3, 85.4)).toEqual({ label: 'Rung 3', billing: 'Giant killing' })
    expect(gauntletImportance(1)).toBe(1)
    expect(gauntletImportance(7)).toBe(1.18)
    expect(gauntletImportance(15)).toBe(1.4)
    expect([1, 2, 3, 4].map(gauntletHome)).toEqual([false, true, false, true])
    expect(gauntletCeiling(5) - gauntletCeiling(4)).toBeCloseTo(1.5, 5)
    expect(gauntletOffset(90, 1, 'realistic')).toBe(0)
    expect(gauntletOffset(gauntletCeiling(3) - 2, 3, 'calibrated')).toBe(0)
    expect(gauntletOffset(gauntletCeiling(3) + 4.04, 3, 'calibrated')).toBe(4)
    const g = gauntletGame('rung-one')
    const info = arenaStepInfo(g.arena!)
    expect(info).toMatchObject({ label: 'Rung 1', code: 'R1', neutral: false, home: false, importance: 1 })
    const opp = nextArenaOpponent(g, u)!
    expect(opp.key).toBe(g.arena!.ladder!.mains[0])
    expect(opp.offset).toBe(gauntletOffset(opp.real, 1, 'calibrated'))
    expect(Object.keys(g.arena!.clubs)).toEqual([opp.key])
  })
})

describe('the Gauntlet: the rules', () => {
  it('sets up fourteen picks with no field, a ladder and the first rung drawn', () => {
    const g = gauntletGame('setup')
    expect(g.settings.arena).toEqual({ format: 'gauntlet' })
    expect(g.settings.rules.squadSize).toBe(GAUNTLET_SQUAD)
    expect(Object.keys(g.squad)).toHaveLength(14)
    expect(g.phase).toBe('week')
    expect(g.arena!.ladder!.mains).toHaveLength(15)
    roundTrip(g)
  })

  it('ends at the first defeat with one more row than rungs won, or after fifteen; files the score and the tier', () => {
    let complete = 0
    for (let i = 0; i < 40; i++) {
      const g = climbed(`ends-${i}`)
      const a = g.arena!
      expect(g.phase).toBe('summary')
      expect(a.over).toBe(true)
      const won = rungsWon(g)
      if (a.won) {
        complete++
        expect(won).toBe(15)
        expect(a.log).toHaveLength(15)
      } else {
        expect(a.log).toHaveLength(won + 1)
        expect(stepWon(a.log[a.log.length - 1])).toBe(false)
      }
      a.log.slice(0, won).forEach((s) => expect(stepWon(s)).toBe(true))
      expect(arenaTierLabel(a.won ? 'GAUNTLET COMPLETE' : 'RUNGS', won)).toBe(a.won ? 'GAUNTLET COMPLETE' : `${won} ${won === 1 ? 'RUNG' : 'RUNGS'}`)
      // Venues alternate, away first
      a.log.forEach((s, r) => expect(s.home).toBe(gauntletHome(r + 1)))
      if (won >= 5) expect(g.unlocked).toContain('gauntlet-5')
      else expect(g.unlocked).not.toContain('gauntlet-5')
      if (won >= 10) expect(g.unlocked).toContain('gauntlet-10')
      // Only the club being played is held; a finished run holds at most the side that won
      expect(Object.keys(a.clubs).length).toBeLessThanOrEqual(1)
    }
    expect(complete).toBeLessThan(40)
  }, 30_000)

  it('changes the draw once: the rung is played against its alternate, a second use is refused', () => {
    const g = gauntletGame('lifeline')
    const a = g.arena!
    const main = a.ladder!.mains[0]
    expect(changeTheDraw(g, u).ok).toBe(true)
    expect(a.lifelineUsed).toBe(1)
    expect(a.next).toBe(a.ladder!.alternates[0])
    expect(rungOpponent(a, 1)).toBe(a.ladder!.alternates[0])
    expect(a.clubs[main]).toBeUndefined()
    expect(Object.keys(a.clubs)).toEqual([a.ladder!.alternates[0]])
    const again = changeTheDraw(g, u)
    expect(again.ok).toBe(false)
    expect(again.message).toMatch(/rung 1/)
    expect(a.next).toBe(a.ladder!.alternates[0])
    playArenaStep(g, u, false)
    expect(a.log[0].opponent).toBe(a.ladder!.alternates[0])
    expect(a.ladder!.mains[0]).toBe(main)
    // Not between the whistle and the hub
    expect(changeTheDraw(g, u).ok).toBe(false)
    roundTrip(g)
  })

  it('tires a never-rotated starter: worse condition before rung 5 than before rung 1, never better than before rung 2', () => {
    let checked = 0
    for (let i = 0; i < 80 && checked < 5; i++) {
      const g = gauntletGame(`legs-${i}`)
      const xi = new Set(Object.values(g.lineup).filter((id) => u.index[id]?.positions[0] !== 'GK'))
      const before: Record<number, Record<string, number>> = {}
      // Managed live with no changes: the same men start every rung unless a ban or an injury moves them
      while (!g.arena!.over) {
        if (g.phase === 'draft') {
          const rng = Rng.fromState(g.rngState)
          autoDraft(u, g.draft!, rng)
          g.rngState = rng.getState()
          beginArena(g, u)
        }
        const rung = g.arena!.step + 1
        before[rung] = Object.fromEntries([...xi].map((id) => [id, g.squad[id].condition]))
        if (rung === 5) break
        for (const id of [...xi]) if (!Object.values(g.lineup).includes(id)) xi.delete(id)
        playArenaStep(g, u, true)
        for (const id of [...xi]) if (!g.live!.mp[g.live!.userIsHome ? 'hLive' : 'aLive'].some((p) => p.psId === id && p.onAt === 0)) xi.delete(id)
        advanceArenaMatch(g, u)
        advanceArenaMatch(g, u)
        const p = g.arena!.pending?.shootout
        if (p) takePenalties(g, u, p.defaultOrder, p.keepers[0])
        // Taken off, sent off or hurt before the end: rotated after all
        const stats = g.lastMatch![g.arena!.log[g.arena!.log.length - 1].home ? 'homeStats' : 'awayStats']
        for (const id of [...xi]) if ((stats.find((s) => s.playerSeasonId === id)?.minutes ?? 0) < 90) xi.delete(id)
        closeArenaMatch(g)
      }
      if (g.arena!.step < 4 || !before[5] || !xi.size) continue
      const mean = (r: number) => [...xi].reduce((t, id) => t + before[r][id], 0) / xi.size
      // Tired legs build up: below rung 1's freshness by rung 5 and never above rung 2's. On main's engine (merged into the
      // casual modes) a fit XI can level off from rung 2 once the recovery between rungs matches a match's cost
      expect(mean(5)).toBeLessThan(mean(1))
      expect(mean(5)).toBeLessThanOrEqual(mean(2))
      checked++
    }
    expect(checked).toBe(5)
  }, 60_000)

  it('makes a red card and a second booking of the run each a one-rung ban, served at the next rung', () => {
    for (let i = 0; i < 60; i++) {
      const g = gauntletGame(`cards-${i}`)
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
      expect(g.squad[booked.playerSeasonId].suspension).toBe(1)
      expect(g.squad[sentOff.playerSeasonId].suspension).toBe(1)
      closeArenaMatch(g)
      expect(g.phase).toBe('week')
      playArenaStep(g, u, false)
      const played = new Set([...g.lastMatch!.homeStats, ...g.lastMatch!.awayStats].map((s) => s.playerSeasonId))
      expect(played.has(booked.playerSeasonId)).toBe(false)
      expect(played.has(sentOff.playerSeasonId)).toBe(false)
      expect(g.squad[booked.playerSeasonId].suspension).toBe(0)
      expect(g.squad[sentOff.playerSeasonId].suspension).toBe(0)
      return
    }
    throw new Error('no rung-one win in 60 seeds')
  })

  it('adds one bench pick after rungs 2, 4, 6 and 8 (up to 18), one history row each, on the run’s own copy of the rules', () => {
    for (let i = 0; i < 200; i++) {
      const g = gauntletGame(`bonus-${i}`)
      const settingsRules = g.settings.rules
      const bonusAt: number[] = []
      while (!g.arena!.over) {
        playArenaStep(g, u, false)
        expect(arenaContinueLabel(g)).toBe(g.arena!.over ? 'Run summary →' : [2, 4, 6, 8].includes(g.arena!.step) ? 'Bonus spin →' : `Next: Rung ${g.arena!.step + 1} →`)
        closeArenaMatch(g)
        if (g.phase !== 'draft') continue
        roundTrip(g)
        const d = g.draft!
        bonusAt.push(g.arena!.step)
        expect(finishDraftLabel(g)).toBe('Back to the ladder')
        const squad = Object.keys(g.squad).length
        const picks = d.history.filter((h) => h.pickedId).length
        const rows = d.history.length
        const lineup = { ...g.lineup }
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, d, rng)
        g.rngState = rng.getState()
        expect(d.history.filter((h) => h.pickedId).length).toBe(picks + 1)
        expect(d.history.length).toBeGreaterThanOrEqual(rows + 1)
        beginArena(g, u)
        expect(g.phase).toBe('week')
        expect(Object.keys(g.squad)).toHaveLength(squad + 1)
        const newcomer = d.history.filter((h) => h.pickedId).at(-1)!.pickedId!
        expect(g.bench).toContain(newcomer)
        expect(g.squad[newcomer]).toEqual(newSquadPlayer(newcomer))
        expect(g.lineup).toEqual(lineup)
        roundTrip(g)
      }
      expect(g.settings.rules).toBe(settingsRules)
      expect(g.settings.rules.squadSize).toBe(GAUNTLET_SQUAD)
      if (rungsWon(g) < 8) continue
      expect(bonusAt).toEqual([2, 4, 6, 8])
      expect(Object.keys(g.squad)).toHaveLength(18)
      closeArenaMatch(g)
      expect(g.phase).toBe('summary')
      return
    }
    throw new Error('no climb of eight rungs in 200 seeds')
  }, 60_000)

  it('unlocks the giant killer for a win over a real 85+ on Realistic only', () => {
    const g = climbed('giant', { difficulty: 'calibrated' })
    const fake = (difficulty: 'calibrated' | 'realistic') => {
      const x = JSON.parse(JSON.stringify(g)) as Game
      x.settings.difficulty = difficulty
      x.unlocked = []
      x.arena!.log.unshift({ ...x.arena!.log[0], gf: 2, ga: 1, realStrength: 86.1 })
      x.phase = 'match'
      finishArena(x)
      return x.unlocked
    }
    expect(fake('realistic')).toContain('giant-killer')
    expect(fake('calibrated')).not.toContain('giant-killer')
  })

  it('writes the share text: the strip, the fall, the scorer and the seed', () => {
    const g = climbed('share-text')
    const a = g.arena!
    const won = rungsWon(g)
    const lines = arenaShareText(arenaShareInput(g, u)!).split('\n')
    expect(lines[0]).toBe('TouchLine · The Gauntlet')
    expect(lines[1]).toBe('Ladder XI · 4-3-3 · Premier League wheel')
    expect(lines[2]).toBe(a.won ? '🏔️ GAUNTLET COMPLETE' : `🪜 ${won} ${won === 1 ? 'RUNG' : 'RUNGS'}`)
    expect([...lines[3]].length).toBe(a.log.length)
    expect(lines[3].endsWith(a.won ? '🟩' : '🟥') || lines[3].endsWith('🟨')).toBe(true)
    if (!a.won) expect(lines[4]).toMatch(new RegExp(`^Fell to .+ \\d{4}-\\d{2} at rung ${a.log.length}, \\d+-\\d+`))
    expect(lines[lines.length - 1]).toBe('Seed share-text')
    expect(arenaShareText({ mode: 'The Gauntlet', teamName: 'Touchline XI', formationName: '4-3-3', wheel: 'Premier League wheel', banner: '7 RUNGS', icon: '🪜', steps: [], strip: '🟩🟩🟩🟨🟩🟩🟩🟥', lines: ['Fell to Real Madrid 2017-18 at rung 8, 1-2', '⚽ Haaland 6 · ⭐ De Bruyne'], seed: 'K7Q2-MX9A' })).toBe(
      ['TouchLine · The Gauntlet', 'Touchline XI · 4-3-3 · Premier League wheel', '🪜 7 RUNGS', '🟩🟩🟩🟨🟩🟩🟩🟥', 'Fell to Real Madrid 2017-18 at rung 8, 1-2', '⚽ Haaland 6 · ⭐ De Bruyne', 'Seed K7Q2-MX9A'].join('\n'),
    )
  })
})

describe('the Gauntlet: balance guard (300 assistant runs, England wheel)', () => {
  it('calibrated: a mean climb between 3.5 and 6.5 rungs, 4% to 25% reaching ten', () => {
    const rungs = Array.from({ length: 300 }, (_, i) => rungsWon(climbed(`gauntlet-guard-${i}`)))
    const mean = rungs.reduce((t, x) => t + x, 0) / rungs.length
    const ten = rungs.filter((x) => x >= 10).length / rungs.length
    expect(mean).toBeGreaterThan(3.5)
    expect(mean).toBeLessThan(6.5)
    expect(ten).toBeGreaterThan(0.04)
    expect(ten).toBeLessThan(0.25)
  }, 120_000)

  it('realistic: a mean climb below 2 rungs', () => {
    const rungs = Array.from({ length: 300 }, (_, i) => rungsWon(climbed(`gauntlet-guard-${i}`, { difficulty: 'realistic' })))
    expect(rungs.reduce((t, x) => t + x, 0) / rungs.length).toBeLessThan(2)
  }, 120_000)
})

describe('the Gauntlet: saves and the store', () => {
  it('a final saved before the Gauntlet (no ladder, no lifeline) normalises and plays on', () => {
    const g = createGame(finalGameSettings(u, { ...choices('old-final'), field: 'giants' }, 'LXI'))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginArena(g, u)
    const old = JSON.parse(JSON.stringify(g)) as Game
    expect('ladder' in old.arena!).toBe(false)
    expect('lifelineUsed' in old.arena!).toBe(false)
    const n = normaliseGame(old)!
    expect(changeTheDraw(n, u).ok).toBe(false)
    playArenaStep(n, u, false)
    expect(n.arena!.over).toBe(true)
  })

  it('Sim to the end files the run once: Best runs, the Gauntlet shelf, never the leaderboard or a cup', () => {
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {} })
    useStore.getState().openArenaSetup('gauntlet')
    expect(useStore.getState().arenaSetupFormat).toBe('gauntlet')
    expect(useStore.getState().setupMode).toBe('arena')
    useStore.getState().startGame(gauntletGameSettings(u, choices('store-run'), 'LXI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    expect(useStore.getState().game!.phase).toBe('week')
    const before = useStore.getState().profile
    useStore.getState().changeTheDraw()
    useStore.getState().changeTheDraw()
    expect(useStore.getState().toast).toMatch(/lifeline was used/)
    expect(useStore.getState().game!.arena!.handManaged).toBe(false)
    useStore.getState().simArenaToEnd()
    const g = useStore.getState().game!
    expect(g.phase).toBe('summary')
    useStore.getState().recordResult()
    const p = useStore.getState().profile
    const won = rungsWon(g)
    expect(p.arenaRuns).toHaveLength((before.arenaRuns?.length ?? 0) + 1)
    const run = p.arenaRuns!.find((e) => e.format === 'gauntlet')!
    expect(run.score).toBe(won)
    expect(run.tier).toBe(g.arena!.won ? 'GAUNTLET COMPLETE' : 'RUNGS')
    expect(p.leaderboard).toHaveLength(before.leaderboard.length)
    expect(p.cabinet!.gauntlet.runs).toBe((before.cabinet?.gauntlet.runs ?? 0) + 1)
    expect(p.cabinet!.gauntlet.best).toBe(Math.max(before.cabinet?.gauntlet.best ?? 0, won))
    expect(p.cabinet!.cups.runs).toBe(before.cabinet?.cups.runs ?? 0)
    expect(p.cabinet!.league).toBe(before.cabinet?.league ?? 0)
    expect(p.cabinet!.cup).toBe(before.cabinet?.cup ?? 0)
  })
})
