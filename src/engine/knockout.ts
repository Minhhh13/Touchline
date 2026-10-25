/**
 * The arena's knockout engine: real club-seasons as one-sitting opponents, the
 * field they are drawn from, the calibration that pulls them towards a
 * drafted side, and a kick-by-kick penalty shoot-out where the order of the
 * takers matters. Pure: every random draw comes from the `Rng` passed in.
 *
 * The Season cups keep `shootout()` in `season.ts`; nothing here is used by an
 * existing mode, so no existing seed moves.
 */
import type { ClubSeason, PlayerSeason, SquadPlayer } from './types'
import type { LoadedUniverse } from './universe'
import type { Rng } from './rng'
import { aiTeamInput, newSquadPlayer, type AiClub } from './season'
import { tacticsForStyle, formationForStyle } from './tactics'
import { computeTeamStrength } from './ratings'

/** Where an arena's opponents come from. */
export type ArenaField = 'wheel' | 'champions' | 'giants' | 'decade' | 'europe'

/** The key an arena club is filed under: `${clubId}@${season}`, the same as `u.clubSeasonByKey`. */
export function clubSeasonKey(cs: Pick<ClubSeason, 'clubId' | 'season'>): string {
  return `${cs.clubId}@${cs.season}`
}

/** The club id inside a club-season key (badges and colours need the club, not the season). */
export function clubIdOfKey(key: string): string {
  const at = key.indexOf('@')
  return at < 0 ? key : key.slice(0, at)
}

/** `Real Madrid 2017-18`. */
export function clubSeasonName(u: LoadedUniverse, cs: Pick<ClubSeason, 'clubId' | 'season'>): string {
  return `${u.clubById[cs.clubId]?.name ?? cs.clubId} ${cs.season}-${String((cs.season + 1) % 100).padStart(2, '0')}`
}

/** A real club-season as an arena opponent: `buildAiClubs`'s recipe, keyed by club and season. */
export function arenaClub(u: LoadedUniverse, cs: ClubSeason): AiClub {
  const club = u.clubById[cs.clubId]
  const style = club?.style ?? 'balanced'
  const state: Record<string, SquadPlayer> = {}
  for (const p of cs.squad) state[p.id] = newSquadPlayer(p.id, { familiarity: 70, sharpness: 85 })
  return { id: clubSeasonKey(cs), clubId: cs.clubId, name: clubSeasonName(u, cs), shortName: club?.shortName ?? cs.clubId, tactics: tacticsForStyle(style, formationForStyle(style)), squad: cs.squad.map((p) => p.id), state }
}

const strengthMemo = new WeakMap<LoadedUniverse, Map<string, number>>()

/** A club-season's real team strength: its auto-picked XI, fresh legs, no offset. Memoised per universe, never saved. */
export function teamStrengthOf(u: LoadedUniverse, cs: ClubSeason): number {
  let memo = strengthMemo.get(u)
  if (!memo) {
    memo = new Map()
    strengthMemo.set(u, memo)
  }
  const key = clubSeasonKey(cs)
  let s = memo.get(key)
  if (s === undefined) {
    const club = arenaClub(u, cs)
    const inp = aiTeamInput(u, club)
    s = computeTeamStrength(club.tactics, inp.lineup, inp.getPlayer, inp.getState).overall
    memo.set(key, s)
  }
  return s
}

export interface FieldScope {
  /** Leagues the field may come from. */
  leagues: string[]
  fromSeason?: number
  toSeason?: number
  field: ArenaField
  /** The decade field's first year (2010 for 2010-11 to 2019-20); it replaces the era. */
  decade?: number
}

/** Every club-season in the scope, sorted by key so the order the packs loaded in never changes a seed. */
export function arenaPool(u: LoadedUniverse, scope: Omit<FieldScope, 'field'>): ClubSeason[] {
  const lo = scope.fromSeason ?? -Infinity
  const hi = scope.toSeason ?? Infinity
  return u.clubSeasons
    .filter((cs) => scope.leagues.includes(cs.leagueId) && cs.season >= lo && cs.season <= hi && cs.squad.length >= 11)
    .sort((a, b) => (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : clubSeasonKey(a) > clubSeasonKey(b) ? 1 : 0))
}

