import { describe, expect, it } from 'vitest'
import { FORMATIONS, getFormation } from '@engine/formations'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP, tacticsForStyle } from '@engine/tactics'
import { SHOUTS, type Shout } from '@engine/match'
import { lineHelp, mentalityHelp, passingHelp, pressingHelp, shoutHint, shoutLabel, tempoHelp, widthHelp } from '../matchday/tacticText'
import { appearancesAt } from '@engine/matchFeed'
import { statsAt, statsSeries, xgStory } from '@engine/matchStats'
import type { LatestScore } from '@game/logic/matchday'
import { cardSeries, clockText, elsewhereLines, flankRows, freshGoal, keyItems, labelRoom, momentumSpells, panelPoints, reportFigures, resumeMinute, segmentStart, skipLabel, slotViews, statRows, stopTarget, xgStepPoints } from '../matchday/model'
import { stepClock } from '../matchday/useMatchClock'
import { defaultSlots, parseChoices, readChoices, resolveSlots, SLOT_IDS, SLOT_WIDGETS, STORAGE_KEY, WIDGET_IDS, WIDGETS, writeChoice, type ChoiceStorage } from '../matchday/widgetIds'
import { changedLive, resultFeed, u } from './feeds'

const get = (id: string) => u.index[id]

function memoryStorage(seed: Record<string, string> = {}): ChoiceStorage & { data: Record<string, string> } {
  const data = { ...seed }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

describe('tactics words on the match day', () => {
  it("read the engine's English through t()", () => {
    const same = <K extends string>(help: Record<K, string>, read: (k: K) => string) => {
      for (const k of Object.keys(help) as K[]) expect(read(k), k).toBe(help[k])
    }
    same(MENTALITY_HELP, mentalityHelp)
    same(PRESSING_HELP, pressingHelp)
    same(TEMPO_HELP, tempoHelp)
    same(WIDTH_HELP, widthHelp)
    same(LINE_HELP, lineHelp)
    same(PASSING_HELP, passingHelp)
    for (const k of Object.keys(SHOUTS) as Shout[]) {
      expect(shoutLabel(k)).toBe(SHOUTS[k].label)
      expect(shoutHint(k)).toBe(SHOUTS[k].hint)
    }
  })
})

describe('widget registry', () => {
  it('lists every widget once with a label, and the desktop slots exclude the phone-only line-ups', () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length)
    expect(WIDGETS.map((w) => w.id)).toEqual([...WIDGET_IDS])
    for (const w of WIDGETS) expect(w.label.length).toBeGreaterThan(3)
    expect(WIDGETS.map((w) => w.label)).toEqual(['Match events', 'Commentary', 'Heat map', 'Average positions', 'Pass maps', 'Action zones', 'Shot map', 'xG graph story', 'Match momentum', 'Match stats', 'Latest scores', 'Live table', 'Dugout', 'Matchday info', 'Line-ups'])
    expect(SLOT_WIDGETS.some((w) => w.id === 'formations')).toBe(false)
    expect(SLOT_WIDGETS).toHaveLength(WIDGET_IDS.length - 1)
  })

  it('defaults: heat map, match events and xG over the pitch; the table and scores at the sides, or info and the dugout in a friendly', () => {
    expect(defaultSlots(false)).toEqual({ A: 'heat-map', B: 'match-events', C: 'xg-story', L: 'live-table', R: 'latest-scores' })
    expect(defaultSlots(true)).toMatchObject({ L: 'matchday-info', R: 'dugout' })
    for (const f of [true, false]) for (const s of SLOT_IDS) expect(SLOT_WIDGETS.some((w) => w.id === defaultSlots(f)[s])).toBe(true)
  })

  it('validates stored choices slot by slot and falls back to the defaults', () => {
    expect(parseChoices(null)).toEqual({})
    expect(parseChoices('not json')).toEqual({})
    expect(parseChoices('[1,2]')).toEqual({})
    expect(parseChoices(JSON.stringify({ A: 'shot-map', B: 'nonsense', C: 42, L: 'formations', X: 'dugout' }))).toEqual({ A: 'shot-map' })
    expect(resolveSlots({ A: 'shot-map' }, false)).toEqual({ ...defaultSlots(false), A: 'shot-map' })
  })

  it('remembers a choice, survives storage that throws, and never stores an unknown id', () => {
    const mem = memoryStorage()
    writeChoice('B', 'match-stats', mem)
    writeChoice('R', 'commentary', mem)
    expect(readChoices(mem)).toEqual({ B: 'match-stats', R: 'commentary' })
    expect(JSON.parse(mem.data[STORAGE_KEY])).toEqual({ B: 'match-stats', R: 'commentary' })
    writeChoice('A', 'formations', mem)
    expect(readChoices(mem).A).toBeUndefined()
    const broken: ChoiceStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readChoices(broken)).toEqual({})
    expect(() => writeChoice('A', 'heat-map', broken)).not.toThrow()
    expect(readChoices(null)).toEqual({})
  })
})

