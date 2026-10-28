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
    // Every engine-keyed message has its engine id: nothing stale left in the catalogue
    expect([...keys].filter((k) => /^(formation|role|powerUp|style|training|staff)/.test(k))).toEqual([])
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

describe('the game logic’s display words mirrored on screen', () => {
  it('a manager’s edge, the odds note, the case guide, its rarities and the reel’s tiers', async () => {
    const { edgeHint, edgeLine } = await import('@game/logic/managerEdge')
    const { caseGuide } = await import('@game/logic/caseGuide')
    const { CASE_RARITY_LABEL } = await import('@game/logic/endCase')
    const { DISPLAY_TIER_INFO, tierName } = await import('@game/logic/rarity')
    const { shownOdds } = await import('@game/logic/oddsDisplay')
    for (const e of [{ attack: 3, defence: -1, suits: true, young: 4, xi: 11 }, { attack: 0, defence: 1.5, suits: false, young: 0, xi: 11 }]) {
      expect(et.edgeText(e)).toBe(edgeLine(e))
      for (const s of MANAGER_STYLES) expect(et.edgeHintText(s, e)).toBe(edgeHint(s, e))
    }
    for (const p of [[0.5, 0.5], [1 / 3, 1 / 3, 1 / 3]]) expect(et.oddsNote(shownOdds(p).exact)).toBe(shownOdds(p).note)
    for (const r of caseGuide({ inventory: {} })) {
      expect(et.caseRowTitle(r)).toBe(r.title)
      expect(et.caseRowLine(r)).toBe(r.line)
    }
    for (const r of Object.keys(CASE_RARITY_LABEL) as (keyof typeof CASE_RARITY_LABEL)[]) expect(et.rarityText(r)).toBe(CASE_RARITY_LABEL[r])
    for (const k of Object.keys(DISPLAY_TIER_INFO) as (keyof typeof DISPLAY_TIER_INFO)[]) {
      expect(et.tierColour(k)).toBe(DISPLAY_TIER_INFO[k].colour)
      expect(et.tierWord(k)).toBe(DISPLAY_TIER_INFO[k].label)
      expect(et.reelTierName(k)).toBe(tierName(k))
    }
  })

  it('a season tier and its line, the Super League’s included', async () => {
    const { tierBlurb } = await import('@engine/season')
    const { superTierBlurb } = await import('@game/logic/superLeague')
    const { tierName } = await import('../format')
    const { tierBlurbText, tierText } = await import('../i18n/tierText')
    const tiers = ['PERFECT', 'INVINCIBLE', 'CHAMPIONS', 'TITLE_RACE', 'EUROPEAN', 'MID_TABLE', 'RELEGATION_BATTLE', 'RELEGATED'] as const
    for (const tier of tiers)
      for (const pos of [1, 2, 3, 4, 6, 11, 18, 20]) {
        for (const sl of [false, true]) expect(tierText(tier, pos, sl)).toBe(tierName(tier, pos, sl))
        expect(tierText(tier)).toBe(tierName(tier))
        expect(tierBlurbText(tier, pos, 20)).toBe(tierBlurb(tier, pos, 20))
        expect(tierBlurbText(tier, pos, 22, { sacked: true })).toBe(tierBlurb(tier, pos, 22, true))
        expect(tierBlurbText(tier, pos, 20, { superLeague: true })).toBe(superTierBlurb(tier, pos, 20))
      }
  })
})
