import { describe, expect, it } from 'vitest'
import { shotXg } from '@engine/matchStats'
import { ballSprite, ballView, DRAG, flightHeight, flightKind, flightWarp, type FlightKind } from '../match/flight'
import { dotName, FLASH, passFlash, shotMarks, shotTrailAt, xgBand } from '../match/overlays'
import { CAMERA, cameraTransform, celebrationMs, FOCUS_XG, focusAt, focusMoments, REPLAY, replayFrame } from '../match/keyMoments'
import { HOLD_MS, skipHold, timeline, type GoalHold, type LiveClockState } from '../match/clockStore'
import { ballAt, goalHolds, strikeTimes } from '../match/possession'
import { matchPath } from '../match/epochs'
import { dotPosition, RUN, runShare, runTo, swayPhase } from '../match/movement'
import { metres, onPitchAt } from '../match/pitchGeometry'
import { shapePoint, sceneAt } from '../match/shape'
import { resultFeed } from './feeds'

const feeds = Array.from({ length: 6 }, (_, i) => resultFeed(i))
const paths = feeds.map((f) => matchPath(f))
const ranges = (i: number) => paths[i].epochs.map((e) => ({ from: e.from, to: e.to }))

describe('the ball in flight', () => {
  it('warps every kind of ball from 0 to 1 without going back, a ground pass slowing as it arrives', () => {
    const kinds: FlightKind[] = ['carry', 'fetch', 'ground', 'driven', 'lofted', 'cross', 'shot']
    for (const k of kinds) {
      expect(flightWarp(k, 0)).toBe(0)
      expect(flightWarp(k, 1)).toBe(1)
      let prev = 0
      for (let f = 0.02; f <= 1; f += 0.02) {
        const w = flightWarp(k, f)
        expect(w).toBeGreaterThanOrEqual(prev)
        prev = w
      }
    }
    // A carry keeps the path's own pace; a pass along the grass is quickest off the boot and slowest at the end
    expect(flightWarp('carry', 0.3)).toBeCloseTo(0.3, 9)
    expect(flightWarp('ground', 0.5)).toBeGreaterThan(0.6)
    expect(flightWarp('ground', 0.95) - flightWarp('ground', 0.9)).toBeLessThan(flightWarp('ground', 0.1) - flightWarp('ground', 0.05))
    // Friction: the ground pass loses most pace, the lofted ball least
    expect(DRAG.ground).toBeGreaterThan(DRAG.driven)
    expect(DRAG.driven).toBeGreaterThan(DRAG.lofted)
  })

  it('gives a lofted ball and a cross an arc to their loft, a driven ball a low one, a shot over the bar a rise to the line, and the grass nothing', () => {
    for (const k of ['lofted', 'cross', 'driven'] as const) {
      expect(flightHeight(k, 0.8, 0)).toBeCloseTo(0, 9)
      expect(flightHeight(k, 0.8, 1)).toBeCloseTo(0, 9)
    }
    expect(flightHeight('lofted', 0.8, 0.5)).toBeCloseTo(0.8, 9)
    expect(flightHeight('cross', 0.6, 0.5)).toBeCloseTo(0.6, 9)
    const driven = Math.max(...Array.from({ length: 51 }, (_, i) => flightHeight('driven', 0.8, i / 50)))
    expect(driven).toBeLessThan(0.8 * 0.7)
    let prev = -1
    for (let f = 0; f <= 1; f += 0.05) {
      const h = flightHeight('shot', 0.55, f)
      expect(h).toBeGreaterThanOrEqual(prev)
      prev = h
    }
    expect(flightHeight('shot', 0.55, 1)).toBeCloseTo(0.55, 9)
    expect(flightHeight('ground', 0.9, 0.5)).toBe(0)
    expect(flightHeight('carry', 0.9, 0.5)).toBe(0)
  })

  it('draws a higher ball bigger and further off a smaller, fainter shadow', () => {
    let last = ballSprite(0, 1.5)
    expect(last.scale).toBe(1)
    expect(last.lift).toBeCloseTo(0, 9)
    for (let h = 0.1; h <= 1; h += 0.1) {
      const s = ballSprite(h, 1.5)
      expect(s.scale).toBeGreaterThan(last.scale)
      expect(s.lift).toBeLessThan(last.lift)
      expect(s.shadowScale).toBeLessThanOrEqual(last.shadowScale)
      expect(s.shadowOpacity).toBeLessThanOrEqual(last.shadowOpacity)
      last = s
    }
  })

  it('classes the hops of real matches into every kind, and on a keyframe the ball is where the path says', () => {
    const seen = new Set<FlightKind>()
    for (const mp of paths) {
      const path = mp.path
      for (let k = 0; k + 1 < path.length; k++) seen.add(flightKind(path[k], path[k + 1]))
      for (let k = 1; k < path.length; k += 7) {
        const v = ballView(path, path[k].t)!
        expect(Math.hypot(v.x - path[k].x, v.y - path[k].y)).toBeLessThan(1e-6)
      }
      for (let T = 0.3; T < 90; T += 0.21) {
        const v = ballView(path, T)!
        expect(v).toEqual(ballView(path, T))
        expect(v.h).toBeGreaterThanOrEqual(0)
        expect(v.h).toBeLessThanOrEqual(1.01)
        expect(v.x).toBeGreaterThanOrEqual(0)
        expect(v.x).toBeLessThanOrEqual(100)
      }
    }
    for (const k of ['carry', 'ground', 'driven', 'lofted', 'cross', 'shot', 'fetch'] as const) expect(seen.has(k)).toBe(true)
  })
})

