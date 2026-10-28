/**
 * The r8 engine audit's fixes, one reproduction each. None of them moves a draw of a default game: every pin, noMove,
 * dailyPin and marketPin suite passes unchanged beside them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { dailyDateOf, previousDailySeed, Rng } from '../rng'
import { computeTable } from '../season'
import { defaultStatuses } from '../status'
import { bottomHalf, newDraft, spin, spinOdds, QUICK_RULES, type DraftState } from '../draft'
import { getFormation } from '../formations'
import { ICONS_CHANCE, isIcons } from '../icons'
import { cleanName } from '../challenge'
import { rollEvent, type EventContext } from '../events'
import { advanceWindow, type MarketContext, type Window } from '../market'
import { newSquadPlayer } from '../season'
import type { ClubSeason, PlayerSeason } from '../types'
import type { LoadedUniverse } from '../universe'

const original = String.prototype.localeCompare

/** Run as a device whose language is `locale` would: `localeCompare` with no locale given collates in it. */
function asDeviceIn(locale: string): void {
  String.prototype.localeCompare = function (this: string, that: string, locales?: string | string[], options?: Intl.CollatorOptions) {
    return original.call(this, that, locales ?? locale, options)
  } as typeof String.prototype.localeCompare
}

describe('ties are broken the same on a device in any language (engine sorts collate in English, never the default locale)', () => {
  afterEach(() => {
    String.prototype.localeCompare = original
  })

  it('a Lithuanian device sorts "yeti" before "jaguar"; the English order is the other way', () => {
    asDeviceIn('lt')
    expect('yeti'.localeCompare('jaguar')).toBeLessThan(0)
    expect('yeti'.localeCompare('jaguar', 'en')).toBeGreaterThan(0)
  })

  it('a league table level on points, difference and goals orders its clubs as in English', () => {
    const english = computeTable([], ['yeti', 'jaguar', 'ibis']).map((r) => r.teamId)
    expect(english).toEqual(['ibis', 'jaguar', 'yeti'])
    asDeviceIn('lt')
    expect(computeTable([], ['yeti', 'jaguar', 'ibis']).map((r) => r.teamId)).toEqual(english)
  })

  it('squad statuses tied on rating split by id as in English', () => {
    // Five tied at the top: the fifth by id is first team, not key
    const squad = ['yak', 'jay', 'ibex', 'hare', 'gnu'].map((id) => ({ id, overall: 80, age: 27 }))
    const english = defaultStatuses(squad)
    expect(english.yak).toBe('first-team')
    asDeviceIn('lt')
    expect(defaultStatuses(squad)).toEqual(english)
  })

  it("Underdog's bottom half of a league without a table splits a tie as in English", () => {
    const player = (id: string, overall: number): PlayerSeason => ({ id, playerId: id, overall } as PlayerSeason)
    const cs = (clubId: string, overall: number): ClubSeason => ({ clubId, leagueId: 'nowhere', season: 2015, position: 0, squad: [player(`${clubId}-1`, overall)] } as ClubSeason)
    const english = { tables: {}, clubSeasons: [cs('yeti', 80), cs('jaguar', 80), cs('zebu', 60)] } as unknown as LoadedUniverse
    const lithuanian = { tables: {}, clubSeasons: [cs('yeti', 80), cs('jaguar', 80), cs('zebu', 60)] } as unknown as LoadedUniverse
    expect(bottomHalf(english, english.clubSeasons[0])).toBe(true)
    expect(bottomHalf(english, english.clubSeasons[1])).toBe(false)
    asDeviceIn('lt')
    expect(bottomHalf(lithuanian, lithuanian.clubSeasons[0])).toBe(true)
    expect(bottomHalf(lithuanian, lithuanian.clubSeasons[1])).toBe(false)
  })
})

