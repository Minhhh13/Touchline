/**
 * A small ICU MessageFormat subset, pure and dependency-free: `{name}`, `{n, number}`, `{m, money}`, `{k, wage}`,
 * `{d, date}` / `{d, date, long}`, `{n, ordinal}`, `{n, plural, =0 {…} one {# game} other {# games}}`,
 * `{n, selectordinal, one {#st} …}` and `{x, select, a {…} other {…}}`. Rich-text tags (`<b>…</b>`) pass through
 * untouched for `rich()` to turn into elements. Quoting follows ICU: `''` is one apostrophe and `'{` starts a quoted
 * run up to the next apostrophe; any other apostrophe ("don't") is just an apostrophe.
 */

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; raw: string }
  | { kind: 'hash' }
  | { kind: 'arg'; name: string; format?: 'number' | 'money' | 'wage' | 'date' | 'ordinal'; style?: string }
  | { kind: 'plural' | 'selectordinal' | 'select'; name: string; options: Record<string, Part[]> }

export type Message = Part[]

/** The formatters a message reaches for; the numbers, money and dates come from `src/ui/format.ts`. */
export interface FormatEnv {
  plural(n: number, ordinal: boolean): string
  number(n: number): string
  money(m: number): string
  wage(k: number): string
  date(v: Date | string | number, style?: string): string
  ordinal(n: number): string
  /** Applied to the literal text only (the pseudo-locale), never to an argument's value or a tag. */
  literal?: (text: string) => string
}

export type Value = string | number | Date | null | undefined

export class MessageError extends Error {}

const FORMATS = new Set(['number', 'money', 'wage', 'date', 'ordinal'])
const TAG = /^<\/?[a-zA-Z][\w-]*>/

/** Parse a message; throws a `MessageError` naming the problem. */
export function parseMessage(src: string): Message {
  let i = 0
  const fail = (why: string): never => {
    throw new MessageError(`${why} at ${i} in "${src}"`)
  }
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  const word = () => {
    ws()
    const m = /^[\w=-]+/.exec(src.slice(i))
    if (!m) fail('expected a name')
    i += m![0].length
    ws()
    return m![0]
  }
  const parts = (inPlural: boolean, depth: number): Part[] => {
    const out: Part[] = []
    let text = ''
    const flush = () => {
      if (text) out.push({ kind: 'text', text })
      text = ''
    }
    while (i < src.length) {
      const c = src[i]
      if (c === "'") {
        const next = src[i + 1]
        if (next === "'") {
          text += "'"
          i += 2
        } else if (next === '{' || next === '}' || next === '<' || (inPlural && next === '#')) {
          const end = src.indexOf("'", i + 1)
          if (end < 0) fail('unclosed quote')
          text += src.slice(i + 1, end)
          i = end + 1
        } else {
          text += c
          i++
        }
      } else if (c === '}') {
        if (depth === 0) fail('unexpected }')
        break
      } else if (c === '{') {
        flush()
        i++
        out.push(argument(depth))
      } else if (c === '#' && inPlural) {
        flush()
        out.push({ kind: 'hash' })
        i++
      } else if (c === '<' && TAG.test(src.slice(i))) {
        flush()
        const raw = TAG.exec(src.slice(i))![0]
        out.push({ kind: 'tag', raw })
        i += raw.length
      } else {
        text += c
        i++
      }
    }
    flush()
    return out
  }
  const argument = (depth: number): Part => {
    const name = word()
    if (src[i] === '}') {
      i++
      return { kind: 'arg', name }
    }
    if (src[i] !== ',') fail('expected , or }')
    i++
    const type = word()
    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      if (src[i] !== ',') fail(`expected , after ${type}`)
      i++
      const options: Record<string, Part[]> = {}
      ws()
      while (src[i] !== '}') {
        if (i >= src.length) fail('unclosed argument')
        const key = word()
        if (src[i] !== '{') fail(`expected { after ${key}`)
        i++
        options[key] = parts(type !== 'select', depth + 1)
        if (src[i] !== '}') fail('unclosed option')
        i++
        ws()
      }
      i++
      if (!options.other) fail(`${type} needs an "other" option`)
      return { kind: type, name, options }
    }
    if (!FORMATS.has(type)) fail(`unknown format ${type}`)
    let style: string | undefined
    if (src[i] === ',') {
      i++
      style = word()
    }
    if (src[i] !== '}') fail('expected }')
    i++
    return { kind: 'arg', name, format: type as 'number', style }
  }
  const out = parts(false, 0)
  if (i < src.length) fail('trailing input')
  return out
}

/** The argument names a message reads (for checking a translation against its English). */
export function argumentsOf(msg: Message): Set<string> {
  const out = new Set<string>()
  const walk = (ps: Part[]) => {
    for (const p of ps) {
      if (p.kind === 'arg') out.add(p.name)
      else if (p.kind === 'plural' || p.kind === 'select' || p.kind === 'selectordinal') {
        out.add(p.name)
        Object.values(p.options).forEach(walk)
      }
    }
  }
  walk(msg)
  return out
}

/** The tags a message carries, in order (a translation must keep the same set). */
export function tagsOf(msg: Message): string[] {
  const out: string[] = []
  const walk = (ps: Part[]) => {
    for (const p of ps) {
      if (p.kind === 'tag') out.push(p.raw)
      else if (p.kind === 'plural' || p.kind === 'select' || p.kind === 'selectordinal') Object.values(p.options).forEach(walk)
    }
  }
  walk(msg)
  return out
}

const asNumber = (v: Value) => (typeof v === 'number' ? v : Number(v))

/** Fill a parsed message with values. A missing value prints as nothing, never "undefined". */
export function formatMessage(msg: Message, vars: Record<string, Value>, env: FormatEnv, hash?: number): string {
  let out = ''
  for (const p of msg) {
    switch (p.kind) {
      case 'text':
        out += env.literal ? env.literal(p.text) : p.text
        break
      case 'tag':
        out += p.raw
        break
      case 'hash':
        out += hash === undefined ? '#' : env.number(hash)
        break
      case 'arg': {
        const v = vars[p.name]
        if (v === null || v === undefined) break
        if (p.format === 'number') out += env.number(asNumber(v))
        else if (p.format === 'money') out += env.money(asNumber(v))
        else if (p.format === 'wage') out += env.wage(asNumber(v))
        else if (p.format === 'ordinal') out += env.ordinal(asNumber(v))
        else if (p.format === 'date') out += env.date(v, p.style)
        else out += typeof v === 'number' ? env.number(v) : v instanceof Date ? env.date(v) : v
        break
      }
      case 'select': {
        const v = String(vars[p.name] ?? 'other')
        out += formatMessage(p.options[v] ?? p.options.other, vars, env, hash)
        break
      }
      case 'plural':
      case 'selectordinal': {
        const n = asNumber(vars[p.name])
        const exact = p.options[`=${n}`]
        const chosen = exact ?? p.options[env.plural(n, p.kind === 'selectordinal')] ?? p.options.other
        out += formatMessage(chosen, vars, env, n)
        break
      }
    }
  }
  return out
}
