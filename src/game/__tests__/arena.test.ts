import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { advanceArenaMatch, arenaRecovery, arenaShareInput, arenaRunEntry, beginArena, closeArenaMatch, finalGameSettings, nextArenaOpponent, playArenaStep, resolveArenaStep, stepWon, takePenalties, type ArenaChoices } from '../logic/arena'
import { playerLookup } from '../logic/players'
import { setFormation } from '../logic/squad'
import { autoDraft } from '@engine/draft'
import { advanceMatch, finishMatch } from '@engine/match'
import { arenaShareText } from '@engine/awards'
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
import { slotOf, useStore } from '../store'

const u = loadTestUniverse(['england'])

function choices(seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices {
  return { teamName: 'Arena XI', formationId: '4-3-3', field: 'giants', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, ...partial }
}

/** A drafted final on its hub, the assistant having drafted all sixteen. */
function finalGame(seed: string, partial: Partial<ArenaChoices> = {}, tweak?: (g: Game) => void): Game {
  const g = createGame(finalGameSettings(u, choices(seed, partial), 'AXI'))
  tweak?.(g)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, u)
  return g
}

const roundTrip = (g: Game) => expect(JSON.parse(JSON.stringify(g))).toEqual(g)

/** The first seed (of 300) whose assistant final is level at 90. */
function levelSeed(): string {
  for (let i = 0; i < 300; i++) {
    const g = finalGame(`level-${i}`)
    playArenaStep(g, u, false)
    if (g.arena!.log[0].gf === g.arena!.log[0].ga) return `level-${i}`
  }
  throw new Error('no level final in 300 seeds')
}