describe('the match clock', () => {
  it('ticks a minute at a time, stops at its stop and stays there; a paused clock stands still', () => {
    let s = { clock: 0, running: true }
    const seen: number[] = []
    for (let i = 0; i < 60; i++) {
      s = stepClock(s, 45)
      seen.push(s.clock)
    }
    expect(seen.slice(0, 3)).toEqual([1, 2, 3])
    expect(seen[44]).toBe(45)
    expect(s).toEqual({ clock: 45, running: false })
    expect(stepClock({ clock: 30, running: false }, 45)).toEqual({ clock: 30, running: false })
    expect(stepClock({ clock: 93, running: true }, 94)).toEqual({ clock: 94, running: false })
  })

  it('starts each segment where it should and resumes after the last change in play', () => {
    expect([segmentStart(45), segmentStart(70), segmentStart(90), segmentStart(undefined)]).toEqual([0, 46, 71, 0])
    expect(resumeMinute({ clock: 45 })).toBe(0)
    expect(resumeMinute({ clock: 70, timeline: [{ minute: 45, side: 'home', by: 'manager', instructions: { mentality: 'attacking' } }] })).toBe(46)
    expect(resumeMinute({ clock: 70, timeline: [{ minute: 58, side: 'home', by: 'manager', instructions: { mentality: 'attacking' } }, { minute: 60, side: 'away', by: 'ai' }] })).toBe(58)
    const { mp } = changedLive(1)
    expect(resumeMinute(mp)).toBe(75)
    expect(stopTarget({ decidedTo: 45, lastMinute: 45 })).toBe(45)
    expect(stopTarget({ decidedTo: 90, lastMinute: 94 })).toBe(94)
  })

  it('labels the clock and the skip button', () => {
    const s = { atStop: false, stopAt: 45, finished: false, final: false, addedTime: 0 }
    expect(clockText(0, s)).toBe('KICK-OFF')
    expect(clockText(23, s)).toBe("23'")
    expect(clockText(45, { ...s, atStop: true, finished: true })).toBe('HALF TIME')
    expect(clockText(70, { ...s, atStop: true, finished: true, stopAt: 70 })).toBe('70 MINUTES')
    expect(clockText(92, { ...s, stopAt: 94, final: true, addedTime: 4 })).toBe("90+2' (+4)")
    expect(clockText(94, { ...s, stopAt: 94, final: true, finished: true, addedTime: 4 })).toBe('FULL TIME')
    expect([skipLabel(45), skipLabel(70), skipLabel(93), skipLabel(96)]).toEqual(['Skip to half time', 'Skip to 70 minutes', 'Skip to full time', 'Skip to full time'])
  })
})

describe('the xG graph story points', () => {
  it('has a point per minute plus two per attempt, grows with the minute and ends on the running total', () => {
    for (let i = 0; i < 6; i++) {
      const feed = resultFeed(i)
      const story = xgStory(feed)
      for (const side of ['home', 'away'] as const) {
        let prev = 0
        for (const upTo of [0, 10, 45, 70, feed.lastMinute]) {
          const pts = xgStepPoints(story[side], upTo)
          const attempts = story[side].filter((s) => s.minute <= upTo).length
          expect(pts).toHaveLength(upTo + 1 + 2 * attempts)
          expect(pts.length).toBeGreaterThan(prev)
          prev = pts.length
          expect(pts[pts.length - 1][1]).toBeCloseTo(story.perMinute[side][upTo], 10)
          for (let k = 1; k < pts.length; k++) {
            expect(pts[k][0]).toBeGreaterThanOrEqual(pts[k - 1][0])
            expect(pts[k][1]).toBeGreaterThanOrEqual(pts[k - 1][1])
          }
        }
      }
    }
  })

  it('puts the share card on a 0..90 axis ending on the match total', () => {
    const feed = resultFeed(3)
    const story = xgStory(feed)
    const s = cardSeries(story.perMinute.home)
    expect(s).toHaveLength(91)
    expect(s[90]).toBe(story.perMinute.home[feed.lastMinute])
    expect(cardSeries([])).toEqual([0])
  })
})

