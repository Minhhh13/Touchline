/**
 * The dressing room as a view: who carries weight (the hierarchy), who sticks
 * together (groups formed by the draft's club-seasons, then clubs, then
 * nationality, then age) and how the room feels (an atmosphere read-out of
 * morale weighted by influence, plus chemistry). Pure and RNG-free; nothing
 * here changes a result yet (effects are Batch 3 of the FM-depth plan).
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { STATUS_LABEL, type SquadStatus } from '@engine/status'
import { squadPlayers } from './players'
import { teamStrength } from './squad'
import { statusOf } from './week'

export type HierarchyTier = 'leader' | 'high' | 'influential' | 'other'

export const TIER_ORDER: HierarchyTier[] = ['leader', 'high', 'influential', 'other']
export const TIER_LABEL: Record<HierarchyTier, string> = { leader: 'Team leaders', high: 'Highly influential', influential: 'Influential', other: 'Others' }
/** Places in each tier from the top; everyone else is in the last. */
export const TIER_SIZES = [3, 4, 6]
/** How much a tier's morale counts in the atmosphere. */
export const TIER_WEIGHT: Record<HierarchyTier, number> = { leader: 3, high: 2, influential: 1.5, other: 1 }

const STATUS_WEIGHT: Record<SquadStatus, number> = { key: 10, 'first-team': 6, rotation: 2, backup: 0, prospect: -4 }

export interface InfluenceRow {
  id: string
  name: string
  score: number
  tier: HierarchyTier
  /** Up to two reasons he carries weight, biggest first. */
  reasons: string[]
  morale: number
}

/** Completed seasons this human has played for the side (dynasty careers), from `careerStats`. */
function seasonsAt(game: Game, p: PlayerSeason): number {
  return game.careerStats?.[p.playerId]?.seasons ?? 0
}

/**
 * A player's standing: mentality, age (up to 33), reputation (his overall),
 * tenure (seasons with the side and this season's appearances), and his squad
 * status. The captain is always first, whatever his score.
 */
export function influenceOf(game: Game, p: PlayerSeason, s: SquadPlayer): { score: number; reasons: string[] } {
  const seasons = seasonsAt(game, p)
  const status = statusOf(game, p.id)
  const parts: Array<[number, string]> = [
    [(p.attributes.mentality - 60) * 0.6, `Mentality ${p.attributes.mentality}`],
    [Math.max(0, Math.min(p.age, 33) - 20) * 1.2, p.age >= 30 ? `Veteran, ${p.age}` : `Age ${p.age}`],
    [(p.overall - 70) * 0.7, p.overall >= 85 ? `Star, rated ${p.overall}` : `Rated ${p.overall}`],
    [seasons * 5 + Math.min(s.seasonStats.apps, 38) * 0.2, seasons ? `${seasons} season${seasons === 1 ? '' : 's'} here` : `${s.seasonStats.apps} app${s.seasonStats.apps === 1 ? '' : 's'}`],
    [STATUS_WEIGHT[status], STATUS_LABEL[status]],
  ]
  const score = Math.round(parts.reduce((a, [v]) => a + v, 0) * 10) / 10
  const reasons = parts.filter(([v]) => v > 2).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, r]) => r)
  return { score, reasons }
}

/** The squad ranked by influence, captain first, cut into tiers of 3, 4, 6 and the rest. */
export function hierarchy(game: Game, u: LoadedUniverse): InfluenceRow[] {
  const rows = squadPlayers(game, u).map(({ p, s }) => ({ p, s, ...influenceOf(game, p, s) }))
  const cap = game.captainId
  rows.sort((a, b) => Number(b.p.id === cap) - Number(a.p.id === cap) || b.score - a.score || a.p.id.localeCompare(b.p.id))
  return rows.map((r, i) => {
    let tier: HierarchyTier = 'other'
    let edge = 0
    for (let t = 0; t < TIER_SIZES.length; t++) {
      edge += TIER_SIZES[t]
      if (i < edge) {
        tier = TIER_ORDER[t]
        break
      }
    }
    const reasons = r.p.id === cap ? ['Captain', ...r.reasons].slice(0, 2) : r.reasons
    return { id: r.p.id, name: r.p.name, score: r.score, tier, reasons, morale: Math.round(r.s.morale) }
  })
}

export type GroupKind = 'club-season' | 'club' | 'nation' | 'age'

export interface SquadGroup {
  id: string
  kind: GroupKind
  label: string
  members: string[]
  /** Average morale of the members. */
  morale: number
  /** The most influential member. */
  leaderId: string
}

const DEMONYM: Record<string, string> = {
  ENG: 'English', ESP: 'Spanish', FRA: 'French', GER: 'Germans', ITA: 'Italians', NED: 'Dutch', POR: 'Portuguese', BRA: 'Brazilians', ARG: 'Argentines', BEL: 'Belgians',
  CRO: 'Croats', SCO: 'Scots', WAL: 'Welsh', IRL: 'Irish', NIR: 'Northern Irish', URU: 'Uruguayans', COL: 'Colombians', SEN: 'Senegalese', CIV: 'Ivorians', NGA: 'Nigerians',
  GHA: 'Ghanaians', CMR: 'Cameroonians', MAR: 'Moroccans', ALG: 'Algerians', DEN: 'Danes', SWE: 'Swedes', NOR: 'Norwegians', SUI: 'Swiss', AUT: 'Austrians', POL: 'Poles',
  SRB: 'Serbs', CZE: 'Czechs', USA: 'Americans', MEX: 'Mexicans', JPN: 'Japanese', KOR: 'Koreans', TUR: 'Turks', GRE: 'Greeks', CHI: 'Chileans', ECU: 'Ecuadorians',
  JAM: 'Jamaicans', AUS: 'Australians', CAN: 'Canadians', MLI: 'Malians', EGY: 'Egyptians', UKR: 'Ukrainians', RUS: 'Russians', SVK: 'Slovaks', SVN: 'Slovenes', HUN: 'Hungarians',
}

