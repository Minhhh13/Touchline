/**
 * QA round 9 (r13, docs/QA.md): the match day in the viewer's language over what round 12 changed. Seeded matches with
 * real names of several words (the dashboard's commentary takes the clubs' and players' full names), read in English
 * and in the pseudo-locale:
 * - English is exactly the line the commentary wrote (no line, order or pick moved; a line's pieces join to it);
 * - every piece matches its message with each hole holding a whole name, a known piece or a number, so in another
 *   language no zone stays English inside a line and no name is cut in two (R13-1);
 * - the pitch's caption pill and a corner's delivery are said through the catalogue (R13-6);
 * - the match header's round and occasion labels are the game logic's English said through `logicLine` (R13-5).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { MatchFeed } from '@engine/matchFeed'
import { commentaryUpTo, ZONES, type CommentaryContext, type CommentaryLine } from '../match/commentary'
import { matchPath } from '../match/epochs'
import { ballAt } from '../match/possession'
import { phaseCaption, sceneAt } from '../match/shape'
import { cornerDelivery } from '../match/overlays'
import { elsewhereLines } from '../matchday/model'
import { formatText, setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { commentaryText } from '../i18n/en/commentaryText'
import { match } from '../i18n/en/match'
import { commentaryLineText, matchCommentary } from '../i18n/commentaryText'
import { logicLine } from '../i18n/logicText'
import { captionWords } from '../components/LivePitch'
import { changedLive, getName, resultFeed, u } from './feeds'

afterEach(() => setLocaleMessages({ id: 'en', messages: {} }))

const NAMES = [
  { home: 'Manchester United', away: 'West Ham United' },
  { home: 'Brighton & Hove Albion', away: 'Nottingham Forest' },
  { home: 'Real Sociedad de Fútbol', away: 'Paris Saint-Germain' },
]
const elsewhere = elsewhereLines([{ homeTeamId: 'a', awayTeamId: 'b', homeName: 'Wolverhampton Wanderers', awayName: 'Crystal Palace', homeCode: 'WOL', awayCode: 'CRY', home: 1, away: 1, status: 'live', goals: [{ minute: 23, side: 'home', scorer: 'Pedro Neto' }, { minute: 61, side: 'away' }] }])

function games(n: number): Array<{ feed: MatchFeed; names: { home: string; away: string }; lines: CommentaryLine[] }> {
  const out: Array<{ feed: MatchFeed; names: { home: string; away: string }; lines: CommentaryLine[] }> = []
  const labels = [undefined, 'Derby day', 'Title decider', 'Cup final', 'European night']
  for (let i = 0; i < n; i++) {
    const base = i % 4 === 3 ? changedLive(i).feed : resultFeed(i)
    const feed = { ...base, importanceLabel: labels[i % labels.length] }
    const names = NAMES[i % NAMES.length]
    const ctx: CommentaryContext = i % 3 === 0 ? {} : { userSide: i % 2 ? 'home' : 'away', positions: { home: 1 + (i % 20), away: 20 - (i % 20), clubs: 20 }, seasonGoals: {}, form: {} }
    out.push({ feed, names, lines: commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, elsewhere, ctx) })
  }
  return out
}

/** The pieces a line is said from (an event's text, the score, a word of colour, a line of play). */
const piecesOf = (l: CommentaryLine): string[] => (l.source?.kind === 'parts' ? l.source.parts : l.source ? [] : [l.text])

