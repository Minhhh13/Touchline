import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { produce } from 'immer'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES, targetSlot, type DraftRules } from '@engine/draft'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'
import { useStore } from '../store'

const u = loadTestUniverse()

function game(seed: string, mode: GameSettings['mode'], rules: DraftRules): Game {
  return createGame({ mode, seed, formationId: '4-3-3', teamName: 'Plain XI', shortName: 'PLN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...rules, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
}

/** The recipe as it stood before: the engine's autoDraft run on the Immer draft itself. */
function reference(g: Game): Game {
  return produce(g, (x) => {
    if (!x.draft) return
    const rng = Rng.fromState(x.rngState)
    if (x.draft.current) x.draft.history.push({ ...x.draft.current, pickedId: null, slotId: null, skipped: true, ...(x.draft.twist ? { twist: x.draft.twist } : {}), ...(targetSlot(x.draft) ? { target: targetSlot(x.draft)!.id } : {}) })
    x.draft.current = null
    x.draft.twist = null
    autoDraft(u, x.draft, rng, playerLookup(x, u))
    x.rngState = rng.getState()
  })
}

describe('Auto-complete on a plain copy of the draft', () => {
  it('drafts exactly what the engine drafts on the Immer draft, over many seeds and rules', () => {
    const variants: Array<[GameSettings['mode'], DraftRules]> = [
      ['quick', QUICK_RULES],
      ['quick', { ...QUICK_RULES, draftMode: 'position' }],
      ['quick', { ...QUICK_RULES, benchPicks: 3 }],
      ['season', SEASON_RULES],
    ]
    let drafts = 0
    for (let i = 0; i < 12; i++) {
      for (const [mode, rules] of variants) {
        const g = game(`plain-auto-${i}`, mode, rules)
        useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, toast: null })
        // Half of them with a spin showing, which Auto-complete logs as skipped
        if (i % 2) useStore.getState().spin()
        const start = useStore.getState().game!
        useStore.getState().autoDraftRest()
        const got = useStore.getState().game!
        expect(JSON.stringify(got), `plain-auto-${i} ${mode} ${rules.draftMode}`).toBe(JSON.stringify(reference(start)))
        expect(Object.isFrozen(got.draft)).toBe(true)
        drafts++
      }
    }
    expect(drafts).toBe(48)
  }, 300_000)
})
