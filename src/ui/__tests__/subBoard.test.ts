import { describe, expect, it } from 'vitest'
import { getFormation } from '@engine/formations'
import { advanceMatch, beginMatch, benchAt, changeInPlay, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, onPitchAtMinute, subsMade } from '@engine/match'
import { canCover, describeFit, POSITIONS } from '@engine/positions'
import { computeTeamStrength, roleRating } from '@engine/ratings'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { Rng } from '@engine/rng'
import type { Sub } from '../matchday/controls'
import { panelPoints } from '../matchday/model'
import { TOUCH_LIFT, aimPoint, boardRoom, countersAfter, fitGlow, lineupAfter, moveOnBoard, slotRoleRating, stageSub, teamRating, undoSub } from '../matchday/subBoard'
import { sides, u } from './feeds'

/** A live match at minute `k` for the home side: who can come off, who can come on, and the room the sheet has. */
function liveAt(seed: string, i: number, k = 50) {
  const s = sides(i)
  const mp = beginMatch({ rng: new Rng(seed), ...s, detail: 'full' })
  advanceMatch(mp, s, undefined, 70)
  const men = onPitchAtMinute(mp, 'home', k).filter((p) => p.onAt < k)
  const bench = benchAt(mp, 'home', k, s.home.getState)
  const subsLeft = MAX_SUBS - subsMade(mp, 'home', k)
  return { s, mp, men, bench, subsLeft, onPitch: men.map((p) => p.psId) }
}

describe('substitution board: fit glows', () => {
  it('are the slot picker split: natural, accomplished cover, out of position', () => {
    const seen = { natural: 0, cover: 0, out: 0 }
    const players = Object.values(u.index).slice(0, 4000)
    for (const p of players) {
      for (const pos of POSITIONS) {
        const g = fitGlow(p, pos)
        seen[g]++
        if (describeFit(p, pos) === 'natural') expect(g).toBe('natural')
        else if (canCover(p, pos, 'accomplished')) expect(g).toBe('cover')
        else expect(g).toBe('out')
      }
      // A man always fits his own first position
      expect(fitGlow(p, p.positions[0])).toBe('natural')
    }
    expect(seen.natural).toBeGreaterThan(0)
    expect(seen.cover).toBeGreaterThan(0)
    expect(seen.out).toBeGreaterThan(seen.natural)
  })

  it('a keeper is out of position outfield, and the role rating is the engine roleRating for the slot', () => {
    const keeper = Object.values(u.index).find((p) => p.positions.length === 1 && p.positions[0] === 'GK')!
    expect(fitGlow(keeper, 'ST')).toBe('out')
    const f = getFormation('4-3-3')
    const t = { roles: {} as Record<string, string> }
    for (const slot of f.slots) expect(slotRoleRating(keeper, t, slot)).toBeCloseTo(roleRating(keeper, getRole(DEFAULT_ROLE[slot.position]), slot.position), 9)
  })
})

