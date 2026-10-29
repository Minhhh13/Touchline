import { describe, expect, it } from 'vitest'
import { statsAt, statsSeries } from '@engine/matchStats'
import { sinceMinute } from '../matchday/model'
import { clickedTabAfter, DUGOUT_TAB_ORDER, dugoutKey, isControlTarget, TAB_KEYS, tabShortcuts, type DugoutKeyContext } from '../dugoutKeys'
import { resultFeed, u } from './feeds'
import { timeline, type LiveClockState } from '../match/clockStore'
import { AFTER, boostAt, BUILD_UP, isMoment, levelAt, marginAt, parseLevel, QUIET_BOOST, watchedMinutes } from '../match/highlights'
import type { MatchEvent } from '@engine/types'
import { ASSISTANT_HOLD, ASSISTANT_MINUTES, assistantCheckpoint, assistantLine, assistantText } from '../match/assistant'

const get = (id: string) => u.index[id]

describe('the since-the-shout read-out', () => {
  it('is the difference of the decided series between 70 and the clock, never negative, and nothing until after 70', () => {
    for (let i = 0; i < 8; i++) {
      const feed = resultFeed(i)
      const series = statsSeries(feed, get)
      expect(sinceMinute(series, 70, 70)).toBeNull()
      expect(sinceMinute(series, 70, 40)).toBeNull()
      const end = feed.lastMinute
      const out = sinceMinute(series, 70, end)!
      const a = statsAt(series, 70)
      const b = statsAt(series, end)
      expect(out.home.shots).toBe(b.home.shots - a.home.shots)
      expect(out.away.shots).toBe(b.away.shots - a.away.shots)
      expect(out.home.xg).toBeCloseTo(b.home.xg - a.home.xg, 1)
      // It only grows as the clock runs: it reads the series up to the clock and no further
      let prev = 0
      for (let m = 71; m <= end; m++) {
        const s = sinceMinute(series, 70, m)!
        expect(s.home.shots + s.away.shots).toBeGreaterThanOrEqual(prev)
        prev = s.home.shots + s.away.shots
        expect(s.home.xg).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('the Dugout keyboard', () => {
  const ctx = (over: Partial<DugoutKeyContext> = {}): DugoutKeyContext => ({ onControl: false, modalOpen: false, modifier: false, canPlay: true, tabs: 12, ...over })
  it('Space plays the week only when allowed and nothing else is in the way', () => {
    expect(dugoutKey(' ', ctx())).toEqual({ kind: 'play' })
    expect(dugoutKey(' ', ctx({ canPlay: false }))).toBeNull()
    expect(dugoutKey(' ', ctx({ onControl: true }))).toBeNull()
    expect(dugoutKey(' ', ctx({ modalOpen: true }))).toBeNull()
    expect(dugoutKey(' ', ctx({ modifier: true }))).toBeNull()
    expect(dugoutKey('Enter', ctx())).toBeNull()
  })
  it('1 to 9 and 0 open the first ten tabs, within the tabs shown', () => {
    expect(dugoutKey('1', ctx())).toEqual({ kind: 'tab', index: 0 })
    expect(dugoutKey('9', ctx())).toEqual({ kind: 'tab', index: 8 })
    expect(dugoutKey('0', ctx())).toEqual({ kind: 'tab', index: 9 })
    expect(dugoutKey('0', ctx({ tabs: 9 }))).toBeNull()
    expect(dugoutKey('3', ctx({ onControl: true }))).toBeNull()
    // Tabs still switch while a decision is pending
    expect(dugoutKey('2', ctx({ canPlay: false }))).toEqual({ kind: 'tab', index: 1 })
  })
  it('A picks the best XI and R rests the tired, only while the team can be changed (r8)', () => {
    expect(dugoutKey('a', ctx({ canManage: true }))).toEqual({ kind: 'autoPick' })
    expect(dugoutKey('A', ctx({ canManage: true }))).toEqual({ kind: 'autoPick' })
    expect(dugoutKey('r', ctx({ canManage: true }))).toEqual({ kind: 'rest' })
    expect(dugoutKey('a', ctx())).toBeNull()
    expect(dugoutKey('r', ctx({ canManage: true, onControl: true }))).toBeNull()
    expect(dugoutKey('a', ctx({ canManage: true, modifier: true }))).toBeNull()
    expect(dugoutKey('r', ctx({ canManage: true, modalOpen: true }))).toBeNull()
  })
  it('treats fields, buttons and widget roles as controls', () => {
    const el = (tagName: string, role: string | null = null, isContentEditable = false) => ({ tagName, isContentEditable, getAttribute: (n: string) => (n === 'role' ? role : null) })
    expect(isControlTarget(null)).toBe(false)
    expect(isControlTarget(el('BODY'))).toBe(false)
    expect(isControlTarget(el('DIV'))).toBe(false)
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) expect(isControlTarget(el(t))).toBe(true)
    expect(isControlTarget(el('DIV', 'radio'))).toBe(true)
    expect(isControlTarget(el('DIV', null, true))).toBe(true)
  })
})

describe('highlight levels', () => {
  const ev = (minute: number, type: MatchEvent['type'], side: 'home' | 'away' = 'home'): MatchEvent => ({ minute, type, side, text: '' })
  it('Full watches every minute; Key watches the build-up to goals, reds and injuries; Extended adds cards and changes', () => {
    const events = [ev(20, 'goal'), ev(55, 'yellow'), ev(60, 'substitution'), ev(80, 'red', 'away')]
    expect(watchedMinutes(events, 'full').every(Boolean)).toBe(true)
    const key = watchedMinutes(events, 'key')
    for (let m = 20 - BUILD_UP; m <= 20 + AFTER; m++) expect(key[m]).toBe(true)
    expect(key[10]).toBe(false)
    expect(key[55]).toBe(false)
    expect(key[80]).toBe(true)
    expect(key[0]).toBe(true)
    const ext = watchedMinutes(events, 'extended')
    expect(ext[55]).toBe(true)
    expect(ext[60]).toBe(true)
    expect(ext[10]).toBe(false)
    expect(isMoment(ev(30, 'kickoff'), 'extended')).toBe(false)
  })

  it('on real matches every goal is watched at every level, and Key shows far fewer minutes than the match', () => {
    for (let i = 0; i < 8; i++) {
      const feed = resultFeed(i)
      for (const level of ['key', 'extended'] as const) {
        const w = watchedMinutes(feed.events, level)
        for (const e of feed.events) if (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') expect(w[e.minute]).toBe(true)
      }
      const shown = watchedMinutes(feed.events, 'key').slice(0, 91).filter(Boolean).length
      expect(shown).toBeLessThan(91)
      expect(watchedMinutes(feed.events, 'key').filter(Boolean).length).toBeLessThanOrEqual(watchedMinutes(feed.events, 'extended').filter(Boolean).length)
    }
  })

  it('winds Extended down to Key at three clear, boosts only quiet minutes, and reads unknown levels as Full', () => {
    const events = [ev(10, 'goal'), ev(20, 'goal'), ev(30, 'goal'), ev(50, 'yellow', 'away')]
    expect(marginAt(events, 25)).toEqual({ home: 2, away: 0, margin: 2 })
    expect(levelAt(events, 'extended', 25)).toEqual({ level: 'extended', wound: false })
    expect(levelAt(events, 'extended', 30)).toEqual({ level: 'key', wound: true })
    expect(levelAt(events, 'full', 30)).toEqual({ level: 'full', wound: false })
    // The yellow at 50 is watched in Extended, but not once the match has wound down to Key
    expect(boostAt(events, 'extended', 50)).toBe(QUIET_BOOST)
    expect(boostAt([ev(50, 'yellow', 'away')], 'extended', 50)).toBe(1)
    expect(boostAt(events, 'full', 40)).toBe(1)
    expect(boostAt(events, 'key', 40)).toBe(QUIET_BOOST)
    expect(boostAt(events, 'key', 29)).toBe(1)
    expect(parseLevel(null)).toBe('full')
    expect(parseLevel('nonsense')).toBe('full')
    expect(parseLevel('key')).toBe('key')
  })

  it('the clock runs boost times faster, and a missing boost is 1', () => {
    const s: LiveClockState = { clock: 0, speed: 1, running: true, period: 300, at: 10, since: 1000, spent: Infinity, stopAt: 45, end: 46, holds: [], revealed: 0, celebrating: -1, done: false }
    expect(timeline(s, 1300).t).toBeCloseTo(11)
    expect(timeline({ ...s, boost: 1 }, 1300).t).toBeCloseTo(11)
    expect(timeline({ ...s, boost: QUIET_BOOST }, 1300).t).toBeCloseTo(10 + QUIET_BOOST)
  })
})

describe("the assistant's live line", () => {
  it('shows for a few minutes after 15, 30, 60 and 80 only', () => {
    expect(assistantCheckpoint(14)).toBeNull()
    expect(assistantCheckpoint(15)).toBe(15)
    expect(assistantCheckpoint(15 + ASSISTANT_HOLD - 1)).toBe(15)
    expect(assistantCheckpoint(15 + ASSISTANT_HOLD)).toBeNull()
    expect(assistantCheckpoint(45)).toBeNull()
    expect(assistantCheckpoint(81)).toBe(80)
  })

  it('picks the xG gap first, then a struggling starter, then their danger man', () => {
    const p = (name: string, rating: number) => ({ name, rating })
    expect(assistantText({ xg: { ours: 1.1, theirs: 0.3 }, ours: [p('A Low', 5.5)], theirs: [] }, 30)).toBe("We're on top: xG 1.10 to 0.30. Keep the tempo up.")
    expect(assistantText({ xg: { ours: 0.2, theirs: 0.9 }, ours: [], theirs: [] }, 30)).toMatch(/^They're making more chances: xG 0\.90 to 0\.20/)
    expect(assistantText({ xg: { ours: 0.4, theirs: 0.3 }, ours: [p('Bernardo Silva', 6.0), p('X Good', 7)], theirs: [] }, 60)).toBe('Silva is struggling (6.0): one to think about at 70.')
    expect(assistantText({ xg: { ours: 0.4, theirs: 0.3 }, ours: [p('Bernardo Silva', 6.0)], theirs: [] }, 15)).toBe('Tight so far: xG 0.40 to 0.30. Stay patient.')
    expect(assistantText({ xg: { ours: 0.4, theirs: 0.3 }, ours: [p('A', 6.8)], theirs: [p('Harry Kane', 7.8), p('B', 6.5)] }, 60)).toBe('Their Kane (7.8) is the one causing problems.')
  })

  it('reads the match at its checkpoint only: the same line all through the hold, with the xG of that minute', () => {
    for (let i = 0; i < 6; i++) {
      const feed = resultFeed(i)
      const series = statsSeries(feed, get)
      for (const cp of ASSISTANT_MINUTES) {
        const first = assistantLine(feed, series, 'home', cp, (id) => u.index[id]?.name)!
        expect(first.minute).toBe(cp)
        for (let m = cp; m < cp + ASSISTANT_HOLD; m++) expect(assistantLine(feed, series, 'home', m, (id) => u.index[id]?.name)).toEqual(first)
        const at = statsAt(series, cp)
        if (first.text.includes('xG')) expect(first.text).toContain(at.home.xg.toFixed(2))
      }
    }
  })
})

describe('the Dugout keyboard, round 10', () => {
  const ctx = (over: Partial<DugoutKeyContext> = {}): DugoutKeyContext => ({ onControl: false, modalOpen: false, modifier: false, canPlay: true, tabs: 14, tabIds: DUGOUT_TAB_ORDER, ...over })
  it('orders the tabs as a manager works: team, match, Inbox and Office before the rest', () => {
    expect(DUGOUT_TAB_ORDER.slice(0, 5)).toEqual(['squad', 'next', 'tactics', 'inbox', 'office'])
    expect(DUGOUT_TAB_ORDER.at(-1)).toBe('club')
    expect(new Set(DUGOUT_TAB_ORDER).size).toBe(DUGOUT_TAB_ORDER.length)
  })
  it('gives every tab its own letter, never A or R (the assistant keeps them)', () => {
    const letters = DUGOUT_TAB_ORDER.map((id) => TAB_KEYS[id])
    expect(new Set(letters).size).toBe(letters.length)
    expect(letters).not.toContain('A')
    expect(letters).not.toContain('R')
    for (const id of DUGOUT_TAB_ORDER) expect(dugoutKey(TAB_KEYS[id].toLowerCase(), ctx())).toEqual({ kind: 'tabId', id })
    expect(dugoutKey('i', ctx({ tabIds: ['squad', 'tactics'] }))).toBeNull()
    expect(dugoutKey('i', ctx({ onControl: true }))).toBeNull()
    expect(dugoutKey('I', ctx({ modifier: true }))).toBeNull()
  })
  it('lets digits and letters through on a tab of the strip, and Space only on the tab a click focused', () => {
    expect(dugoutKey('3', ctx({ onControl: true, onTab: true }))).toEqual({ kind: 'tab', index: 2 })
    expect(dugoutKey('m', ctx({ onControl: true, onTab: true }))).toEqual({ kind: 'tabId', id: 'market' })
    expect(dugoutKey(' ', ctx({ onControl: true, onTab: true, tabByPointer: true }))).toEqual({ kind: 'play' })
    expect(dugoutKey(' ', ctx({ onControl: true, onTab: true }))).toBeNull()
    expect(dugoutKey(' ', ctx({ onControl: true, onTab: true, tabByPointer: true, canPlay: false }))).toBeNull()
  })
  it('shows each tab its digit while among the first ten, and its letter always', () => {
    const keys = tabShortcuts(DUGOUT_TAB_ORDER)
    expect(keys[0]).toEqual({ digit: '1', letter: 'S' })
    expect(keys[9]).toEqual({ digit: '0', letter: 'L' })
    expect(keys[10]).toEqual({ letter: 'C' })
  })
  it('remembers the tab a click focused until a key moves the focus', () => {
    let at = clickedTabAfter<string>(null, { pointer: 'tactics' })
    expect(at).toBe('tactics')
    for (const key of ['i', '3', ' ', 'a']) expect((at = clickedTabAfter(at, { key }))).toBe('tactics')
    expect(clickedTabAfter(at, { key: 'ArrowRight' })).toBeNull()
    expect(clickedTabAfter(at, { key: 'Tab' })).toBeNull()
    expect(clickedTabAfter(at, { pointer: null })).toBeNull()
  })
})
