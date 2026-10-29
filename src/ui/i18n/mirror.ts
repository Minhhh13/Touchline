/**
 * The matcher behind the catalogue mirrors (`logicText.ts` for the game logic's lines, `commentaryText.ts` for the
 * match commentary): a message of English with ICU holes becomes a regular expression, a hole matching any text, a
 * plural's `#` or a number a number, an ordinal "12th", a branch its own words. A line matched against a list of them
 * (most of their own words first) gives back the message and what its holes held, to be said again through `t()`.
 * Pure: no React, no DOM.
 */
import type { Vars } from '.'
import { parseMessage, type Part } from './icu'

export type Group = { name: string; kind: 'arg' | 'num' | 'branch'; value?: string | number }
export interface Pattern {
  key: string
  re: RegExp
  groups: Group[]
  /** How much of the message is its own words: the longest are tried first, so a line finds its most specific message. */
  weight: number
}

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

function literalLength(parts: Part[]): number {
  return parts.reduce((n, p) => n + (p.kind === 'text' ? p.text.length : p.kind === 'tag' ? p.raw.length : 'options' in p ? Math.max(...Object.values(p.options).map(literalLength)) : 0), 0)
}

/** Every message of a catalogue as a pattern, the most specific first. */
export function compilePatterns(messages: Record<string, string>): Pattern[] {
  const list: Pattern[] = []
  for (const [key, src] of Object.entries(messages)) {
    const parts = parseMessage(src)
    const groups: Group[] = []
    const re = new RegExp(`^${compile(parts, groups, null)}$`, 's')
    list.push({ key, re, groups, weight: literalLength(parts) })
  }
  return list.sort((a, b) => b.weight - a.weight)
}

/** What a match's holes held: numbers as numbers, a branch by its value, the rest as text. */
export function varsOf(p: Pattern, m: RegExpExecArray): Vars {
  const vars: Vars = {}
  p.groups.forEach((g, i) => {
    const v = m[i + 1]
    if (v === undefined) return
    if (g.kind === 'num') vars[g.name] = Number(v)
    else if (g.kind === 'arg') vars[g.name] = v
    else if (g.value !== undefined && vars[g.name] === undefined) vars[g.name] = g.value
  })
  return vars
}
