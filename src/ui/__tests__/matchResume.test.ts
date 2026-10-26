import { describe, expect, it } from 'vitest'
import { parseMark, resumeFrom, resumeLine, segmentKey } from '../matchday/resume'

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
})
