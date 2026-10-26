/**
 * Personality labels, Football Manager style, read straight off the hidden
 * traits (professionalism, consistency, big-match temperament) and mentality.
 * Pure and fixed: the same player-season always reads the same, and the label
 * changes nothing; it only names what the traits already do.
 */
import type { PlayerSeason } from '@engine/types'

export type PersonalityId = 'model' | 'temperamental' | 'mercurial' | 'big-game' | 'professional' | 'steady' | 'fickle' | 'casual' | 'driven' | 'balanced'

export interface Personality {
  id: PersonalityId
  label: string
  /** One line on what it means in TouchLine. */
  blurb: string
}

export const PERSONALITIES: Record<PersonalityId, Omit<Personality, 'id'>> = {
  model: { label: 'Model professional', blurb: 'Develops well, shrugs off hard words and rarely lets you down.' },
  temperamental: { label: 'Temperamental', blurb: 'Takes criticism personally and blows hot and cold.' },
  mercurial: { label: 'Mercurial', blurb: 'Lives for the big night, disappears on a wet Tuesday.' },
  'big-game': { label: 'Big-game player', blurb: 'Raises his game when it matters most.' },
  professional: { label: 'Professional', blurb: 'Trains right and takes a demand on the chin.' },
  steady: { label: 'Steady', blurb: 'Plays to his rating week in, week out.' },
  fickle: { label: 'Fickle', blurb: 'Brilliant one week, anonymous the next.' },
  casual: { label: 'Casual', blurb: 'Slow to improve and quick to sulk.' },
  driven: { label: 'Driven', blurb: 'A strong mentality: a voice in the dressing room.' },
  balanced: { label: 'Balanced', blurb: 'No extremes either way.' },
}

/**
 * The label, by the first rule that holds: model professional (professionalism
 * 0.70+ and consistency 0.62+), temperamental (professionalism under 0.46 and
 * consistency under 0.5), mercurial (big-match 0.68+ and consistency under
 * 0.5), big-game player (big-match 0.66+), professional (professionalism
 * 0.68+), steady (consistency 0.68+), fickle (consistency under 0.43), casual
 * (professionalism under 0.46), driven (mentality 80+), otherwise balanced.
 */
export function personalityOf(p: Pick<PlayerSeason, 'traits' | 'attributes'>): Personality {
  const { professionalism: pro, consistency: con, bigMatch: big } = p.traits
  const id: PersonalityId =
    pro >= 0.7 && con >= 0.62 ? 'model'
    : pro < 0.46 && con < 0.5 ? 'temperamental'
    : big >= 0.68 && con < 0.5 ? 'mercurial'
    : big >= 0.66 ? 'big-game'
    : pro >= 0.68 ? 'professional'
    : con >= 0.68 ? 'steady'
    : con < 0.43 ? 'fickle'
    : pro < 0.46 ? 'casual'
    : p.attributes.mentality >= 80 ? 'driven'
    : 'balanced'
  return { id, ...PERSONALITIES[id] }
}
