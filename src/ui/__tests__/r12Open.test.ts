/**
 * Round 12 (`claude/r12-open`): QA round 6's open items closed (docs/QA.md, R11-O1 and R11-O2; R11-O3 is
 * `commentaryMirror.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import type { Mode } from '@game/types'
import { show } from './qaSsr'
import { Setup } from '../screens/Setup'
import { SETUP_START_ID, skipToControl } from '../landmarks'
import { roomCodeFrom, roomInviteText } from '../../online/rooms'

afterEach(() => vi.unstubAllGlobals())

describe('R11-O1: Setup’s Skip to Start link', () => {
  const u = loadTestUniverse(['england'])
  const base = { universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, offseason: null, h2h: null, pendingChallenge: null }
  // The first thing a Tab reaches: a link, a button, a field or anything given a tab stop
  const FOCUSABLE = /<(a [^>]*href|button|input|select|textarea)[^>]*>|<[a-z]+ [^>]*tabindex="0"[^>]*>/

  it('is the first stop on every setup, and points at Start', () => {
    for (const mode of ['quick', 'daily', 'season', 'dynasty', 'weekly'] as Mode[]) {
      show({ ...base, screen: 'setup', setupMode: mode })
      const html = renderToString(createElement(Setup))
      const first = FOCUSABLE.exec(html)?.[0] ?? ''
      expect(first, mode).toContain('data-testid="setup-skip-start"')
      expect(first, mode).toContain(`href="#${SETUP_START_ID}"`)
      expect(html, mode).toMatch(new RegExp(`<button[^>]*id="${SETUP_START_ID}"[^>]*data-testid="setup-start"`))
      expect(html, mode).toContain('Skip to Start')
    }
  })

  /** A stand-in element with what `skipToControl` reads and writes. */
  function el(disabled = false, section: ReturnType<typeof el> | null = null) {
    const attrs = new Map<string, string>()
    const listeners: Array<() => void> = []
    return {
      disabled,
      focused: false,
      getAttribute: (k: string) => attrs.get(k) ?? null,
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      addEventListener: (_: string, f: () => void) => void listeners.push(f),
      closest: () => section,
      focus() {
        this.focused = true
      },
      blur: () => listeners.splice(0).forEach((f) => f()),
    }
  }

  it('focuses Start; a disabled Start’s box takes the focus for this once', () => {
    const start = el()
    vi.stubGlobal('document', { getElementById: (id: string) => (id === SETUP_START_ID ? start : null) })
    const preventDefault = vi.fn()
    skipToControl(SETUP_START_ID, { preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(start.focused).toBe(true)

    const box = el()
    const off = el(true, box)
    vi.stubGlobal('document', { getElementById: () => off })
    skipToControl(SETUP_START_ID)
    expect(off.focused).toBe(false)
    expect(box.focused).toBe(true)
    expect(box.getAttribute('tabindex')).toBe('-1')
    box.blur()
    expect(box.getAttribute('tabindex')).toBeNull()

    vi.stubGlobal('document', { getElementById: () => null })
    expect(() => skipToControl(SETUP_START_ID)).not.toThrow()
  })
})

describe('R11-O2: a room code from an encoded link or a full-width keyboard', () => {
  it('reads a URL-encoded #h= link', () => {
    expect(roomCodeFrom('https://touchline.quest/%23h=K7Q2MX9A')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('https://touchline.quest/%23h%3Dk7q2-mx9a')).toBe('K7Q2MX9A')
    expect(roomCodeFrom(encodeURIComponent('https://touchline.quest/#h=K7Q2MX9A'))).toBe('K7Q2MX9A')
    expect(roomCodeFrom(encodeURIComponent(roomInviteText('Ann', 'K7FAAAAB')))).toBe('K7FAAAAB')
    // A stray percent sign the decoder refuses still leaves the link readable
    expect(roomCodeFrom('100% https://touchline.quest/%23h%3DK7Q2MX9A')).toBe('K7Q2MX9A')
  })

  it('folds full-width letters, digits and marks (NFKC)', () => {
    expect(roomCodeFrom('Ｋ７Ｑ２－ＭＸ９Ａ')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('ｋ７ｑ２ｍｘ９ａ')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('touchline.quest/＃ｈ＝Ｋ７Ｑ２ＭＸ９Ａ')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('ルーム Ｋ７Ｑ２－ＭＸ９Ａ')).toBe('K7Q2MX9A')
  })

  it('still refuses what it refused', () => {
    for (const bad of ['', 'K7Q2', '%23h=K7Q2', 'Ｋ７Ｑ２', 'https://touchline.quest/%23s=K7Q2MX9A', 'https://touchline.quest/%23h=K7Q2MX9AB', 'ＩＩＩＩ－ＯＯＯＯ']) expect(roomCodeFrom(bad), bad).toBeNull()
  })
})
