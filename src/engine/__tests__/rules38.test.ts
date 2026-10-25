import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import {
  DIFFICULTY_RESPINS,
  QUICK_RULES,
  SEASON_RULES,
  autoDraft,
  canSpin,
  canUse,
  chooseSlot,
  difficultyOf,
  draftModeOf,
  eligibleSlots,
  isComplete,
  newDraft,
  openSlots,
  pick,
  positionFirst,
  ratingsHidden,
  ratingsModeOf,
  respin,
  rulesTags,
  spin,
  spinnableSlots,
  targetSlot,
  wheelPool,
  withDifficulty,
  type DraftRules,
  type DraftState,
} from '../draft'
import { isRulesDiff } from '../challenge'
import { primeLookup, primeOf, primed } from '../prime'
import { ERA_PRESETS, eraCount, eraRange } from '../era'
import { getFormation } from '../formations'
import { canCover } from '../positions'
import type { ClubSeason, Formation } from '../types'
import type { LoadedUniverse } from '../universe'

const POSITION: DraftRules = { ...QUICK_RULES, draftMode: 'position' }

describe('difficulty', () => {
  it('gives easy, normal and hard 3, 1 and 0 re-spins', () => {
    expect(DIFFICULTY_RESPINS).toEqual({ easy: 3, normal: 1, hard: 0 })
    for (const [diff, n] of [['easy', 3], ['normal', 1], ['hard', 0]] as const) {
      const rules = withDifficulty(QUICK_RULES, diff)
      expect(rules.respins).toBe(n)
      expect(difficultyOf(rules)).toBe(diff)
      expect(rules.hardMode).toBe(diff === 'hard')
      expect(newDraft(getFormation('4-3-3'), rules).respinsLeft).toBe(n)
    }
  })
  it('defaults Quick Draft to normal and Season to easy', () => {
    expect(difficultyOf(QUICK_RULES)).toBe('normal')
    expect(QUICK_RULES.respins).toBe(1)
    expect(difficultyOf(SEASON_RULES)).toBe('easy')
    expect(SEASON_RULES.respins).toBe(3)
  })
  it('runs out of re-spins at the budget', () => {
    const u = loadTestUniverse()
    const d = newDraft(getFormation('4-3-3'), withDifficulty(QUICK_RULES, 'normal'))
    const rng = new Rng('respin-budget')
    spin(u, d, rng)
    respin(u, d, rng)
    expect(d.respinsLeft).toBe(0)
    expect(() => respin(u, d, rng)).toThrow('No re-spins left')
    const hard = newDraft(getFormation('4-3-3'), withDifficulty(QUICK_RULES, 'hard'))
    spin(u, hard, rng)
    expect(() => respin(u, hard, rng)).toThrow('No re-spins left')
  })
  it('reads an older hard-mode rule as hard, whatever difficulty sits beside it', () => {
    const legacy: DraftRules = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: true, uniqueClubSeasons: true }
    expect(difficultyOf(legacy)).toBe('hard')
    expect(difficultyOf({ ...legacy, hardMode: false })).toBe('normal')
    expect(difficultyOf({ ...QUICK_RULES, hardMode: true })).toBe('hard')
  })
})

describe('show ratings', () => {
  it('hides ratings on hard, with the toggle off, and on an older hard-mode save', () => {
    expect(ratingsHidden(QUICK_RULES)).toBe(false)
    expect(ratingsHidden({ ...QUICK_RULES, showRatings: false })).toBe(true)
    const hard = withDifficulty(QUICK_RULES, 'hard')
    expect(hard.showRatings).toBe(false)
    // Hard always hides, even if the toggle is turned back on afterwards
    expect(ratingsHidden({ ...hard, showRatings: true })).toBe(true)
    expect(ratingsHidden({ ...QUICK_RULES, hardMode: true })).toBe(true)
    // Leaving hard restores the toggle's own value
    expect(withDifficulty({ ...QUICK_RULES, showRatings: false }, 'easy').showRatings).toBe(false)
    expect(withDifficulty(QUICK_RULES, 'easy').showRatings).toBe(true)
  })
})

