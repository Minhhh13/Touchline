/**
 * Localisation (docs/DESIGN_SYSTEM.md section 17): the ICU subset, the pseudo-locale, the language setting, and the
 * catalogues themselves. The catalogue checks fail on a key a `t()` call names that its catalogue does not hold, a
 * catalogue key no file uses, a message that does not parse, and a translation whose keys, arguments or tags differ
 * from the English. `I18N_EXPORT=1` also writes every English message to `.i18n/en.json` for a translator.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { argumentsOf, formatMessage, parseMessage, tagsOf, type FormatEnv } from '../i18n/icu'
import { accent, isPseudo, PSEUDO_LOCALE, wrapPseudo } from '../i18n/pseudo'
import { catalog, formatText, setLocaleMessages, translator } from '../i18n'
import { languageOptions, resolveLanguage } from '../i18n/language'
import { CATALOGS } from '../i18n/en'
import { fixed, formatDate, formatNumber, money, setFormatLocale, wage } from '../format'

const root = path.resolve(__dirname, '..', '..', '..')
const ENV: FormatEnv = { plural: (n, o) => new Intl.PluralRules('en', o ? { type: 'ordinal' } : {}).select(n), number: String, money: (m) => `£${m}M`, wage: (k) => `£${k}k/wk`, date: (d) => String(d), ordinal: (n) => `${n}th` }
const fmt = (src: string, vars = {}) => formatMessage(parseMessage(src), vars, ENV)

afterEach(() => {
  setLocaleMessages({ id: 'en', messages: {} })
  setFormatLocale('en')
})

describe('the ICU subset', () => {
  it('fills arguments and leaves a missing one empty', () => {
    expect(fmt('Hello {name}!', { name: 'Ann' })).toBe('Hello Ann!')
    expect(fmt('Hello {name}!')).toBe('Hello !')
  })
  it('picks plural forms, exact matches first, with # as the number', () => {
    const m = '{n, plural, =0 {no games} one {# game} other {# games}}'
    expect([0, 1, 2, 38].map((n) => fmt(m, { n }))).toEqual(['no games', '1 game', '2 games', '38 games'])
    expect(fmt('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', { n: 22 })).toBe('22nd')
  })
  it('selects, nests and formats through the environment', () => {
    expect(fmt('{v, select, home {v} other {at}} {club}', { v: 'home', club: 'Everton' })).toBe('v Everton')
    expect(fmt('{v, select, home {v} other {at}}', { v: 'nowhere' })).toBe('at')
    expect(fmt('{a, plural, one {{b, select, x {one x} other {one y}}} other {many}}', { a: 1, b: 'x' })).toBe('one x')
    expect(fmt('{m, money} and {k, wage}, {n, ordinal}', { m: 5, k: 40, n: 3 })).toBe('£5M and £40k/wk, 3th')
  })
  it('keeps apostrophes, and quotes braces the ICU way', () => {
    expect(fmt("Don't panic, it's {n}", { n: 1 })).toBe("Don't panic, it's 1")
    expect(fmt("'{literal}' and ''")).toBe("{literal} and '")
  })
  it('passes tags through and lists arguments and tags', () => {
    const m = parseMessage('<b>{n, plural, one {# spin} other {# spins}}</b> for {who}')
    expect(formatMessage(m, { n: 2, who: 'you' }, ENV)).toBe('<b>2 spins</b> for you')
    expect([...argumentsOf(m)].sort()).toEqual(['n', 'who'])
    expect(tagsOf(m)).toEqual(['<b>', '</b>'])
    expect(fmt('a < b')).toBe('a < b')
  })
  it('refuses broken messages', () => {
    for (const bad of ['{n', 'x}', '{n, plural, one {a}}', '{n, bogus}', "'{unclosed"]) expect(() => parseMessage(bad), bad).toThrow()
  })
})

describe('the pseudo-locale', () => {
  it('accents letters only and wraps about 30% longer', () => {
    expect(accent('Setup 4-3-3')).toBe('Ŝéţûþ 4-3-3')
    const long = 'Spin the wheel to land on a real club in a real season'
    const out = wrapPseudo(accent(long), long.length)
    expect(out.startsWith('[!! ')).toBe(true)
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil(long.length * 1.3))
    expect(out.length).toBeLessThanOrEqual(Math.ceil(long.length * 1.3) + 1)
    expect(wrapPseudo('Ŝéţûþ', 5)).toBe('[!! Ŝéţûþ !!]')
  })
  it('accents the message, never its values or tags', () => {
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    const out = formatText('<b>{name}</b> scored {n, plural, one {# goal} other {# goals}}', { name: 'Kane', n: 2 })
    expect(out).toContain('<b>Kane</b>')
    expect(out).toContain('šçöŕéð 2 ĝöáļš')
    expect(isPseudo(out)).toBe(true)
    expect(isPseudo('Kane scored')).toBe(false)
  })
})

describe('t()', () => {
  const c = catalog('demo', { hi: 'Hello {name}', games: '{n, plural, one {# game} other {# games}}' })
  const t = translator(c)
  it('reads English, then a loaded translation by full key, falling back to English', () => {
    expect(t('hi', { name: 'Ann' })).toBe('Hello Ann')
    setLocaleMessages({ id: 'de', messages: { 'demo.hi': 'Hallo {name}' } })
    expect(t('hi', { name: 'Ann' })).toBe('Hallo Ann')
    expect(t('games', { n: 2 })).toBe('2 games')
    expect((t as (k: string) => string)('nope')).toBe('⟦demo.nope⟧')
  })
  it('uses the language plural rules', () => {
    setLocaleMessages({ id: 'pl', messages: { 'demo.games': '{n, plural, one {# mecz} few {# mecze} many {# meczów} other {# meczu}}' } })
    expect([1, 3, 5].map((n) => t('games', { n }))).toEqual(['1 mecz', '3 mecze', '5 meczów'])
  })
})

describe('numbers, money and dates through format.ts', () => {
  it('prints English exactly as before', () => {
    expect([money(0), money(0.45), money(4.25), money(12.34), money(180), money(1234)]).toEqual(['£0', '£450k', '£4.3M', '£12.3M', '£180M', '£1.23bn'])
    expect([wage(45.4), wage(1500)]).toEqual(['£45k/wk', '£1.50M/wk'])
    expect([formatNumber(2024), fixed(1.25, 1)]).toEqual(['2024', (1.25).toFixed(1)])
    expect(formatDate('2026-10-27')).toBe('27 Oct 2026')
    expect(formatDate('2026-10-27', 'long')).toBe('27 October 2026')
  })
  it('writes another language with its own decimal mark and month names', () => {
    setFormatLocale('de')
    expect([money(4.25), wage(1500), formatNumber(1.5), formatNumber(2024)]).toEqual(['£4,3M', '£1,50M/wk', '1,5', '2024'])
    expect(formatDate('2026-10-27', 'long')).toBe('27. Oktober 2026')
  })
})

describe('the language setting', () => {
  it('follows the device to a language TouchLine has, else English', () => {
    expect(resolveLanguage('auto', ['de-AT', 'en'], ['de', 'fr'])).toBe('de')
    expect(resolveLanguage('auto', ['pt-BR'], ['pt-BR', 'pt'])).toBe('pt-BR')
    expect(resolveLanguage('auto', ['en-GB', 'fr'], ['fr'])).toBe('en')
    expect(resolveLanguage('auto', ['ja'], ['de'])).toBe('en')
    expect(resolveLanguage('auto', [], [])).toBe('en')
  })
  it('keeps an explicit choice it has, and drops one it does not', () => {
    expect(resolveLanguage('fr', ['de'], ['de', 'fr'])).toBe('fr')
    expect(resolveLanguage('xx', ['de'], ['de'])).toBe('de')
    expect(resolveLanguage(PSEUDO_LOCALE, [], [])).toBe(PSEUDO_LOCALE)
  })
  it('lists the pseudo-locale only in development or once chosen', () => {
    expect(languageOptions('auto', false).map((o) => o.id)).toEqual(['en'])
    expect(languageOptions('auto', true).map((o) => o.id)).toEqual(['en', PSEUDO_LOCALE])
    expect(languageOptions(PSEUDO_LOCALE, false).map((o) => o.id)).toContain(PSEUDO_LOCALE)
  })
})

// ---- The catalogues -----------------------------------------------------------------------------------------

const all = CATALOGS as unknown as Record<string, { ns: string; messages: Record<string, string> }>

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}
const files = sources(path.join(root, 'src', 'ui')).map((p) => ({ p, code: readFileSync(p, 'utf8') }))

/** The first argument of each `name(` call in the code. */
function firstArgs(code: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`(?<![\\w.$])${name}\\(`, 'g')
  while (re.exec(code)) {
    let i = re.lastIndex
    let depth = 0
    let quote: string | null = null
    const start = i
    for (; i < code.length; i++) {
      const c = code[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) {
        if (depth === 0) break
        depth--
      } else if (c === ',' && depth === 0) break
    }
    out.push(code.slice(start, i))
  }
  return out
}