describe('arena: the one-off final', () => {
  it('sets up a final: phase week, a squad of 16, one opponent drawn, streams seeded with the game', () => {
    const g = finalGame('arena-setup')
    expect(g.settings.mode).toBe('arena')
    expect(g.phase).toBe('week')
    expect(Object.keys(g.squad)).toHaveLength(16)
    expect(Object.keys(g.arena!.clubs)).toHaveLength(1)
    expect(g.arena!.next).toBe(Object.keys(g.arena!.clubs)[0])
    expect(g.draft).not.toBeNull()
    expect(Object.keys(g.contracts)).toHaveLength(0)
    expect(g.arena!.streams.field).not.toEqual(createGame(finalGameSettings(u, choices('arena-setup'), 'AXI')).arena!.streams.field)
    const opp = nextArenaOpponent(g, u)!
    expect(opp.real).toBeGreaterThan(80)
    expect(opp.offset).toBeCloseTo(Math.max(0, Math.round((opp.real - 78) * 10) / 10), 5)
    expect(g.settings.jobSecurity).toBe(false)
    expect(g.settings.rules.squadSize).toBe(16)
  })

  it('meets the same opponent on one seed whatever was drafted', () => {
    for (let i = 0; i < 10; i++) {
      const a = finalGame(`same-opp-${i}`)
      const b = finalGame(`same-opp-${i}`, { formationId: '3-5-2' }, (g) => {
        g.rngState = new Rng(`other-draft-${i}`).getState()
      })
      expect(Object.values(b.lineup).sort()).not.toEqual(Object.values(a.lineup).sort())
      expect(b.arena!.next).toBe(a.arena!.next)
    }
  })

  it('an assistant final ends in the summary with one log row', () => {
    const g = finalGame('arena-sim')
    playArenaStep(g, u, false)
    expect(g.phase).toBe('match')
    expect(g.arena!.over).toBe(true)
    expect(g.arena!.log).toHaveLength(1)
    expect(g.lastMatch).not.toBeNull()
    expect(g.lastMatchContext?.competition).toBe('arena')
    const row = g.arena!.log[0]
    expect(row.live).toBe(false)
    expect(g.arena!.won).toBe(stepWon(row))
    if (row.gf === row.ga) expect(row.pens).toBeDefined()
    closeArenaMatch(g)
    expect(g.phase).toBe('summary')
    expect(g.arena!.handManaged).toBe(false)
    if (g.arena!.won) expect(g.unlocked).toContain('final-whistle')
  })

  it('a level live final waits for the penalties, which kick in the given order; every stop survives a JSON round trip', () => {
    const seed = levelSeed()
    const g = finalGame(seed)
    roundTrip(g)
    playArenaStep(g, u, true)
    expect(g.live?.kind).toBe('arena')
    expect(g.live?.mp.clock ?? 45).toBe(45)
    roundTrip(g)
    advanceArenaMatch(g, u)
    expect(g.live?.mp.clock).toBe(70)
    roundTrip(g)
    advanceArenaMatch(g, u)
    expect(g.live).toBeNull()
    const pending = g.arena!.pending!.shootout
    expect(pending.defaultOrder.length).toBeGreaterThanOrEqual(7)
    // The man in goal is one of the men on the pitch, and the default order ends with a keeper
    expect(pending.defaultOrder).toContain(pending.keepers[0])
    expect(u.index[pending.defaultOrder[pending.defaultOrder.length - 1]].positions[0]).toBe('GK')
    roundTrip(g)
    // Nothing moves on while the kicks wait
    closeArenaMatch(g)
    expect(g.phase).toBe('match')
    // A man not on the pitch, or a stranger in goal, is refused without touching the game
    expect(takePenalties(g, u, ['nobody'], pending.keepers[0]).ok).toBe(false)
    expect(takePenalties(g, u, pending.defaultOrder, 'nobody').ok).toBe(false)
    expect(g.arena!.pending).toBeDefined()
    const order = [...pending.defaultOrder].reverse().slice(0, 5)
    expect(takePenalties(g, u, order, pending.keepers[0]).ok).toBe(true)
    const row = g.arena!.log[0]
    const ours = row.pens!.kicks.filter((k) => k.us).map((k) => k.takerId)
    ours.forEach((id, i) => expect(id).toBe(order[i % order.length]))
    expect(row.pens!.us).not.toBe(row.pens!.them)
    expect(g.arena!.over).toBe(true)
    expect(g.arena!.handManaged).toBe(true)
    roundTrip(g)
    closeArenaMatch(g)
    expect(g.phase).toBe('summary')
    if (row.pens!.us > row.pens!.them) expect(g.unlocked).toEqual(expect.arrayContaining(['final-whistle', 'spot-kick-kings']))
    roundTrip(g)
    // The default order played live gives the assistant's shoot-out exactly
    const live = finalGame(seed)
    playArenaStep(live, u, true)
    advanceArenaMatch(live, u)
    advanceArenaMatch(live, u)
    const p = live.arena!.pending!.shootout
    takePenalties(live, u, p.defaultOrder, p.keepers[0])
    const sim = finalGame(seed)
    playArenaStep(sim, u, false)
    expect(live.arena!.log[0].pens).toEqual(sim.arena!.log[0].pens)
    expect(live.rngState).toEqual(sim.rngState)
  })

  it('makes a red card and every second booking of the run a one-match ban, served by sitting out', () => {
    const g = finalGame('arena-cards')
    playArenaStep(g, u, true)
    const live = g.live!
    const club = g.arena!.clubs[live.opponentId]
    const lookups = { home: { getPlayer: playerLookup(g, u), getState: (id: string) => g.squad[id] }, away: { getPlayer: (id: string) => u.index[id], getState: (id: string) => club.state[id] } }
    advanceMatch(live.mp, lookups, undefined, 70)
    const res = finishMatch(live.mp, lookups)
    g.live = null
    const [booked, sentOff, clean] = res.homeStats.filter((s) => !s.yellow && !s.red)
    booked.yellow = true
    sentOff.red = true
    g.arena!.yellows[booked.playerSeasonId] = 1
    // Someone already banned who sits this one out serves it
    const banned = g.bench.find((id) => !res.homeStats.some((s) => s.playerSeasonId === id))!
    g.squad[banned].suspension = 1
    resolveArenaStep(g, u, res, live.mp, live.ctx, new Set(Object.values(g.lineup)), false)
    expect(g.squad[booked.playerSeasonId].suspension).toBe(1)
    expect(g.squad[sentOff.playerSeasonId].suspension).toBe(1)
    expect(g.squad[clean.playerSeasonId].suspension).toBe(0)
    expect(g.squad[banned].suspension).toBe(0)
    expect(g.arena!.yellows[booked.playerSeasonId]).toBe(2)
  })

  it('recovers between matches by a share of a week, one match off every injury', () => {
    const g = finalGame('arena-recovery')
    const [a, b] = Object.keys(g.squad)
    g.squad[a].condition = 50
    g.squad[b].injury = { description: 'Knock', weeksOut: 2 }
    const full = JSON.parse(JSON.stringify(g)) as Game
    arenaRecovery(g, u, 0.5)
    arenaRecovery(full, u, 1)
    expect(g.squad[a].condition).toBeGreaterThan(50)
    expect(full.squad[a].condition).toBeGreaterThan(g.squad[a].condition)
    expect(g.squad[b].injury?.weeksOut).toBe(1)
  })

  it('charges a shape change after the first match the familiarity a mid-season change costs', () => {
    const g = finalGame('arena-shape')
    const id = Object.keys(g.squad)[0]
    const before = g.squad[id].familiarity
    setFormation(g, u, '4-4-2')
    expect(g.squad[id].familiarity).toBe(before)
    g.arena!.step = 1
    setFormation(g, u, '4-3-3')
    expect(g.squad[id].familiarity).toBe(Math.max(0, before - 12))
  })

  it('writes a share text in the arena format', () => {
    const text = arenaShareText({ mode: 'Cup Final', teamName: 'Touchline XI', formationName: '4-3-3', wheel: 'Premier League wheel', banner: 'WINNERS', icon: '🏆', steps: [{ code: 'F', gf: 1, ga: 1, opponent: 'Manchester City 2017-18', pens: { us: 4, them: 3 } }], motm: 'Kevin De Bruyne', seed: 'K7Q2-MX9A' })
    expect(text).toBe(['TouchLine · Cup Final', 'Touchline XI · 4-3-3 · Premier League wheel', '🏆 WINNERS', 'F 🟨 1-1 Manchester City 2017-18 (4-3 pens)', '⭐ MOTM: K. De Bruyne', 'Seed K7Q2-MX9A'].join('\n'))
  })

  it("tells a finished run's share text: the format, the side, the banner, the final and the seed", () => {
    const g = finalGame('arena-share')
    playArenaStep(g, u, false)
    const row = g.arena!.log[0]
    const lines = arenaShareText(arenaShareInput(g, u)!).split('\n')
    expect(lines[0]).toBe('TouchLine · Cup Final')
    expect(lines[1]).toBe('Arena XI · 4-3-3 · Premier League wheel')
    expect(lines[2]).toBe(g.arena!.won ? '🏆 WINNERS' : '🥈 RUNNERS-UP')
    expect(lines[3]).toMatch(new RegExp(`^F (🟩|🟨|🟥) ${row.gf}-${row.ga} .+ \\d{4}-\\d{2}`))
    expect(lines[lines.length - 1]).toBe('Seed arena-share')
  })

  it('wins more often against calibrated giants than against the real ones (100 assistant finals each)', () => {
    const rate = (difficulty: 'calibrated' | 'realistic') => {
      let won = 0
      for (let i = 0; i < 100; i++) {
        const g = finalGame(`guard-${i}`, { difficulty })
        playArenaStep(g, u, false)
        if (g.arena!.won) won++
      }
      return won / 100
    }
    const calibrated = rate('calibrated')
    const realistic = rate('realistic')
    expect(calibrated).toBeGreaterThan(0.35)
    expect(calibrated).toBeLessThan(0.85)
    expect(realistic).toBeLessThan(calibrated)
  }, 120_000)
})

