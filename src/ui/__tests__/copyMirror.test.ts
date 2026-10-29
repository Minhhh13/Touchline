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

describe('the mode cards and the fixed-rules chips', () => {
  it('say what MODE_INFO and describeRuleChips say, but Hard reads "No re-spins" for 0', async () => {
    const { MODE_CARDS, MODE_INFO } = await import('@engine/modes')
    for (const c of MODE_CARDS) {
      expect(et.modeCardTitle(c)).toBe(MODE_INFO[c].title)
      expect(et.modeCardLine(c)).toBe(c === 'hard' ? MODE_INFO.hard.line.replace(/^0 re-spins/, 'No re-spins') : MODE_INFO[c].line)
    }
    const { loadTestUniverse } = await import('../../engine/__tests__/helpers')
    const { describeRuleChips } = await import('@game/logic/setup')
    const { DAILY_RULES } = await import('@game/logic/daily')
    const { QUICK_RULES, SEASON_RULES } = await import('@engine/draft')
    const u = loadTestUniverse(['england'])
    const sets = [DAILY_RULES, QUICK_RULES, SEASON_RULES, { ...QUICK_RULES, respins: 0, modes: ['crazy', 'speedrun'] as const, upgrader: true, powerUps: true, managers: true, managerSpin: false, endCase: true, superLeague: true, fromSeason: 2010, toSeason: 2015, benchPicks: 3 }, { ...QUICK_RULES, respins: 3, twists: false, managers: true, managerSpin: true }]
    for (const r of sets) {
      const chips = describeRuleChips(u, r as never)
      expect(et.ruleChipsText(u, r as never).map((x) => x.text)).toEqual(chips.map((c) => c.text))
    }
  })
})

describe('the Weekly themes', () => {
  it('name and line every theme as weeklyThemes.ts and weekly.ts do', async () => {
    const { WEEKLY_THEMES, weeklyThemeName } = await import('@game/logic/weeklyThemes')
    const { weeklyThemeLine } = await import('@game/logic/weekly')
    const { weeklyThemeLineText, weeklyThemeText } = await import('../i18n/weeklyThemeText')
    const { loadTestUniverse } = await import('../../engine/__tests__/helpers')
    const u = loadTestUniverse(['england'])
    for (const id of Object.keys(WEEKLY_THEMES) as (keyof typeof WEEKLY_THEMES)[]) {
      expect(weeklyThemeText(id)).toBe(weeklyThemeName(id))
      for (const rules of [{}, { onlyNation: 'fr' }]) expect(weeklyThemeLineText(u, { theme: id, rules })).toBe(weeklyThemeLine(u, { theme: id, rules: rules as never }))
    }
    expect(weeklyThemeText('a-newer-theme')).toBe('a-newer-theme')
    expect(weeklyThemeText(undefined)).toBe('')
  })
})

describe('the Run-in and the arena fields', () => {
  it('say what runin.ts and arena.ts say', async () => {
    const { gapLine, jobLine, RUN_IN_BRIEF_SHORT, RUN_IN_TEMPLATE_LABEL } = await import('@game/logic/runin')
    const { ARENA_FIELDS } = await import('@game/logic/arena')
    const { briefShortText, gapText, jobText, templateText } = await import('../runInText')
    const { translator } = await import('../i18n')
    const { arena } = await import('../i18n/en/arena')
    const ta = translator(arena)
    for (const k of ['title', 'europe', 'survival'] as const) {
      expect(templateText(k)).toBe(RUN_IN_TEMPLATE_LABEL[k])
      expect(briefShortText(k)).toBe(RUN_IN_BRIEF_SHORT[k])
      for (const [target, pos] of [[1, 1], [1, 3], [4, 2], [4, 6], [17, 15], [17, 19]])
        for (const gap of pos > target ? [-3, -1, 0] : [0, 1, 4]) {
          expect(gapText(k, target, pos, gap)).toBe(gapLine(k, target, pos, gap))
          const job = { template: k, target, gap, takeover: 28, projected: { position: pos, points: 40 } }
          expect(jobText(job as never)).toBe(jobLine(job as never))
        }
    }
    for (const f of ARENA_FIELDS) {
      expect(ta(`field_${f.value}`)).toBe(f.label)
      expect(ta(`fieldHint_${f.value}`)).toBe(f.hint)
    }
  })
})

