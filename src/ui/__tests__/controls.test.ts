import { describe, expect, it } from 'vitest'
import { getFormation } from '@engine/formations'
import { advanceMatch, beginMatch, canChangeInPlay, changeInPlay, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, subsMade, type InPlayOutcome } from '@engine/match'
import { feedFromLive } from '@engine/matchFeed'
import { Rng } from '@engine/rng'
import type { Tactics } from '@engine/types'
import {
  appliedText,
  barClock,
  canEdit,
  clockLabel,
  closeDrawer,
  CLOSED_DRAWER,
  conditionBand,
  draftChanges,
  emptyDraft,
  highlightedMan,
  instructionDiff,
  landing,
  moraleBand,
  nextSelection,
  openDrawer,
  PHONE_TABS,
  phoneTabs,
  queueIntoDraft,
  readTab,
  refusalText,
  setPiecesDiffer,
  shoutsOpen,
  stopSubCap,
  stripCards,
  TAB_KEY,
  tabAfter,
  tabKey,
  tacticsChanged,
  writeTab,
} from '../matchday/controls'
import { keyItems } from '../matchday/model'
import { WIDGET_IDS, type ChoiceStorage } from '../matchday/widgetIds'
import { positionCode } from '../match/shirts'
import { getName, sides, u } from './feeds'

const base: Tactics = { formationId: '4-3-3', mentality: 'balanced', pressing: 'mid', tempo: 'standard', width: 'standard', defensiveLine: 'standard', passing: 'mixed', roles: {} }