describe('substitution board: staging', () => {
  it('stages, undoes and swaps the incoming man without spending another change', () => {
    const { onPitch, bench, subsLeft } = liveAt('board-stage', 1)
    const c = { onPitch, bench, cap: subsLeft }
    let subs: Sub[] = []
    let r = stageSub(subs, { off: onPitch[3], on: bench[0] }, c)
    expect(r.refused).toBeUndefined()
    subs = r.subs
    expect(subs).toEqual([{ off: onPitch[3], on: bench[0] }])
    // Another bench man dropped on the man coming on replaces him: still one change, the same man off
    r = stageSub(subs, { off: bench[0], on: bench[1] }, c)
    expect(r.subs).toEqual([{ off: onPitch[3], on: bench[1] }])
    subs = r.subs
    // bench[0] is free again; bench[1] cannot be staged twice
    expect(stageSub(subs, { off: onPitch[4], on: bench[1] }, c).refused).toBe('already-on')
    expect(stageSub(subs, { off: onPitch[3], on: bench[2] }, c).refused).toBe('not-on-pitch')
    subs = stageSub(subs, { off: onPitch[4], on: bench[0] }, c).subs
    expect(subs.length).toBe(2)
    subs = undoSub(subs, bench[1])
    expect(subs).toEqual([{ off: onPitch[4], on: bench[0] }])
    // Undo leaves the man who came off free to be staged again
    expect(stageSub(subs, { off: onPitch[3], on: bench[1] }, c).refused).toBeUndefined()
  })

  it('caps at the five substitutions and the room the window has', () => {
    for (let i = 0; i < 12; i++) {
      const { onPitch, bench, subsLeft } = liveAt(`board-cap-${i}`, i)
      if (bench.length < 6 || onPitch.length < 7) continue
      expect(subsLeft).toBeLessThanOrEqual(MAX_SUBS)
      let subs: Sub[] = []
      let refused = 0
      for (let k = 0; k < 6; k++) {
        const r = stageSub(subs, { off: onPitch[k + 1], on: bench[k] }, { onPitch, bench, cap: subsLeft })
        if (r.refused) {
          expect(r.refused).toBe('no-room')
          refused++
        }
        subs = r.subs
      }
      expect(subs.length).toBe(Math.min(subsLeft, 6))
      expect(subs.length).toBeLessThanOrEqual(MAX_SUBS)
      expect(refused).toBe(6 - subs.length)
      // Swapping the incoming man is still allowed at the cap
      const last = subs[subs.length - 1]
      const spare = bench.find((id) => !subs.some((s) => s.on === id))
      if (spare) expect(stageSub(subs, { off: last.on, on: spare }, { onPitch, bench, cap: subsLeft }).subs.length).toBe(subs.length)
      return
    }
    throw new Error('no seed had a full bench')
  })

  it('never brings back on a man who has played', () => {
    const s = sides(2)
    const mp = beginMatch({ rng: new Rng('board-back-on'), ...s, detail: 'full' })
    advanceMatch(mp, s, undefined, 70)
    const off = onPitchAtMinute(mp, 'home', 50).find((p) => p.position !== 'GK' && p.onAt < 50)!
    const first = benchAt(mp, 'home', 50, s.home.getState)[0]
    const out = changeInPlay(mp, s, { side: 'home', minute: 50, substitutions: [{ off: off.psId, on: first }] })
    expect(out.made.length).toBe(1)
    const onPitch = onPitchAtMinute(mp, 'home', 60).filter((p) => p.onAt < 60).map((p) => p.psId)
    const bench = benchAt(mp, 'home', 60, s.home.getState)
    expect(bench).not.toContain(off.psId)
    expect(bench).not.toContain(first)
    const c = { onPitch, bench, cap: MAX_SUBS - subsMade(mp, 'home', 60) }
    // The man taken off cannot come back, and the man who came on cannot come on again
    expect(stageSub([], { off: onPitch[2], on: off.psId }, c).refused).toBe('not-on-bench')
    expect(stageSub([], { off: onPitch[2], on: first }, c).refused).toBe('not-on-bench')
    expect(stageSub([], { off: off.psId, on: bench[0] }, c).refused).toBe('not-on-pitch')
  })

  it('the staged list is the payload: the engine makes exactly those changes, each man into the slot of the man he replaced', () => {
    let checked = 0
    for (let i = 0; i < 10 && checked < 4; i++) {
      const { s, mp, men, onPitch, bench, subsLeft } = liveAt(`board-payload-${i}`, i, 55)
      if (bench.length < 2) continue
      let subs: Sub[] = []
      subs = stageSub(subs, { off: onPitch[5], on: bench[0] }, { onPitch, bench, cap: subsLeft }).subs
      subs = stageSub(subs, { off: onPitch[8], on: bench[1] }, { onPitch, bench, cap: subsLeft }).subs
      const expected = lineupAfter(men, subs)
      const windows = managerWindowsUsed(mp, 'home')
      const out = changeInPlay(mp, s, { side: 'home', minute: 55, substitutions: subs })
      expect(out.made.map((m) => ({ off: m.off, on: m.on }))).toEqual(subs)
      expect(managerWindowsUsed(mp, 'home')).toBe(windows + 1)
      for (const [slotId, psId] of Object.entries(expected)) expect(mp.home.lineup[slotId]).toBe(psId)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('substitution board: counters and ratings', () => {
  it('counts subs and stoppages as the engine does', () => {
    expect(boardRoom({ subCap: 3, landing: 'now', windowsLeft: 0, windowOpen: false })).toBe(0)
    expect(boardRoom({ subCap: 3, landing: 'now', windowsLeft: 0, windowOpen: true })).toBe(3)
    expect(boardRoom({ subCap: 2, landing: 'stop', windowsLeft: 0, windowOpen: false })).toBe(2)
    expect(boardRoom({ subCap: 5, landing: 'now', windowsLeft: MAX_WINDOWS, windowOpen: false })).toBe(5)
    expect(countersAfter({ subsLeft: 5, windowsLeft: 3, landing: 'now', windowOpen: false, staged: 2 })).toEqual({ subsLeft: 3, windowsLeft: 2 })
    expect(countersAfter({ subsLeft: 3, windowsLeft: 2, landing: 'now', windowOpen: true, staged: 1 })).toEqual({ subsLeft: 2, windowsLeft: 2 })
    expect(countersAfter({ subsLeft: 5, windowsLeft: 3, landing: 'stop', windowOpen: false, staged: 3 })).toEqual({ subsLeft: 2, windowsLeft: 3 })
    expect(countersAfter({ subsLeft: 5, windowsLeft: 3, landing: 'now', windowOpen: false, staged: 0 })).toEqual({ subsLeft: 5, windowsLeft: 3 })
  })

  it('previews the team rating of the lineup after the staged changes', () => {
    const { s, men, onPitch, bench, subsLeft } = liveAt('board-rating', 3)
    const t = s.home.tactics
    const before = teamRating(t, lineupAfter(men, []), s.home.getPlayer, s.home.getState)
    expect(before).toBeCloseTo(computeTeamStrength(t, Object.fromEntries(men.map((m) => [m.slotId, m.psId])), s.home.getPlayer, s.home.getState).overall, 9)
    // A keeper put up front costs the side
    const keeperOnBench = bench.find((id) => s.home.getPlayer(id)?.positions[0] === 'GK')
    const striker = men.find((m) => m.position === 'ST' || m.position === 'LW' || m.position === 'RW')
    if (keeperOnBench && striker) {
      const subs = stageSub([], { off: striker.psId, on: keeperOnBench }, { onPitch, bench, cap: subsLeft }).subs
      expect(teamRating(t, lineupAfter(men, subs), s.home.getPlayer, s.home.getState)).toBeLessThan(before)
    }
  })
})

describe('substitution board: keyboard moves', () => {
  it('moves to the nearest slot that way and stays put at the edge', () => {
    const f = getFormation('4-3-3')
    const t = { formationId: '4-3-3', mentality: 'balanced', pressing: 'mid', tempo: 'standard', width: 'standard', defensiveLine: 'standard', passing: 'mixed', roles: {} } as const
    const pts = panelPoints(f, { ...t, roles: {} })
    const gk = f.slots.find((s) => s.position === 'GK')!.id
    const up = moveOnBoard(pts, gk, 'ArrowUp')!
    const at = (id: string) => pts.find((p) => p.id === id)!
    expect(at(up).top).toBeLessThan(at(gk).top)
    expect(moveOnBoard(pts, gk, 'ArrowDown')).toBe(gk)
    // From the leftmost man, left stays; right moves right
    const leftmost = [...pts].sort((a, b) => a.left - b.left)[0]
    expect(moveOnBoard(pts, leftmost.id, 'ArrowLeft')).toBe(leftmost.id)
    expect(at(moveOnBoard(pts, leftmost.id, 'ArrowRight')!).left).toBeGreaterThan(leftmost.left)
    // No slot yet: any arrow starts at the first; a key that is not an arrow keeps the slot
    expect(moveOnBoard(pts, null, 'ArrowUp')).toBe(pts[0].id)
    expect(moveOnBoard(pts, gk, 'Enter')).toBe(gk)
    expect(moveOnBoard([], gk, 'ArrowUp')).toBeNull()
    // Every slot can be reached from the keeper by arrows
    const reached = new Set([gk])
    let frontier = [gk]
    while (frontier.length) {
      const nextF: string[] = []
      for (const id of frontier) for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        const n = moveOnBoard(pts, id, k)!
        if (!reached.has(n)) {
          reached.add(n)
          nextF.push(n)
        }
      }
      frontier = nextF
    }
    expect(reached.size).toBe(f.slots.length)
  })
})

describe('the board under a finger', () => {
  it('aims a touch drag at the lifted man, a mouse or a pen at the pointer', () => {
    expect(aimPoint(100, 300, 'touch')).toEqual({ x: 100, y: 300 - TOUCH_LIFT })
    expect(aimPoint(100, 300, 'mouse')).toEqual({ x: 100, y: 300 })
    expect(aimPoint(100, 300, 'pen')).toEqual({ x: 100, y: 300 })
  })
})
