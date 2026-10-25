import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, eligibleSlots, pick, SEASON_RULES, spin } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { ACCOMPLISHED_FACTOR, canCover, positionFactor, ratingAt } from '@engine/positions'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { autoPick, assignPlayer, lineupProblems } from '../logic/squad'
import { squadPlayers } from '../logic/players'
import { assignmentNote, discRating, draftSlotChoices, slotLabel, slotSheet, surname, whereabouts, whereaboutsLabel } from '../logic/slotSheet'
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

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed,
    formationId: '4-3-3',
    teamName: 'Sheet XI',
    shortName: 'SHT',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function seasonGame(seed = 'slot-sheet', partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game

describe('the slot picker', () => {
  it('lists every squad player once: the occupant, then accomplished cover by rating there, then the rest out of position', () => {
    for (const seed of ['slot-a', 'slot-b', 'slot-c']) {
      const g = seasonGame(seed)
      const squad = squadPlayers(g, u)
      for (const slot of getFormation(g.tactics.formationId).slots) {
        const sheet = slotSheet(g, u, slot.id)!
        expect(sheet.occupant?.p.id).toBe(g.lineup[slot.id])
        const ids = [sheet.occupant?.p.id, ...sheet.cover.map((o) => o.p.id), ...sheet.outOfPosition.map((o) => o.p.id)].filter(Boolean)
        expect(new Set(ids).size).toBe(squad.length)
        expect(ids.length).toBe(squad.length)
        // Cover is canCover's accomplished line, which is auto-pick's first-pass factor
        for (const o of sheet.cover) {
          expect(canCover(o.p, slot.position, 'accomplished')).toBe(true)
          expect(positionFactor(o.p, slot.position)).toBeGreaterThanOrEqual(ACCOMPLISHED_FACTOR)
          expect(['natural', 'accomplished']).toContain(o.fit)
        }
        for (const o of sheet.outOfPosition) {
          expect(positionFactor(o.p, slot.position)).toBeLessThan(ACCOMPLISHED_FACTOR)
          expect(['awkward', 'unsuited']).toContain(o.fit)
        }
        // Sorted by ratingAt there; the disc number is the pitch's (overall times the fit factor)
        for (const list of [sheet.cover, sheet.outOfPosition]) {
          for (let i = 1; i < list.length; i++) expect(list[i - 1].rating).toBeGreaterThanOrEqual(list[i].rating)
          for (const o of list) {
            expect(o.rating).toBe(ratingAt(o.p, slot.position))
            expect(o.disc).toBe(Math.round(o.p.overall * positionFactor(o.p, slot.position)))
            expect(o.disc).toBe(discRating(o.p, slot.position))
          }
        }
      }
      expect(slotSheet(g, u, 'no-such-slot')).toBeNull()
    }
  })

  it('names where each man is now: Starting at CM, Bench or Unused', () => {
    const g = seasonGame()
    const formation = getFormation(g.tactics.formationId)
    const starter = g.lineup.cm1
    expect(whereabouts(g, starter)).toEqual({ kind: 'starting', slotId: 'cm1', position: 'CM' })
    expect(whereaboutsLabel(whereabouts(g, starter))).toBe('Starting at CM')
    expect(whereaboutsLabel(whereabouts(g, g.bench[0]))).toBe('Bench')
    // An 18-man squad fills the XI and a bench of seven, so take one man off the bench to have someone unused
    const unused = g.bench[g.bench.length - 1]
    g.bench = g.bench.filter((id) => id !== unused)
    expect(whereabouts(g, unused)).toEqual({ kind: 'unused' })
    expect(whereaboutsLabel(whereabouts(g, unused))).toBe('Unused')
    // Rows in the sheet carry the same whereabouts, and the unused man is among them
    const sheet = slotSheet(g, u, 'st')!
    const rows = [...sheet.cover, ...sheet.outOfPosition]
    for (const o of rows) expect(o.where).toEqual(whereabouts(g, o.p.id))
    expect(rows.find((o) => o.p.id === unused)?.where.kind).toBe('unused')
    expect(formation.slots.length).toBe(11)
    // An unused man put in a slot pushes the occupant to the bench, as a bench man does
    const st = g.lineup.st
    expect(assignmentNote(g, u, unused, 'st')).toBe(`${surname((g.customPlayers[unused] ?? u.index[unused])!.name)} in at ST, ${surname((g.customPlayers[st] ?? u.index[st])!.name)} to the bench`)
    assignPlayer(g, u, unused, 'st')
    expect(g.lineup.st).toBe(unused)
    expect(g.bench).toContain(st)
    expect(g.bench).not.toContain(unused)
  })

  it('greys out exactly the men lineupProblems would refuse: injured or suspended', () => {
    const g = seasonGame()
    const bench = g.bench.slice(0, 4)
    g.squad[bench[0]].injury = { description: 'Hamstring', weeksOut: 3 }
    g.squad[bench[1]].suspension = 1
    const target = 'cm1'
    const sheet = slotSheet(g, u, target)!
    const rows = [...sheet.cover, ...sheet.outOfPosition]
    expect(rows.find((o) => o.p.id === bench[0])?.unavailable).toBe('injured')
    expect(rows.find((o) => o.p.id === bench[1])?.unavailable).toBe('suspended')
    expect(rows.filter((o) => o.unavailable).length).toBe(Object.values(g.squad).filter((s) => s.injury || s.suspension > 0).length - (sheet.occupant?.unavailable ? 1 : 0))
    expect(lineupProblems(g, u)).toEqual([])
    for (const o of rows) {
      const after = clone(g)
      assignPlayer(after, u, o.p.id, target)
      const flagged = lineupProblems(after, u).some((msg) => msg.includes(o.p.name))
      expect(flagged).toBe(!!o.unavailable)
    }
  })

  it('agrees with auto-pick: a starter is out of position only when every fit, available cover man is starting elsewhere', () => {
    const cases: Game[] = ['auto-a', 'auto-b', 'auto-c'].map((seed) => seasonGame(seed))
    // Force a gap: injure every centre-back cover man but one, so one CB slot must go out of position
    const short = seasonGame('auto-short')
    const cbCover = squadPlayers(short, u).filter((x) => canCover(x.p, 'CB', 'accomplished'))
    for (const x of cbCover.slice(1)) short.squad[x.p.id].injury = { description: 'Knock', weeksOut: 2 }
    cases.push(short)
    let outOfPosition = 0
    for (const g of cases) {
      autoPick(g, u, false)
      for (const slot of getFormation(g.tactics.formationId).slots) {
        const sheet = slotSheet(g, u, slot.id)!
        expect(sheet.occupant).toBeDefined()
        expect(sheet.occupant!.unavailable).toBeUndefined()
        if (canCover(sheet.occupant!.p, slot.position, 'accomplished')) continue
        outOfPosition++
        for (const o of sheet.cover.filter((c) => !c.unavailable)) expect(o.where.kind).toBe('starting')
      }
    }
    expect(outOfPosition).toBeGreaterThan(0)
  })

  it('labels repeated positions left, centre and right', () => {
    const f433 = getFormation('4-3-3')
    expect(slotLabel(f433, f433.slots.find((s) => s.id === 'gk')!)).toBe('GK')
    expect(slotLabel(f433, f433.slots.find((s) => s.id === 'cb1')!)).toBe('left CB')
    expect(slotLabel(f433, f433.slots.find((s) => s.id === 'cb2')!)).toBe('right CB')
    const f352 = getFormation('3-5-2')
    const cbs = f352.slots.filter((s) => s.position === 'CB').sort((a, b) => a.x - b.x)
    expect(cbs.map((s) => slotLabel(f352, s))).toEqual(['left CB', 'centre CB', 'right CB'])
  })

  it('words the move before it happens: in at RW, the displaced man to the bench or to the vacated slot', () => {
    const g = seasonGame()
    const get = (id: string) => (g.customPlayers[id] ?? u.index[id])!
    const last = (id: string) => surname(get(id).name)
    expect(['Bukayo Saka', 'Kevin De Bruyne', 'Virgil van Dijk', 'K. Phillips', 'Rodri'].map(surname)).toEqual(['Saka', 'De Bruyne', 'van Dijk', 'Phillips', 'Rodri'])
    const benchMan = g.bench[0]
    const rw = g.lineup.rw
    expect(assignmentNote(g, u, benchMan, 'rw')).toBe(`${last(benchMan)} in at RW, ${last(rw)} to the bench`)
    const cm = g.lineup.cm1
    expect(assignmentNote(g, u, cm, 'rw')).toBe(`${last(cm)} in at RW, ${last(rw)} to left CM`)
    expect(assignmentNote(g, u, rw, 'rw')).toBe(`${last(rw)} stays at RW`)
    expect(assignmentNote(g, u, rw, 'bench')).toBe(`${last(rw)} to the bench, RW is empty`)
    const empty = clone(g)
    delete empty.lineup.rw
    expect(assignmentNote(empty, u, benchMan, 'rw')).toBe(`${last(benchMan)} in at RW`)
    expect(assignmentNote(empty, u, cm, 'rw')).toBe(`${last(cm)} in at RW, left CM is empty`)
  })

  it('playInSlot assigns through the store, swaps with the occupant and toasts what moved', () => {
    const g = seasonGame()
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, toast: null, screen: 'game' })
    const benchMan = g.bench[0]
    const rw = g.lineup.rw
    const cm = g.lineup.cm1
    useStore.getState().playInSlot(benchMan, 'rw')
    let s = useStore.getState()
    expect(s.game!.lineup.rw).toBe(benchMan)
    expect(s.game!.bench).toContain(rw)
    expect(s.toast).toContain('to the bench')
    // Picking a starter from another slot is the old two-tap swap
    useStore.getState().playInSlot(cm, 'rw')
    s = useStore.getState()
    expect(s.game!.lineup.rw).toBe(cm)
    expect(s.game!.lineup.cm1).toBe(benchMan)
    expect(s.toast).toMatch(/in at RW, .+ to left CM$/)
    useStore.getState().playInSlot(cm, 'bench')
    s = useStore.getState()
    expect(s.game!.lineup.rw).toBeUndefined()
    expect(s.game!.bench).toContain(cm)
    expect(s.toast).toMatch(/to the bench, RW is empty$/)
  })
})

describe('the Draft slot chips', () => {
  it('offer exactly the eligible open slots, rated there, and every chip is a pick the draft accepts', () => {
    let checked = 0
    for (let n = 0; n < 12 && checked < 4; n++) {
      const g = createGame(settings(`chips-${n}`))
      const d = g.draft!
      const rng = Rng.fromState(g.rngState)
      const cs = spin(u, d, rng)
      for (const p of cs.squad) {
        const slots = eligibleSlots(d, p)
        if (slots.length < 2) continue
        const chips = draftSlotChoices(d, p)
        expect(chips.map((c) => c.slotId)).toEqual(slots.map((s) => s.id))
        for (const c of chips) {
          expect(c.rating).toBe(Math.round(ratingAt(p, c.position)))
          expect(c.fit).toBe(p.positions.includes(c.position) ? 'fits' : 'can cover')
          const copy = JSON.parse(JSON.stringify(d)) as typeof d
          pick(u, copy, p.id, c.slotId)
          expect(copy.lineup[c.slotId]).toBe(p.id)
        }
        checked++
        break
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
