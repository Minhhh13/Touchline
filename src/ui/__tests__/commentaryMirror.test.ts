/**
 * The match commentary mirrored through the `commentaryText` catalogue (QA r11's R11-O3, `src/ui/i18n/commentaryText.ts`),
 * beside `logicMirror.test.ts`: English reads byte for byte as before (pinned), every template of the commentary and
 * every event wording of the engine is a message, every piece played matches are written back character for character
 * from its message, and in the pseudo-locale a line is translated with its names, score and minute kept.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CHANCE_TEXTS, SHOUTS } from '@engine/match'
import type { MatchFeed } from '@engine/matchFeed'
import { ADDED_TIME_LINES, boardText, changeText, commentaryUpTo, KEEPER_LINES, LULL_LINES, PASS_LINES, PHRASES, PLAY_LINES, QUIET_LINES, TURNOVER_LINES, ZONES, type CommentaryContext, type CommentaryLine } from '../match/commentary'
import { CARD_LINES, CHANCE_LINES, DERBY_GOAL_LINES, FORM_LINES, FULL_TIME_LINES, GOAL_LINES, GOAL_TYPE_LINES, HALF_TIME_LINES, INJURY_LINES, MOOD_LINES, PRE_MATCH_LINES, SUB_LINES } from '../match/commentaryColour'
import { assistantText } from '../match/assistant'
import { matchPath } from '../match/epochs'
import { elsewhereLines } from '../matchday/model'
import { formatText, setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { commentaryText } from '../i18n/en/commentaryText'
import { changeLineText, commentaryLineText, commentaryPiece, eventLine, matchCommentary } from '../i18n/commentaryText'
import { changedLive, getName, resultFeed } from './feeds'

const names = { home: 'HOM', away: 'AWA' }
const messages = commentaryText.messages as Record<string, string>
const english = new Set(Object.values(messages))
const elsewhere = [{ minute: 23, text: 'Elsewhere: Arsenal 1-0 Spurs, Saka 23\'.' }]

afterEach(() => setLocaleMessages({ id: 'en', messages: {} }))

/** A number per id, the same every run: a scorer's season goals or form before kick-off. */
const byId = (mod: number, base: number) => new Proxy({}, { get: (_, k) => base + (String(k).length * 7 + String(k).charCodeAt(0)) % mod }) as Record<string, number>

/** Seeded matches with every kind of context the dashboard hands the commentary. */
function matches(n: number): Array<{ feed: MatchFeed; ctx: CommentaryContext }> {
  const out: Array<{ feed: MatchFeed; ctx: CommentaryContext }> = []
  const labels = [undefined, 'Derby day', 'Title decider', 'Cup final', 'Cup semi-final', 'European night', 'Cup tie']
  const tables = [{ home: 1, away: 19, clubs: 20 }, { home: 19, away: 20, clubs: 20 }, { home: 3, away: 1, clubs: 20 }, { home: 8, away: 9, clubs: 20 }]
  for (let i = 0; i < n; i++) {
    const base = i % 5 === 4 ? changedLive(i).feed : resultFeed(i)
    const feed = { ...base, importanceLabel: labels[i % labels.length] }
    const ctx: CommentaryContext = i % 3 === 0 ? {} : { userSide: i % 2 ? 'home' : 'away', positions: tables[i % tables.length], seasonGoals: byId(30, i % 4 === 1 ? 9 : 0), form: byId(3, i % 2 ? 7 : 5) }
    out.push({ feed, ctx })
  }
  return out
}

function linesOf(n: number): CommentaryLine[] {
  return matches(n).flatMap(({ feed, ctx }) => commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, elsewhere, ctx))
}

