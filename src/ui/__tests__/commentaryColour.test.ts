import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '@engine/types'
import { fillTemplate } from '@game/logic/flavour'
import { commentaryUpTo, MOOD_GAP } from '../match/commentary'
import { CARD_LINES, cardColour, CHANCE_LINES, chanceColour, commentaryContextFor, DERBY_GOAL_LINES, FORM_LINES, FULL_TIME_LINES, fullTimeColour, GOAL_LINES, GOAL_TYPE_LINES, goalColour, goalType, HALF_TIME_LINES, halfTimeColour, INJURY_LINES, injuryColour, MOOD_LINES, moodLine, PRE_MATCH_LINES, preMatchLine, SUB_LINES, subColour, type MatchState } from '../match/commentaryColour'
import { matchPath } from '../match/epochs'
import { getName, resultFeed } from './feeds'

const names = { home: 'HOM', away: 'AWA' }
const KEYS = Array.from({ length: 400 }, (_, i) => `colour-${i}`)
const vars = { p: 'P. Striker', team: 'HOM', opp: 'AWA' }
const filled = (bank: readonly string[], v: Record<string, string> = vars) => bank.map((t) => fillTemplate(t, v))
const state = (o: Partial<MatchState> = {}): MatchState => ({ before: { home: 0, away: 0 }, after: { home: 0, away: 0 }, tally: 0, worst: { home: 0, away: 0 }, reds: { home: 0, away: 0 }, ...o })
const ev = (o: Partial<MatchEvent>): MatchEvent => ({ minute: 30, type: 'goal', side: 'home', playerId: 'p1', playerName: 'P. Striker', text: 'GOAL! P. Striker finishes low into the corner.', ...o })

/** Every line in `bank` comes out of `f` over the keys, and `f` never says anything outside `allowed`. */
function covers(bank: readonly string[], f: (key: string) => string | null, allowed?: readonly string[]) {
  const seen = new Set(KEYS.map(f).filter((x): x is string => !!x))
  for (const line of bank) expect(seen.has(line), line).toBe(true)
  if (allowed) for (const s of seen) expect(allowed.includes(s), s).toBe(true)
}

