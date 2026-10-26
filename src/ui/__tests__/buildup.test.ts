import { describe, expect, it } from 'vitest'
import { matchPath } from '../match/epochs'
import { ballAt, cueTimes, foulTimes, strikeTimes, type BallKeyframe } from '../match/possession'
import { PITCH_MS, SECOND, FOUL_CLEAR_AFTER, FOUL_CLEAR_BEFORE, FOUL_STOP } from '../match/timing'
import { patternFor, styleOf } from '../match/playbook'
import { phaseCaption, sceneAt, shapePoint } from '../match/shape'
import { swayPhase } from '../match/movement'
import { metres, onPitchAt } from '../match/pitchGeometry'
import { cuePending, readout } from '../match/clockStore'
import { commentaryUpTo } from '../match/commentary'
import { highlightMinuteMs, HIGHLIGHT_LEAD_MS, HIGHLIGHT_MINUTE_MS, HIGHLIGHT_MOMENT_MS } from '../components/Highlights'
import type { MatchEvent } from '@engine/types'
import { getName, resultFeed } from './feeds'

const GOALS = new Set(['goal', 'penalty', 'own_goal'])
const feeds = Array.from({ length: 16 }, (_, i) => resultFeed(i))
const paths = feeds.map((f) => matchPath(f))
const seconds = (minutes: number) => (minutes * PITCH_MS) / 1000

describe('the moments the pitch is built around', () => {
  it('stages the foul behind every card in its own minute, clear of the shots, and cues every strike and foul', () => {
    let staged = 0
    for (const feed of feeds) {
      for (const [from, to] of [[0, 45], [46, 70], [71, 90]] as const) {
        const fouls = foulTimes(feed.events, from, to)
        const strikes = [...strikeTimes(feed.events, from, to).values()]
        for (const [idx, f] of fouls) {
          const e = feed.events[idx]
          expect(['yellow', 'red']).toContain(e.type)
          expect(Math.floor(f.t)).toBe(e.minute)
          if (!f.staged) continue
          staged++
          for (const s of strikes) expect(f.t < s - FOUL_CLEAR_BEFORE - FOUL_STOP || f.t > s + FOUL_CLEAR_AFTER).toBe(true)
        }
        const cues = cueTimes(feed.events, from, to)
        expect(cues.length).toBe(strikes.length + fouls.size)
        for (let i = 1; i < cues.length; i++) expect(cues[i]).toBeGreaterThanOrEqual(cues[i - 1])
        expect(cueTimes(feed.events, from, to)).toEqual(cues)
      }
    }
    expect(staged).toBeGreaterThan(10)
  })

  it('reads how a shot was made from its event', () => {
    const ev = (text: string, patch: Partial<MatchEvent> = {}): MatchEvent => ({ minute: 10, type: 'goal', side: 'home', text, position: { x: 92, y: 50 }, ...patch })
    expect(patternFor(ev('GOAL! A heads it home from a corner.'), 1)).toBe('corner')
    expect(patternFor(ev('GOAL! A rounds the keeper and finishes.'), 1)).toBe('through')
    expect(patternFor(ev('GOAL! A finishes a flowing team move.'), 1)).toBe('team-move')
    expect(patternFor(ev('GOAL! A taps in from close range.'), 1)).toBe('cutback')
    expect(patternFor(ev('GOAL! A pounces on a loose ball.'), 1)).toBe('scramble')
    expect(patternFor(ev('Penalty.', { type: 'penalty' }), 1)).toBe('penalty')
    // A curler with nobody credited can be a direct free kick; with an assist it is a lay-off
    expect(['freekick', 'edge']).toContain(patternFor(ev('GOAL! A curls one in from the edge of the box.', { position: { x: 79, y: 50 } }), 0))
    expect(patternFor(ev('GOAL! A curls one in from the edge of the box, assisted by B.', { secondaryId: 'b', position: { x: 79, y: 50 } }), 0)).toBe('edge')
    expect(styleOf(undefined)).toEqual({ tempo: 'standard', passing: 'mixed', width: 'standard', pressing: 'mid' })
  })
})

