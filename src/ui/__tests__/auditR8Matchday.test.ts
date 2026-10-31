/** The r8 audit of the match-day dashboard (src/ui/matchday): the P key under a drawer, reduced motion, dead CSS, the drag ghost. */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pauseKeyFires } from '../matchday/controls'

const dir = join(__dirname, '..', 'matchday')
const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8')
const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const SHEETS = ['matchday.css', 'matchday-controls.css', 'matchday-phone.css']

const key = (k: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...o })

describe('the P key', () => {
  it('pauses and resumes on P or p, off any control, with no dialog open', () => {
    expect(pauseKeyFires(key('p'), false, false)).toBe(true)
    expect(pauseKeyFires(key('P'), false, false)).toBe(true)
  })
  it('does nothing while a drawer or another dialog is open over the board (the drawer paused the match)', () => {
    expect(pauseKeyFires(key('p'), false, true)).toBe(false)
  })
  it('does nothing on a control, with a modifier, on a held key repeating or for another key', () => {
    expect(pauseKeyFires(key('p'), true, false)).toBe(false)
    expect(pauseKeyFires(key('p', { ctrlKey: true }), false, false)).toBe(false)
    expect(pauseKeyFires(key('p', { metaKey: true }), false, false)).toBe(false)
    expect(pauseKeyFires(key('p', { altKey: true }), false, false)).toBe(false)
    expect(pauseKeyFires(key('p', { repeat: true }), false, false)).toBe(false)
    expect(pauseKeyFires(key('o'), false, false)).toBe(false)
    expect(pauseKeyFires(key(' '), false, false)).toBe(false)
  })
  it('is what the dashboard asks, with the open dialog layers', () => {
    const dash = read('MatchDashboard.tsx')
    expect(dash).toContain('pauseKeyFires(e, isControlTarget(e.target as HTMLElement | null), openLayers() > 0)')
  })
})

/** Every top-level and media rule's selectors with its body, from one sheet (comments stripped). */
function rules(sheet: string): Array<{ selectors: string[]; body: string; reduced: boolean }> {
  const src = bare(sheet)
  const out: Array<{ selectors: string[]; body: string; reduced: boolean }> = []
  const stack: string[] = []
  let buf = ''
  let start = -1
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') {
      stack.push(buf.trim())
      buf = ''
      start = i + 1
    } else if (ch === '}') {
      const sel = stack.pop() ?? ''
      if (!sel.startsWith('@') && start >= 0) out.push({ selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: src.slice(start, i), reduced: stack.some((s) => s.includes('prefers-reduced-motion')) })
      buf = ''
      start = -1
    } else if (ch === ';') buf = ''
    else buf += ch
  }
  return out
}

describe('reduced motion on the match day', () => {
  const all = SHEETS.flatMap((f) => rules(read(f)))
  const stilled = new Set(all.filter((r) => r.reduced && /animation:\s*none/.test(r.body)).flatMap((r) => r.selectors))
  it('stills every animation the sheets start, by the same selector (the key banner line ran on: its rule outranked the block)', () => {
    const animated = all.filter((r) => !r.reduced && /(^|[;\s])animation:\s*(?!none)/.test(r.body)).flatMap((r) => r.selectors)
    expect(animated.length).toBeGreaterThan(3)
    expect(animated.filter((s) => !stilled.has(s))).toEqual([])
    expect(stilled.has('.matchday .md-banner.key .txt')).toBe(true)
  })
})

describe('the match-day sheets hold no dead rules', () => {
  /** Every .ts and .tsx file under src, tests left out. */
  const sources = (root: string): string[] =>
    readdirSync(root).flatMap((name) => {
      const p = join(root, name)
      if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p)
      return /\.(ts|tsx)$/.test(name) ? [readFileSync(p, 'utf8')] : []
    })
  const code = sources(join(__dirname, '..', '..')).join('\n')
  it('every class they style is written by some component (the fit glows are built as glow-<fit>)', () => {
    const classes = new Set(SHEETS.flatMap((f) => [...bare(read(f)).matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1])))
    const dynamic = (c: string) => /^glow-(natural|cover|out)$/.test(c) && code.includes('glow-${')
    const unused = [...classes].filter((c) => !dynamic(c) && !new RegExp(`(^|[^a-zA-Z0-9_-])${c}([^a-zA-Z0-9_-]|$)`, 'm').test(code))
    expect(unused).toEqual([])
  })
})

describe('the substitution board drag', () => {
  it('moves the ghost by writing its transform, not by a render per pointer move', () => {
    const board = read('drawers', 'SubBoard.tsx')
    const move = board.slice(board.indexOf('const move = '), board.indexOf('const up = '))
    expect(move).toContain('ghostRef.current.style.transform')
    expect(move).toMatch(/else if \(!ghost\) setGhost\(at\)/)
  })
})
