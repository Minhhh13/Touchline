import { describe, expect, it } from 'vitest'
import { buildBracket, revealSteps, type BracketTie } from '@game/logic/bracket'
import { CUP_REVEAL, revealDelay, revealLength, userFinalInPlay, userInPlay, userOutBy } from '../cupReveal'

const t = (home: string, away: string, hg: number, ag: number): BracketTie => ({ home, away, hg, ag, winner: hg > ag ? home : away })

// Four clubs and the user: the user wins his semi-final and loses the final
const won = buildBracket(['Semi-final', 'Final'], [[t('a', 'b', 2, 0), t('user', 'c', 1, 0)], [t('user', 'a', 0, 1)]])
// The user goes out in the semi-final; the other semi and the final follow quickly
const out = buildBracket(['Semi-final', 'Final'], [[t('user', 'c', 0, 3), t('a', 'b', 2, 0)], [t('c', 'a', 1, 0)]])

describe('the cup reveal’s pace', () => {
  it('gives the user’s tie its moment, holds after it, and opens each round with the draw', () => {
    const steps = revealSteps(won)
    // Step 0 is the user's semi-final (his tie first in its round), step 1 the other, step 2 the final
    expect(userInPlay(won, steps, 0)).toBe(true)
    expect(userInPlay(won, steps, 1)).toBe(false)
    expect(revealDelay(won, steps, 0)).toBe(CUP_REVEAL.live)
    expect(revealDelay(won, steps, 1)).toBe(CUP_REVEAL.hold)
    // His final waits longest of all
    expect(revealDelay(won, steps, 2)).toBe(CUP_REVEAL.final + CUP_REVEAL.round)
    expect(CUP_REVEAL.final).toBeGreaterThan(CUP_REVEAL.live)
    expect([0, 1, 2].map((n) => userFinalInPlay(won, steps, n))).toEqual([false, false, true])
    expect(revealDelay(won, steps, 3)).toBe(0)
    expect(revealLength(won, steps)).toBe(CUP_REVEAL.live + CUP_REVEAL.final + CUP_REVEAL.hold + CUP_REVEAL.round)
  })

  it('runs through the rest of the cup quickly once the user is out', () => {
    const steps = revealSteps(out)
    expect(userOutBy(out, steps, 0)).toBe(false)
    expect(userOutBy(out, steps, 1)).toBe(true)
    // The tie after his is held; the final, with him out, is quick
    expect(revealDelay(out, steps, 1)).toBe(CUP_REVEAL.hold)
    expect(revealDelay(out, steps, 2)).toBe(CUP_REVEAL.fast + CUP_REVEAL.round)
  })

  it('keeps a whole sixteen-club cup to about thirteen seconds, and every pause on the motion scale or longer', () => {
    const r0 = Array.from({ length: 8 }, (_, i) => t(i === 0 ? 'user' : `h${i}`, `a${i}`, 1, 0))
    const r1 = Array.from({ length: 4 }, (_, i) => t(r0[2 * i].winner!, r0[2 * i + 1].winner!, 2, 1))
    const r2 = Array.from({ length: 2 }, (_, i) => t(r1[2 * i].winner!, r1[2 * i + 1].winner!, 1, 0))
    const r3 = [t(r2[0].winner!, r2[1].winner!, 3, 1)]
    const view = buildBracket(['Fourth round', 'Quarter-final', 'Semi-final', 'Final'], [r0, r1, r2, r3])
    expect(view.champion).toBe('user')
    const ms = revealLength(view, revealSteps(view))
    expect(ms).toBeGreaterThan(9000)
    expect(ms).toBeLessThan(15000)
    expect(Math.min(...Object.values(CUP_REVEAL))).toBeGreaterThanOrEqual(140)
  })
})
