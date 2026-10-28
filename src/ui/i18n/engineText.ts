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