describe('build-up on the live pitch', () => {
  it('is deterministic for a feed and tags every move with its phase', () => {
    expect(matchPath(feeds[3])).toEqual(paths[3])
    const phases = new Set<string>()
    for (const { path } of paths) for (const k of path) if (k.phase) phases.add(k.phase)
    for (const p of ['buildup', 'progression', 'final', 'setpiece']) expect(phases.has(p)).toBe(true)
  })

  it('moves the ball at a pace you can follow: a ground pass rolls for well over a second at 1x and the man on it takes a touch first', () => {
    const passes: number[] = []
    const touches: number[] = []
    for (const { path } of paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]
        const b = path[i]
        if (b.kind === 'pass' && !(b.loft ?? 0) && metres(a, b) > 15 && metres(a, b) < 25) passes.push(seconds(b.t - a.t))
        if (b.kind === 'carry' && b.holder === a.holder && metres(a, b) < 2 && path[i + 1]?.kind === 'pass') touches.push(seconds(b.t - a.t))
      }
    }
    passes.sort((x, y) => x - y)
    touches.sort((x, y) => x - y)
    expect(passes.length).toBeGreaterThan(300)
    expect(passes[Math.floor(passes.length / 2)]).toBeGreaterThan(1.4)
    expect(passes[Math.floor(passes.length * 0.1)]).toBeGreaterThan(0.9)
    expect(touches[Math.floor(touches.length / 2)]).toBeGreaterThan(0.3)
    expect(SECOND).toBeCloseTo(1000 / PITCH_MS)
  })

  it('lets a side keep the ball: spells of possession run for several touches, and the switches, crosses and turnovers all happen', () => {
    const tags: Record<string, number> = {}
    let spells = 0
    let passes = 0
    for (const { path } of paths) {
      for (let i = 1; i < path.length; i++) {
        const k = path[i]
        if (k.play) tags[k.play] = (tags[k.play] ?? 0) + 1
        if (k.side !== path[i - 1].side) spells++
        else if (k.kind === 'pass') passes++
      }
    }
    expect(passes / spells).toBeGreaterThan(1.8)
    for (const t of ['switch', 'cross', 'through', 'tackle', 'interception', 'distribution', 'clearance', 'dribble', 'back']) expect(tags[t] ?? 0).toBeGreaterThan(paths.length)
  })

  it("plays a goal's last pass from its recorded assister, into the scorer, who strikes it", () => {
    let assisted = 0
    let fromAssister = 0
    feeds.forEach((feed, fi) => {
      const path = paths[fi].path
      feed.events.forEach((e) => {
        if (e.type !== 'goal' || !e.secondaryId) return
        const shot = path.find((k) => k.kind === 'shot' && k.holder === e.playerId && Math.floor(k.t) === e.minute)
        if (!shot) return
        assisted++
        const i = path.indexOf(shot)
        // Back from the shot past the scorer's own touches to the ball that reached him: the assister played it (a scramble's cross may come off a body on the way)
        let j = i - 1
        while (j > 0 && path[j].holder === e.playerId && path[j].kind === 'carry') j--
        const before = path.slice(Math.max(0, j - 3), j).filter((k) => !k.holder || k.holder === e.secondaryId)
        if (path[j].holder === e.playerId && (path[j - 1]?.holder === e.secondaryId || (path[j].play === 'rebound' && before.some((k) => k.holder === e.secondaryId)))) fromAssister++
      })
    })
    expect(assisted).toBeGreaterThan(10)
    expect(fromAssister / assisted).toBeGreaterThan(0.7)
  })

  it('stages set pieces: the ball waits on the spot while the shape forms, then it is taken', () => {
    const kinds: Record<string, number> = {}
    let swung = 0
    for (const { path } of paths) {
      for (let i = 0; i < path.length; i++) {
        const k = path[i]
        if (!k.setPiece) continue
        kinds[k.setPiece.kind] = (kinds[k.setPiece.kind] ?? 0) + 1
        expect(k.setPiece.until).toBeGreaterThanOrEqual(k.t)
        // Nothing moves until it is taken
        for (let j = i + 1; j < path.length && path[j].t <= k.setPiece.until - 1e-6; j++) expect(Math.hypot(path[j].x - k.x, path[j].y - k.y)).toBeLessThan(0.01)
        if (k.setPiece.kind === 'corner') {
          expect(Math.min(k.y, 100 - k.y)).toBeLessThan(1)
          expect(seconds(k.setPiece.until - k.t)).toBeGreaterThan(1.2)
          const delivery = path.slice(i + 1).find((x) => x.t > k.setPiece!.until + 1e-6)
          // Swung into the box (or, now and then, played short when the next move is close)
          if (delivery?.kind === 'pass') expect((delivery.loft ?? 0) >= 0.5 || metres(delivery, k) < 16).toBe(true)
          if (delivery?.kind === 'pass' && (delivery.loft ?? 0) >= 0.5) swung++
        }
      }
    }
    for (const kind of ['kickoff', 'corner', 'freekick', 'goalkick']) expect(kinds[kind] ?? 0).toBeGreaterThan(5)
    expect(swung).toBeGreaterThan((kinds.corner ?? 0) / 2)
  })

  it('brings down a man and sets up a free kick at every staged foul, and puts a penalty on the spot before it is struck', () => {
    let fouls = 0
    let pens = 0
    feeds.forEach((feed, fi) => {
      const mpath = paths[fi]
      for (const e of mpath.epochs) {
        for (const [, f] of foulTimes(feed.events, e.from, e.to)) {
          if (!f.staged) continue
          const k = mpath.path.find((x) => Math.abs(x.t - f.t) < 1e-6 && x.play === 'foul')
          if (!k) continue
          fouls++
          const fk = mpath.path.find((x) => x.t > f.t && x.setPiece)
          expect(fk?.setPiece?.kind).toBe('freekick')
        }
        for (const [idx, t] of strikeTimes(feed.events, e.from, e.to)) {
          if (feed.events[idx].type !== 'penalty') continue
          const spot = mpath.path.filter((x) => x.t < t && x.t > t - 3 && x.setPiece?.kind === 'penalty')
          if (spot.length) pens++
        }
      }
    })
    expect(fouls).toBeGreaterThan(10)
    expect(pens).toBeGreaterThanOrEqual(1)
  })

  it('builds a wall at a free kick near goal and sends everyone to the box for a corner', () => {
    let walls = 0
    let corners = 0
    for (const { path, epochs } of paths) {
      for (let i = 0; i < path.length; i++) {
        const k = path[i]
        if (!k.setPiece || (k.setPiece.kind !== 'freekick' && k.setPiece.kind !== 'corner')) continue
        const T = (k.t + k.setPiece.until) / 2
        const b = ballAt(path, T)!
        const sc = sceneAt(path, b, T)
        if (!sc.setPiece || sc.setPiece.w < 0.99) continue
        const ep = epochs.reduce((a, e) => (e.from <= T ? e : a))
        const defending = onPitchAt(k.side === 'home' ? ep.away : ep.home, Math.floor(T))
        const goalX = k.side === 'home' ? 100 : 0
        const near = Math.abs(goalX - k.x) < 36
        if (k.setPiece.kind === 'freekick' && near) {
          const wall = defending.filter((p) => ['ST', 'LW', 'RW', 'AM'].includes(p.position)).map((p) => metres(shapePoint(p, sc, swayPhase(p.psId)), k))
          if (!wall.length) continue
          walls++
          for (const d of wall) expect(d).toBeGreaterThan(8)
          for (const d of wall) expect(d).toBeLessThan(11)
        }
        if (k.setPiece.kind === 'corner') {
          corners++
          const inBox = defending.filter((p) => p.position !== 'GK').filter((p) => Math.abs(goalX - shapePoint(p, sc, swayPhase(p.psId)).x) < 17)
          expect(inBox.length).toBeGreaterThanOrEqual(7)
          expect(phaseCaption(path, b, sc)?.text).toBe('Corner')
        }
      }
    }
    expect(corners).toBeGreaterThan(5)
    expect(walls).toBeGreaterThan(0)
  })
})