/** The wheel's own weighting of a club-season: a higher finish is likelier, a season without a table sits in the middle. */
export function wheelWeight(cs: ClubSeason): number {
  return cs.position > 0 ? 1 + 0.06 * (21 - cs.position) : 1.6
}

/** The strongest 5% of a pool by real team strength (at least one), strongest first, ties by key. */
export function giantsOf(u: LoadedUniverse, pool: ClubSeason[]): ClubSeason[] {
  const ranked = [...pool].sort((a, b) => teamStrengthOf(u, b) - teamStrengthOf(u, a) || (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : 1))
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.05)))
}

/**
 * The opponent of a one-off final, drawn from the field's stream:
 * - wheel: a season uniformly, then a club by the wheel's weighting;
 * - champions: the champions of the data only (leagues without tables never appear);
 * - giants: the strongest 5% of the pool.
 * The decade and European fields are drawn by `cupField` (`cup.ts`), a final's opponent as a field of one; here they draw as the wheel does.
 * An empty champions pool (no table in scope) falls back to the giants.
 */
export function finalOpponent(u: LoadedUniverse, rng: Rng, scope: FieldScope): ClubSeason {
  const pool = arenaPool(u, scope)
  if (!pool.length) throw new Error('No club-seasons in the arena field')
  if (scope.field === 'champions') {
    const champions = pool.filter((cs) => cs.champions)
    if (champions.length) return rng.pick(champions)
  }
  if (scope.field === 'giants' || scope.field === 'champions') return rng.pick(giantsOf(u, pool))
  const seasons = [...new Set(pool.map((cs) => cs.season))].sort((a, b) => a - b)
  const season = rng.pick(seasons)
  return rng.pickWeighted(
    pool.filter((cs) => cs.season === season),
    (cs) => wheelWeight(cs),
  )
}

/** The team strength each field is calibrated to: the mean opponent plays at this, never above its real self. */
export const KO_FIELD_TARGET: Record<ArenaField, number> = { wheel: 72, decade: 74, europe: 75, champions: 76, giants: 78 }

/** Rating points taken off every opponent in a knockout: 0 on Realistic, otherwise the field's mean over its target (the final's targets unless others are given). */
export function knockoutOffset(strengths: number[], field: ArenaField, difficulty: 'calibrated' | 'realistic', targets: Record<ArenaField, number> = KO_FIELD_TARGET): number {
  if (difficulty === 'realistic' || !strengths.length) return 0
  const mean = strengths.reduce((a, b) => a + b, 0) / strengths.length
  return Math.max(0, Math.round((mean - targets[field]) * 10) / 10)
}

// ---------------------------------------------------------------------------
// The penalty shoot-out

export interface Taker {
  id: string
  shooting: number
  mentality: number
}

export interface Kick {
  side: 'home' | 'away'
  takerId: string
  scored: boolean
  /** The chance he had, for the reveal and the tests. */
  p: number
}

export interface Shootout {
  home: number
  away: number
  kicks: Kick[]
}

/** How much the moment weighs on a kick: the first three lightly, the fourth, the fifth and sudden death more and more. */
export function kickPressure(kickNo: number): number {
  return kickNo <= 3 ? 0.5 : kickNo === 4 ? 1 : kickNo === 5 ? 1.5 : 2
}

/** The chance a taker scores his side's `kickNo`-th kick against a keeper of this goalkeeping. */
export function kickChance(t: Pick<Taker, 'shooting' | 'mentality'>, keeperGoalkeeping: number, kickNo: number): number {
  const p = 0.74 + (t.shooting - 70) * 0.004 + (t.mentality - 70) * 0.004 * kickPressure(kickNo) - (keeperGoalkeeping - 75) * 0.003
  return Math.min(0.92, Math.max(0.5, p))
}

/**
 * A shoot-out, home kicking first: five each in turn (ABAB), stopping as soon
 * as one side cannot be caught, then sudden-death pairs. Each side's takers
 * cycle through its order (up to eleven) before anyone goes again. One draw
 * per kick.
 */
