/**
 * QA round 13 (r15, docs/QA.md, R14-O1): a screen chunk that did not load reloads the page once by itself, online,
 * and never twice inside `CHUNK_RELOAD_WINDOW_MS`, so a chunk that is really missing (a deploy, offline) shows the
 * boundary's card instead of a reload loop. The rule over random sequences of errors, then the boundary itself with a
 * stand-in page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Rng } from '@engine/rng'
import { chunkReloadDue, CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, ScreenBoundary } from '../lazyScreens'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://touchline.quest/assets/H2H-abc.js')

describe('QA r15: reloading over a chunk that did not load', { timeout: 60_000 }, () => {
  it('reloads at most once a window, never offline, over random error times', () => {
    let reloads = 0
    for (let s = 0; s < 300; s++) {
      const rng = new Rng(`qa-r15-chunk-${s}`)
      let now = 1_700_000_000_000 + rng.int(0, 1e9)
      let last: number | null = rng.next() < 0.2 ? now - rng.int(0, 2 * CHUNK_RELOAD_WINDOW_MS) : null
      const times: number[] = []
      for (let e = 0; e < 40; e++) {
        now += rng.int(0, CHUNK_RELOAD_WINDOW_MS / 4)
        const online = rng.next() < 0.85
        const due = chunkReloadDue(now, last, online)
        if (!online) expect(due).toBe(false)
        if (online && (last === null || now - last >= CHUNK_RELOAD_WINDOW_MS)) expect(due).toBe(true)
        if (due) {
          times.push(now)
          last = now
          reloads++
        }
      }
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(CHUNK_RELOAD_WINDOW_MS)
    }
    expect(reloads).toBeGreaterThan(300)
    // A damaged mark or a clock set back never blocks the reload for good
    expect(chunkReloadDue(1000, Number.NaN, true)).toBe(true)
    expect(chunkReloadDue(1000, 5000, true)).toBe(true)
  })

  describe('the boundary', () => {
    afterEach(() => vi.unstubAllGlobals())
    const page = (online: boolean) => {
      const mem = new Map<string, string>()
      const reload = vi.fn()
      vi.stubGlobal('sessionStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
      vi.stubGlobal('location', { reload })
      vi.stubGlobal('navigator', { onLine: online })
      return { mem, reload }
    }
    const caught = (error: Error) => {
      const b = new ScreenBoundary({ resetKey: 'h2h||setup', onHome: () => {}, children: null })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      b.componentDidCatch(error, { componentStack: '' })
    }

    it('reloads once over a chunk, then leaves the card up', () => {
      const { mem, reload } = page(true)
      caught(chunkError())
      expect(reload).toHaveBeenCalledTimes(1)
      expect(Number(mem.get(CHUNK_RELOAD_KEY))).toBeGreaterThan(0)
      // The page that came back fails again straight away: no second reload
      caught(chunkError())
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('never reloads offline, nor over a screen that threw', () => {
      const off = page(false)
      caught(chunkError())
      expect(off.reload).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
      const on = page(true)
      caught(new TypeError("Cannot read properties of undefined (reading 'badge')"))
      expect(on.reload).not.toHaveBeenCalled()
      expect(on.mem.size).toBe(0)
    })

    it('leaves the card up when storage is blocked', () => {
      vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
      const reload = vi.fn()
      vi.stubGlobal('location', { reload })
      vi.stubGlobal('navigator', { onLine: true })
      caught(chunkError())
      expect(reload).not.toHaveBeenCalled()
    })
  })
})