describe('the overlays', () => {
  it('flashes a pass line only for a pass to a team-mate, fading over the first part of the pass', () => {
    let flashes = 0
    for (const mp of paths) {
      const path = mp.path
      for (let T = 0.3; T < 90; T += 0.05) {
        const b = ballAt(path, T)
        const pf = passFlash(path, b)
        if (!pf || !b) continue
        flashes++
        const a = path[b.index]
        expect(b.next!.kind).toBe('pass')
        expect(b.next!.side).toBe(a.side)
        expect(b.progress).toBeLessThan(FLASH.share)
        expect(pf.alpha).toBeLessThanOrEqual(FLASH.alpha)
        expect(pf.alpha).toBeGreaterThan(0)
        // Later in the same pass is fainter
        const later = passFlash(path, { ...b, progress: Math.min(FLASH.share - 1e-6, b.progress + 0.1) })
        if (later) expect(later.alpha).toBeLessThan(pf.alpha)
      }
    }
    expect(flashes).toBeGreaterThan(300)
  })

  it('matches every shot on the path to its event, with its xG band', () => {
    for (let i = 0; i < paths.length; i++) {
      const marks = shotMarks(paths[i].path, feeds[i].events, ranges(i))
      const strikes = ranges(i).reduce((n, r) => n + strikeTimes(feeds[i].events, r.from, r.to).size, 0)
      expect(marks.size).toBe(strikes)
      for (const [k, m] of marks) {
        expect(paths[i].path[k].kind).toBe('shot')
        expect(paths[i].path[k].side).toBe(m.side)
        expect(m.xg).toBeCloseTo(shotXg(feeds[i].events[m.event]), 9)
        expect(m.band).toBe(xgBand(m.xg))
      }
    }
    expect(xgBand(0.03)).toBe('low')
    expect(xgBand(0.12)).toBe('mid')
    expect(xgBand(0.4)).toBe('high')
  })

  it("draws a chance's line as it flies and fades it, never a goal's", () => {
    let trails = 0
    for (const mp of paths) {
      const path = mp.path
      path.forEach((k, i) => {
        if (k.kind !== 'shot' || i + 1 >= path.length) return
        const st = shotTrailAt(path, ballAt(path, k.t + 0.05), k.t + 0.05)
        if (path[i + 1].kind === 'goal') expect(st).toBeNull()
        else if (st) {
          trails++
          expect(st.index).toBe(i)
          const later = shotTrailAt(path, ballAt(path, k.t + 0.4), k.t + 0.4)
          if (later) expect(later.alpha).toBeLessThan(st.alpha)
          expect(shotTrailAt(path, ballAt(path, k.t + 0.8), k.t + 0.8)).toBeNull()
        }
      })
    }
    expect(trails).toBeGreaterThan(10)
  })

  it('names a dot by its surname, keeping a particle and cutting a long one', () => {
    expect(dotName('Virgil van Dijk')).toBe('van Dijk')
    expect(dotName('Kevin De Bruyne')).toBe('De Bruyne')
    expect(dotName('Casemiro')).toBe('Casemiro')
    expect(dotName('Bukayo Saka')).toBe('Saka')
    expect(dotName('A Verylongsurnamehere')).toBe('Verylongsur.')
    expect(dotName(undefined)).toBe('')
  })
})