export function penaltyShootout(rng: Rng, takers: { home: Taker[]; away: Taker[] }, keepers: { home: number; away: number }): Shootout {
  if (!takers.home.length || !takers.away.length) throw new Error('A shoot-out needs a taker on each side')
  const order = { home: takers.home.slice(0, 11), away: takers.away.slice(0, 11) }
  const out: Shootout = { home: 0, away: 0, kicks: [] }
  const taken = { home: 0, away: 0 }
  const kick = (side: 'home' | 'away') => {
    const n = taken[side] + 1
    const t = order[side][(n - 1) % order[side].length]
    const p = kickChance(t, side === 'home' ? keepers.away : keepers.home, n)
    const scored = rng.next() < p
    taken[side] = n
    if (scored) out[side] += 1
    out.kicks.push({ side, takerId: t.id, scored, p })
  }
  const decided = () => out.home > out.away + (5 - taken.away) || out.away > out.home + (5 - taken.home)
  for (let i = 0; i < 5; i++) {
    kick('home')
    if (decided()) return out
    kick('away')
    if (decided()) return out
  }
  while (out.home === out.away) {
    kick('home')
    kick('away')
  }
  return out
}

/** The default order: the named penalty taker first, then by (shooting + mentality) / 2, the goalkeeper last. */
export function defaultTakers(onPitch: string[], getPlayer: (id: string) => PlayerSeason | undefined, penaltyTakerId?: string): string[] {
  const score = (id: string) => {
    const p = getPlayer(id)
    return p ? (p.attributes.shooting + p.attributes.mentality) / 2 : 0
  }
  const isKeeper = (id: string) => getPlayer(id)?.positions[0] === 'GK'
  return [...onPitch].sort((a, b) => {
    if (a === penaltyTakerId) return -1
    if (b === penaltyTakerId) return 1
    if (isKeeper(a) !== isKeeper(b)) return isKeeper(a) ? 1 : -1
    return score(b) - score(a) || (a < b ? -1 : a > b ? 1 : 0)
  })
}

/** A taker as the shoot-out reads him. */
export function takerOf(id: string, getPlayer: (id: string) => PlayerSeason | undefined): Taker {
  const p = getPlayer(id)
  return { id, shooting: p?.attributes.shooting ?? 50, mentality: p?.attributes.mentality ?? 50 }
}

/**
 * How an arena run ended: a final's result, how far up the Gauntlet (`RUNGS`,
 * with the count beside it, or all fifteen), or the round a Cup ended in.
 */
export type ArenaTier = 'WINNERS' | 'RUNNERS-UP' | 'RUNGS' | 'GAUNTLET COMPLETE' | 'CUP WINNERS' | 'FINALISTS' | 'SEMI-FINALISTS' | 'QUARTER-FINALISTS' | 'OUT IN THE ROUND OF 16' | 'OUT IN THE FIRST ROUND'

export const ARENA_TIER_LABEL: Record<ArenaTier, string> = {
  WINNERS: 'WINNERS',
  'RUNNERS-UP': 'RUNNERS-UP',
  RUNGS: 'RUNGS',
  'GAUNTLET COMPLETE': 'GAUNTLET COMPLETE',
  'CUP WINNERS': 'CUP WINNERS',
  FINALISTS: 'FINALISTS',
  'SEMI-FINALISTS': 'SEMI-FINALISTS',
  'QUARTER-FINALISTS': 'QUARTER-FINALISTS',
  'OUT IN THE ROUND OF 16': 'OUT IN THE ROUND OF 16',
  'OUT IN THE FIRST ROUND': 'OUT IN THE FIRST ROUND',
}

/** The banner of a run: `WINNERS`, `7 RUNGS`, `1 RUNG`, `GAUNTLET COMPLETE`. `score` is the rounds won. */
export function arenaTierLabel(tier: ArenaTier, score: number): string {
  return tier === 'RUNGS' ? `${score} ${score === 1 ? 'RUNG' : 'RUNGS'}` : ARENA_TIER_LABEL[tier]
}