describe('commentary colour', () => {
  it('reads the same for the same input, and the colour comes after the event’s own text', () => {
    for (let i = 0; i < 6; i++) {
      const feed = resultFeed(i)
      const mpath = matchPath(feed)
      const ctx = { positions: { home: 1, away: 19, clubs: 20 }, seasonGoals: {}, form: {} }
      const a = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [], ctx)
      expect(commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, [], ctx)).toEqual(a)
      for (const e of feed.events) if (e.type !== 'kickoff') expect(a.some((l) => l.minute === e.minute && l.text.startsWith(e.text))).toBe(true)
      expect(a[0].text).toBe('Kick-off.')
      // Never a spoiler: a line written at its minute reads the same when the whole match is known
      for (const m of [20, 45, 60, 80]) {
        const upTo = commentaryUpTo(feed, mpath, m, names, getName, [], ctx)
        for (const l of upTo) if (l.minute < m) expect(a).toContainEqual(l)
      }
    }
  })

  it('puts a word on the occasion after kick-off, and the mood now and then in a quiet minute', () => {
    const feed = { ...resultFeed(1), importanceLabel: 'Derby day' }
    const lines = commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, [])
    expect(lines[0].text).toBe('Kick-off.')
    expect(PRE_MATCH_LINES.derby).toContain(lines[1].text)
    let moods = 0
    let moodMinutes: number[] = []
    const moodTexts = new Set(Object.values(MOOD_LINES).flat().map((t) => t.replace(/\{\w+\}/g, '')))
    for (let i = 0; i < 12; i++) {
      const f = resultFeed(i)
      const play = commentaryUpTo(f, matchPath(f), f.lastMinute, names, getName, []).filter((l) => l.kind === 'play')
      const mine = play.filter((l) => [...moodTexts].some((t) => t.length > 12 && l.text.replace(/HOM|AWA/g, '') === t))
      moods += mine.length
      moodMinutes = mine.map((l) => l.minute)
      for (let k = 1; k < moodMinutes.length; k++) expect(moodMinutes[k] - moodMinutes[k - 1]).toBeGreaterThanOrEqual(MOOD_GAP)
    }
    expect(moods).toBeGreaterThan(5)
  })

  it('tells a goal’s story: four, a hat-trick, a comeback, a late one, a brace', () => {
    covers(filled(GOAL_LINES.fourPlus), (k) => goalColour(k, ev({}), state({ before: { home: 3, away: 0 }, after: { home: 4, away: 0 }, tally: 4 }), names))
    covers(filled(GOAL_LINES.hatTrick), (k) => goalColour(k, ev({}), state({ before: { home: 2, away: 0 }, after: { home: 3, away: 0 }, tally: 3 }), names))
    covers(filled(GOAL_LINES.comebackAhead), (k) => goalColour(k, ev({ minute: 70 }), state({ before: { home: 2, away: 2 }, after: { home: 3, away: 2 }, tally: 1, worst: { home: 2, away: 0 } }), names))
    covers(filled(GOAL_LINES.comebackLevel), (k) => goalColour(k, ev({ minute: 60 }), state({ before: { home: 1, away: 2 }, after: { home: 2, away: 2 }, tally: 1, worst: { home: 2, away: 0 } }), names))
    covers(filled(GOAL_LINES.lateWinner), (k) => goalColour(k, ev({ minute: 88 }), state({ before: { home: 1, away: 1 }, after: { home: 2, away: 1 }, tally: 1 }), names))
    covers(filled(GOAL_LINES.lateLevel), (k) => goalColour(k, ev({ minute: 87 }), state({ before: { home: 0, away: 1 }, after: { home: 1, away: 1 }, tally: 1, worst: { home: 1, away: 0 } }), names))
    covers(filled(GOAL_LINES.brace), (k) => goalColour(k, ev({}), state({ before: { home: 1, away: 0 }, after: { home: 2, away: 0 }, tally: 2 }), names))
    covers(filled(GOAL_LINES.stoppage), (k) => goalColour(k, ev({ minute: 92 }), state({ before: { home: 2, away: 0 }, after: { home: 3, away: 0 }, tally: 1 }), names))
  })

  it('otherwise turns between the situation, the type, the derby and the scorer’s season', () => {
    const situations: Array<[readonly string[], Partial<MatchState>, number?]> = [
      [GOAL_LINES.earlyOpener, { after: { home: 1, away: 0 } }, 3],
      [GOAL_LINES.opener, { after: { home: 1, away: 0 } }],
      [GOAL_LINES.equaliser, { before: { home: 0, away: 1 }, after: { home: 1, away: 1 }, worst: { home: 1, away: 0 } }],
      [GOAL_LINES.goAhead, { before: { home: 1, away: 1 }, after: { home: 2, away: 1 } }],
      [GOAL_LINES.twoClear, { before: { home: 1, away: 0 }, after: { home: 2, away: 0 } }],
      [GOAL_LINES.rout, { before: { home: 2, away: 0 }, after: { home: 3, away: 0 } }],
      [GOAL_LINES.pullBack, { before: { home: 0, away: 2 }, after: { home: 1, away: 2 }, worst: { home: 2, away: 0 } }],
      [GOAL_LINES.consolation, { before: { home: 0, away: 3 }, after: { home: 1, away: 3 }, worst: { home: 3, away: 0 } }],
    ]
    for (const [bank, s, minute] of situations) covers(filled(bank), (k) => goalColour(k, ev({ minute: minute ?? 30 }), state({ tally: 1, ...s }), names))
    const opener = state({ after: { home: 1, away: 0 }, tally: 1 })
    covers(filled(GOAL_TYPE_LINES.header), (k) => goalColour(k, ev({ text: 'GOAL! P. Striker heads it home from a corner.' }), opener, names))
    covers(filled(GOAL_TYPE_LINES.penalty), (k) => goalColour(k, ev({ type: 'penalty', text: 'P. Striker scores from the penalty spot.' }), opener, names))
    covers(filled(GOAL_TYPE_LINES.ownGoal), (k) => goalColour(k, ev({ type: 'own_goal', text: 'Own goal! P. Striker turns it into his own net.' }), opener, names), filled(GOAL_TYPE_LINES.ownGoal))
    covers(filled(DERBY_GOAL_LINES), (k) => goalColour(k, ev({}), { ...opener, label: 'Derby day' }, names))
    covers(FORM_LINES.hot, (k) => goalColour(k, ev({}), opener, names, { form: { p1: 7.8 } }))
    covers(FORM_LINES.cold, (k) => goalColour(k, ev({}), opener, names, { form: { p1: 6.1 } }))
    const season = new Set(KEYS.map((k) => goalColour(k, ev({}), opener, names, { seasonGoals: { p1: 11 } })))
    expect([...season].some((l) => /12th of the season|12 for the season|number 12/.test(l))).toBe(true)
  })

  it('reads every goal type off the engine’s words', () => {
    const texts: Record<string, string> = {
      'finishes low into the corner': 'finish', 'thumps it into the roof of the net': 'longRange', 'slots it past the keeper': 'finish', 'heads it home from a corner': 'header',
      'curls one in from the edge of the box': 'longRange', 'taps in from close range': 'tapIn', 'rounds the keeper and finishes': 'solo', 'drills it through a crowd of bodies': 'scramble',
      'volleys in spectacularly': 'volley', 'finishes a flowing team move': 'teamMove', 'pounces on a loose ball': 'scramble', 'chips the keeper with real class': 'chip',
    }
    for (const [t, type] of Object.entries(texts)) expect(goalType({ type: 'goal', text: `GOAL! X ${t}.` }), t).toBe(type)
    for (const type of Object.keys(GOAL_TYPE_LINES)) if (type !== 'penalty' && type !== 'ownGoal') expect(Object.values(texts)).toContain(type)
  })

  it('colours chances, cards, changes and injuries, each bank in full', () => {
    covers(filled(CHANCE_LINES.woodwork), (k) => chanceColour(k, ev({ type: 'chance', text: 'P hits the post!' }), state(), names))
    covers(filled(CHANCE_LINES.save), (k) => chanceColour(k, ev({ type: 'save', text: 'K gets down well to keep out P.' }), state(), names))
    covers(filled(CHANCE_LINES.line), (k) => chanceColour(k, ev({ type: 'chance', text: 'Big chance for P, blocked on the line!' }), state(), names))
    covers(filled(CHANCE_LINES.miss), (k) => chanceColour(k, ev({ type: 'chance', text: 'P heads over from six yards.' }), state(), names))
    covers(filled(CHANCE_LINES.lateLevel), (k) => chanceColour(k, ev({ type: 'chance', minute: 82, text: 'P heads over from six yards.' }), state({ before: { home: 0, away: 1 } }), names))
    covers(filled(CHANCE_LINES.lateCushion), (k) => chanceColour(k, ev({ type: 'chance', minute: 82, text: 'P heads over from six yards.' }), state({ before: { home: 1, away: 0 } }), names))
    // A third of the chances get no colour
    const quiet = KEYS.filter((k) => chanceColour(k, ev({ type: 'chance', text: 'P hits the post!' }), state(), names) === null).length
    expect(quiet / KEYS.length).toBeGreaterThan(0.2)
    expect(quiet / KEYS.length).toBeLessThan(0.45)
    covers(CARD_LINES.secondYellow, (k) => cardColour(k, ev({ type: 'red', text: 'X sees a second yellow and is sent off!' }), state({ reds: { home: 1, away: 0 } })))
    covers(CARD_LINES.straightRed, (k) => cardColour(k, ev({ type: 'red', text: 'Straight red for X!' }), state({ reds: { home: 1, away: 0 } })))
    covers(CARD_LINES.downToNine, (k) => cardColour(k, ev({ type: 'red', text: 'Straight red for X!' }), state({ reds: { home: 2, away: 0 } })))
    covers(CARD_LINES.early, (k) => cardColour(k, ev({ type: 'yellow', minute: 9, text: 'X is booked.' }), state()))
    covers(CARD_LINES.tactical, (k) => cardColour(k, ev({ type: 'yellow', minute: 80, text: 'X is booked.' }), state({ before: { home: 1, away: 0 } })))
    covers(CARD_LINES.yellow, (k) => cardColour(k, ev({ type: 'yellow', minute: 40, text: 'X is booked.' }), state()))
    const sub = (minute: number, text = 'A comes on for B.') => ev({ type: 'substitution', minute, text })
    covers(SUB_LINES.chasing, (k) => subColour(k, sub(75), state({ before: { home: 0, away: 1 } })))
    covers(SUB_LINES.holding, (k) => subColour(k, sub(80), state({ before: { home: 2, away: 1 } })))
    covers(SUB_LINES.halfTime, (k) => subColour(k, sub(45, 'Half-time change: A replaces B.'), state()))
    covers(SUB_LINES.routine, (k) => subColour(k, sub(60), state()))
    expect(KEYS.every((k) => subColour(k, sub(30, 'A replaces the injured B.'), state()) === null)).toBe(true)
    covers(filled(INJURY_LINES), (k) => injuryColour(k, ev({ type: 'injury', text: 'X goes down injured: knock.' }), names))
  })

  it('has a word for every half-time and full-time score', () => {
    covers(HALF_TIME_LINES.goalless, (k) => halfTimeColour(k, { home: 0, away: 0 }, names))
    covers(HALF_TIME_LINES.level, (k) => halfTimeColour(k, { home: 1, away: 1 }, names))
    covers(filled(HALF_TIME_LINES.lead), (k) => halfTimeColour(k, { home: 1, away: 0 }, names))
    covers(filled(HALF_TIME_LINES.comfortable, { team: 'AWA', opp: 'HOM' }), (k) => halfTimeColour(k, { home: 0, away: 2 }, names))
    const g = (minute: number, side: 'home' | 'away'): MatchEvent => ev({ minute, side })
    covers(filled(FULL_TIME_LINES.comeback), (k) => fullTimeColour(k, [g(10, 'away'), g(50, 'home'), g(60, 'home')], names))
    covers(filled(FULL_TIME_LINES.lateWinner), (k) => fullTimeColour(k, [g(40, 'home'), g(60, 'away'), g(88, 'home')], names))
    covers(filled(FULL_TIME_LINES.derbyWin), (k) => fullTimeColour(k, [g(40, 'home'), g(60, 'home')], names, 'Derby day'))
    covers(filled(FULL_TIME_LINES.thrashing), (k) => fullTimeColour(k, [g(10, 'home'), g(20, 'home'), g(30, 'home'), g(40, 'home')], names))
    covers(filled(FULL_TIME_LINES.cleanSheet), (k) => fullTimeColour(k, [g(10, 'home'), g(20, 'home')], names))
    covers(filled(FULL_TIME_LINES.goalFest), (k) => fullTimeColour(k, [g(5, 'home'), g(10, 'home'), g(20, 'away'), g(30, 'home'), g(40, 'away'), g(50, 'home'), g(60, 'home')], names))
    covers(filled(FULL_TIME_LINES.win), (k) => fullTimeColour(k, [g(10, 'home'), g(20, 'home'), g(30, 'away')], names))
    covers(FULL_TIME_LINES.goalless, (k) => fullTimeColour(k, [], names))
    covers(FULL_TIME_LINES.draw, (k) => fullTimeColour(k, [g(10, 'home'), g(20, 'away')], names))
  })

  it('names the occasion before kick-off, and the table when it tells a story', () => {
    const labels: Array<[string, readonly string[]]> = [['Derby day', PRE_MATCH_LINES.derby], ['Title decider', PRE_MATCH_LINES.decider], ['Cup final', PRE_MATCH_LINES.final], ['Continental semi-final', PRE_MATCH_LINES.semi], ['European night', PRE_MATCH_LINES.european], ['Cup tie', PRE_MATCH_LINES.cup]]
    for (const [label, bank] of labels) covers(bank, (k) => preMatchLine(k, names, label))
    covers(PRE_MATCH_LINES.topVsBottom, (k) => preMatchLine(k, names, undefined, { positions: { home: 1, away: 20, clubs: 20 } }))
    covers(PRE_MATCH_LINES.sixPointer, (k) => preMatchLine(k, names, undefined, { positions: { home: 18, away: 19, clubs: 20 } }))
    covers(filled(PRE_MATCH_LINES.leaders, { team: 'AWA' }), (k) => preMatchLine(k, names, undefined, { positions: { home: 7, away: 1, clubs: 20 } }))
    expect(KEYS.every((k) => preMatchLine(k, names, undefined, { positions: { home: 7, away: 9, clubs: 20 } }) === null)).toBe(true)
    expect(preMatchLine('x', names)).toBeNull()
  })

  it('reads the mood from the score and the clock', () => {
    const v = { team: 'HOM', lead: 'HOM', trail: 'AWA', short: 'AWA' }
    const none = { home: 0, away: 0 }
    covers(filled(MOOD_LINES.early, v), (k) => moodLine(k, 6, { home: 0, away: 0 }, none, 'home', names))
    covers(filled(MOOD_LINES.goalless, v), (k) => moodLine(k, 40, { home: 0, away: 0 }, none, 'home', names))
    covers(filled(MOOD_LINES.secondHalf, v), (k) => moodLine(k, 48, { home: 1, away: 1 }, none, 'home', names))
    covers(filled(MOOD_LINES.nervy, v), (k) => moodLine(k, 84, { home: 1, away: 0 }, none, 'home', names))
    covers(filled(MOOD_LINES.lateLevel, v), (k) => moodLine(k, 84, { home: 2, away: 2 }, none, 'home', names))
    covers(filled(MOOD_LINES.cruising, v), (k) => moodLine(k, 60, { home: 3, away: 0 }, none, 'home', names))
    covers(filled(MOOD_LINES.tenMen, v), (k) => moodLine(k, 60, { home: 1, away: 1 }, { home: 0, away: 1 }, 'home', names))
    expect(KEYS.every((k) => moodLine(k, 20, { home: 1, away: 0 }, none, 'home', names) === null)).toBe(true)
  })

  it('reads the table and our men’s season only before a live league match', () => {
    const season = { fixtures: [], ai: {} } as never
    expect(commentaryContextFor({ season, squad: {} }, 'a', 'b', false)).toEqual({})
    expect(commentaryContextFor({ season: null, squad: {} } as never, 'a', 'b', true)).toEqual({})
  })

  it('draws nothing: no RNG, no clock, no Math.random in the colour', () => {
    for (const f of ['src/ui/match/commentaryColour.ts', 'src/game/logic/flavour.ts']) {
      // The code, not its comments (which say what it never does)
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(src).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|Rng\b/)
    }
  })
})
