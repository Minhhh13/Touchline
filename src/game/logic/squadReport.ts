/**
 * Squad complete's scouting report on the drafted XI: the key man and the weak link (by the number on his disc), who is
 * playing out of position, the age profile, and how many of the eleven already know each other (team-mates from the
 * same club-season, the chemistry links `chemistryOf` counts). Pure and draw-free: it reads the lineup and the lookup.
 * With ratings hidden it names no key man or weak link, since picking them out would show the ratings.
 */
import { describeFit, type Fit } from '@engine/positions'
import { YOUTH_AGE } from '@engine/managers'
import { UNKNOWN_NATION } from '@engine/nations'
import type { Formation, Lineup, PlayerSeason, Position } from '@engine/types'
import { discRating } from './slotSheet'

/** Starters at or over this age count as the XI's experience. */
export const VETERAN_AGE = 32

export interface ReportMan {
  id: string
  name: string
  position: Position
  /** His number on the disc in that slot; null with ratings hidden. */
  rating: number | null
  fit: Fit
}

export interface SquadReport {
  /** The best starter in his slot (the first in the formation's order on a tie). */
  key: ReportMan | null
  /** The weakest starter in his slot, when he is a clear step below the rest (3 or more under the XI's mean). */
  weak: ReportMan | null
  /** Starters not natural in their slot, worst fit first. */
  outOfPosition: ReportMan[]
  /** Mean age, one decimal. */
  meanAge: number
  young: number
  veterans: number
  /** Pairs of starters from the same club-season. */
  links: number
  clubs: number
  nations: number
  starters: number
}

const FIT_RANK: Record<Fit, number> = { natural: 0, accomplished: 1, awkward: 2, unsuited: 3 }

export function squadReport(formation: Formation, lineup: Lineup, get: (id: string) => PlayerSeason | undefined, hideRatings: boolean): SquadReport | null {
  const men = formation.slots.flatMap((sl) => {
    const id = lineup[sl.id]
    const p = id ? get(id) : undefined
    return p ? [{ p, position: sl.position, r: discRating(p, sl.position), fit: describeFit(p, sl.position) }] : []
  })
  if (!men.length) return null
  const man = (x: (typeof men)[number]): ReportMan => ({ id: x.p.id, name: x.p.name, position: x.position, rating: hideRatings ? null : x.r, fit: x.fit })
  const mean = men.reduce((s, x) => s + x.r, 0) / men.length
  let key = men[0]
  let weak = men[0]
  for (const x of men) {
    if (x.r > key.r) key = x
    if (x.r < weak.r) weak = x
  }
  let links = 0
  for (let i = 0; i < men.length; i++) for (let j = i + 1; j < men.length; j++) if (men[i].p.clubId === men[j].p.clubId && men[i].p.season === men[j].p.season) links++
  return {
    key: hideRatings ? null : man(key),
    weak: hideRatings || men.length < 2 || mean - weak.r < 3 ? null : man(weak),
    outOfPosition: men.filter((x) => x.fit !== 'natural').sort((a, b) => FIT_RANK[b.fit] - FIT_RANK[a.fit]).map(man),
    meanAge: Math.round((men.reduce((s, x) => s + x.p.age, 0) / men.length) * 10) / 10,
    young: men.filter((x) => x.p.age <= YOUTH_AGE).length,
    veterans: men.filter((x) => x.p.age >= VETERAN_AGE).length,
    links,
    clubs: new Set(men.map((x) => x.p.clubId)).size,
    nations: new Set(men.map((x) => x.p.nationality).filter((n) => n && n !== UNKNOWN_NATION)).size,
    starters: men.length,
  }
}
