/**
 * `t()`: every user-facing string goes through a catalogue (docs/DESIGN_SYSTEM.md section 16). A catalogue is one
 * namespace of English messages, declared with `catalog('home', { … })` beside the screen that uses it, so a lazy
 * screen's English travels in its own chunk; `translator(catalogue)` gives that namespace's `t`, whose keys TypeScript
 * checks. Another language is a `locales/<id>.ts` file of full keys (`home.title`), loaded only when chosen
 * (`language.ts`); a key it leaves out reads in English. Numbers, money and dates are formatted by `src/ui/format.ts`.
 * No React here: a screen re-renders on a language change because `App.tsx` remounts it.
 */
import { formatDate, formatNumber, money, ordinal, wage } from '../format'
import { formatMessage, parseMessage, type FormatEnv, type Message, type Value } from './icu'
import { accent, PSEUDO_LOCALE, wrapPseudo } from './pseudo'

export type Messages = Readonly<Record<string, string>>
export interface Catalog<N extends string = string, M extends Messages = Messages> {
  readonly ns: N
  readonly messages: M
}
export type Vars = Record<string, Value>

/** One namespace of English messages: `catalog('home', { title: 'TouchLine', … })`. */
export function catalog<const N extends string, const M extends Messages>(ns: N, messages: M): Catalog<N, M> {
  return { ns, messages }
}

/** A loaded language: its id (BCP 47), its own name, and messages by full key (`home.title`). */
export interface LoadedLocale {
  id: string
  messages: Readonly<Record<string, string>>
}

let active: LoadedLocale = { id: 'en', messages: {} }
const parsed = new Map<string, Message>()
let pluralRules: { cardinal: Intl.PluralRules; ordinal: Intl.PluralRules } | null = null

/** The language `t()` writes in now ('en', a translation's id, or the pseudo-locale). */
export function activeLocale(): string {
  return active.id
}

/** Switch every `t()` to a loaded language (`language.ts` calls this; tests may too). */
export function setLocaleMessages(next: LoadedLocale): void {
  active = next
  pluralRules = null
}

function rules() {
  const tag = active.id === PSEUDO_LOCALE ? 'en' : active.id
  if (!pluralRules) {
    try {
      pluralRules = { cardinal: new Intl.PluralRules(tag), ordinal: new Intl.PluralRules(tag, { type: 'ordinal' }) }
    } catch {
      pluralRules = { cardinal: new Intl.PluralRules('en'), ordinal: new Intl.PluralRules('en', { type: 'ordinal' }) }
    }
  }
  return pluralRules
}

const ENV: FormatEnv = {
  plural: (n, ord) => (ord ? rules().ordinal : rules().cardinal).select(n),
  number: formatNumber,
  money,
  wage,
  date: formatDate,
  ordinal: (n) => (active.id === 'en' || active.id === PSEUDO_LOCALE ? ordinal(n) : `${formatNumber(n)}.`),
}
const PSEUDO_ENV: FormatEnv = { ...ENV, literal: accent }

function compiled(src: string): Message {
  let m = parsed.get(src)
  if (!m) {
    try {
      m = parseMessage(src)
    } catch {
      // A broken translation shows as written rather than taking the screen down (the catalogue test catches it first)
      m = [{ kind: 'text', text: src }]
    }
    parsed.set(src, m)
  }
  return m
}

/** Format one message source with values in the active language (the pseudo-locale accents and pads it). */
export function formatText(src: string, vars: Vars = {}): string {
  if (active.id === PSEUDO_LOCALE) {
    const english = formatMessage(compiled(src), vars, ENV)
    return wrapPseudo(formatMessage(compiled(src), vars, PSEUDO_ENV), english.length)
  }
  return formatMessage(compiled(src), vars, ENV)
}

export interface Translate<M extends Messages> {
  (key: keyof M & string, vars?: Vars): string
  /** The catalogue's namespace, for `rich()` and the tests. */
  readonly ns: string
}

/** The `t` for one catalogue. A key outside it (only possible through a cast) prints as `⟦ns.key⟧`. */
export function translator<N extends string, M extends Messages>(c: Catalog<N, M>): Translate<M> {
  const t = (key: keyof M & string, vars?: Vars) => {
    const src = active.messages[`${c.ns}.${key}`] ?? c.messages[key]
    if (src === undefined) return `⟦${c.ns}.${key}⟧`
    return formatText(src, vars)
  }
  return Object.assign(t, { ns: c.ns })
}
