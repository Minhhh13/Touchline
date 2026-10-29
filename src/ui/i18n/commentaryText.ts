/**
 * The match commentary in the viewer's language (QA r11, R11-O3), the way `logicText.ts` mirrors the game logic: the
 * engine writes each match event's English (`src/engine/match.ts`) and the commentary writes its own
 * (`src/ui/match/commentary.ts` and its colour), and both keep it, so the line a match picks, its "never said twice"
 * check and the share text never change. A line carries the English pieces it was joined from (`CommentaryLine.source`);
 * each piece is matched against the `commentaryText` catalogue and said again through `t()`, a hole that holds a known
 * piece of its own (a zone, an injury, "a team-mate") said again too, and names kept. A change of instructions, the
 * added-time board and a goal elsewhere are said by key from their data. English never matches: it is returned as it
 * came. `src/ui/__tests__/commentaryMirror.test.ts` holds every message to its source.
 */
import type { TimelineEntry } from '@engine/match'
import { activeLocale, translator, type Vars } from '.'
import { compilePatterns, varsOf, type Pattern } from './mirror'
import { commentaryText } from './en/commentaryText'
import { changeText, type CommentaryLine, type ElsewhereScore } from '../match/commentary'
import { minuteLabel } from '../format'

type Key = keyof typeof commentaryText.messages & string
const t = translator(commentaryText)
const say = (key: string, vars?: Vars) => t(key as Key, vars)

/** Messages said by key from a line's data, never matched (`{team} {actions}.` would match anything). */
const BY_KEY = /^(change_|shout_|board$|elsewhere)/

let patterns: Pattern[] | null = null
let parts: Map<string, string> | null = null
function allPatterns(): Pattern[] {
  if (patterns) return patterns
  const pieces: Record<string, string> = {}
  parts = new Map()
  for (const [key, msg] of Object.entries(commentaryText.messages)) {
    if (key.startsWith('part_')) parts.set(msg, key)
    else if (!BY_KEY.test(key)) pieces[key] = msg
  }
  return (patterns = compilePatterns(pieces))
}

/** The message a piece of the commentary's English came from, with what its holes held (for the tests; English only). */
export function matchCommentary(text: string): { key: string; vars: Vars } | null {
  if (!text) return null
  for (const p of allPatterns()) {
    const m = p.re.exec(text)
    if (m) return { key: p.key, vars: varsOf(p, m) }
  }
  return null
}

const said = new Map<string, string>()
const SAID_CAP = 4000
let saidIn = ''

/** One piece of a line (an event's text, the score, a word of colour, a line of play) in the viewer's language, or as it came. */
export function commentaryPiece(text: string): string {
  if (!text || activeLocale() === 'en') return text
  if (saidIn !== activeLocale() || said.size > SAID_CAP) {
    said.clear()
    saidIn = activeLocale()
  }
  const known = said.get(text)
  if (known !== undefined) return known
  const hit = matchCommentary(text)
  let out = text
  if (hit) {
    const vars: Vars = {}
    for (const [k, v] of Object.entries(hit.vars)) {
      const part = typeof v === 'string' ? parts?.get(v) : undefined
      vars[k] = part ? say(part) : v
    }
    out = say(hit.key, vars)
  }
  said.set(text, out)
  return out
}

/** A match event's own text (the events list, the highlights, the shot map's tooltips) in the viewer's language. */
export const eventLine = commentaryPiece

/** "TXI go attacking and press high." in the viewer's language; null for a change of personnel only, as `changeText`. */
export function changeLineText(e: TimelineEntry, team: string): string | null {
  if (activeLocale() === 'en') return changeText(e, team)
  const actions: string[] = []
  for (const [k, v] of Object.entries(e.instructions ?? {})) {
    const key = `change_${k}_${String(v)}`
    if (key in commentaryText.messages) actions.push(say(key))
  }
  if (e.setPieces) actions.push(say('change_setPieces'))
  const sentences: string[] = []
  if (actions.length) sentences.push(say('change_line', { team, actions: listOf(actions) }))
  if (e.shout) sentences.push(say('change_shout', { team, shout: say(`shout_${e.shout.replace(/-(.)/g, (_, c: string) => c.toUpperCase())}`) }))
  return sentences.length ? sentences.join(' ') : null
}

/** "a, b and c" in the viewer's language. */
function listOf(items: string[]): string {
  try {
    return new Intl.ListFormat(activeLocale(), { type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

function elsewhereText(s: ElsewhereScore): string {
  const vars = { home: s.home, away: s.away, homeGoals: s.homeGoals, awayGoals: s.awayGoals }
  return s.scorer ? say('elsewhereScorer', { ...vars, scorer: s.scorer, minute: minuteLabel(s.minute) }) : say('elsewhere', vars)
}

/** A commentary line in the viewer's language: its pieces mirrored, or said from its data; English exactly as written. */
export function commentaryLineText(line: Pick<CommentaryLine, 'text' | 'source'>): string {
  if (activeLocale() === 'en') return line.text
  const src = line.source
  if (!src) return commentaryPiece(line.text)
  switch (src.kind) {
    case 'parts':
      return src.parts.map(commentaryPiece).join(' ')
    case 'change':
      return changeLineText(src.entry, src.team) ?? line.text
    case 'board':
      return say('board', { n: src.added })
    case 'elsewhere':
      return elsewhereText(src.score)
  }
}
