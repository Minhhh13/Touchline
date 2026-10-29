import { describe, expect, it, vi } from 'vitest'
// The setup memory reads and writes localStorage: an in-memory stand-in, which can also refuse like blocked storage
const disk = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { blocked: false, mem }
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => {
        if (state.blocked) throw new DOMException('denied', 'SecurityError')
        return mem.get(k) ?? null
      },
      setItem: (k: string, v: string) => {
        if (state.blocked) throw new DOMException('denied', 'SecurityError')
        mem.set(k, v)
      },
      removeItem: (k: string) => void mem.delete(k),
    },
    configurable: true,
  })
  return state
})
import { FORMATIONS } from '@engine/formations'
import { Chooser } from '../../game/__tests__/qaHarness'
import { defaultChoices, isDefault, loadChoices, readChoices, saveChoices, setupKey, type MemoryMode, type SetupChoices } from '../setupMemory'

/**
 * QA round 6 (r11, docs/QA.md): Setup's remembered choices (`setupMemory.ts`, round 10) read from whatever a viewer's
 * storage holds: another build's fields, a hand-edited value, half a write, blocked storage. Whatever comes in, the
 * screen gets whole choices of the right shapes, a second read changes nothing, a save reads back as it went, the
 * defaults leave no key, and one mode's memory never reaches another's.
 */
const MODES: MemoryMode[] = ['quick', 'season', 'dynasty']

function junk(ch: Chooser, depth = 0): unknown {
  const r = ch.int(0, 11)
  if (r === 0) return null
  if (r === 1) return undefined
  if (r === 2) return ch.chance(0.5)
  if (r === 3) return ch.pick([0, -1, 1.5, 3, 18, 22, 99, 1e9, NaN, Infinity])
  if (r === 4) return ch.pick(['', 'custom', 'all', 'spin', 'hard', 'england', 'spain', '4-3-3', '4-4-2-diamond', '../x', 'ENGLAND', 'a'.repeat(60), 'moneyball'])
  if (r === 5 && depth < 2) return Array.from({ length: ch.int(0, 4) }, () => junk(ch, depth + 1))
  if (r === 6 && depth < 2) return { preset: junk(ch, depth + 1), custom: junk(ch, depth + 1) }
  if (r === 7) return ch.pick([['crazy', 'crazy', 'upgrader'], ['legends', 'nope'], [2010, 2015], [2015, 2010], [2010], ['2010', '2015']])
  return ch.pick(['x', 1, true, {}, []])
}

const FIELDS = Object.keys(defaultChoices('quick')) as Array<keyof SetupChoices>

function shapeProblems(c: SetupChoices, label: string): string[] {
  const out: string[] = []
  const d = defaultChoices('quick')
  for (const k of FIELDS) {
    const want = k === 'customEra' || k === 'twistsChoice' ? null : Array.isArray(d[k]) ? 'array' : typeof d[k]
    const v = c[k]
    if (v === null) {
      if (want !== null) out.push(`${label} ${k} null`)
    } else if (want === 'array' ? !Array.isArray(v) : want !== null && typeof v !== want) out.push(`${label} ${k} ${JSON.stringify(v)}`)
    if (typeof v === 'number' && !Number.isFinite(v)) out.push(`${label} ${k} ${v}`)
  }
  if (!FORMATIONS.some((f) => f.id === c.formationId)) out.push(`${label} formation ${c.formationId}`)
  if (c.eraPreset === 'custom' ? !c.customEra : c.customEra !== null) out.push(`${label} era ${c.eraPreset} ${JSON.stringify(c.customEra)}`)
  if (c.customEra && (c.customEra[0] > c.customEra[1] || !c.customEra.every(Number.isInteger))) out.push(`${label} era ${JSON.stringify(c.customEra)}`)
  if (new Set(c.modes).size !== c.modes.length) out.push(`${label} modes twice ${c.modes}`)
  if (c.squadSize < 16 || c.squadSize > 22 || c.benchPicks < 0 || c.benchPicks > 5) out.push(`${label} sizes ${c.squadSize} ${c.benchPicks}`)
  if (Object.keys(c).length !== FIELDS.length) out.push(`${label} fields ${Object.keys(c).length}`)
  return out
}

describe('QA r11: Setup’s remembered choices from any stored value', () => {
  it('reads 3,000 damaged or foreign values as whole choices, the same on a second read', () => {
    const problems: string[] = []
    const ch = new Chooser('r11-setup-memory')
    for (let i = 0; i < 3000; i++) {
      const mode = ch.pick(MODES)
      // Mostly a real save with fields bent, sometimes anything at all
      const raw: unknown = ch.chance(0.8) ? { ...defaultChoices(mode), ...Object.fromEntries(FIELDS.filter(() => ch.chance(0.3)).map((k) => [k, junk(ch)])), ...(ch.chance(0.1) ? { extra: junk(ch) } : {}) } : junk(ch)
      const c = readChoices(raw, mode)
      problems.push(...shapeProblems(c, `#${i} ${mode}`))
      if (JSON.stringify(readChoices(c, mode)) !== JSON.stringify(c)) problems.push(`#${i}: a second read changes the choices`)
      if (problems.length > 10) break
    }
    expect(problems).toEqual([])
  })

  it('a save reads back as it went, the defaults leave no key, and each mode keeps its own', () => {
    const ch = new Chooser('r11-setup-roundtrip')
    for (let i = 0; i < 300; i++) {
      disk.mem.clear()
      const mode = ch.pick(MODES)
      const other = MODES.find((m) => m !== mode)!
      const c = readChoices({ ...defaultChoices(mode), ...Object.fromEntries(FIELDS.filter(() => ch.chance(0.3)).map((k) => [k, junk(ch)])) }, mode)
      saveChoices(mode, c)
      if (isDefault(c, mode)) {
        expect(disk.mem.has(setupKey(mode))).toBe(false)
        expect(loadChoices(mode)).toBeNull()
      } else expect(loadChoices(mode)).toEqual(c)
      expect(loadChoices(other)).toBeNull()
      saveChoices(mode, defaultChoices(mode))
      expect(disk.mem.size).toBe(0)
    }
  })

  it('a stored value that is not JSON, or storage that refuses, starts from the defaults and saving never throws', () => {
    for (const mode of MODES) {
      disk.mem.set(setupKey(mode), '{"formationId":"4-4-2",')
      expect(loadChoices(mode)).toBeNull()
      disk.mem.set(setupKey(mode), '"4-4-2"')
      expect(loadChoices(mode)).toEqual(defaultChoices(mode))
    }
    disk.blocked = true
    try {
      expect(loadChoices('quick')).toBeNull()
      expect(() => saveChoices('quick', { ...defaultChoices('quick'), formationId: '4-4-2' })).not.toThrow()
    } finally {
      disk.blocked = false
    }
  })

  it('a Season’s defaults are a Season’s: Easy and no bench; a Quick Draft’s Normal with one', () => {
    expect(isDefault(defaultChoices('season'), 'season')).toBe(true)
    expect(isDefault(defaultChoices('season'), 'quick')).toBe(false)
    expect(defaultChoices('season')).toMatchObject({ difficulty: 'easy', benchPicks: 0 })
    expect(defaultChoices('quick')).toMatchObject({ difficulty: 'normal', benchPicks: 1 })
  })
})