describe('rules tags', () => {
  it('names only what differs from the defaults', () => {
    expect(rulesTags(QUICK_RULES)).toEqual([])
    expect(rulesTags({ ...withDifficulty(QUICK_RULES, 'hard'), draftMode: 'position', ratings: 'prime' })).toEqual(['Hard', 'Position First', 'Prime ratings'])
    expect(rulesTags(withDifficulty(QUICK_RULES, 'easy'))).toEqual(['Easy'])
    expect(rulesTags({ ...QUICK_RULES, showRatings: false })).toEqual(['Blind'])
    // Season mode's default is easy, so it is not named there
    expect(rulesTags(SEASON_RULES, SEASON_RULES)).toEqual([])
    expect(rulesTags(withDifficulty(SEASON_RULES, 'normal'), SEASON_RULES)).toEqual(['Normal'])
  })
  it('reads absent options as the defaults', () => {
    const legacy: DraftRules = { squadSize: 11, respins: 2, minFit: 'accomplished', hardMode: false, uniqueClubSeasons: true }
    expect(draftModeOf(legacy)).toBe('squad')
    expect(ratingsModeOf(legacy)).toBe('season')
    expect(rulesTags(legacy)).toEqual([])
  })
})

/** Whether a club-season holds someone the draft could put in this slot. */
function hasUsableFor(d: DraftState, cs: ClubSeason, slot: Formation['slots'][number]): boolean {
  return cs.squad.some((p) => !d.takenPlayers.includes(p.playerId) && (!d.rules.onlyNation || p.nationality === d.rules.onlyNation) && canCover(p, slot.position, d.rules.minFit))
}

/**
 * Drive a Position First draft by hand: a slot chosen by the seed, a spin, and the best player for
 * it, re-spinning now and then. Checks every landing against the slot and every pick against it.
 */
function positionDraft(u: LoadedUniverse, rules: DraftRules, formationId: string, seed: string): DraftState {
  const d = newDraft(getFormation(formationId), rules)
  const rng = new Rng(seed)
  const chooser = new Rng(`${seed}-chooser`)
  let guard = 0
  while (!isComplete(d) && guard++ < 60) {
    expect(positionFirst(d)).toBe(true)
    expect(() => spin(u, d, rng)).toThrow('Choose a slot first')
    const slots = spinnableSlots(u, d)
    expect(slots.length).toBeGreaterThan(0)
    const slot = chooser.pick(slots)
    chooseSlot(u, d, slot.id)
    expect(targetSlot(d)?.id).toBe(slot.id)
    let cs = spin(u, d, rng)
    expect(hasUsableFor(d, cs, slot)).toBe(true)
    for (const c of wheelPool(u, d)) expect(hasUsableFor(d, c, slot)).toBe(true)
    // The slot is locked while the spin shows
    expect(() => chooseSlot(u, d, slot.id)).toThrow('Pick a player')
    if (d.respinsLeft > 0 && chooser.next() < 0.5) {
      cs = respin(u, d, rng)
      // The re-spin keeps the chosen slot and lands on a club that can fill it too
      expect(targetSlot(d)?.id).toBe(slot.id)
      expect(hasUsableFor(d, cs, slot)).toBe(true)
      expect(d.history.at(-1)?.target).toBe(slot.id)
    }
    const usable = cs.squad.filter((p) => canUse(d, p))
    expect(usable.length).toBeGreaterThan(0)
    const p = usable.sort((a, b) => b.overall - a.overall)[0]
    expect(eligibleSlots(d, p).map((s) => s.id)).toEqual([slot.id])
    // Any other open slot is refused, even one he could cover
    const other = openSlots(d).find((s) => s.id !== slot.id && canCover(p, s.position, d.rules.minFit))
    if (other) expect(() => pick(u, d, p.id, other.id)).toThrow('slot you chose')
    pick(u, d, p.id, slot.id)
    expect(d.lineup[slot.id]).toBe(p.id)
    expect(d.target).toBeNull()
  }
  return d
}