const seasonLabel = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`

function ageBand(age: number): { id: string; label: string } {
  if (age <= 21) return { id: 'young', label: 'The youngsters' }
  if (age >= 30) return { id: 'old', label: 'The old heads' }
  return { id: 'core', label: 'The core' }
}

/**
 * Every player in exactly one group, by the first that holds: two or more
 * drafted from the same club-season ("The 2017-18 Man City lot"), then from the
 * same club in other seasons ("The Man City old boys"), then the same
 * nationality ("The Brazilians"), then an age band (21 and under, 22 to 29,
 * 30 and over). Largest groups first; ties by id, so the same squad always
 * forms the same groups.
 */
export function squadGroups(game: Game, u: LoadedUniverse): SquadGroup[] {
  const players = squadPlayers(game, u)
  const ranks = new Map(hierarchy(game, u).map((r, i) => [r.id, i]))
  const left = new Map(players.map((x) => [x.p.id, x]))
  const groups: SquadGroup[] = []
  const take = (kind: GroupKind, keyOf: (p: PlayerSeason) => string | null, labelOf: (key: string, sample: PlayerSeason) => string, min: number) => {
    const by = new Map<string, Array<{ p: PlayerSeason; s: SquadPlayer }>>()
    for (const x of left.values()) {
      const key = keyOf(x.p)
      if (key === null) continue
      const list = by.get(key) ?? []
      list.push(x)
      by.set(key, list)
    }
    const found = [...by.entries()].filter(([, l]) => l.length >= min).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    for (const [key, list] of found) {
      const members = list.map((x) => x.p.id).sort((a, b) => (ranks.get(a) ?? 99) - (ranks.get(b) ?? 99) || a.localeCompare(b))
      for (const id of members) left.delete(id)
      groups.push({ id: `${kind}:${key}`, kind, label: labelOf(key, list[0].p), members, morale: Math.round(list.reduce((a, x) => a + x.s.morale, 0) / list.length), leaderId: members[0] })
    }
  }
  const short = (clubId: string) => u.clubById[clubId]?.shortName ?? clubId
  take('club-season', (p) => `${p.clubId}@${p.season}`, (_, p) => `The ${seasonLabel(p.season)} ${short(p.clubId)} lot`, 2)
  take('club', (p) => p.clubId, (_, p) => `The ${short(p.clubId)} old boys`, 2)
  take('nation', (p) => (p.nationality && p.nationality !== 'UNK' ? p.nationality : null), (key) => `The ${DEMONYM[key] ?? `${u.nations[key]?.name ?? key} contingent`}`, 2)
  take('age', (p) => ageBand(p.age).id, (_, p) => ageBand(p.age).label, 1)
  return groups
}

export interface Atmosphere {
  /** 0 to 100. */
  value: number
  label: 'Electric' | 'Good' | 'Steady' | 'Tense' | 'Toxic'
  /** Morale weighted by influence (leaders count three times). */
  weightedMorale: number
  /** The XI's chemistry points. */
  chemistry: number
  /** The leaders' average morale. */
  leaders: number
  /** Short lines on what drives it. */
  lines: string[]
}

/** A read-out, not a system yet: 80 per cent weighted morale, 20 per cent chemistry (50 + 20 a chemistry point, clamped 0 to 100). */
export function atmosphereOf(game: Game, u: LoadedUniverse): Atmosphere {
  const rows = hierarchy(game, u)
  const totalW = rows.reduce((a, r) => a + TIER_WEIGHT[r.tier], 0)
  const weightedMorale = totalW ? rows.reduce((a, r) => a + TIER_WEIGHT[r.tier] * (game.squad[r.id]?.morale ?? 70), 0) / totalW : 70
  const chemistry = rows.length ? teamStrength(game, u).chemistry : 0
  const chemScore = Math.max(0, Math.min(100, 50 + chemistry * 20))
  const value = Math.round(0.8 * weightedMorale + 0.2 * chemScore)
  const label = value >= 80 ? 'Electric' : value >= 65 ? 'Good' : value >= 50 ? 'Steady' : value >= 35 ? 'Tense' : 'Toxic'
  const leaderRows = rows.filter((r) => r.tier === 'leader')
  const leaders = leaderRows.length ? Math.round(leaderRows.reduce((a, r) => a + (game.squad[r.id]?.morale ?? 70), 0) / leaderRows.length) : 0
  const lines: string[] = []
  if (leaderRows.length) lines.push(`Leaders' morale ${leaders}`)
  lines.push(`Chemistry ${chemistry >= 0 ? '+' : ''}${chemistry} in the XI`)
  const unhappy = rows.filter((r) => (game.squad[r.id]?.morale ?? 70) < 40)
  if (unhappy.length) lines.push(`Unhappy: ${unhappy.slice(0, 3).map((r) => r.name.split(' ').slice(-1)[0]).join(', ')}${unhappy.length > 3 ? ` and ${unhappy.length - 3} more` : ''}`)
  return { value, label, weightedMorale: Math.round(weightedMorale), chemistry, leaders, lines }
}
