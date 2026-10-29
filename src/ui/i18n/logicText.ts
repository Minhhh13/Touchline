/**
 * The mirror of the game logic's own English (r10): lines the engine and `src/game/logic` build for themselves (the
 * Inbox's stored news, the briefing, the dressing room, the planner, the Office's answers, morale reasons, round
 * names…) stay where they are, and a screen reads them through `logicLine()`. Each message of the `logicText`
 * catalogue is the logic's English with its holes as ICU arguments; in another language the line is matched against
 * those messages (a hole matches any text, a plural's `#` a number, a branch its own words) and said again through
 * `t()` with what the holes held, each hole's text mirrored in turn (a round name inside "{round}: through"). A line
 * no message matches reads as it was: a name, or English nobody mirrored yet. English never matches: it is returned
 * as it came, so the logic's words, the share text and the verifier's bundle are untouched.
 * `src/ui/__tests__/copyMirror.test.ts` holds every message to its source's English.
 */
import { activeLocale, translator, type Vars } from '.'
import { parseMessage, type Part } from './icu'
import { logicText } from './en/logicText'
import { setLogicMirror } from './logicLine'

const t = translator(logicText)
/** `t` by a key found at run time (the message a line matched). */
const say = (key: string, vars: Vars) => t(key as keyof typeof logicText.messages & string, vars)

type Group = { name: string; kind: 'arg' | 'num' | 'branch'; value?: string | number }
interface Pattern {
  key: keyof typeof logicText.messages & string
  re: RegExp
  groups: Group[]
}

/** Messages too general to stand alone ("{objective}: {risk}"): they match only when every hole is itself a known line. */
const STRICT = new Set<string>(['briefing_objectiveRisk', 'runin_verdictLine'])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PLURAL_VALUE: Record<string, number> = { zero: 0, one: 1, two: 2 }

/** A message as a regular expression, its capture groups in `groups` (one per hole, branch and `#`). */
function compile(parts: Part[], groups: Group[], plural: string | null): string {
  let out = ''
  for (const p of parts) {
    if (p.kind === 'text') out += escape(p.text)
    else if (p.kind === 'tag') out += escape(p.raw)
    else if (p.kind === 'hash') {
      groups.push({ name: plural ?? '', kind: 'num' })
      out += '(-?\\d+(?:\\.\\d+)?)'
    } else if (p.kind === 'arg') {
      if (p.format === 'number' || p.format === 'ordinal') {
        groups.push({ name: p.name, kind: 'num' })
        out += p.format === 'ordinal' ? '(\\d+)(?:st|nd|rd|th)' : '(-?\\d+(?:\\.\\d+)?)'
      } else {
        groups.push({ name: p.name, kind: 'arg' })
        out += '(.+?)'
      }
    } else {
      // An exact branch (`=0`) first, so "no games" is not read as the `other` branch of a number
      const options = Object.entries(p.options).sort(([a], [b]) => Number(b.startsWith('=')) - Number(a.startsWith('=')))
      const alts = options.map(([k, ps]) => {
        const value = p.kind === 'select' ? k : k.startsWith('=') ? Number(k.slice(1)) : PLURAL_VALUE[k]
        groups.push({ name: p.name, kind: 'branch', value })
        return `(${compile(ps, groups, p.kind === 'select' ? plural : p.name)})`
      })
      out += `(?:${alts.join('|')})`
    }
  }
  return out
}

/** How much of a message is its own words: the longest are tried first, so a line finds its most specific message. */
function literalLength(parts: Part[]): number {
  return parts.reduce((n, p) => n + (p.kind === 'text' ? p.text.length : p.kind === 'tag' ? p.raw.length : 'options' in p ? Math.max(...Object.values(p.options).map(literalLength)) : 0), 0)
}

let patterns: Pattern[] | null = null
function allPatterns(): Pattern[] {
  if (patterns) return patterns
  const list: Array<Pattern & { weight: number }> = []
  for (const [key, src] of Object.entries(logicText.messages)) {
    const parts = parseMessage(src)
    const groups: Group[] = []
    const re = new RegExp(`^${compile(parts, groups, null)}$`, 's')
    list.push({ key: key as Pattern['key'], re, groups, weight: literalLength(parts) })
  }
  list.sort((a, b) => b.weight - a.weight)
  return (patterns = list)
}

/** The message a line of the logic's English came from, with what its holes held (for the tests; English only). */
export function matchLogicLine(text: string, depth = 0): { key: string; vars: Vars } | null {
  if (!text || depth > 4) return null
  for (const p of allPatterns()) {
    const m = p.re.exec(text)
    if (!m) continue
    if (STRICT.has(p.key) && p.groups.some((g, i) => g.kind === 'arg' && m[i + 1] !== undefined && !matchLogicLine(m[i + 1], depth + 1))) continue
    const vars: Vars = {}
    p.groups.forEach((g, i) => {
      const v = m[i + 1]
      if (v === undefined) return
      if (g.kind === 'num') vars[g.name] = Number(v)
      else if (g.kind === 'arg') vars[g.name] = v
      else if (g.value !== undefined && vars[g.name] === undefined) vars[g.name] = g.value
    })
    return { key: p.key, vars }
  }
  return null
}

const said = new Map<string, string>()
const SAID_CAP = 4000
let saidIn = ''

/** A line the game logic built, in the viewer's language: mirrored through the `logicText` catalogue, or as it came. */
export function logicLine(text: string): string
export function logicLine(text: string | undefined): string | undefined
export function logicLine(text: string | null | undefined): string | null | undefined
export function logicLine(text: string | null | undefined): string | null | undefined {
  if (!text || activeLocale() === 'en') return text
  // A new language, or a long session's worth of lines, starts the memo again
  if (saidIn !== activeLocale() || said.size > SAID_CAP) {
    said.clear()
    saidIn = activeLocale()
  }
  const known = said.get(text)
  if (known !== undefined) return known
  let out = mirror(text, 0)
  // A line of several sentences the logic put together (the pundit's verdict) is mirrored sentence by sentence
  if (out === text && /[.!?] [A-Z]/.test(text)) out = text.split(/(?<=[.!?]) (?=[A-Z])/).map((x) => mirror(x, 0)).join(' ')
  said.set(text, out)
  return out
}

function mirror(text: string, depth: number): string {
  const hit = matchLogicLine(text, depth)
  // A hole that holds a list ("£12M, £80k a week, 3 seasons as first team") is mirrored item by item
  if (!hit) return depth > 0 && text.includes(', ') ? text.split(', ').map((x) => mirror(x, depth + 1)).join(', ') : text
  const vars: Vars = {}
  for (const [k, v] of Object.entries(hit.vars)) vars[k] = typeof v === 'string' ? mirror(v, depth + 1) : v
  return say(hit.key, vars)
}

/** A line the logic joined from pieces (a setup summary: "Ten FC, 4-3-3, in the Premier League 2025-26, calibrated, seed X"), mirrored piece by piece. */
export function logicList(text: string, separator: string): string {
  return activeLocale() === 'en' ? text : text.split(separator).map((x) => logicLine(x)).join(separator)
}

setLogicMirror((text) => logicLine(text))