describe('arena: saves and the store', () => {
  it('an old save normalises to arena: null', () => {
    const g = createGame({ ...finalGameSettings(u, choices('old-save'), 'AXI'), mode: 'quick', arena: undefined })
    const old = JSON.parse(JSON.stringify(g)) as Record<string, unknown>
    delete old.arena
    expect(normaliseGame(old as unknown as Game)!.arena).toBeNull()
    const arena = finalGame('kept-save')
    expect(normaliseGame(JSON.parse(JSON.stringify(arena)))!.arena).toEqual(arena.arena)
  })

  it('files a finished run once on Best runs and the arena shelf: no leaderboard row, no season', () => {
    const g = finalGame('arena-record')
    playArenaStep(g, u, false)
    closeArenaMatch(g)
    const before = useStore.getState().profile
    useStore.setState({ universe: u, game: g })
    useStore.getState().recordResult()
    useStore.getState().recordResult()
    const p = useStore.getState().profile
    expect(p.arenaRuns).toHaveLength((before.arenaRuns?.length ?? 0) + 1)
    expect(p.leaderboard).toHaveLength(before.leaderboard.length)
    expect(p.seasonsSimulated).toBe(before.seasonsSimulated)
    expect(p.cabinet!.cups.runs).toBe((before.cabinet?.cups.runs ?? 0) + 1)
    expect(p.cabinet!.byMode.arena).toBe((before.cabinet?.byMode.arena ?? 0) + 1)
    expect(p.cabinet!.league).toBe(before.cabinet?.league ?? 0)
    expect(p.cabinet!.cup).toBe(before.cabinet?.cup ?? 0)
    const run = p.arenaRuns!.find((e) => e.id === arenaRunEntry(g, '')!.id)!
    expect(run.tier).toBe(g.arena!.won ? 'WINNERS' : 'RUNNERS-UP')
    expect(run.score).toBe(g.arena!.won ? 1 : 0)
    expect(p.cabinet!.cups.won).toBe((before.cabinet?.cups.won ?? 0) + (g.arena!.won ? 1 : 0))
    if (g.arena!.won) expect(p.cabinet!.cups.bySize['2']).toBe((before.cabinet?.cups.bySize['2'] ?? 0) + 1)
  })

  it('a quick draft started mid-run parks it, and Resume brings it back; a touch of the tactics is managing by hand', async () => {
    useStore.setState({ universe: u, loadedLeagues: u.available.map((l) => l.id), game: null, parked: {} })
    const s = useStore.getState()
    s.startGame(finalGameSettings(u, choices('arena-park'), 'AXI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    const run = useStore.getState().game!
    expect(run.phase).toBe('week')
    expect(slotOf(run)).toBe('arena')
    expect(run.arena!.handManaged).toBe(false)
    useStore.getState().setTactics({ mentality: 'attacking' })
    expect(useStore.getState().game!.arena!.handManaged).toBe(true)
    useStore.getState().startGame({ ...run.settings, mode: 'quick', arena: undefined, seed: 'park-quick', rules: { ...run.settings.rules, squadSize: 11 } })
    expect(useStore.getState().game!.settings.mode).toBe('quick')
    expect(useStore.getState().parked.arena?.id).toBe(run.id)
    useStore.getState().resumeGame('arena')
    await new Promise((r) => setTimeout(r, 0))
    expect(useStore.getState().game!.id).toBe(run.id)
    expect(useStore.getState().parked.quick?.settings.seed).toBe('park-quick')
    // A live step resumes where it stood after a reload: the paused match is in the save
    useStore.getState().playArenaStep(true)
    const saved = JSON.parse(JSON.stringify(useStore.getState().game)) as Game
    expect(normaliseGame(saved)!.live?.mp.clock ?? 45).toBe(45)
    useStore.getState().advanceLive({})
    expect(useStore.getState().game!.live?.mp.clock).toBe(70)
  })

  it('plays an arena step paint-first (playArenaStepSoon) to the same game as playArenaStep', async () => {
    for (let i = 0; i < 6; i++) {
      const start = finalGame(`arena-soon-${i}`)
      const live = i % 2 === 0
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false })
      useStore.getState().playArenaStep(live)
      const plain = JSON.stringify({ game: useStore.getState().game, view: useStore.getState().matchView })
      useStore.setState({ game: start, matchView: 'report' })
      await useStore.getState().playArenaStepSoon(live)
      expect(JSON.stringify({ game: useStore.getState().game, view: useStore.getState().matchView }), `arena-soon-${i}`).toBe(plain)
      expect(useStore.getState().playingWeek).toBe(false)
    }
  }, 120_000)

  it('opens a simmed step on its report and a managed one on the dashboard (playtest P4)', async () => {
    for (const live of [false, true]) {
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: finalGame(`arena-view-${live}`), screen: 'game', playingWeek: false, matchView: live ? 'report' : 'ticker' })
      useStore.getState().playArenaStep(live)
      expect(useStore.getState().matchView).toBe(live ? 'ticker' : 'report')
      useStore.setState({ game: finalGame(`arena-view-${live}`), matchView: live ? 'report' : 'ticker' })
      await useStore.getState().playArenaStepSoon(live)
      expect(useStore.getState().matchView).toBe(live ? 'ticker' : 'report')
    }
  }, 60_000)
})