describe('key moments', () => {
  const h: GoalHold = { t: 30.6, ms: HOLD_MS.ours + REPLAY.ms, side: 'home', key: '3', tone: 'ours', replay: REPLAY.ms }

  it('adds the replay to each goal hold only when asked, and never with reduced motion', () => {
    const ev = feeds.map((f) => f.events)
    for (const events of ev) {
      const plain = goalHolds(events, 0, 90, { userSide: 'home' })
      const withReplay = goalHolds(events, 0, 90, { userSide: 'home', replay: true })
      const reduced = goalHolds(events, 0, 90, { userSide: 'home', replay: true, reduced: true })
      expect(withReplay.map((x) => x.t)).toEqual(plain.map((x) => x.t))
      plain.forEach((p, i) => {
        expect('replay' in p).toBe(false)
        expect(withReplay[i].ms).toBe(p.ms + REPLAY.ms)
        expect(withReplay[i].replay).toBe(REPLAY.ms)
        expect(celebrationMs(withReplay[i])).toBe(p.ms)
        expect(reduced[i].ms).toBe(HOLD_MS.reduced)
      })
    }
  })

  it('plays the window before the strike forward, then the ball in, with a cut at each end', () => {
    expect(replayFrame(h, celebrationMs(h) - 1, h.t)).toBeNull()
    expect(replayFrame({ ms: 2800 }, 2000, h.t)).toBeNull()
    const start = replayFrame(h, celebrationMs(h), h.t)!
    expect(start.T).toBeCloseTo(h.t - REPLAY.window, 9)
    expect(start.cut).toBeCloseTo(1, 9)
    let prev = start
    for (let e = celebrationMs(h) + 20; e <= h.ms; e += 20) {
      const f = replayFrame(h, e, h.t)!
      expect(f.T).toBeGreaterThanOrEqual(prev.T)
      expect(f.T).toBeLessThanOrEqual(h.t)
      expect(f.flight).toBeGreaterThanOrEqual(prev.flight)
      expect(f).toEqual(replayFrame(h, e, h.t))
      prev = f
    }
    const end = replayFrame(h, h.ms, h.t)!
    expect(end.T).toBe(h.t)
    expect(end.flight).toBe(1)
    expect(end.cut).toBeCloseTo(1, 9)
    // Slower than 1x: the window takes longer on screen than it did live (4.5 s a minute at 1x)
    expect(REPLAY.ms - REPLAY.flight - REPLAY.rest).toBeGreaterThan(REPLAY.window * 4500)
    const mid = replayFrame(h, celebrationMs(h) + REPLAY.ms / 2, h.t)!
    expect(mid.cut).toBe(0)
  })

  it('skips the rest of a hold and carries on from the kick-off', () => {
    const s: LiveClockState = { clock: 30, speed: 1, running: true, period: 4500, at: 30, since: 0, spent: Infinity, stopAt: 45, end: 46, holds: [h], revealed: 0, celebrating: -1, done: false }
    const inReplay = (0.6 * 4500) + celebrationMs(h) + 500
    expect(timeline(s, inReplay).hold).not.toBeNull()
    const next = skipHold(s, inReplay)!
    const after = { ...s, ...next }
    expect(timeline(after, inReplay).hold).toBeNull()
    expect(timeline(after, inReplay).t).toBeCloseTo(h.t, 9)
    expect(timeline(after, inReplay + 450).t).toBeCloseTo(h.t + 0.1, 6)
    expect(skipHold(s, 100)).toBeNull()
  })

  it('leans the camera in on every goal and every big chance, rising into the strike and easing out after', () => {
    for (let i = 0; i < feeds.length; i++) {
      const ms = focusMoments(feeds[i].events, ranges(i))
      const goals = feeds[i].events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal').length
      expect(ms.filter((m) => m.goal).length).toBe(goals)
      for (const m of ms) {
        expect(focusAt(ms, m.t, 0.3, 0.25).w).toBeCloseTo(1, 9)
        expect(focusAt(ms, m.t - 0.15, 0.3, 0.25).w).toBeLessThan(1)
        expect(focusAt(ms, m.t - 0.15, 0.3, 0.25).w).toBeGreaterThan(0)
      }
      for (let k = 1; k < ms.length; k++) expect(ms[k].t).toBeGreaterThanOrEqual(ms[k - 1].t)
      const chances = feeds[i].events.filter((e) => (e.type === 'chance' || e.type === 'save') && shotXg(e) >= FOCUS_XG).length
      expect(ms.length).toBe(goals + chances)
    }
    expect(focusAt([{ t: 30, at: { x: 90, y: 50 }, goal: true }], 20, 0.3, 0.3)).toEqual({ w: 0, at: null })
  })

  it('keeps the camera inside the pitch and centres on the moment when it can', () => {
    const box = { x: -3, y: -3, w: 111, h: 74 }
    expect(cameraTransform({ x: 10, y: 10 }, 1, box)).toEqual({ tx: 0, ty: 0, s: 1 })
    for (const s of [1.2, CAMERA.chance, CAMERA.replay, 2]) {
      for (const fx of [-3, 0, 20, 52.5, 90, 108]) {
        for (const fy of [-3, 10, 34, 71]) {
          const t = cameraTransform({ x: fx, y: fy }, s, box)
          // The box's corners map outside the view or onto its edge: nothing beyond the box is shown
          expect(box.x * t.s + t.tx).toBeLessThanOrEqual(box.x + 1e-9)
          expect(box.y * t.s + t.ty).toBeLessThanOrEqual(box.y + 1e-9)
          expect((box.x + box.w) * t.s + t.tx).toBeGreaterThanOrEqual(box.x + box.w - 1e-9)
          expect((box.y + box.h) * t.s + t.ty).toBeGreaterThanOrEqual(box.y + box.h - 1e-9)
        }
      }
      // In the middle the focus lands at the centre of the view
      const c = cameraTransform({ x: 52.5, y: 34 }, s, box)
      expect(52.5 * c.s + c.tx).toBeCloseTo(box.x + box.w / 2, 9)
      expect(34 * c.s + c.ty).toBeCloseTo(box.y + box.h / 2, 9)
    }
  })
})