/** The keys a call's first argument can name: its quoted strings, less the operands of a comparison (`x === 'cup' ? 'a' : 'b'`). */
function keysIn(arg: string): string[] {
  const out: string[] = []
  for (const m of arg.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
    const before = arg.slice(0, m.index).trimEnd()
    const after = arg.slice(m.index! + m[0].length).trimStart()
    if (/[=!]=$/.test(before) || /^[=!]=/.test(after)) continue
    out.push(m[1])
  }
  return out
}

/** Each file's translators: the local name, the catalogue's namespace. */
function translatorsOf(code: string): Array<{ name: string; ns: string }> {
  const imports = new Map<string, string>()
  for (const m of code.matchAll(/import \{([^}]+)\} from '[./]+(?:i18n\/)?en\/(\w+)'/g)) for (const id of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!)) imports.set(id, m[2])
  const out: Array<{ name: string; ns: string }> = []
  for (const m of code.matchAll(/const (\w+) = translator\((\w+)\)/g)) {
    const ns = imports.get(m[2])
    if (ns && all[ns]) out.push({ name: m[1], ns })
  }
  return out
}

describe('the catalogues', () => {
  it('register every catalogue file once, under its own namespace', () => {
    const onDisk = readdirSync(path.join(root, 'src/ui/i18n/en')).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.replace(/\.ts$/, '')).sort()
    expect(Object.keys(all).sort()).toEqual(onDisk)
    for (const [k, c] of Object.entries(all)) expect(c.ns, k).toBe(k)
  })

  it('hold only messages that parse', () => {
    const bad: string[] = []
    for (const c of Object.values(all))
      for (const [k, v] of Object.entries(c.messages)) {
        try {
          parseMessage(v)
        } catch (e) {
          bad.push(`${c.ns}.${k}: ${(e as Error).message}`)
        }
      }
    expect(bad).toEqual([])
  })

  it('hold every key a t() call names (a missing key fails here)', () => {
    const missing: string[] = []
    let calls = 0
    for (const { p, code } of files)
      for (const { name, ns } of translatorsOf(code))
        for (const arg of firstArgs(code, name))
          for (const key of keysIn(arg)) {
            calls++
            if (!(key in all[ns].messages)) missing.push(`${path.relative(root, p)}: ${ns}.${key}`)
          }
    expect(missing).toEqual([])
    expect(calls).toBeGreaterThan(50)
  })

  it('hold no key that no file uses', () => {
    const unused: string[] = []
    for (const c of Object.values(all)) {
      const users = files.filter(({ code }) => translatorsOf(code).some((x) => x.ns === c.ns))
      const literals = new Set(users.flatMap(({ code }) => translatorsOf(code).filter((x) => x.ns === c.ns).flatMap((x) => firstArgs(code, x.name))).flatMap(keysIn))
      // A key built from a template (`t(\`tier_${x}\`)`) counts as used through its prefix
      const prefixes = users.flatMap(({ code }) => [...code.matchAll(/\(`(\w+)\$\{/g)].map((m) => m[1]))
      for (const k of Object.keys(c.messages)) if (!literals.has(k) && !prefixes.some((pre) => k.startsWith(pre))) unused.push(`${c.ns}.${k}`)
    }
    expect(unused).toEqual([])
  })

  it('accept only translations that match the English', async () => {
    const dir = path.join(root, 'src/ui/i18n/locales')
    const problems: string[] = []
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'types.ts')) {
      const mod = (await import(/* @vite-ignore */ path.join(dir, f))) as { default: { id: string; messages: Record<string, string> } }
      expect(mod.default.id, f).toBe(f.replace(/\.ts$/, ''))
      for (const [full, msg] of Object.entries(mod.default.messages)) {
        const [ns, ...rest] = full.split('.')
        const en = all[ns]?.messages[rest.join('.')]
        if (en === undefined) {
          problems.push(`${f}: unknown key ${full}`)
          continue
        }
        try {
          const a = parseMessage(en)
          const b = parseMessage(msg)
          if ([...argumentsOf(a)].sort().join() !== [...argumentsOf(b)].sort().join()) problems.push(`${f}: ${full} arguments differ`)
          if ([...tagsOf(a)].sort().join() !== [...tagsOf(b)].sort().join()) problems.push(`${f}: ${full} tags differ`)
        } catch (e) {
          problems.push(`${f}: ${full} ${(e as Error).message}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('keep the English the game logic and the box sets hold, word for word', async () => {
    const { ALL_SETS } = await import('../boxSets')
    const { MATCHDAY_COMPACT } = await import('../matchday/widgetIds')
    const { DAMAGED_LINK_TOAST } = await import('../gameHash')
    const boxes = all.boxes.messages
    for (const set of [...ALL_SETS, MATCHDAY_COMPACT]) {
      expect(boxes[`boxes_${set.screen}`], set.screen).toBe(set.title)
      for (const b of set.boxes) expect(boxes[`box_${set.screen}_${b.id}`], `${set.screen} ${b.id}`).toBe(b.label)
    }
    expect(all.shell.messages.damagedLink).toBe(DAMAGED_LINK_TOAST)
  })

  it('give the modes the same English names as modes.ts', async () => {
    const { MODE_TITLE, modeLabel, finishDraftLabel, arenaFormatLabel, yearLabel } = await import('@game/logic/modes')
    const { modeText, modeTitle, finishDraftText, arenaFormatText, yearText } = await import('../i18n/modeText')
    const arenas = [undefined, { format: 'cup' as const, size: 2 }, { format: 'cup' as const, size: 16 }, { format: 'gauntlet' as const }, { format: 'cup' as const, size: 2, daily: true }]
    for (const mode of Object.keys(MODE_TITLE) as Array<keyof typeof MODE_TITLE>) {
      expect(modeTitle(mode)).toBe(MODE_TITLE[mode])
      for (const arena of arenas)
        for (const year of [1, 3])
          for (const step of [0, 2]) {
            const game = { year, arena: { step } as never, settings: { mode, seed: mode === 'weekly' ? 'weekly-2026-W44' : 'daily-2026-10-27', arena: arena as never, weekly: { theme: 'golden-oldies' } as never } }
            for (const style of ['short', 'heading'] as const) expect(modeText(game, style), `${mode} ${style}`).toBe(modeLabel(game, style))
            expect(finishDraftText(game), mode).toBe(finishDraftLabel(game))
            expect(finishDraftText(game, 15)).toBe(finishDraftLabel(game, 15))
            expect(yearText(game)).toBe(yearLabel(game))
          }
    }
    for (const a of arenas) expect(arenaFormatText(a)).toBe(arenaFormatLabel(a))
  })

  it('give the achievements, badges and milestones the engine English', async () => {
    const { ACHIEVEMENTS } = await import('@engine/awards')
    const { BADGES, badgeProgress } = await import('@engine/badges')
    const { MILESTONE_BADGES, milestoneProgress } = await import('@game/logic/milestoneBadges')
    const { countPhrase } = await import('../screenText')
    const tt = await import('../i18n/trophyText')
    const msgs = all.trophies.messages
    for (const a of ACHIEVEMENTS) {
      expect(msgs[`ach_${a.id}_title`], a.id).toBe(a.title)
      expect(msgs[`ach_${a.id}_desc`], a.id).toBe(a.description)
    }
    for (const b of BADGES) {
      expect(tt.badgeTitle(b)).toBe(b.title)
      expect(msgs[`badge_${b.id}_count`], b.id).toBeDefined()
      for (const n of [0, 1, 2, 12]) expect(tt.badgeCount(b, n)).toBe(countPhrase(n, b.counts))
      for (const v of [0, ...b.tiers, b.tiers.at(-1)! + 5]) expect(tt.progressText(b.tiers, v)).toBe(badgeProgress(b, v))
    }
    for (const m of MILESTONE_BADGES) {
      expect(tt.milestoneTitle(m)).toBe(m.title)
      expect(msgs[`milestone_${m.id}_count`], m.id).toBeDefined()
      for (const n of [0, 1, 2]) expect(tt.milestoneCount(m, n)).toBe(m.tiers.length === 1 ? m.counts : countPhrase(n, m.counts))
      for (const v of [0, ...m.tiers, m.tiers.at(-1)! + 5]) expect(tt.progressText(m.tiers, v, m.tiers.length === 1)).toBe(milestoneProgress(m.tiers, v))
    }
  })

  it.runIf(process.env.I18N_EXPORT === '1')('exports every English message for a translator', () => {
    const out: Record<string, string> = {}
    for (const c of Object.values(all)) for (const [k, v] of Object.entries(c.messages)) out[`${c.ns}.${k}`] = v
    mkdirSync(path.join(root, '.i18n'), { recursive: true })
    writeFileSync(path.join(root, '.i18n', 'en.json'), JSON.stringify(out, null, 2) + '\n')
  })
})
