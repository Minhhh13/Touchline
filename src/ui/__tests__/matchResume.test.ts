import { describe, expect, it } from 'vitest'
import { RESUME_KEY, parseMark, readMarkFrom, resumeFrom, resumeLine, segmentKey, writeMarkTo } from '../matchday/resume'

describe('a live match picked up after a reload', () => {
  const key = segmentKey('g1', 'wolves-3-league', 45, 0, 12)

  it('starts the same segment at the minute it reached, never before its start nor past its stop', () => {
    expect(resumeFrom({ key, at: 31 }, key, 0, 45)).toBe(31)
    expect(resumeFrom({ key, at: 31.7 }, key, 0, 45)).toBe(31)
    expect(resumeFrom({ key, at: 46 }, key, 0, 45)).toBe(46)
    expect(resumeFrom({ key, at: 99 }, key, 0, 45)).toBe(46)
    expect(resumeFrom({ key, at: -4 }, key, 0, 45)).toBe(0)
  })

  it('starts from the segment start for another segment, a change in play or nothing remembered', () => {
    expect(resumeFrom(null, key, 0, 45)).toBe(0)
    expect(resumeFrom({ key: segmentKey('g1', 'wolves-3-league', 70, 46, 15), at: 60 }, key, 0, 45)).toBe(0)
    // A change in play moves the start and the events: another segment
    expect(segmentKey('g1', 'wolves-3-league', 45, 20, 13)).not.toBe(key)
    expect(resumeFrom({ key: 'g2|wolves-3-league|45|0|12', at: 31 }, key, 0, 45)).toBe(0)
    expect(resumeFrom({ key, at: Number.NaN }, key, 0, 45)).toBe(0)
  })

  it('reads only a well-formed mark', () => {
    expect(parseMark(null)).toBeNull()
    expect(parseMark('{')).toBeNull()
    expect(parseMark('{"key":3,"at":1}')).toBeNull()
    expect(parseMark(JSON.stringify({ key, at: 12 }))).toEqual({ key, at: 12 })
  })

  it('says where it picked up', () => {
    expect(resumeLine(0, 0, 45)).toBeNull()
    expect(resumeLine(31, 0, 45)).toBe("Back at 31', where you left the match")
    expect(resumeLine(46, 0, 45)).toBe('Back at half time, where you left the match')
    expect(resumeLine(71, 46, 70)).toBe('Back at 70 minutes, where you left the match')
    expect(resumeLine(96, 71, 95)).toBe('Back at full time, where you left the match')
  })

  // O-7 (docs/QA.md): iOS may kill a backgrounded web view, which loses sessionStorage; the mark now lives in localStorage
  const memory = (full = false) => {
    const m = new Map<string, string>()
    return {
      map: m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException('full', 'QuotaExceededError')
        m.set(k, v)
      },
    }
  }
  it('keeps the mark in the first store that takes it and reads it back from there', () => {
    const local = memory()
    const session = memory()
    expect(writeMarkTo([() => local, () => session], { key, at: 46 })).toBe(true)
    expect(local.map.get(RESUME_KEY)).toBe(JSON.stringify({ key, at: 46 }))
    expect(session.map.size).toBe(0)
    // A fresh web view: the tab's store is empty, the viewer's still holds the mark
    expect(resumeFrom(readMarkFrom([() => local, () => memory()], key), key, 0, 45)).toBe(46)
  })
  it('falls back to the tab when the viewer store is full or missing, and reads the mark for this segment first', () => {
    const full = memory(true)
    const session = memory()
    expect(writeMarkTo([() => full, () => session], { key, at: 30 })).toBe(true)
    expect(session.map.get(RESUME_KEY)).toBe(JSON.stringify({ key, at: 30 }))
    expect(writeMarkTo([() => undefined, () => { throw new Error('blocked') }], { key, at: 30 })).toBe(false)
    // An older mark for another segment in the viewer store does not hide this segment's in the tab
    const local = memory()
    local.setItem(RESUME_KEY, JSON.stringify({ key: 'g0|x|45|0|1', at: 46 }))
    expect(readMarkFrom([() => local, () => session], key)).toEqual({ key, at: 30 })
    expect(readMarkFrom([() => local, () => memory()], key)).toEqual({ key: 'g0|x|45|0|1', at: 46 })
    expect(readMarkFrom([() => { throw new Error('blocked') }, () => session], key)).toEqual({ key, at: 30 })
    expect(readMarkFrom([() => undefined], key)).toBeNull()
  })
})
