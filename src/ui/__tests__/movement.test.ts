import { describe, expect, it } from 'vitest'
import { dotPosition, swayPhase } from '../match/movement'
import { matchPath } from '../match/epochs'
import { metres, onPitchAt, type PlacedPlayer } from '../match/pitchGeometry'
import { ballAt, type BallKeyframe, type BallState } from '../match/possession'
import { resultFeed } from './feeds'

/** The frame loop's formula as LivePitch had it inline before it moved to movement.ts: the reference. */
function reference(p: PlacedPlayer, path: BallKeyframe[], b: BallState | null, T: number, phase: number): { x: number; y: number } {
  const lean = b ? (b.x - 50) * 0.08 : 0
  const i = b?.index ?? -1
  const cur = i >= 0 ? path[i] : undefined
  const next = b?.next ?? null
  const f = b?.progress ?? 1
  let saveKf: BallKeyframe | null = null
  for (let k = i; k >= 0 && k >= i - 2; k--) {
    const kf = path[k]
    if (kf.kind === 'save' && Math.abs(T - kf.t) < 0.5) saveKf = kf
  }
  let hold = 0
  if (cur?.holder === p.psId) hold += next ? 1 - f : 1
  if (next?.holder === p.psId) hold += f
  hold = Math.min(1, hold)
  let x = p.x + lean * (1 - hold) * (p.position === 'GK' ? 0.35 : 1)
  let y = p.y
  if (b && hold < 1 && p.position !== 'GK') {
    const pull = 0.24 * Math.max(0, 1 - metres(b, { x, y }) / 26) * (1 - hold)
    x += (b.x - x) * pull
    y += (b.y - y) * pull
    x += Math.sin(T * 1.7 + phase) * 0.5 * (1 - hold)
    y += Math.cos(T * 1.3 + phase) * 0.7 * (1 - hold)
  }
  if (saveKf && saveKf.holder === p.psId) {
    const prev = path[path.indexOf(saveKf) - 1]
    const dive = 1 - Math.abs(T - saveKf.t) / 0.5
    if (prev) {
      x += (prev.x - p.x) * 0.35 * dive
      y += (prev.y - p.y) * 0.5 * dive
    }
  }
  return { x, y }
}

describe('dot movement', () => {
  it('reproduces the live pitch’s old inline formula exactly, keepers diving at saves included', () => {
    let saves = 0
    for (let i = 0; i < 6; i++) {
      const mpath = matchPath(resultFeed(i))
      const { home, away } = mpath.epochs[0]
      for (let T = 0.2; T < 45; T += 0.23) {
        const b = ballAt(mpath.path, T)
        for (const p of [...onPitchAt(home, Math.floor(T)), ...onPitchAt(away, Math.floor(T))]) {
          expect(dotPosition(p, mpath.path, b, T, swayPhase(p.psId))).toEqual(reference(p, mpath.path, b, T, swayPhase(p.psId)))
        }
      }
      for (const k of mpath.path.filter((x) => x.kind === 'save' && x.t < 45)) {
        const keeper = [...home, ...away].find((p) => p.psId === k.holder)
        if (!keeper) continue
        const T = k.t + 0.1
        expect(dotPosition(keeper, mpath.path, ballAt(mpath.path, T), T, 0)).toEqual(reference(keeper, mpath.path, ballAt(mpath.path, T), T, 0))
        saves++
      }
    }
    expect(saves).toBeGreaterThan(0)
    expect(dotPosition({ psId: 'x', slotId: 'gk', position: 'GK', onAt: 0, offAt: 90, red: false, injured: false, side: 'home', x: 5, y: 50 }, [], null, 10, 0)).toEqual({ x: 5, y: 50 })
  })

  it('gives every man a fixed sway phase from his id', () => {
    expect(swayPhase('abc')).toBe(swayPhase('abc'))
    expect(swayPhase('abc')).not.toBe(swayPhase('abd'))
    expect(swayPhase('a')).toBeGreaterThanOrEqual(0)
    expect(swayPhase('a-long-player-season-id@2020@club')).toBeLessThan(6.283)
  })
})