describe('runs off the ball', () => {
  it('sends the man a pass is for towards where it lands before it is struck, further for a ball in behind, and meets it there', () => {
    let runs = 0
    let far = 0
    let ahead = 0
    expect(runShare('through')).toBe(RUN.through)
    expect(runShare('through')).toBeGreaterThan(runShare('short'))
    for (const mp of paths) {
      const path = mp.path
      const { home, away } = mp.epochs[0]
      for (let k = 1; k + 1 < path.length && path[k].t < 44; k++) {
        const dwell = path[k]
        const pass = path[k + 1]
        if (dwell.kind !== 'carry' || pass.kind !== 'pass' || !pass.holder || pass.side !== dwell.side || dwell.holder === pass.holder || dwell.t - path[k - 1].t < RUN.lead) continue
        const man = [...onPitchAt(home, Math.floor(dwell.t)), ...onPitchAt(away, Math.floor(dwell.t))].find((p) => p.psId === pass.holder && p.side === pass.side)
        if (!man || man.position === 'GK') continue
        // Just before the strike he is on his way; at the strike his run continues without a jump
        const T0 = dwell.t - 0.0005
        const b0 = ballAt(path, T0)!
        const r0 = runTo(man, path, b0, T0)
        expect(r0).not.toBeNull()
        expect(r0!.to).toBe(pass)
        const b1 = ballAt(path, dwell.t)!
        const r1 = runTo(man, path, b1, dwell.t)!
        expect(Math.abs(r1.w - r0!.w)).toBeLessThan(0.02)
        // Well before the touch he has not set off
        const Tearly = dwell.t - RUN.lead - 0.01
        const be = ballAt(path, Tearly)!
        if (be.index === k - 1) expect(runTo(man, path, be, Tearly)).toBeNull()
        const sc = sceneAt(path, b0, T0)
        const spot = shapePoint(man, sc, swayPhase(man.psId))
        const at = dotPosition(man, path, b0, T0, swayPhase(man.psId), sc)
        runs++
        // Where the ball lands away from his place in the shape (a ball in behind, a ball into the box), he is nearer it than his place
        if (metres(spot, pass) > 5) {
          far++
          if (metres(at, pass) < metres(spot, pass) - 0.5) ahead++
        }
        // As the ball arrives he is on it
        const bEnd = ballAt(path, pass.t - 0.0005)!
        const end = dotPosition(man, path, bEnd, pass.t - 0.0005, swayPhase(man.psId))
        expect(metres(end, pass)).toBeLessThan(3)
      }
    }
    expect(runs).toBeGreaterThan(40)
    expect(far).toBeGreaterThan(10)
    expect(ahead / far).toBeGreaterThan(0.85)
  })
})

describe('the same events give the same frames', () => {
  it('rebuilds every frame of a match exactly: ball, flight, dots, overlays, camera and replay', () => {
    const digest = (i: number) => {
      const mp = matchPath(feeds[i])
      const marks = shotMarks(mp.path, feeds[i].events, mp.epochs.map((e) => ({ from: e.from, to: e.to })))
      const ms = focusMoments(feeds[i].events, mp.epochs.map((e) => ({ from: e.from, to: e.to })))
      const out: unknown[] = []
      for (let T = 0.5; T < 90; T += 0.73) {
        const b = ballAt(mp.path, T)
        const men = onPitchAt(mp.epochs[0].home, Math.floor(T)).slice(0, 4)
        out.push([ballView(mp.path, T, b), passFlash(mp.path, b), shotTrailAt(mp.path, b, T), focusAt(ms, T, 0.3, 0.25), men.map((p) => dotPosition(p, mp.path, b, T, swayPhase(p.psId)))])
      }
      for (const hd of goalHolds(feeds[i].events, 0, 90, { replay: true })) for (let e = 0; e < hd.ms; e += 300) out.push(replayFrame(hd, e, hd.t))
      out.push([...marks.entries()])
      return JSON.stringify(out)
    }
    for (const i of [0, 3]) expect(digest(i)).toBe(digest(i))
  })
})