describe('stats flanks, the stats table and the report', () => {
  it('formats the ten flank rows', () => {
    const feed = resultFeed(2)
    const line = statsAt(statsSeries(feed, get), feed.lastMinute).home
    const rows = flankRows(line)
    expect(rows.map((r) => r.label)).toEqual(['Shots', 'On target', 'xG', 'Distance', 'Pass %', 'Corners', 'Tackles', 'Fouls', 'Yellow cards', 'Possession'])
    expect(rows[0].value).toBe(String(line.shots))
    expect(rows[2].value).toMatch(/^\d+\.\d\d$/)
    expect(rows[3].value).toMatch(/^\d+\.\d km$/)
    expect(rows[4].value).toMatch(/^\d+%$/)
    expect(rows[9].value).toBe(`${Math.round(line.possession)}%`)
    const kick = flankRows(statsAt(statsSeries(feed, get), 0).home)
    expect(kick.map((r) => r.value)).toEqual(['0', '0', '0.00', '0.0 km', '0%', '0', '0', '0', '0', '50%'])
    const table = statRows(line, statsAt(statsSeries(feed, get), feed.lastMinute).away)
    expect(table).toHaveLength(15)
    for (const r of table) expect(r.share).toBeGreaterThanOrEqual(0)
  })

  it('reports exactly the dashboard numbers at the whistle', () => {
    for (let i = 0; i < 8; i++) {
      const feed = resultFeed(i)
      const series = statsSeries(feed, get)
      const fig = reportFigures(series, feed.lastMinute)
      const at = statsAt(series, feed.lastMinute)
      const story = xgStory(feed)
      for (const side of ['home', 'away'] as const) {
        expect(fig[side].shots).toBe(at[side].shots)
        expect(fig[side].onTarget).toBe(at[side].onTarget)
        expect(fig[side].xg).toBe(at[side].xg)
        expect(fig[side].xg).toBeCloseTo(story.perMinute[side][feed.lastMinute], 1)
        // The shot map's markers are the same attempts
        expect(fig[side].shots).toBe(feed.events.filter((e) => e.side === side && ['goal', 'penalty', 'chance', 'save'].includes(e.type)).length)
      }
      expect(fig.home.possession).toBe(Math.round(at.home.possession))
      expect(fig.home.possession + fig.away.possession).toBe(100)
    }
  })
})

