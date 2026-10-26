import type { PlayerSeason, Position, SquadPlayer } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { describeFit, POSITIONS, ratingAt, type Fit } from '@engine/positions'
import { INJURY_RISK_LABEL, injuryRiskLevel } from '@engine/depth'
import { isEstimated } from './era'

/**
 * The player card's derived numbers (display only, no RNG): the rating-by-season series, the
 * position map, the attribute columns, the form graph and the squad row's form arrow.
 */

/** Every database season of one real player across the loaded leagues, oldest first. */
export function careerSeasons(u: LoadedUniverse, playerId: string): PlayerSeason[] {
  return Object.values(u.index)
    .filter((p) => p.playerId === playerId)
    .sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
}

export interface SeasonPoint {
  season: number
  /** "08/09" */
  label: string
  overall: number
  clubId: string
  /** TouchLine's estimate (a classic season), not an EA rating. */
  estimated: boolean
  /** The first season at the career peak. */
  peak: boolean
  /** He played for a different club than at the previous point. */
  clubChange: boolean
}

/** A season as "08/09". */
export function shortSeason(season: number): string {
  const a = String(season % 100).padStart(2, '0')
  const b = String((season + 1) % 100).padStart(2, '0')
  return `${a}/${b}`
}

/** One point per season (the best entry when he played for two clubs that season), oldest first. */
export function seasonSeries(u: LoadedUniverse, seasons: PlayerSeason[]): SeasonPoint[] {
  const bySeason = new Map<number, PlayerSeason>()
  for (const p of seasons) {
    const cur = bySeason.get(p.season)
    if (!cur || p.overall > cur.overall) bySeason.set(p.season, p)
  }
  const ordered = [...bySeason.values()].sort((a, b) => a.season - b.season)
  const peak = ordered.reduce((m, p) => Math.max(m, p.overall), 0)
  const peakSeason = ordered.find((p) => p.overall === peak)?.season
  return ordered.map((p, i) => ({
    season: p.season,
    label: shortSeason(p.season),
    overall: p.overall,
    clubId: p.clubId,
    estimated: isEstimated(u, p.id),
    peak: p.season === peakSeason,
    clubChange: i > 0 && ordered[i - 1].clubId !== p.clubId,
  }))
}

/** The chart's fixed y range: 50 to 99, opened down in steps of 10 for a career that dips below 50. */
export function seasonScale(points: Array<Pick<SeasonPoint, 'overall'>>): { min: number; max: number } {
  const low = points.reduce((m, p) => Math.min(m, p.overall), 99)
  return { min: low >= 50 ? 50 : Math.max(0, Math.floor((low - 2) / 10) * 10), max: 99 }
}

export type MapFit = 'natural' | 'cover' | 'awkward' | 'unsuited'

export interface MapSpot {
  pos: Position
  fit: MapFit
  rating: number
}

const MAP_FIT: Record<Fit, MapFit> = { natural: 'natural', accomplished: 'cover', awkward: 'awkward', unsuited: 'unsuited' }

/** The position map: every position with his fit and his rating there. Natural and cover are what `canCover` accepts. */
export function positionMap(p: Pick<PlayerSeason, 'positions' | 'attributes'>): MapSpot[] {
  return POSITIONS.map((pos) => ({ pos, fit: MAP_FIT[describeFit(p, pos)], rating: Math.round(ratingAt(p, pos)) }))
}

export type AttrRow =
  | { kind: 'attr'; key: string; label: string; value: number }
  | { kind: 'trait'; key: string; label: string; value: number; word: 'High' | 'Avg' | 'Low' }
  | { kind: 'risk'; key: 'injury'; label: string; level: 1 | 2 | 3 | 4 | 5; word: string; note: string }

export interface AttrColumn {
  title: 'Technical' | 'Physical' | 'Mental'
  rows: AttrRow[]
}

/** A hidden trait as a word: never a number. */
export function traitWord(v: number): 'High' | 'Avg' | 'Low' {
  return v >= 0.7 ? 'High' : v >= 0.45 ? 'Avg' : 'Low'
}

/** One plain line on what the injury risk means. */
export const INJURY_RISK_NOTE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Rarely injured.',
  2: 'Injured less than most.',
  3: 'A typical injury record.',
  4: 'Injured more than most.',
  5: 'Often injured: keep cover.',
}

/** Attributes in three even columns: Technical (with defending and goalkeeping), Physical (with injury risk) and Mental (with the hidden traits). */
export function attributeColumns(p: Pick<PlayerSeason, 'attributes' | 'traits' | 'positions'>): AttrColumn[] {
  const a = p.attributes
  const t = p.traits
  const risk = injuryRiskLevel(t)
  const at = (key: string, label: string, value: number): AttrRow => ({ kind: 'attr', key, label, value })
  const tr = (key: string, label: string, value: number): AttrRow => ({ kind: 'trait', key, label, value, word: traitWord(value) })
  const outfield = [at('shooting', 'Shooting', a.shooting), at('passing', 'Passing', a.passing), at('dribbling', 'Dribbling', a.dribbling), at('defending', 'Defending', a.defending)]
  const keeping = at('goalkeeping', 'Goalkeeping', a.goalkeeping)
  return [
    { title: 'Technical', rows: p.positions[0] === 'GK' ? [keeping, ...outfield] : [...outfield, keeping] },
    { title: 'Physical', rows: [at('pace', 'Pace', a.pace), at('stamina', 'Stamina', a.stamina), at('strength', 'Strength', a.strength), at('jumping', 'Jumping', a.jumping), { kind: 'risk', key: 'injury', label: 'Injury risk', level: risk, word: INJURY_RISK_LABEL[risk], note: INJURY_RISK_NOTE[risk] }] },
    { title: 'Mental', rows: [at('mentality', 'Mentality', a.mentality), at('aggression', 'Aggression', a.aggression), at('workRate', 'Work rate', a.workRate), tr('bigMatch', 'Big match', t.bigMatch), tr('consistency', 'Consistency', t.consistency), tr('professionalism', 'Professional', t.professionalism)] },
  ]
}

/** A match rating's band: good from 7.5, bad under 6. */
export function formBand(r: number): 'good' | 'mid' | 'bad' {
  return r >= 7.5 ? 'good' : r < 6 ? 'bad' : 'mid'
}

export interface FormPoint {
  index: number
  rating: number
  band: 'good' | 'mid' | 'bad'
}

/** The form graph: the stored recent ratings (the save keeps the last 6), oldest first. */
export function formSeries(s: Pick<SquadPlayer, 'recentRatings'>): FormPoint[] {
  return s.recentRatings.map((rating, index) => ({ index, rating, band: formBand(rating) }))
}