function memory(seed: Record<string, string> = {}): ChoiceStorage & { data: Record<string, string> } {
  const data = { ...seed }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

describe('tactics diff', () => {
  it('names only the instructions that changed, in the engine order', () => {
    expect(instructionDiff(base, base)).toEqual([])
    expect(instructionDiff(base, { ...base, width: 'wide', mentality: 'attacking' })).toEqual(['mentality', 'width'])
    // Formation and roles are not in-play instructions
    expect(instructionDiff(base, { ...base, formationId: '4-4-2', roles: { st: 'tm' } })).toEqual([])
  })

  it('treats a missing and an empty set-piece taker as the same', () => {
    expect(setPiecesDiffer(undefined, {})).toBe(false)
    expect(setPiecesDiffer({ penalties: undefined }, {})).toBe(false)
    expect(setPiecesDiffer({ penalties: 'a' }, {})).toBe(true)
    expect(tacticsChanged(base, { ...base, setPieces: { corners: 'x' } })).toBe(true)
    expect(tacticsChanged(base, { ...base, setPieces: {} })).toBe(false)
  })
})

describe('clock label', () => {
  it('reads the t-th minute and its fraction as (t - 1):ss', () => {
    expect(clockLabel(45.12)).toBe('44:07')
    expect(clockLabel(1)).toBe('00:00')
    expect(clockLabel(1.5)).toBe('00:30')
    expect(clockLabel(0)).toBe('00:00')
    expect(clockLabel(0.4)).toBe('00:00')
    expect(clockLabel(12.999)).toBe('11:59')
  })

  it('shows the added time once the board is up', () => {
    expect(clockLabel(91, 4)).toBe('90:00 (+4)')
    expect(clockLabel(90, 4)).toBe('89:00 (+4)')
    expect(clockLabel(89.5, 4)).toBe('88:30')
    expect(clockLabel(91, 0)).toBe('90:00')
  })

  it('names the stops and the whistle', () => {
    const s = { atStop: false, stopAt: 45, finished: false, final: false, addedTime: 0 }
    expect(barClock(45, { ...s, atStop: true, finished: true })).toBe('HALF TIME')
    expect(barClock(70, { ...s, stopAt: 70, atStop: true, finished: true })).toBe('70 MINUTES')
    expect(barClock(94, { ...s, stopAt: 94, finished: true, final: true, addedTime: 4 })).toBe('FULL TIME')
    expect(barClock(30.5, s)).toBe('29:30')
  })
})

describe('where a change lands', () => {
  const ok = { ok: true, nextStop: null } as const
  it('says now, at the stop, queued, too late or replay', () => {
    expect(landing({ replay: true, atStop: false, stopAt: 45, check: ok })).toMatchObject({ kind: 'replay', text: 'Replay' })
    expect(landing({ replay: false, atStop: false, stopAt: 45, check: null }).kind).toBe('replay')
    expect(landing({ replay: false, atStop: true, stopAt: 45, check: ok })).toEqual({ kind: 'stop', stop: 45, text: 'At the break: changes apply when you play on' })
    expect(landing({ replay: false, atStop: true, stopAt: 70, check: ok })).toMatchObject({ kind: 'stop', stop: 70 })
    expect(landing({ replay: false, atStop: false, stopAt: 45, check: ok })).toEqual({ kind: 'now', text: 'Changes apply now' })
    expect(landing({ replay: false, atStop: false, stopAt: 45, check: { ok: false, refusal: 'no-segment', nextStop: 45 } })).toEqual({ kind: 'queue', stop: 45, text: 'Changes wait for half time' })
    expect(landing({ replay: false, atStop: false, stopAt: 70, check: { ok: false, refusal: 'no-segment', nextStop: 70 } })).toEqual({ kind: 'queue', stop: 70, text: 'Changes wait for the 70th minute' })
    expect(landing({ replay: false, atStop: false, stopAt: 94, check: { ok: false, refusal: 'too-late', nextStop: null } })).toEqual({ kind: 'closed', text: 'Too late for changes' })
    expect(canEdit({ kind: 'closed', text: '' })).toBe(false)
    expect(canEdit({ kind: 'queue', text: '' })).toBe(true)
  })

  it('matches the engine: a fresh match takes changes now, stoppage time is too late, an old save queues', () => {
    const s = sides(3)
    const mp = beginMatch({ rng: new Rng('controls-landing'), ...s, detail: 'full' })
    expect(landing({ replay: false, atStop: false, stopAt: 45, check: canChangeInPlay(mp, 20, 'home') }).kind).toBe('now')
    const old = JSON.parse(JSON.stringify(mp))
    delete old.segment
    expect(landing({ replay: false, atStop: false, stopAt: 45, check: canChangeInPlay(old, 20, 'home') })).toMatchObject({ kind: 'queue', stop: 45 })
    advanceMatch(mp, s, undefined, 70)
    advanceMatch(mp, s, undefined, 90)
    expect(landing({ replay: false, atStop: false, stopAt: 93, check: canChangeInPlay(mp, 91, 'home') }).text).toBe('Too late for changes')
  })

  it('opens shouts at the 70th minute only', () => {
    const now = { kind: 'now', text: '' } as const
    expect(shoutsOpen(69, now)).toBe(false)
    expect(shoutsOpen(71, now)).toBe(true)
    expect(shoutsOpen(45, { kind: 'stop', stop: 45, text: '' })).toBe(false)
    expect(shoutsOpen(70, { kind: 'stop', stop: 70, text: '' })).toBe(true)
    expect(shoutsOpen(60, { kind: 'queue', stop: 70, text: '' })).toBe(true)
    expect(shoutsOpen(80, { kind: 'replay', text: '' })).toBe(false)
  })
})

describe('queueing at a stop', () => {
  it('takes three at the break and the rest of the five at 70', () => {
    expect(stopSubCap(45, 0)).toBe(3)
    expect(stopSubCap(45, 3)).toBe(2)
    expect(stopSubCap(70, 1)).toBe(4)
    expect(stopSubCap(70, 6)).toBe(0)
  })

  it('folds tactics, the shout and the substitutions into the pending changes', () => {
    const t = { ...base, pressing: 'high' as const }
    let r = queueIntoDraft(emptyDraft(), { tactics: t, substitutions: [{ off: 'a', on: 'x' }] }, 3)
    expect(r.draft.tactics).toBe(t)
    expect(r.draft.subs).toEqual([{ off: 'a', on: 'x' }])
    expect(r.dropped).toEqual([])
    // A man off twice, a man on twice, a man coming on taken off, no room: all dropped
    r = queueIntoDraft(r.draft, { shout: 'all-out-attack', substitutions: [{ off: 'a', on: 'y' }, { off: 'b', on: 'x' }, { off: 'x', on: 'z' }, { off: 'c', on: 'w' }, { off: 'd', on: 'v' }] }, 2)
    expect(r.draft.subs).toEqual([{ off: 'a', on: 'x' }, { off: 'c', on: 'w' }])
    expect(r.dropped).toHaveLength(4)
    expect(r.draft.shout).toBe('all-out-attack')
    expect(r.draft.tactics).toBe(t)
  })

  it('sends a talk at the break and a shout at 70', () => {
    const d = { ...emptyDraft(), talk: 'demand' as const, shout: 'shut-up-shop' as const, subs: [{ off: 'a', on: 'b' }] }
    expect(draftChanges(d, 45)).toEqual({ talk: 'demand', tactics: undefined, substitutions: [{ off: 'a', on: 'b' }] })
    expect(draftChanges(d, 70)).toEqual({ shout: 'shut-up-shop', tactics: undefined, substitutions: [{ off: 'a', on: 'b' }] })
  })
})

describe('drawer state', () => {
  it('pauses on open and resumes on close only if it was running', () => {
    let s = openDrawer(CLOSED_DRAWER, 'instructions', true)
    expect(s).toEqual({ open: 'instructions', resume: true })
    // Switching drawers keeps the first one's resume (the clock is already paused)
    s = openDrawer(s, 'subs', false)
    expect(s).toEqual({ open: 'subs', resume: true })
    expect(closeDrawer(s)).toEqual({ state: CLOSED_DRAWER, resume: true })
    expect(closeDrawer(openDrawer(CLOSED_DRAWER, 'tactics', false)).resume).toBe(false)
    expect(closeDrawer(CLOSED_DRAWER).resume).toBe(false)
  })
})

describe('outcome texts', () => {
  const none: InPlayOutcome = { applied: false, refusal: 'no-change', made: [], refused: [] }
  it('says nothing for a change that changes nothing, and names every refusal', () => {
    expect(refusalText(none)).toBeNull()
    expect(refusalText({ ...none, refusal: 'too-late' })).toBe('Too late for changes.')
    expect(refusalText({ applied: true, made: [], refused: [{ off: 'a', on: 'b', why: 'no-window' }] })).toBe('No stoppages left: you have used all three.')
    expect(refusalText({ ...none, refused: [{ off: 'a', on: 'b', why: 'before-kick-off' }] })).toBe('Substitutions wait until the ball is rolling.')
    expect(refusalText({ ...none, refused: [{ off: 'a', on: 'b', why: 'not-on-pitch' }] }, (id) => (id === 'a' ? 'Kevin De Bruyne' : undefined))).toBe('De Bruyne is not on the pitch.')
    expect(refusalText({ ...none, shoutRefused: true })).toBe('Touchline shouts open at 70 minutes.')
  })

  it('says what was made and from when', () => {
    expect(appliedText({ applied: true, made: [], refused: [] }, 30)).toBe("Change made: it applies from 31'.")
    expect(appliedText({ applied: true, made: [{ minute: 30, off: 'a', on: 'b', reason: 'manager' }], refused: [] }, 30, (id) => (id === 'a' ? 'Ann Old' : 'Bob New'))).toBe("New on for Old (30').")
  })
})

describe('squad strip cards', () => {
  it('bands condition and morale on the thresholds used elsewhere', () => {
    expect([90, 85, 84, 70, 69, 55, 54, 0].map(conditionBand)).toEqual(['fresh', 'fresh', 'ok', 'ok', 'tired', 'tired', 'spent', 'spent'])
    expect([90, 85, 70, 69, 55, 40, 39].map(moraleBand)).toEqual(['superb', 'superb', 'good', 'okay', 'okay', 'poor', 'very-poor'])
  })

  it('a substitution at 30 shows from 30: the card, the events, five subs to four, three stoppages to two', () => {
    for (let i = 0; i < 6; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`controls-strip-${i}`), ...s, detail: 'full' })
      // A man still on at 30 with nothing decided against him
      const off = mp.hLive.find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red && !mp.events.some((e) => e.playerId === p.psId && e.minute <= 30))
      const on = mp.home.bench.find((id) => !mp.hLive.some((p) => p.psId === id))
      if (!off || !on) continue
      expect(subsMade(mp, 'home', 30)).toBe(0)
      const out = changeInPlay(mp, s, { side: 'home', minute: 30, substitutions: [{ off: off.psId, on }] })
      expect(out.applied).toBe(true)
      expect(MAX_SUBS - subsMade(mp, 'home', 30)).toBe(4)
      expect(MAX_WINDOWS - managerWindowsUsed(mp, 'home')).toBe(2)
      const feed = feedFromLive(mp, `controls-${i}`)
      const formation = getFormation(feed.home.tactics.formationId)
      const opts = { ratings: { [on]: 6.4 }, numbers: { [on]: 12, [off.psId]: 7 }, name: getName, condition: () => 80, morale: () => 72 }
      const before = stripCards(feed, 'home', 29, formation, opts).find((c) => c.slotId === off.slotId)!
      const after = stripCards(feed, 'home', 30, formation, opts).find((c) => c.slotId === off.slotId)!
      expect(before.psId).toBe(off.psId)
      expect(before.subMinute).toBeNull()
      expect(before.number).toBe(7)
      expect(after.psId).toBe(on)
      expect(after.subMinute).toBe(30)
      expect(after.number).toBe(12)
      expect(after.rating).toBe(6.4)
      expect(after.pos).toBe(positionCode(formation, off.slotId))
      expect(after.conditionBand).toBe('ok')
      expect(after.moraleBand).toBe('good')
      const ev = (m: number) => keyItems(feed, m).some((k) => k.kind === 'event' && k.event.type === 'substitution' && k.event.secondaryId === on)
      expect(ev(29)).toBe(false)
      expect(ev(30)).toBe(true)
      return
    }
    throw new Error('no seed had a man to change')
  })

  it('a fourth window is refused, half-time changes spend none', () => {
    const s = sides(1)
    const mp = beginMatch({ rng: new Rng('controls-windows'), ...s, detail: 'full' })
    const bench = mp.home.bench.filter((id) => !mp.hLive.some((p) => p.psId === id))
    // One change at the break: free
    const htOff = mp.hLive.find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red)!
    advanceMatch(mp, s, { side: 'home', substitutions: [{ off: htOff.psId, on: bench[0] }] }, 70)
    expect(managerWindowsUsed(mp, 'home')).toBe(0)
    const tried: InPlayOutcome[] = []
    for (const [k, on] of [[50, bench[1]], [55, bench[2]], [60, bench[3]], [65, bench[4]]] as const) {
      const off = mp.hLive.find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red && p.onAt < k && !mp.events.some((e) => e.playerId === p.psId && e.minute > k))
      if (!off || !on) continue
      tried.push(changeInPlay(mp, s, { side: 'home', minute: k, substitutions: [{ off: off.psId, on }] }))
    }
    expect(tried.length).toBe(4)
    expect(tried.slice(0, 3).every((o) => o.made.length === 1)).toBe(true)
    expect(tried[3].refused[0]?.why === 'no-window' || tried[3].refused[0]?.why === 'no-subs-left').toBe(true)
    expect(refusalText(tried[3])).toMatch(/No stoppages left|All five substitutions/)
    expect(managerWindowsUsed(mp, 'home')).toBe(3)
  })

  it('marks the cards of booked men from their minute', () => {
    for (let i = 0; i < 40; i++) {
      const s = sides(i)
      const mp = beginMatch({ rng: new Rng(`controls-cards-${i}`), ...s, detail: 'full' })
      const y = mp.events.find((e) => e.type === 'yellow' && e.side === 'home' && e.minute > 1)
      if (!y) continue
      const feed = feedFromLive(mp, `cards-${i}`)
      const formation = getFormation(feed.home.tactics.formationId)
      const o = { ratings: {}, numbers: {}, name: getName, condition: () => null, morale: () => undefined }
      const card = (m: number) => stripCards(feed, 'home', m, formation, o).find((c) => c.psId === y.playerId)
      expect(card(y.minute - 1)?.yellow).toBe(false)
      expect(card(y.minute)?.yellow).toBe(true)
      expect(card(y.minute)?.conditionBand).toBeNull()
      expect(card(y.minute)?.moraleBand).toBeNull()
      return
    }
    throw new Error('no seed had a booking')
  })

  it('one card per slot, codes for every shape', () => {
    const mp = beginMatch({ rng: new Rng('controls-slots'), ...sides(2), detail: 'full' })
    const feed = feedFromLive(mp, 'slots')
    const formation = getFormation(feed.home.tactics.formationId)
    const cards = stripCards(feed, 'home', 0, formation, { ratings: {}, numbers: {}, name: getName, condition: () => 100, morale: () => 50 })
    expect(cards.map((c) => c.slotId)).toEqual(formation.slots.map((s) => s.id))
    expect(cards.filter((c) => c.keeper)).toHaveLength(1)
    expect(cards.every((c) => c.name.length > 0 && c.pos.length >= 2)).toBe(true)
    expect(u.index[cards[0].psId!]).toBeDefined()
  })
})

