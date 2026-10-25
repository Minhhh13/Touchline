import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { FORMATIONS, getFormation } from '@engine/formations'
import { QUICK_RULES, autoDraft } from '@engine/draft'
import { groupOf } from '@engine/positions'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { THUMB_DOT_R, THUMB_H, THUMB_PAD, THUMB_W, formationThumb } from '../logic/formationThumb'
import type { GameSettings } from '../types'

const u = loadTestUniverse()

function settings(formationId: string, seed: string): GameSettings {
  return {
    mode: 'quick',
    seed,
    formationId,
    teamName: 'Thumb XI',
    shortName: 'THU',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
  }
}

describe('the mini pitch on a formation tile', () => {
  it('draws all eleven slots of every shape, on the grass, from the real slot coordinates', () => {
    expect(FORMATIONS).toHaveLength(8)
    for (const f of FORMATIONS) {
      const dots = formationThumb(f)
      expect(dots.map((d) => d.slotId)).toEqual(f.slots.map((s) => s.id))
      expect(dots).toHaveLength(11)
      for (const d of dots) {
        expect(d.cx - THUMB_DOT_R).toBeGreaterThanOrEqual(0)
        expect(d.cx + THUMB_DOT_R).toBeLessThanOrEqual(THUMB_W)
        expect(d.cy - THUMB_DOT_R).toBeGreaterThanOrEqual(0)
        expect(d.cy + THUMB_DOT_R).toBeLessThanOrEqual(THUMB_H)
      }
      // Linear in both axes: a slot's place on the tile is a fixed scaling of its place on the full pitch
      for (const [i, s] of f.slots.entries()) {
        expect(dots[i].cx).toBeCloseTo(THUMB_PAD + (s.x / 100) * (THUMB_W - 2 * THUMB_PAD), 1)
        expect(dots[i].cy).toBeCloseTo(THUMB_H - THUMB_PAD - (s.y / 100) * (THUMB_H - 2 * THUMB_PAD), 1)
        expect(dots[i].group).toBe(groupOf(s.position))
        expect(dots[i].position).toBe(s.position)
      }
    }
  })

  it('stands the shape up: the keeper at the bottom, the strikers at the top, left stays left', () => {
    for (const f of FORMATIONS) {
      const dots = formationThumb(f)
      const gk = dots.find((d) => d.group === 'GK')!
      expect(gk.cy).toBe(Math.max(...dots.map((d) => d.cy)))
      for (const [i, a] of f.slots.entries()) {
        for (const [j, b] of f.slots.entries()) {
          if (a.y > b.y) expect(dots[i].cy).toBeLessThan(dots[j].cy)
          if (a.x < b.x) expect(dots[i].cx).toBeLessThan(dots[j].cx)
        }
      }
    }
  })

  it('never lets two dots touch, so every shape reads at phone width', () => {
    for (const f of FORMATIONS) {
      const dots = formationThumb(f)
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const gap = Math.hypot(dots[i].cx - dots[j].cx, dots[i].cy - dots[j].cy)
          expect(gap, `${f.id} ${dots[i].slotId}/${dots[j].slotId}`).toBeGreaterThan(2 * THUMB_DOT_R + 0.5)
        }
      }
    }
  })

  it('gives each shape a picture of its own', () => {
    const pictures = FORMATIONS.map((f) => JSON.stringify(formationThumb(f).map((d) => [d.cx, d.cy])))
    expect(new Set(pictures).size).toBe(FORMATIONS.length)
    expect(formationThumb(getFormation('4-3-3'))).toEqual(formationThumb(getFormation('4-3-3')))
  })

  it('matches the XI a real draft fills: every drafted player sits on a dot of his slot\'s group', () => {
    for (const f of FORMATIONS) {
      for (const seed of ['THUMB-1', 'THUMB-2']) {
        const g = createGame(settings(f.id, `${seed}-${f.id}`))
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        g.rngState = rng.getState()
        const dots = formationThumb(getFormation(g.settings.formationId))
        const lookup = playerLookup(g, u)
        const filled = Object.keys(g.draft!.lineup)
        expect(filled.sort()).toEqual(dots.map((d) => d.slotId).sort())
        for (const d of dots) {
          const p = lookup(g.draft!.lineup[d.slotId])
          expect(p, `${f.id} ${d.slotId}`).toBeTruthy()
          expect(d.group).toBe(groupOf(g.draft!.formation.slots.find((s) => s.id === d.slotId)!.position))
        }
      }
    }
  })
})
