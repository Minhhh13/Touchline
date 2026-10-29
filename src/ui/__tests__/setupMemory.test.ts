import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultChoices, isDefault, loadChoices, readChoices, saveChoices, setupKey } from '../setupMemory'
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { DEFAULT_CAP_CHOICE } from '@game/logic/cap'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { setup } from '../i18n/en/setup'

/** A stand-in for the browser's storage (the tests run in node). */
function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return { get length() { return m.size }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => void m.delete(k), setItem: (k, v) => void m.set(k, String(v)) }
}

describe('setupMemory: the setup remembers this viewer’s last choices', () => {
  const g = globalThis as { localStorage?: Storage }
  let before: Storage | undefined
  beforeEach(() => {
    before = g.localStorage
    g.localStorage = fakeStorage()
  })
  afterEach(() => {
    g.localStorage = before
  })

  it('the defaults are the screen’s old defaults, per mode', () => {
    const q = defaultChoices('quick')
    expect(q).toMatchObject({ formationId: '4-3-3', leagueId: 'england', difficulty: QUICK_RULES.difficulty, showRatings: true, draftMode: 'squad', ratingsMode: 'prime', eraPreset: 'all', benchPicks: 1, modes: [], powerUps: false, managerChoice: 'spin', endCase: true, twistsChoice: null, chain: false, january: true, opposition: 'calibrated', squadSize: 18 })
    expect(q.cap).toEqual(DEFAULT_CAP_CHOICE)
    expect(defaultChoices('season').difficulty).toBe(SEASON_RULES.difficulty)
    expect(isDefault(q, 'quick')).toBe(true)
  })

  it('a first visit, or storage that throws, reads as nothing remembered', () => {
    expect(loadChoices('quick')).toBeNull()
    g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(loadChoices('quick')).toBeNull()
    expect(() => saveChoices('quick', { ...defaultChoices('quick'), chain: true })).not.toThrow()
  })

  it('round-trips the choices Start was pressed with, per mode, and forgets them on a reset to defaults', () => {
    const mine = { ...defaultChoices('quick'), formationId: '3-5-2', modes: ['crazy' as const, 'gamble' as const], cap: { preset: 'moneyball' as const, custom: 180 }, benchPicks: 3, eraPreset: 'custom' as const, customEra: [2010, 2015] as [number, number] }
    saveChoices('quick', mine)
    expect(loadChoices('quick')).toEqual(mine)
    expect(loadChoices('season')).toBeNull()
    saveChoices('quick', defaultChoices('quick'))
    expect(localStorage.getItem(setupKey('quick'))).toBeNull()
  })

  it('reads a damaged value field by field: what does not read as a choice takes the default', () => {
    const d = defaultChoices('quick')
    expect(readChoices('nonsense', 'quick')).toEqual(d)
    expect(readChoices([1, 2], 'quick')).toEqual(d)
    const r = readChoices({ formationId: '9-9-9', leagueId: 'Not A League!', difficulty: 'impossible', modes: ['crazy', 'crazy', 'warp'], benchPicks: 9, eraPreset: 'custom', customEra: null, squadSize: 40, cap: { preset: 'gold', custom: 'x' }, managerChoice: 'spin', chain: 'yes' }, 'quick')
    expect(r.formationId).toBe('4-3-3')
    expect(r.leagueId).toBe('england')
    expect(r.difficulty).toBe('normal')
    expect(r.modes).toEqual(['crazy'])
    expect(r.benchPicks).toBe(1)
    // A custom era with no seasons is All-time
    expect(r.eraPreset).toBe('all')
    expect(r.customEra).toBeNull()
    expect(r.squadSize).toBe(18)
    expect(r.cap).toEqual(DEFAULT_CAP_CHOICE)
    expect(r.chain).toBe(false)
    // A reversed custom era is put in order
    expect(readChoices({ eraPreset: 'custom', customEra: [2015, 2010] }, 'quick').customEra).toEqual([2010, 2015])
  })
})

describe('the Setup and Draft words of round 10', () => {
  it('the re-spin button says what is left and what it costs', () => {
    const t = translator(draft)
    expect(t('respin', { n: 1 })).toBe('Re-spin · 1 left')
    expect(t('respin', { n: 0 })).toBe('No re-spins left')
    expect(t('respinTip', { n: 2 })).toContain('2 re-spins left for the whole draft')
    expect(t('respinTip', { n: 1 })).toContain('it does not cost a pick')
  })
  it('the team name’s second button is Shuffle', () => {
    expect(translator(setup)('randomise')).toBe('Shuffle')
  })
})