describe('phone tabs', () => {
  it('unique ids, every widget reachable (the xG graph story is always on in the pulse row)', () => {
    const ids = PHONE_TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(PHONE_TABS.map((t) => t.widget)).size).toBe(PHONE_TABS.length)
    for (const w of WIDGET_IDS) if (w !== 'xg-story') expect(PHONE_TABS.some((t) => t.widget === w)).toBe(true)
    expect(PHONE_TABS.some((t) => t.widget === 'xg-story')).toBe(false)
    expect(PHONE_TABS[0].label).toBe('Events')
  })

  it('a friendly has no table and no other scores', () => {
    const f = phoneTabs(true)
    expect(f.some((t) => t.widget === 'live-table' || t.widget === 'latest-scores')).toBe(false)
    expect(f).toHaveLength(PHONE_TABS.length - 2)
    expect(phoneTabs(false)).toBe(PHONE_TABS)
  })

  it('remembers the tab, validated, and survives storage that throws', () => {
    const mem = memory()
    expect(readTab(PHONE_TABS, mem)).toBe('events')
    writeTab('shots', mem)
    expect(mem.data[TAB_KEY]).toBe('shots')
    expect(readTab(PHONE_TABS, mem)).toBe('shots')
    writeTab('nonsense', mem)
    expect(mem.data[TAB_KEY]).toBe('shots')
    // A remembered tab a friendly does not have falls back to the first
    expect(readTab(phoneTabs(true), memory({ [TAB_KEY]: 'table' }))).toBe('events')
    const broken: ChoiceStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readTab(PHONE_TABS, broken)).toBe('events')
    expect(() => writeTab('stats', broken)).not.toThrow()
    expect(readTab(PHONE_TABS, null)).toBe('events')
  })

  it('moves with the arrow keys and pairs a tab with the next on a tablet', () => {
    expect(tabKey(PHONE_TABS, 'events', 'ArrowRight')).toBe('stats')
    expect(tabKey(PHONE_TABS, 'events', 'ArrowLeft')).toBe('commentary')
    expect(tabKey(PHONE_TABS, 'stats', 'Home')).toBe('events')
    expect(tabKey(PHONE_TABS, 'stats', 'End')).toBe('commentary')
    expect(tabKey(PHONE_TABS, 'stats', 'a')).toBeNull()
    expect(tabAfter(PHONE_TABS, 'events').id).toBe('stats')
    expect(tabAfter(PHONE_TABS, 'commentary').id).toBe('events')
  })
})

describe('the man picked out on the strip', () => {
  it('a tap picks him and a second tap lets him go; another man takes his place', () => {
    expect(nextSelection(null, 'a')).toBe('a')
    expect(nextSelection('a', 'a')).toBeNull()
    expect(nextSelection('a', 'b')).toBe('b')
  })
  it('keyboard focus previews a man over the selection, and the selection comes back on blur', () => {
    expect(highlightedMan('a', null)).toBe('a')
    expect(highlightedMan('a', 'b')).toBe('b')
    expect(highlightedMan(null, null)).toBeNull()
  })
})