describe('the commentary in English', () => {
  it('reads byte for byte as before the catalogue (the same 40 matches, hashed)', () => {
    const h = createHash('sha256')
    for (let i = 0; i < 40; i++) {
      const feed = i % 4 === 3 ? changedLive(i).feed : resultFeed(i)
      const ctx: CommentaryContext = i % 2 ? { userSide: 'home', positions: { home: 1, away: 19, clubs: 20 }, seasonGoals: {}, form: {} } : {}
      for (const l of commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, elsewhere, ctx)) h.update(`${l.minute}|${l.kind}|${l.side ?? ''}|${l.weight}|${l.text}\n`)
    }
    // From `main` with claude/r11-qa merged, before the catalogue: no line, order or pick moved. Re-baselined once by
    // content round 2 (r13): the mood banks' new wordings and the two new moods (a two-goal cushion, an open game) move
    // which quiet-minute word is said, only in the minutes `commentaryUpTo` already gave to the mood
    expect(h.digest('hex')).toBe('4b61ad3a34dc3ab22d6d416e74ab9a69fc040eac8337cf5e74329d02ffbb05ee')
  })

  it('is said exactly as written, and a line’s pieces join to its text', () => {
    for (const l of linesOf(12)) {
      expect(commentaryLineText(l)).toBe(l.text)
      if (l.source?.kind === 'parts') expect(l.source.parts.join(' ')).toBe(l.text)
      if (l.source?.kind === 'change') expect(changeText(l.source.entry, l.source.team)).toBe(l.text)
      if (l.source?.kind === 'board') expect(boardText(l.source.added)).toBe(l.text)
    }
    expect(eventLine('Kick-off.')).toBe('Kick-off.')
  })
})

describe('the commentary catalogue', () => {
  it('holds every template of the commentary, its colour and the engine’s events', () => {
    const banks: Array<readonly string[]> = [PASS_LINES, KEEPER_LINES, TURNOVER_LINES, QUIET_LINES, ADDED_TIME_LINES, LULL_LINES, DERBY_GOAL_LINES, INJURY_LINES, CHANCE_TEXTS, ZONES, ...Object.values(PLAY_LINES), ...[GOAL_LINES, GOAL_TYPE_LINES, CHANCE_LINES, CARD_LINES, SUB_LINES, HALF_TIME_LINES, FULL_TIME_LINES, PRE_MATCH_LINES, MOOD_LINES, FORM_LINES].flatMap((g) => Object.values(g) as Array<readonly string[]>)]
    const missing = banks.flat().filter((x) => !english.has(x))
    expect(missing).toEqual([])
    for (const [k, v] of Object.entries(PHRASES)) for (const [x, p] of Object.entries(v)) expect(messages[`change_${k}_${x}`]).toBe(p)
    for (const [k, v] of Object.entries(SHOUTS)) expect(messages[`shout_${k.replace(/-(.)/g, (_, c: string) => c.toUpperCase())}`]).toBe(v.label.toLowerCase())
    // Every corner line still starts "Corner to"
    for (const [k, v] of Object.entries(messages)) if (k.startsWith('play_corner_')) expect(v.startsWith('Corner to')).toBe(true)
  })

  it('every event wording and injury is still in the engine', () => {
    const engine = readFileSync('src/engine/match.ts', 'utf8')
    for (const [k, v] of Object.entries(messages)) {
      if (k.startsWith('ev_goal')) expect(engine, k).toContain(`'${/GOAL! \{scorer\} (.+?)(, assisted by \{assist\})?\.$/.exec(v)![1]}'`)
      if (k.startsWith('part_injury_')) expect(engine.toLowerCase(), k).toContain(`'${v}'`)
    }
    for (const w of ['GOAL! ${sName} ${flavour}, assisted by ${aName}.', 'scores from the penalty spot.', 'turns it into his own net.', 'is booked.', 'sees a second yellow and is sent off!', 'Straight red for', 'goes down injured: ', 'Half-time change: ', 'Change on ', 'comes on for', 'replaces the injured', 'Half time: ', 'Full time: ', "'Kick-off.'"]) expect(engine).toContain(w)
  })

  it('writes back every piece of 60 played matches character for character', () => {
    const pieces = new Set<string>()
    for (const l of linesOf(60)) {
      if (l.source?.kind === 'parts') l.source.parts.forEach((p) => pieces.add(p))
      else if (!l.source) pieces.add(l.text)
    }
    // The assistant's word in the banner, every branch
    for (const cp of [15, 30, 60, 80]) {
      pieces.add(assistantText({ xg: { ours: 1.4, theirs: 0.2 }, ours: [], theirs: [] }, cp))
      pieces.add(assistantText({ xg: { ours: 0.2, theirs: 1.4 }, ours: [], theirs: [] }, cp))
      pieces.add(assistantText({ xg: { ours: 0.5, theirs: 0.6 }, ours: [{ name: 'Mohamed Salah', rating: 5.9 }], theirs: [] }, cp))
      pieces.add(assistantText({ xg: { ours: 0.5, theirs: 0.6 }, ours: [], theirs: [{ name: 'E. Haaland', rating: 7.9 }] }, cp))
      pieces.add(assistantText({ xg: { ours: 0.5, theirs: 0.6 }, ours: [], theirs: [] }, cp))
    }
    const missed: string[] = []
    const wrong: string[] = []
    for (const p of pieces) {
      const hit = matchCommentary(p)
      if (!hit) missed.push(p)
      else {
        const back = formatText(messages[hit.key], hit.vars)
        if (back !== p) wrong.push(`${hit.key}: "${p}" read back as "${back}"`)
      }
    }
    expect(wrong).toEqual([])
    expect(missed).toEqual([])
    expect(pieces.size).toBeGreaterThan(800)
  }, 120_000)
})

