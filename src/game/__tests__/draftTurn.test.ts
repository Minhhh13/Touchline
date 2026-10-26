import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, assistantTurn, newDraft, pick, QUICK_RULES, respin, spin, spinClubSeason, type DraftRules, type DraftState } from '@engine/draft'
import { canArmband, canReroll, giveArmband, rerollOptions, rerollSeason } from '@engine/powerups'
import { upgradeCandidates, upgradePlayer } from '@engine/upgrader'
import { getFormation } from '@engine/formations'
import { draftTurnKey, openWindow } from '../logic/draftTurn'

const u = loadTestUniverse(['england'])
const RULES: DraftRules = { ...QUICK_RULES, leagues: ['england'], powerUps: true }

function assistantPick(d: DraftState): void {
  const best = assistantChoice(u, d, spinClubSeason(u, d)!)!
  pick(u, d, best.id, best.slot)
}

describe('draftTurnKey', () => {
  it('moves on every spin, re-spin and pick, and stays put between them', () => {
    for (const seed of ['turn-a', 'turn-b', 'turn-c']) {
      const d = newDraft(getFormation('4-3-3'), RULES, seed)
      const rng = new Rng(seed)
      const seen = new Set<string>([draftTurnKey(d)])
      for (let i = 0; i < 6; i++) {
        const before = draftTurnKey(d)
        expect(draftTurnKey(d)).toBe(before)
        spin(u, d, rng)
        expect(seen.has(draftTurnKey(d))).toBe(false)
        seen.add(draftTurnKey(d))
        if (i === 2 && d.respinsLeft > 0) {
          const showing = draftTurnKey(d)
          respin(u, d, rng)
          expect(draftTurnKey(d)).not.toBe(showing)
          seen.add(draftTurnKey(d))
        }
        assistantPick(d)
        expect(seen.has(draftTurnKey(d))).toBe(false)
        seen.add(draftTurnKey(d))
      }
    }
  })

  it('moves when the assistant takes the turn on a Speedrun timeout', () => {
    const d = newDraft(getFormation('4-3-3'), RULES, 'turn-speedrun')
    const rng = new Rng('turn-speedrun')
    spin(u, d, rng)
    assistantPick(d)
    const before = draftTurnKey(d)
    assistantTurn(u, d, rng)
    expect(draftTurnKey(d)).not.toBe(before)
  })

  it('moves on a re-roll (the season showing changes) but not on the Upgrader or the armband', () => {
    let found = false
    for (let i = 0; i < 40 && !found; i++) {
      const seed = `turn-reroll-${i}`
      const d = newDraft(getFormation('4-3-3'), RULES, seed)
      const rng = new Rng(seed)
      for (let k = 0; k < 3; k++) {
        spin(u, d, rng)
        assistantPick(d)
      }
      const between = draftTurnKey(d)
      if (canArmband(d)) giveArmband(d, upgradeCandidates(d)[0])
      upgradePlayer(u, d, upgradeCandidates(d)[1], 2)
      expect(draftTurnKey(d)).toBe(between)
      spin(u, d, rng)
      if (!canReroll(u, d) || !rerollOptions(u, d).length) continue
      const showing = draftTurnKey(d)
      rerollSeason(u, d)
      expect(draftTurnKey(d)).not.toBe(showing)
      found = true
    }
    expect(found).toBe(true)
  })
})

describe('openWindow', () => {
  it('shows a window only on the turn it was opened on', () => {
    expect(openWindow(null, '1/0/-')).toBeNull()
    expect(openWindow({ kind: 'reroll', turn: '1/0/arsenal@2015' }, '1/0/arsenal@2015')).toBe('reroll')
    // The assistant picked on a timeout: the re-roll window of the last spin is gone
    expect(openWindow({ kind: 'reroll', turn: '1/0/arsenal@2015' }, '1/1/-')).toBeNull()
  })
})