describe('the dashboard waits for what the pitch shows', () => {
  it('counts the cues the picture has reached and holds a minute back until its cue', () => {
    const base = { at: 10, since: 0, spent: Infinity, running: true, speed: 1, period: 1000, end: 46, holds: [], stopAt: 45 }
    expect(readout(base, 0)).not.toHaveProperty('cued')
    expect(readout({ ...base, cues: [10.5, 12.25, 30] }, 0).cued).toBe(0)
    expect(readout({ ...base, cues: [10.5, 12.25, 30] }, 600).cued).toBe(1)
    expect(readout({ ...base, cues: [10.5, 12.25, 30] }, 2300).cued).toBe(2)
    // Minute 12 is on the clock but its chance is still to come: hold it back
    expect(cuePending([10.5, 12.25, 30], 1, 12, 0)).toBe(true)
    expect(cuePending([10.5, 12.25, 30], 2, 12, 0)).toBe(false)
    expect(cuePending([10.5, 12.25, 30], 1, 11, 0)).toBe(false)
    // A cue from before the stretch began never holds it
    expect(cuePending([10.5], 0, 10, 11)).toBe(false)
  })

  it("describes what has just happened on the pitch in each quiet minute's line", () => {
    let named = 0
    feeds.slice(0, 8).forEach((feed, fi) => {
      const mpath = paths[fi]
      const lines = commentaryUpTo(feed, mpath, feed.lastMinute, { home: 'HOM', away: 'AWA' }, getName, [])
      const play = new Map(lines.filter((l) => l.kind === 'play').map((l) => [l.minute, l]))
      for (const k of mpath.path) {
        if (k.setPiece?.kind !== 'corner') continue
        const m = Math.round(k.t)
        if (Math.abs(k.t - m) > 0.15) continue
        const l = play.get(m)
        if (!l) continue
        expect(l.text.startsWith('Corner to')).toBe(true)
        named++
      }
    })
    expect(named).toBeGreaterThanOrEqual(1)
  })

  it('slows the quick-season highlights down for the move that makes each moment', () => {
    expect(highlightMinuteMs(20, 25)).toBe(HIGHLIGHT_MINUTE_MS)
    expect(highlightMinuteMs(24, 25)).toBe(HIGHLIGHT_LEAD_MS)
    expect(highlightMinuteMs(25, 25)).toBe(HIGHLIGHT_MOMENT_MS)
    expect(HIGHLIGHT_MOMENT_MS).toBeGreaterThan(HIGHLIGHT_LEAD_MS)
  })
})

// Keep the type import honest
export type { BallKeyframe }
void GOALS