describe('a daily seed for a day that does not exist is not a Daily', () => {
  it('refuses 30 February and month 13 instead of filing them under another day', () => {
    expect(dailyDateOf('daily-2026-02-30')).toBeNull()
    expect(dailyDateOf('daily-2026-13-01')).toBeNull()
    expect(previousDailySeed('daily-2026-02-30')).toBeNull()
    expect(dailyDateOf('daily-2028-02-29')?.toISOString().slice(0, 10)).toBe('2028-02-29')
    expect(previousDailySeed('daily-2026-03-01')).toBe('daily-2026-02-28')
  })
})

describe('the Icons odds match the spin when the Teammate Chain breaks', () => {
  it('shows no Icons chance on a spin whose Icons roll is checked against a chain no icon belongs to', () => {
    const u = loadTestUniverse()
    const rules = { ...QUICK_RULES, chain: true, modes: ['gamble' as const], leagues: ['england'] }
    const base = newDraft(getFormation('4-3-3'), rules, 'icons-chain')
    // After a pick whose only "teammate" is nobody on the wheel: the next spin breaks the chain
    base.chainFrom = u.clubSeasons[0].squad[0].id
    base.chainMates = ['nobody-on-the-wheel']
    let landed = 0
    for (let i = 0; i < 1500; i++) {
      const d = JSON.parse(JSON.stringify(base)) as DraftState
      d.gambleRng = new Rng(`icons-chain-${i}`).getState()
      spin(u, d, new Rng(`main-${i}`))
      if (isIcons(d.current)) landed++
    }
    // The spin never lands on the Icons here (expected 15 at the shown 1%), so the odds must say 0
    expect(landed).toBe(0)
    expect(spinOdds(u, base).icons).toBe(0)
    // Without the chain the same draft shows the Icons chance and the spin does land there
    const free = { ...base, chainMates: undefined, chainFrom: undefined }
    expect(spinOdds(u, free).icons).toBe(ICONS_CHANCE)
  })
})

describe('a challenge name is cut on a whole character', () => {
  it('never leaves half an emoji at the 24-character cut', () => {
    const name = cleanName(`${'a'.repeat(23)}😀b`)
    expect(name.length).toBeLessThanOrEqual(24)
    const last = name.charCodeAt(name.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    expect(name).toBe('a'.repeat(23))
    expect(cleanName(`${'a'.repeat(22)}😀b`)).toBe(`${'a'.repeat(22)}😀`)
  })
})

describe('event bodies say ordinals in English', () => {
  it('never "1th", "2th", "3th", "21th" or "22th" in the job and board questions', () => {
    const bodies = new Set<string>()
    for (let i = 0; i < 400; i++) {
      for (const [position, boardTarget] of [[21, 1], [22, 2], [17, 3], [12, 1]] as const) {
        const ctx: EventContext = { rng: new Rng(`ordinal-${i}`), matchweek: 15, expiring: [], recentForm: [], beatRival: false, squad: [], unbeaten: false, wins: 2, losses: 10, position, boardTarget, confidence: 30, nextOpponentIsRival: false, budget: 10 }
        const ev = rollEvent(ctx)
        if (ev && (ev.id === 'press-job' || ev.id === 'board')) bodies.add(ev.body)
      }
    }
    expect([...bodies].some((b) => b.includes('21st'))).toBe(true)
    for (const b of bodies) expect(b).not.toMatch(/\b(1|2|3|21|22)th\b/)
  })
})

describe('a market day with no other club in the league', () => {
  it('never throws on an offer for one of our players (no buyer, no offer)', () => {
    const u = loadTestUniverse()
    const star = u.clubSeasons.flatMap((cs) => cs.squad).find((p) => p.overall >= 88)!
    for (let i = 0; i < 60; i++) {
      const ctx: MarketContext = { u, rng: new Rng(`no-clubs-${i}`), ownedPlayerIds: new Set([star.playerId]), leagueSeason: 2020, priceLevel: 1 }
      const w: Window = { kind: 'january', day: 0, days: 7, listings: [], offers: [], log: [] }
      expect(() => advanceWindow(ctx, w, [{ p: star, s: newSquadPlayer(star.id), listed: true }], [])).not.toThrow()
      expect(w.offers).toEqual([])
    }
  })
})