describe('the commentary with names of several words (R13-1)', () => {
  const played = games(60)
  const messages = commentaryText.messages as Record<string, string>
  const known = new Set<string>([...NAMES.flatMap((n) => [n.home, n.away]), 'HOM', 'AWA', ...Object.values(messages)])
  for (const ps of Object.values(u.index)) known.add(ps.name)

  it('reads in English exactly as written, its pieces joined', () => {
    let n = 0
    for (const { lines } of played)
      for (const l of lines) {
        n++
        expect(commentaryLineText(l)).toBe(l.text)
        if (l.source?.kind === 'parts') expect(l.source.parts.join(' ')).toBe(l.text)
      }
    expect(n).toBeGreaterThan(5000)
  })

  it('matches every piece with each hole holding a whole name, a known piece or a number', () => {
    const odd: string[] = []
    let zoned = 0
    for (const { lines } of played)
      for (const l of lines)
        for (const p of piecesOf(l)) {
          const hit = matchCommentary(p)
          if (!hit) {
            odd.push(`no message: ${p}`)
            continue
          }
          if (formatText(messages[hit.key], hit.vars) !== p) odd.push(`${hit.key} reads back wrong: ${p}`)
          if ('zone' in hit.vars) zoned++
          for (const [k, v] of Object.entries(hit.vars)) if (typeof v === 'string' && !known.has(v)) odd.push(`${hit.key} {${k}} = "${v}" in: ${p}`)
        }
    expect(odd.slice(0, 10)).toEqual([])
    // Lines of play name a zone often enough for the check to mean something
    expect(zoned).toBeGreaterThan(300)
  })

  it('leaves no zone in English inside a line said in another language', () => {
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    const english: string[] = []
    let said = 0
    for (const { lines } of played.slice(0, 30))
      for (const l of lines) {
        const s = commentaryLineText(l)
        said++
        expect(isPseudo(s), l.text).toBe(true)
        for (const z of ZONES) if (s.includes(z)) english.push(`${z}: ${s}`)
      }
    expect(english.slice(0, 5)).toEqual([])
    expect(said).toBeGreaterThan(2000)
  })
})

describe('the pitch caption (R13-6)', () => {
  it('has a message for every caption and delivery a match shows, and says it in the viewer’s language', () => {
    const englishCaptions = new Set<string>(Object.entries(match.messages).filter(([k]) => k.startsWith('caption_')).map(([, v]) => v))
    const seen = new Set<string>()
    for (let i = 0; i < 24; i++) {
      const feed = resultFeed(i)
      const { path: keys } = matchPath(feed)
      for (let t = 0; t <= feed.lastMinute + 0.99; t += 0.04) {
        const b = ballAt(keys, t)
        if (!b) continue
        const c = phaseCaption(keys, b, sceneAt(keys, b, t))
        if (!c) continue
        seen.add(c.text)
        if (c.text === 'Corner') {
          const where = cornerDelivery(keys, b)
          if (where) seen.add(where)
        }
      }
    }
    expect([...seen].filter((x) => !englishCaptions.has(x))).toEqual([])
    expect(seen.size).toBeGreaterThanOrEqual(12)
    for (const x of seen) expect(captionWords(x)).toBe(x)
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    for (const x of englishCaptions) expect(isPseudo(captionWords(x)), x).toBe(true)
    // One the catalogue does not hold comes back as it was
    expect(captionWords('Not a caption')).toBe('Not a caption')
  })
})

describe('the match header’s labels (R13-5)', () => {
  it('says every round and occasion label the engine and the season write', () => {
    const season = readFileSync('src/engine/season.ts', 'utf8')
    const labels = [...season.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(expect.arrayContaining(['Derby day', 'Title decider', 'Cup final', 'European night', 'Fourth round', 'Continental quarter-final']))
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    for (const x of [...labels, 'Friendly', 'Pre-season friendly v Arsenal', 'Continental Cup, Group B, matchday 3', 'Continental semi-final (first leg 2-1)']) expect(isPseudo(logicLine(x)), x).toBe(true)
  })

  it('never prints a match context’s label raw on a screen', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) {
          if (f !== '__tests__') walk(p)
        } else if (p.endsWith('.tsx')) files.push(p)
      }
    }
    walk('src/ui')
    const raw: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // The share card keeps the English (`renderMatchCard`), as every share text does
        if (/title: ctx\.roundLabel/.test(line)) return
        if (/\{(?:ctx|feed)\.(?:roundLabel|importanceLabel) \?\?|\$\{ctx\.(?:roundLabel|importanceLabel)\}|\{feed\.importanceLabel \?\? ctx\.importanceLabel\}|roundLabel \?\? t\(/.test(line)) raw.push(`${f}:${i + 1}`)
      })
    }
    expect(raw).toEqual([])
  })
})