describe('the Dugout’s match-play chips and squad views', () => {
  it('say what assistant.ts and squadDisplay.ts say', async () => {
    const { MATCH_PLAY_MODES } = await import('@game/logic/assistant')
    const { SQUAD_VIEWS } = await import('@game/logic/squadDisplay')
    const { translator } = await import('../i18n')
    const { dugout } = await import('../i18n/en/dugout')
    const t = translator(dugout)
    for (const m of MATCH_PLAY_MODES) {
      expect(t(`play_${m.id}`)).toBe(m.label)
      expect(t(`playHint_${m.id}`)).toBe(m.hint)
    }
    for (const v of SQUAD_VIEWS) {
      expect(t(`view_${v.id}`)).toBe(v.label)
      expect(t(`viewHint_${v.id}`)).toBe(v.hint)
    }
  })
})

describe('Home’s Daily Arena line, the league gate and the empty wheel', () => {
  it('say what arenaDaily.ts, leagueLoad.ts and wheelCheck.ts say', async () => {
    const { dailyArenaLine } = await import('@game/logic/arenaDaily')
    const { gateLabel, LEAGUE_MISSING_LINE } = await import('@game/logic/leagueLoad')
    const { EMPTY_WHEEL_LABEL } = await import('@game/logic/wheelCheck')
    const { translator } = await import('../i18n')
    const { home } = await import('../i18n/en/home')
    const { setup } = await import('../i18n/en/setup')
    const th = translator(home)
    const ts = translator(setup)
    const u = { available: [{ id: 'england', name: 'Premier League' }] } as never
    expect(th('arenaDayGauntlet', { wheel: 'Premier League' })).toBe(dailyArenaLine(u, { format: 'gauntlet', leagueId: 'england' } as never))
    expect(th('arenaDayCup', { size: 16, wheel: 'Premier League' })).toBe(dailyArenaLine(u, { format: 'cup', size: 16, leagueId: 'england' } as never))
    expect(ts('loadingLeagues')).toBe(gateLabel('loading', ''))
    expect(ts('leagueMissing')).toBe(gateLabel('missing', ''))
    expect(ts('leagueMissingLine')).toBe(LEAGUE_MISSING_LINE)
    expect(ts('emptyWheel')).toBe(EMPTY_WHEEL_LABEL)
  })
})

describe('the briefing’s fixed words', () => {
  it('read as briefing.ts writes them, for a pre-season and a Dynasty summer', async () => {
    const { loadTestUniverse } = await import('../../engine/__tests__/helpers')
    const { weeklyBriefing } = await import('@game/logic/briefing')
    const { createGame } = await import('@game/logic/setup')
    const { autoDraft, SEASON_RULES } = await import('@engine/draft')
    const { Rng } = await import('@engine/rng')
    const { beginSeason } = await import('@game/logic/setup')
    const { briefingActionText, briefingHintText, briefingLineText } = await import('../briefingText')
    const u = loadTestUniverse(['england'])
    let seen = 0
    for (const seed of ['brief-a', 'brief-b', 'brief-c']) {
      const game = createGame({ mode: 'season', seed, formationId: '4-3-3', teamName: 'Brief XI', shortName: 'BXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated', continental: false })
      const rng = Rng.fromState(game.rngState)
      autoDraft(u, game.draft!, rng)
      game.rngState = rng.getState()
      beginSeason(game, u)
      for (const item of weeklyBriefing(game, u)) {
        seen++
        expect(briefingLineText(item)).toBe(item.text)
        if (item.hint) expect(briefingHintText(item)).toBe(item.hint)
        if (item.action) expect(briefingActionText(item.action.label)).toBe(item.action.label)
      }
    }
    expect(seen).toBeGreaterThan(5)
    for (const label of ['Auto-pick', 'Choose', 'Club', 'Contracts', 'Decide', 'Market', 'Medical', 'Play friendly', 'Squad', 'Tactics', 'View']) expect(briefingActionText(label)).toBe(label)
    expect(briefingLineText({ id: 'renewals', text: 'Contracts: 3 out' })).toBe('Contracts: 3 out')
    expect(briefingLineText({ id: 'captain', text: 'Captain: H. Kane' })).toBe('Captain: H. Kane')
  })
})

describe('the Dugout’s sim button', () => {
  it('reads as simToLabel', async () => {
    const { translator } = await import('../i18n')
    const { dugout } = await import('../i18n/en/dugout')
    const t = translator(dugout)
    expect(t('simToStop', { label: 'Derby day', n: 7 })).toBe('Sim to Derby day (MW 7)')
    expect(t('simToNextBig')).toBe('Sim to the next big match')
    const src = (await import('node:fs')).readFileSync(new URL('../../game/logic/seasonHighlights.ts', import.meta.url), 'utf8')
    expect(src).toContain("`Sim to ${seen.label} (MW ${seen.matchweek})` : 'Sim to the next big match'")
  })
})