describe('panel models', () => {
  it('names a spell only when one side is on top for two bins or more, up to the clock', () => {
    const m = [0.7, 0.72, 0.5, 0.3, 0.35, 0.36, 0.5, 0.62, 0.5, 0.65, 0.66, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    expect(momentumSpells(m, 90)).toEqual([
      { side: 'home', from: 1, to: 10, strength: 0.71 },
      { side: 'away', from: 16, to: 30, strength: expect.closeTo(0.663, 3) },
      { side: 'home', from: 46, to: 55, strength: expect.closeTo(0.655, 3) },
    ])
    expect(momentumSpells(m, 9)).toEqual([])
    expect(momentumSpells(m, 30)).toHaveLength(2)
  })

  it('fills every formation slot with the man there at the minute, marks the substitute and greys a man sent off', () => {
    const { feed, subOn, subOff } = changedLive(4)
    const formation = getFormation(feed.home.tactics.formationId)
    for (const minute of [0, 29, 30, 31, 60, 90]) {
      const views = slotViews(formation, feed.home.appearances, feed.events, minute)
      expect(views.map((v) => v.slotId)).toEqual(formation.slots.map((s) => s.id))
      const on = new Set(appearancesAt(feed.home.appearances, minute).map((a) => a.psId))
      for (const v of views) if (v.psId && !v.out) expect(on.has(v.psId)).toBe(true)
      if (subOn && minute >= 30) expect(views.some((v) => v.psId === subOn && v.subbedOn)).toBe(true)
      if (subOn && minute < 30) expect(views.some((v) => v.psId === subOff)).toBe(true)
    }
    // A red card greys his slot when nobody comes on for him
    for (let i = 0; i < 40; i++) {
      const f = resultFeed(i)
      const red = f.events.find((e) => e.type === 'red' && e.playerId)
      if (!red) continue
      const side = red.side === 'home' ? f.home : f.away
      const views = slotViews(getFormation(side.tactics.formationId), side.appearances, f.events, 90)
      const v = views.find((x) => x.psId === red.playerId)
      expect(v).toMatchObject({ red: true, out: true })
      return
    }
  })

  it('lists the key events and the changes of instructions in order, never past the clock', () => {
    const { feed } = changedLive(2)
    const items = keyItems(feed, feed.lastMinute)
    for (let k = 1; k < items.length; k++) expect(items[k].minute).toBeGreaterThanOrEqual(items[k - 1].minute)
    expect(items.some((i) => i.kind === 'change' && i.minute === 30)).toBe(true)
    expect(items.some((i) => i.kind === 'event' && i.event.type === 'half_time')).toBe(true)
    expect(items.every((i) => i.kind !== 'event' || !['chance', 'save', 'kickoff'].includes(i.event.type))).toBe(true)
    expect(keyItems(feed, 29).every((i) => i.minute <= 29)).toBe(true)
  })

  it('writes a line for every goal elsewhere with the score it made, and flashes a fresh one', () => {
    const s: LatestScore = { homeTeamId: 'a', awayTeamId: 'b', homeName: 'Arsenal', awayName: 'Spurs', homeCode: 'ARS', awayCode: 'TOT', home: 2, away: 1, status: 'live', goals: [{ minute: 23, side: 'home', scorer: 'Saka' }, { minute: 50, side: 'away' }, { minute: 88, side: 'home', scorer: 'Rice' }] }
    expect(elsewhereLines([s])).toMatchObject([
      { minute: 23, text: "Elsewhere: Arsenal 1-0 Spurs, Saka 23'." },
      { minute: 50, text: 'Elsewhere: Arsenal 1-1 Spurs.' },
      { minute: 88, text: "Elsewhere: Arsenal 2-1 Spurs, Rice 88'." },
    ])
    expect(freshGoal(s, 24)).toBe(true)
    expect(freshGoal(s, 25)).toBe(false)
    expect(freshGoal({ ...s, status: 'FT' }, 88)).toBe(false)
  })
})

describe('formation panel labels', () => {
  it('keep every outfield man clear of the keeper, and give each name no more room than the gap to a team-mate level with him, in every shape', () => {
    for (const f of FORMATIONS) {
      for (const style of ['balanced', 'press', 'counter', 'defensive'] as const) {
        const t = tacticsForStyle(style, f.id)
        const points = panelPoints(f, t)
        expect(points.map((p) => p.id)).toEqual(f.slots.map((s) => s.id))
        const gk = points.find((p) => f.slots.find((s) => s.id === p.id)!.position === 'GK')!
        for (const p of points) {
          // On the pitch, and where the live pitch puts him unless he would stand on the keeper
          expect(p.left).toBeGreaterThanOrEqual(0)
          expect(p.left).toBeLessThanOrEqual(100)
          if (p !== gk) expect(gk.top - p.top).toBeGreaterThanOrEqual(12)
        }
        const room = labelRoom(points)
        expect(room[gk.id]).toBeNull()
        for (const a of points) {
          for (const b of points) {
            if (a === b || Math.abs(a.top - b.top) >= 6) continue
            // Two centred names of these widths end before they meet, and none is squeezed to nothing
            expect((room[a.id] ?? Infinity) / 2 + (room[b.id] ?? Infinity) / 2).toBeLessThanOrEqual(Math.abs(a.left - b.left) + 1e-9)
            expect(room[a.id]).toBeGreaterThanOrEqual(10)
          }
        }
        const cbs = f.slots.filter((s) => s.position === 'CB')
        if (cbs.length >= 2) expect(Math.min(...cbs.map((s) => room[s.id] ?? Infinity))).toBeLessThan(40)
      }
    }
    expect(labelRoom([{ id: 'a', left: 40, top: 50 }, { id: 'b', left: 60, top: 52 }, { id: 'c', left: 50, top: 80 }])).toEqual({ a: 20, b: 20, c: null })
  })
})