describe('the commentary in another language', () => {
  it('translates every line, keeps the names, the score and the minute', () => {
    const lines = linesOf(6)
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    for (const l of lines) {
      const said = commentaryLineText(l)
      expect(isPseudo(said), `${l.kind}: ${l.text} -> ${said}`).toBe(true)
    }
    const goal = lines.find((l) => l.kind === 'goal' && l.source?.kind === 'parts')!
    const said = commentaryLineText(goal)
    if (goal.source?.kind !== 'parts') throw new Error('a goal is built from parts')
    expect(said).toContain('HOM')
    expect(said).toContain('AWA')
    const scorer = /GOAL! (.+?) [a-z]/.exec(goal.source.parts[0])?.[1]
    if (scorer) expect(said).toContain(scorer)
    // A hole holding a known piece is said again too: the zone of a line of play
    const zoned = commentaryPiece('Bruno Fernandes drives forward in midfield.')
    expect(zoned).toContain('Bruno Fernandes')
    expect(zoned).not.toContain('in midfield')
    // An event's own text, the board, a change of plan and a goal elsewhere
    expect(eventLine('Mohamed Salah is booked.')).toContain('Mohamed Salah')
    expect(isPseudo(eventLine('Mohamed Salah is booked.'))).toBe(true)
    const [away] = elsewhereLines([{ homeTeamId: 'a', awayTeamId: 'b', homeName: 'Arsenal', awayName: 'Spurs', homeCode: 'ARS', awayCode: 'TOT', home: 1, away: 0, status: 'live', goals: [{ minute: 23, side: 'home', scorer: 'Saka' }] }])
    const elsewhereLine = commentaryUpTo(resultFeed(0), matchPath(resultFeed(0)), 30, names, getName, [away]).find((l) => l.kind === 'elsewhere')!
    expect(commentaryLineText(elsewhereLine)).toMatch(/Arsenal.*1.*0.*Spurs.*Saka.*23'/)
    expect(isPseudo(commentaryLineText(elsewhereLine))).toBe(true)
    const change = changeLineText({ minute: 30, side: 'home', by: 'manager', instructions: { mentality: 'attacking', pressing: 'high' }, shout: 'all-out-attack' } as never, 'HOM')!
    expect(change).toContain('HOM')
    expect(isPseudo(change)).toBe(true)
    // A line nothing matches comes back as it was
    expect(commentaryPiece('Nothing like any template')).toBe('Nothing like any template')
  })
})