describe('position first', () => {
  const u = loadTestUniverse()

  it('never lands on a club without a usable player for the chosen slot, and the pick goes there (40 seeds, twists on)', () => {
    for (let i = 0; i < 40; i++) {
      const d = positionDraft(u, POSITION, ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1'][i % 4], `pos-first-${i}`)
      expect(isComplete(d)).toBe(true)
      expect(Object.keys(d.lineup).length).toBe(11)
      expect(new Set(d.usedClubSeasons).size).toBe(11)
    }
  })

  it('works with one club, reopening used club-seasons when a slot needs them', () => {
    for (let i = 0; i < 6; i++) {
      const d = positionDraft(u, { ...POSITION, onlyClub: 'burnley', fromSeason: 2020 }, '4-3-3', `pos-club-${i}`)
      expect(isComplete(d)).toBe(true)
      for (const id of Object.values(d.lineup)) expect(u.index[id].clubId).toBe('burnley')
    }
  })

  it('works with one nation across two leagues', () => {
    const two = loadTestUniverse(['england', 'spain'])
    for (let i = 0; i < 6; i++) {
      const d = positionDraft(two, { ...POSITION, onlyNation: 'BRA' }, '4-3-3', `pos-nation-${i}`)
      expect(isComplete(d)).toBe(true)
      for (const id of Object.values(d.lineup)) expect(two.index[id].nationality).toBe('BRA')
    }
  })

  it('drops a slot nobody left can fill and refuses to choose it', () => {
    // A one-club wheel of a single season: once its goalkeepers are drafted the GK slot cannot be spun
    const d = newDraft(getFormation('4-3-3'), { ...POSITION, onlyClub: 'arsenal', fromSeason: 2024, toSeason: 2024 })
    const cs = u.clubSeasonByKey['arsenal@2024']
    const gkSlot = d.formation.slots.find((s) => s.position === 'GK')!
    for (const p of cs.squad) if (canCover(p, 'GK', d.rules.minFit)) d.takenPlayers.push(p.playerId)
    expect(spinnableSlots(u, d).map((s) => s.id)).not.toContain(gkSlot.id)
    expect(() => chooseSlot(u, d, gkSlot.id)).toThrow('No club left on the wheel can fill GK')
    expect(canSpin(u, d)).toBe(true)
  })

  it('auto-completes into chosen slots deterministically, keeping a slot already chosen', () => {
    const a = newDraft(getFormation('4-3-3'), POSITION)
    const b = newDraft(getFormation('4-3-3'), POSITION)
    const st = a.formation.slots.find((s) => s.position === 'ST')!
    chooseSlot(u, a, st.id)
    chooseSlot(u, b, st.id)
    autoDraft(u, a, new Rng('pos-auto'))
    autoDraft(u, b, new Rng('pos-auto'))
    expect(isComplete(a)).toBe(true)
    expect(a.lineup).toEqual(b.lineup)
    expect(a.history[0].slotId).toBe(st.id)
    for (const h of a.history) if (h.pickedId) expect(h.slotId).not.toBeNull()
  })

  it('leaves Squad First as it was: no slot to choose, the spin takes any open slot', () => {
    const d = newDraft(getFormation('4-3-3'), QUICK_RULES)
    expect(positionFirst(d)).toBe(false)
    expect(spinnableSlots(u, d)).toEqual([])
    expect(() => chooseSlot(u, d, d.formation.slots[0].id)).toThrow('Position First')
    const cs = spin(u, d, new Rng('squad-first'))
    expect(cs.squad.some((p) => canUse(d, p))).toBe(true)
  })

  it('fills the bench squad first once the XI is full', () => {
    const d = newDraft(getFormation('4-3-3'), { ...POSITION, squadSize: 13 })
    autoDraft(u, d, new Rng('pos-bench'))
    expect(isComplete(d)).toBe(true)
    expect(d.bench.length).toBe(2)
    expect(positionFirst(d)).toBe(false)
  })
})

describe('prime ratings', () => {
  const u = loadTestUniverse(['england', 'spain'])

  it('rates every player-season at the maximum overall over his seasons, never below the season', () => {
    const best = new Map<string, number>()
    for (const p of Object.values(u.index)) best.set(p.playerId, Math.max(best.get(p.playerId) ?? 0, p.overall))
    for (const p of Object.values(u.index)) {
      const q = primed(u, p)
      expect(q.overall).toBeGreaterThanOrEqual(p.overall)
      expect(q.overall).toBe(best.get(p.playerId))
      expect(primeOf(u, p.playerId)!.overall).toBe(best.get(p.playerId))
      // Same player-season: id, club, season and positions stay
      expect(q.id).toBe(p.id)
      expect(q.positions).toEqual(p.positions)
    }
  })

  it('takes the attributes of the best season and caches one object per id', () => {
    const mover = Object.values(u.index).find((p) => primeOf(u, p.playerId)!.overall > p.overall + 5)!
    const top = primeOf(u, mover.playerId)!
    const q = primed(u, mover)
    expect(q.attributes).toEqual(top.attributes)
    expect(q).not.toBe(mover)
    expect(primed(u, mover)).toBe(q)
    expect(primeLookup(u, mover.id)).toBe(q)
    expect(primeLookup(u, 'nobody@2000@x')).toBeUndefined()
    // The season of his prime is its own prime
    expect(primed(u, top)).toBe(top)
    // The universe itself is untouched
    expect(u.index[mover.id].overall).toBe(mover.overall)
  })

  it('looks across every loaded league: a player who moved has his best season from either', () => {
    const england = loadTestUniverse()
    let found = false
    for (const p of Object.values(u.index)) {
      if (!england.index[p.id]) continue
      const e = primeOf(england, p.playerId)!.overall
      const all = primeOf(u, p.playerId)!.overall
      expect(all).toBeGreaterThanOrEqual(e)
      if (all > e) found = true
    }
    expect(found).toBe(true)
  })
})

describe('era presets', () => {
  const u = loadTestUniverse()
  it('maps each preset onto season bounds, never before the data starts', () => {
    expect(ERA_PRESETS.map((p) => p.label)).toEqual(['All-time', '2000s+', '2010s+', 'Modern (2016+)'])
    expect(eraRange('all', 2008, 2026)).toEqual({})
    expect(eraRange('2000s', 2008, 2026)).toEqual({ fromSeason: 2008 })
    expect(eraRange('2010s', 2008, 2026)).toEqual({ fromSeason: 2010 })
    expect(eraRange('modern', 2008, 2026)).toEqual({ fromSeason: 2016 })
    expect(eraRange('custom', 2008, 2026, { from: 2015, to: 2012 })).toEqual({ fromSeason: 2012, toSeason: 2015 })
    expect(eraRange('custom', 2008, 2026, { from: 1990, to: 2030 })).toEqual({ fromSeason: 2008, toSeason: 2026 })
  })
  it('counts "N of M seasons" for the wheel leagues', () => {
    expect(eraCount(u, ['england'], {})).toEqual({ n: 19, m: 19, label: '19 of 19 seasons', caption: '2008-09 to 2026-27' })
    expect(eraCount(u, ['england'], eraRange('2000s', 2008, 2026)).label).toBe('19 of 19 seasons')
    expect(eraCount(u, ['england'], eraRange('2010s', 2008, 2026)).label).toBe('17 of 19 seasons')
    expect(eraCount(u, ['england'], eraRange('modern', 2008, 2026))).toEqual({ n: 11, m: 19, label: '11 of 19 seasons', caption: '2016-17 to 2026-27' })
    expect(eraCount(u, ['england'], { fromSeason: 2012, toSeason: 2015 }).label).toBe('4 of 19 seasons')
    expect(eraCount(u, ['england'], { fromSeason: 2019, toSeason: 2019 }).caption).toBe('2019-20')
    expect(eraCount(u, ['england'], { fromSeason: 2030 })).toEqual({ n: 0, m: 19, label: '0 of 19 seasons', caption: 'No seasons' })
  })
})

describe('challenge links carry the new rules', () => {
  it('accepts the four options with their values and refuses anything else', () => {
    expect(isRulesDiff({ difficulty: 'hard', showRatings: false, draftMode: 'position', ratings: 'prime' })).toBe(true)
    for (const bad of [{ difficulty: 'insane' }, { showRatings: 'no' }, { draftMode: 'slot' }, { ratings: 'peak' }]) expect(isRulesDiff(bad), JSON.stringify(bad)).toBe(false)
  })
})
