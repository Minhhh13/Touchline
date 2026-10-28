/**
 * r8 audit: every animated rule in styles.css and visuals.css is switched off under prefers-reduced-motion by a
 * reduced-motion rule that actually wins the cascade (DESIGN_SYSTEM section 12, rule 5). A reduced-motion block placed
 * before a rule of equal specificity never reaches it: the toast, the scrim, the hero art, the other side's goal banner,
 * the draft recap and four hover lifts kept moving that way until the last block of styles.css.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const UI = join(__dirname, '..')

type Rule = { file: string; line: number; order: number; selectors: string[]; decls: { prop: string; value: string; important: boolean }[]; media: string[] }

/** A small block parser: enough for these two stylesheets (no strings holding braces). */
function parseRules(file: string): Rule[] {
  const text = readFileSync(join(UI, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  const breaks: number[] = []
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) breaks.push(i)
  const lineAt = (pos: number) => {
    let lo = 0
    let hi = breaks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (breaks[mid] < pos) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
  const rules: Rule[] = []
  const stack: string[] = []
  let start = 0
  let order = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      const prelude = text.slice(start, i).trim()
      const inKeyframes = stack.some((s) => /^@(-webkit-)?keyframes/.test(s))
      if (!prelude.startsWith('@') && !inKeyframes) {
        const end = text.indexOf('}', i)
        const body = text.slice(i + 1, end)
        const decls = body
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d.includes(':'))
          .map((d) => {
            const k = d.indexOf(':')
            const value = d.slice(k + 1).trim()
            return { prop: d.slice(0, k).trim(), value: value.replace(/\s*!important$/, ''), important: /!important$/.test(value) }
          })
        const line = lineAt(start + (text.slice(start, i).length - text.slice(start, i).trimStart().length))
        rules.push({ file, line, order: order++, selectors: splitSelectors(prelude), decls, media: [...stack] })
        i = end
        start = end + 1
        continue
      }
      stack.push(prelude)
      start = i + 1
    } else if (ch === '}') {
      stack.pop()
      start = i + 1
    } else if (ch === ';' && stack.length === 0) {
      start = i + 1
    }
  }
  return rules
}

function splitSelectors(prelude: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of prelude) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim().replace(/\s+/g, ' '))
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim().replace(/\s+/g, ' '))
  return out
}

/** Rough specificity (ids, classes and pseudo-classes and attributes, elements), enough to compare these rules. */
function specificity(sel: string): number {
  const s = sel.replace(/:(not|is|has)\(([^()]*)\)/g, ' $2').replace(/::?[\w-]+\([^()]*\)/g, (m) => (m.startsWith('::') ? ' ::x' : ' :x'))
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):[\w-]+/g) ?? []).length
  const els = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length
  return ids * 10000 + cls * 100 + els
}

const compounds = (sel: string): string[] => sel.split(/\s*[\s>+~]\s*(?![^(]*\))/).filter(Boolean)
const simples = (compound: string): string[] => compound.match(/\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?|^[a-z][\w-]*/gi) ?? []
/** Classes the lockup always carries beside these (Logo.tsx: `tl-lockup tl-play`, `tl-lockup tl-hover`). */
const SAME_ELEMENT: Record<string, string> = { '.tl-play': '.tl-play.tl-lockup', '.tl-hover': '.tl-hover.tl-lockup' }
const widen = (sel: string) => sel.replace(/\.tl-(play|hover)(?![\w-])/g, (m) => SAME_ELEMENT[m])

/** Does reduced-motion selector `r` match every element `a` matches (a sound, partial check)? */
function reaches(r: string, a: string): boolean {
  if (r === a) return true
  const wa = widen(a)
  const rc = compounds(r)
  const last = simples(compounds(wa).at(-1) ?? '')
  if (!simples(rc.at(-1) ?? '').every((x) => last.includes(x))) return false
  const ancestors = compounds(wa).slice(0, -1)
  return rc.slice(0, -1).every((c) => ancestors.some((x) => simples(c).every((y) => simples(x).includes(y))))
}

const isReducedMotion = (r: Rule) => r.media.some((m) => /prefers-reduced-motion:\s*reduce/.test(m))

function uncovered(): string[] {
  const out: string[] = []
  for (const file of ['styles.css', 'visuals.css']) {
    const rules = parseRules(file)
    const rm = rules.filter(isReducedMotion)
    for (const a of rules) {
      if (isReducedMotion(a) || a.media.some((m) => /no-preference/.test(m))) continue
      const kinds: ('animation' | 'transition')[] = []
      if (a.decls.some((d) => /^animation(-name)?$/.test(d.prop) && d.value !== 'none')) kinds.push('animation')
      if (a.decls.some((d) => /^transition(-property)?$/.test(d.prop) && /\b(transform|all)\b/.test(d.value))) kinds.push('transition')
      for (const kind of kinds)
        for (const sel of a.selectors) {
          const sa = specificity(sel)
          const covered = rm.some((r) =>
            r.selectors.some((rs) => {
              // A hidden ancestor (the celebration, the confetti) or the view transitions' own wildcard
              if (r.decls.some((d) => d.prop === 'display' && d.value === 'none') && (sel === rs || sel.startsWith(rs + ' '))) return true
              const off = r.decls.find((d) => d.prop === kind && d.value === 'none')
              if (!off) return false
              if (rs.startsWith('::view-transition') && rs.includes('(*)') && sel.startsWith(rs.split('(')[0])) return off.important
              if (!reaches(rs, sel)) return false
              const sr = specificity(rs)
              return off.important || sr > sa || (sr === sa && r.order > a.order)
            }),
          )
          if (!covered) out.push(`${file}:${a.line} ${kind} ${sel}`)
        }
    }
  }
  return out
}

describe('reduced motion reaches every animated rule', () => {
  it('parses the stylesheets (a sanity check on the parser)', () => {
    const rules = parseRules('styles.css')
    expect(rules.length).toBeGreaterThan(2000)
    expect(rules.filter(isReducedMotion).length).toBeGreaterThan(20)
    expect(specificity('.goal-burst.theirs .banner')).toBe(300)
    expect(reaches('.tl-lockup .tl-name', '.tl-play .tl-name')).toBe(true)
    expect(reaches('.toast', '.toast.leaving')).toBe(true)
    expect(reaches('.toast.leaving', '.toast')).toBe(false)
  })

  it('every animation and transform transition in styles.css and visuals.css is off under prefers-reduced-motion', () => {
    expect(uncovered()).toEqual([])
  })

  it('the stylesheets keep their braces balanced', () => {
    for (const file of ['styles.css', 'visuals.css']) {
      const text = readFileSync(join(UI, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect((text.match(/{/g) ?? []).length, file).toBe((text.match(/}/g) ?? []).length)
    }
  })
})
