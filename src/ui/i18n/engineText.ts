/**
 * The engine's display words on screen, through `t()`: a formation's blurb, a role's name and line, a power-up's title
 * and line, a manager style, a training focus and the backroom staff. The engine keeps its English for the logic and
 * the share text; each helper reads the catalogue by the engine's id and falls back to the engine's own words for an id
 * the catalogue does not hold yet. `copyMirror.test.ts` holds every message equal to the engine's English.
 */
import type { Formation } from '@engine/types'
import type { Role } from '@engine/roles'
import { POWER_UP_INFO, type PowerUp } from '@engine/powerups'
import { MANAGER_STYLE_HELP, MANAGER_STYLE_LABEL, type ManagerStyle } from '@engine/managers'
import { TRAINING, TRAINING_LABEL } from '@engine/training'
import { STAFF, type StaffRole } from '@engine/staff'
import type { TrainingFocus } from '@engine/training'
import { YOUTH_AGE } from '@engine/managers'
import type { CaseRarity } from '@engine/endCase'
import type { ManagerEdge } from '@game/logic/managerEdge'
import type { CaseGuideRow } from '@game/logic/caseGuide'
import { DISPLAY_TIER_INFO, type DisplayTier } from '@game/logic/rarity'
import { MODE_CARDS, MODE_INFO, SPEEDRUN_SECONDS, type ModeCard } from '@engine/modes'
import { benchPlaces, CRAZY_SURPRISE_CHANCE, difficultyOf, DIFFICULTY_RESPINS, draftModeOf, LEGENDS_RATING, modesOf, ratingsHidden, ratingsModeOf, type DraftRules } from '@engine/draft'
import { ICONS_CHANCE } from '@engine/icons'
import { SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { seasonLabel, type LoadedUniverse } from '@engine/universe'
import { describeRuleChips, type RuleChip } from '@game/logic/setup'
import { eraFirstSeason } from '@game/logic/era'
import { translator } from './index'
import { engineText } from './en/engineText'

const t = translator(engineText)
const read = (key: string, english: string) => (t.has(key) ? t(key) : english)

export const formationBlurb = (f: Pick<Formation, 'id' | 'blurb'>) => read(`formation_${f.id}`, f.blurb)
export const roleName = (r: Pick<Role, 'id' | 'name'>) => read(`roleName_${r.id}`, r.name)
export const roleBlurb = (r: Pick<Role, 'id' | 'blurb'>) => read(`roleBlurb_${r.id}`, r.blurb)
export const powerUpTitle = (k: PowerUp) => read(`powerUp_${k}`, POWER_UP_INFO[k].title)
export const powerUpLine = (k: PowerUp) => read(`powerUpLine_${k}`, POWER_UP_INFO[k].line)
export const styleLabel = (k: ManagerStyle) => read(`style_${k}`, MANAGER_STYLE_LABEL[k])
export const styleHelp = (k: ManagerStyle) => read(`styleHelp_${k}`, MANAGER_STYLE_HELP[k])
export const trainingLabel = (k: TrainingFocus) => read(`training_${k}`, TRAINING_LABEL[k])
export const trainingBlurb = (k: TrainingFocus) => read(`trainingBlurb_${k}`, TRAINING[k].blurb)
export const staffLabel = (k: StaffRole) => read(`staff_${k}`, STAFF[k].label)
export const staffHelp = (k: StaffRole) => read(`staffHelp_${k}`, STAFF[k].help)
export const staffTierTitle = (k: StaffRole, tier: number) => read(`staffTier_${k}_${tier}`, STAFF[k].tiers[tier]?.title ?? '')
export const staffTierBlurb = (k: StaffRole, tier: number) => read(`staffTierBlurb_${k}_${tier}`, STAFF[k].tiers[tier]?.blurb ?? '')

const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}%`

/** A manager style's edge on the XI (`edgeLine`): "+3.0% goals · −1.0% conceded". */
export const edgeText = (e: Pick<ManagerEdge, 'attack' | 'defence'>) => t('edge', { attack: signed(e.attack), defence: signed(e.defence) })

/** What the XI and the instructions add to a style's line (`edgeHint`), or null. */
export function edgeHintText(style: ManagerStyle, e: ManagerEdge): string | null {
  if (style === 'youth') return t('edgeYouth', { young: e.young, xi: e.xi, age: YOUTH_AGE })
  return e.suits ? t('edgeSuits') : null
}

/** The odds panel's note (`shownOdds(...).note`). */
export const oddsNote = (exact: boolean) => t(exact ? 'oddsExact' : 'oddsRounded')

/** A case guide row's title and line (`caseGuide`). */
export const caseRowTitle = (r: Pick<CaseGuideRow, 'item' | 'title'>) => (r.item === 'icon' ? t('caseIconTitle') : powerUpTitle(r.item))
export const caseRowLine = (r: Pick<CaseGuideRow, 'item' | 'line'>) => (r.item === 'icon' ? t('caseIconLine') : powerUpLine(r.item))

/** A case drop's rarity (`CASE_RARITY_LABEL`). */
export const rarityText = (r: CaseRarity) => read(`rarity_${r}`, r)

/** A reel tier's colour and its word (`DISPLAY_TIER_INFO`), and the pair (`tierName` in `rarity.ts`: "Gold · Elite"). */
export const tierColour = (k: DisplayTier) => read(`tierColour_${k}`, DISPLAY_TIER_INFO[k].colour)
export const tierWord = (k: DisplayTier) => read(`tierLabel_${k}`, DISPLAY_TIER_INFO[k].label)
export const reelTierName = (k: DisplayTier) => t('tierPair', { colour: tierColour(k), label: tierWord(k) })

/** A Quick Draft mode card's name and line (`MODE_INFO`); Hard with no re-spins reads "No re-spins", not "0 re-spins". */
export const modeCardTitle = (c: ModeCard) => read(`modeTitle_${c}`, MODE_INFO[c].title)
export function modeCardLine(c: ModeCard): string {
  const vars = { crazy: { pct: Math.round(CRAZY_SURPRISE_CHANCE * 100) }, hard: { n: DIFFICULTY_RESPINS.hard }, legends: { rating: LEGENDS_RATING }, speedrun: { s: SPEEDRUN_SECONDS }, gamble: { pct: Math.round(ICONS_CHANCE * 100) } } as Partial<Record<ModeCard, Record<string, number>>>
  return t.has(`modeLine_${c}`) ? t(`modeLine_${c}`, vars[c]) : MODE_INFO[c].line
}
/** `MODE_INFO` in the viewer's language, for the Modes row (its emoji kept for the share text's sake). */
export const modeCardInfo = () => Object.fromEntries(MODE_CARDS.map((c) => [c, { icon: MODE_INFO[c].icon, title: modeCardTitle(c), line: modeCardLine(c) }])) as Record<ModeCard, { icon: string; title: string; line: string }>

/**
 * The fixed-rules chips (`describeRuleChips` in setup.ts, which the verifier bundles) in the viewer's language: the
 * engine's chip (whose English `ruleNotes.ts` reads) beside its words, chip for chip and in the same order.
 */
export function ruleChipsText(u: LoadedUniverse, r: DraftRules): Array<{ chip: RuleChip; text: string }> {
  const diff = difficultyOf(r)
  const respins = r.respins
  const words: string[] = [
    respins === DIFFICULTY_RESPINS[diff] ? t('chipLevel', { level: diff, respins: t('chipRespins', { n: respins }) }) : t('chipRespinsAlone', { n: respins }),
    t(ratingsHidden(r) ? 'chipRatingsHidden' : 'chipRatingsOn'),
    t(draftModeOf(r) === 'position' ? 'chipPositionFirst' : 'chipSquadFirst'),
    t(ratingsModeOf(r) === 'prime' ? 'chipPrime' : 'chipSeason'),
    r.fromSeason === undefined && r.toSeason === undefined ? t('chipAllTime') : t('chipRange', { from: seasonLabel(eraFirstSeason(u, r)), to: seasonLabel(r.toSeason ?? u.lastSeason) }),
    t(r.twists ? 'chipTwistsOn' : 'chipNoTwists'),
    ...(benchPlaces(r) ? [t('chipBench', { n: benchPlaces(r) })] : []),
    ...modesOf(r).map((m) => modeCardTitle(m)),
    ...(r.upgrader ? [modeCardTitle('upgrader')] : []),
    ...(r.powerUps ? [t('chipPowerUps')] : []),
    ...(r.managers ? [t(r.managerSpin ? 'chipManagerSpin' : 'chipManagerPick')] : []),
    ...(r.endCase ? [t('chipEndCase')] : []),
    ...(r.superLeague ? [SUPER_LEAGUE_NAME] : []),
  ]
  const chips = describeRuleChips(u, r)
  // Should the two ever part, the engine's words stand rather than a chip in the wrong place
  return chips.map((chip, i) => ({ chip, text: words.length === chips.length ? words[i] : chip.text }))
}

/** A rules tag (`rulesTags` in the engine) in words: the difficulty, Blind, the draft and the ratings mode. */
export function ruleTagText(tag: string): string {
  const known: Record<string, string> = { Easy: t('tagEasy'), Normal: t('tagNormal'), Hard: t('tagHard'), Blind: t('tagBlind'), 'Position First': t('chipPositionFirst'), 'Squad First': t('chipSquadFirst'), 'Prime ratings': t('chipPrime'), 'Season ratings': t('chipSeason') }
  return known[tag] ?? tag
}
