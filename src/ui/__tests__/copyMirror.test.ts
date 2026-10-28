/**
 * The screens' mirrors of English that the engine and the game logic keep for themselves (the share text, the verifier's
 * bundle): each mirror reads through `t()` and must say exactly what its source says in English.
 */
import { describe, expect, it } from 'vitest'
import { FORMATIONS } from '@engine/formations'
import { ROLES } from '@engine/roles'
import { POWER_UPS } from '@engine/powerups'
import { MANAGER_STYLES } from '@engine/managers'
import { TRAINING } from '@engine/training'
import { STAFF, STAFF_ROLES } from '@engine/staff'
import type { TrainingFocus } from '@engine/training'
import { costLabel, slotRatingLine, type SlotRating } from '@game/logic/slotRating'
import * as et from '../i18n/engineText'
import { engineText } from '../i18n/en/engineText'
import { costText, slotRatingText } from '../slotRatingText'

describe('engineText mirrors the engine’s English', () => {
  it('every formation, role, power-up, style, training focus and staff tier', () => {
    const keys = new Set(Object.keys(engineText.messages))
    const read = (k: string) => (keys.delete(k), k)
    for (const f of FORMATIONS) {
      read(`formation_${f.id}`)
      expect(et.formationBlurb(f)).toBe(f.blurb)
    }
    for (const r of ROLES) {
      read(`roleName_${r.id}`)
      read(`roleBlurb_${r.id}`)
      expect(et.roleName(r)).toBe(r.name)
      expect(et.roleBlurb(r)).toBe(r.blurb)
    }
    for (const k of POWER_UPS) {
      read(`powerUp_${k}`)
      read(`powerUpLine_${k}`)
    }
    for (const k of MANAGER_STYLES) {
      read(`style_${k}`)
      read(`styleHelp_${k}`)
    }
    for (const k of Object.keys(TRAINING) as TrainingFocus[]) {
      read(`training_${k}`)
      read(`trainingBlurb_${k}`)
      expect(et.trainingBlurb(k)).toBe(TRAINING[k].blurb)
    }
    for (const k of STAFF_ROLES) {
      read(`staff_${k}`)
      read(`staffHelp_${k}`)
      STAFF[k].tiers.forEach((x, i) => {
        read(`staffTier_${k}_${i}`)
        read(`staffTierBlurb_${k}_${i}`)
        expect(et.staffTierTitle(k, i)).toBe(x.title)
        expect(et.staffTierBlurb(k, i)).toBe(x.blurb)
      })
    }
    // Every message has its engine id: nothing stale left in the catalogue
    expect([...keys]).toEqual([])
  })

  it('power-ups and styles read the engine’s words', async () => {
    const { POWER_UP_INFO } = await import('@engine/powerups')
    const { MANAGER_STYLE_HELP, MANAGER_STYLE_LABEL } = await import('@engine/managers')
    for (const k of Object.keys(POWER_UP_INFO) as (keyof typeof POWER_UP_INFO)[]) {
      expect(et.powerUpTitle(k)).toBe(POWER_UP_INFO[k].title)
      expect(et.powerUpLine(k)).toBe(POWER_UP_INFO[k].line)
    }
    for (const k of MANAGER_STYLES) {
      expect(et.styleLabel(k)).toBe(MANAGER_STYLE_LABEL[k])
      expect(et.styleHelp(k)).toBe(MANAGER_STYLE_HELP[k])
    }
  })
})

describe('slotRatingText mirrors slotRatingLine', () => {
  it('natural and out of position, with and without the attributes', () => {
    const cases: SlotRating[] = [
      { inSlot: 84, overall: 89, cost: 5, attributes: 75 },
      { inSlot: 81, overall: 81, cost: 0, attributes: 80 },
    ]
    for (const r of cases) {
      expect(costText(r)).toBe(costLabel(r))
      expect(slotRatingText(r, 'RW')).toBe(slotRatingLine(r, 'RW'))
      expect(slotRatingText(r, 'RW', { attributes: true })).toBe(slotRatingLine(r, 'RW', { attributes: true }))
    }
  })
})
