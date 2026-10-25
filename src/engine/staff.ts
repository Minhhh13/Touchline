/**
 * Backroom staff. Four roles, three tiers each. Staff wages count against the
 * wage cap, so a full elite backroom is a real choice against another signing.
 */
export type StaffRole = 'assistant' | 'coach' | 'physio' | 'scout'

export interface StaffTier {
  /** 0 = nobody in the role. */
  tier: 0 | 1 | 2
  title: string
  /** GBP thousands per week. */
  wage: number
  blurb: string
}

export interface StaffRoleInfo {
  label: string
  help: string
  tiers: [StaffTier, StaffTier, StaffTier]
}

export const STAFF: Record<StaffRole, StaffRoleInfo> = {
  assistant: {
    label: 'Assistant manager',
    help: 'Runs the sessions you do not: the system beds in faster and team talks land better.',
    tiers: [
      { tier: 0, title: 'No assistant', wage: 0, blurb: 'You do everything yourself.' },
      { tier: 1, title: 'Experienced number two', wage: 25, blurb: '+1 tactical familiarity a week. Team talks 15% stronger.' },
      { tier: 2, title: 'Elite assistant', wage: 60, blurb: '+2 tactical familiarity a week. Team talks 30% stronger.' },
    ],
  },
  coach: {
    label: 'Head coach',
    help: 'Sharper sessions: players keep their edge and the weekly training focus bites harder.',
    tiers: [
      { tier: 0, title: 'No specialist coach', wage: 0, blurb: 'Training is what it is.' },
      { tier: 1, title: 'Pro Licence coach', wage: 20, blurb: '+1 sharpness a week. Training focus effects 1% stronger.' },
      { tier: 2, title: 'Elite coaching team', wage: 50, blurb: '+2 sharpness a week. Training focus effects 2% stronger.' },
    ],
  },
  physio: {
    label: 'Physio',
    help: 'Fewer training injuries, quicker returns, fresher legs.',
    tiers: [
      { tier: 0, title: 'Club doctor only', wage: 0, blurb: 'Injuries run their course.' },
      { tier: 1, title: 'Senior physio', wage: 15, blurb: 'Training injuries 25% rarer. +2 condition a week. Some injuries heal a week sooner.' },
      { tier: 2, title: 'Sports science department', wage: 40, blurb: 'Training injuries 45% rarer. +4 condition a week. Injuries heal a week sooner.' },
    ],
  },
  scout: {
    label: 'Chief scout',
    help: 'Finds players the market would not show you and tells you what the ratings hide.',
    tiers: [
      { tier: 0, title: 'No scouting network', wage: 0, blurb: 'You see what everyone sees.' },
      { tier: 1, title: 'Regional scouts', wage: 15, blurb: '+1 extra listing a market day. Hidden traits shown on the market.' },
      { tier: 2, title: 'Global network', wage: 40, blurb: '+2 extra listings a market day. Hidden traits shown; weak link named in opposition reports.' },
    ],
  },
}

export const STAFF_ROLES = Object.keys(STAFF) as StaffRole[]

export type StaffState = Partial<Record<StaffRole, number>>

export function staffTier(staff: StaffState | undefined, role: StaffRole): 0 | 1 | 2 {
  const t = staff?.[role] ?? 0
  return (t >= 2 ? 2 : t >= 1 ? 1 : 0) as 0 | 1 | 2
}

/** Weekly staff wages, GBP thousands. */
export function staffWages(staff: StaffState | undefined): number {
  return STAFF_ROLES.reduce((s, r) => s + STAFF[r].tiers[staffTier(staff, r)].wage, 0)
}

/** Labels for the hidden traits a scout reveals. */
export function traitTags(traits: { consistency: number; injuryProneness: number; bigMatch: number; professionalism: number }): string[] {
  const tags: string[] = []
  if (traits.consistency >= 0.75) tags.push('Consistent')
  else if (traits.consistency <= 0.35) tags.push('Streaky')
  if (traits.injuryProneness <= 0.3) tags.push('Ironman')
  else if (traits.injuryProneness >= 0.75) tags.push('Injury prone')
  if (traits.bigMatch >= 0.7) tags.push('Big-game player')
  if (traits.professionalism >= 0.8) tags.push('Model professional')
  else if (traits.professionalism <= 0.3) tags.push('Maverick')
  return tags
}
