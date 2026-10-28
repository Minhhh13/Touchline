import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMessage, parseMessage, type FormatEnv } from '../i18n/icu'

/*
 * r8 audit of src/ui/sound and src/ui/i18n: the ICU parser's nested `#` and quoted apostrophes, the language
 * setting's failed-load race, and the audio context following the master switch (made at once when sound goes on
 * inside the switch's gesture, suspended while it is off, never made while it is off).
 */

const ENV: FormatEnv = {
  plural: (n) => (n === 1 ? 'one' : 'other'),
  number: (n) => String(n),
  money: (m) => `£${m}M`,
  wage: (k) => `£${k}K`,
  date: (d) => String(d),
  ordinal: (n) => `${n}th`,
}
const fmt = (src: string, vars: Record<string, string | number> = {}) => formatMessage(parseMessage(src), vars, ENV)

describe('icu: a select inside a plural keeps the plural number', () => {
  it('prints # as the number inside a nested select', () => {
    const src = '{n, plural, one {{g, select, f {# goal (f)} other {# goal}}} other {{g, select, f {# goals (f)} other {# goals}}}}'
    expect(fmt(src, { n: 3, g: 'f' })).toBe('3 goals (f)')
    expect(fmt(src, { n: 1, g: 'm' })).toBe('1 goal')
  })

  it('keeps # literal in a select that is not inside a plural', () => {
    expect(fmt('{g, select, a {# one} other {# two}}', { g: 'a' })).toBe('# one')
  })

  it("reads a doubled apostrophe inside a quoted run as one apostrophe", () => {
    expect(fmt("'{it''s}' here")).toBe("{it's} here")
    expect(fmt("'{'braces'}'")).toBe('{braces}')
    expect(fmt("don't")).toBe("don't")
    expect(fmt("it''s")).toBe("it's")
    expect(() => parseMessage("'{never closed")).toThrow()
  })
})

describe('language: a failed translation load', () => {
  it('falls back to English only while it is still the choice', () => {
    const src = readFileSync(new URL('../i18n/language.ts', import.meta.url), 'utf8')
    const catchBlock = /catch \{[\s\S]*?\n {2}\}\n\}/.exec(src.slice(src.indexOf('async function apply')))?.[0] ?? ''
    expect(catchBlock).toContain("if (state.pref === pref) show('en', {})")
  })
})

// ---- The audio context and the master switch ----------------------------------------------------------------

class FakeParam {
  value = 0
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v
  }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam()
  curve: Float32Array | null = null
  oversample = 'none'
  connect() {}
  disconnect() {}
}
const made: FakeContext[] = []
class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 0
  sampleRate = 8000
  destination = new FakeNode()
  suspended = 0
  resumed = 0
  constructor() {
    made.push(this)
  }
  createGain() {
    return new FakeNode()
  }
  createWaveShaper() {
    return new FakeNode()
  }
  createBuffer(_c: number, n: number) {
    const data = new Float32Array(n)
    return { getChannelData: () => data }
  }
  suspend() {
    this.suspended++
    this.state = 'suspended'
    return Promise.resolve()
  }
  resume() {
    this.resumed++
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

async function freshSynth() {
  vi.resetModules()
  made.length = 0
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  const listeners = new Map<string, Array<(e: Event) => void>>()
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    addEventListener: (type: string, l: (e: Event) => void) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
  })
  const gesture = (type = 'pointerdown') => listeners.get(type)?.forEach((l) => l({ isTrusted: true, target: null } as unknown as Event))
  const prefs = await import('../sound/prefs')
  const synth = await import('../sound/synth')
  return { prefs, synth, gesture }
}

describe('synth: the context follows the master switch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('makes no context on a gesture while sound is off, and makes it inside the gesture that turns sound on', async () => {
    vi.useFakeTimers()
    const { prefs, synth, gesture } = await freshSynth()
    prefs.setSoundOn(false)
    synth.armAudio()
    gesture()
    expect(made.length).toBe(0)
    expect(synth.liveAudio()).toBeNull()
    // The Profile's switch: its click is the gesture, and the context is there before any later sound asks for it
    prefs.setSoundOn(true)
    expect(made.length).toBe(1)
    expect(synth.liveAudio()).not.toBeNull()
    vi.runAllTimers()
  })

  it('suspends the context while sound is off and resumes it when sound comes back', async () => {
    vi.useFakeTimers()
    const { prefs, synth, gesture } = await freshSynth()
    synth.armAudio()
    gesture()
    expect(made.length).toBe(1)
    const c = made[0]
    prefs.setSoundOn(false)
    expect(c.suspended).toBe(1)
    expect(c.state).toBe('suspended')
    // A gesture with sound off leaves it suspended
    gesture()
    expect(c.resumed).toBe(0)
    prefs.setSoundOn(true)
    expect(c.resumed).toBe(1)
    expect(c.state).toBe('running')
    expect(made.length).toBe(1)
    // The volume never makes a second context
    prefs.setSoundVolume(40)
    expect(made.length).toBe(1)
    vi.runAllTimers()
  })
})
