/**
 * The arena's Cup: a knockout of 8, 16 or 32 real club-seasons with the user
 * among them, in one sitting. The field, the seeds and every draw come from
 * the arena's seed streams; the ties between two AI sides are played here at
 * summary detail. Pure: every random draw comes from the `Rng` passed in.
 *
 * The Season cups keep `season.ts`; nothing here is used by an existing mode,
 * so no existing seed moves.
 */
import type { ClubSeason, SquadPlayer } from './types'
import type { LoadedUniverse } from './universe'
import type { Rng } from './rng'
import { simulateMatch, type FullMatchResult } from './match'
import { aiFixtureInputs, applyMatchToAiState, newSquadPlayer, recoverWeek, shootout, USER_TEAM, type AiClub } from './season'
import { arenaClub, arenaPool, clubSeasonKey, giantsOf, KO_FIELD_TARGET, teamStrengthOf, wheelWeight, type ArenaField, type FieldScope } from './knockout'

/** Clubs in a cup, the user included: 2 is the one-off final. */
export type CupSize = 2 | 8 | 16 | 32
export const CUP_SIZES: readonly CupSize[] = [2, 8, 16, 32]

/**
 * The team strength a Cup's field is calibrated to, by field: its mean plays
 * at this (every side loses the same points), never above its real self. The
 * final's targets (`KO_FIELD_TARGET`) except where the Cup's own balance
 * guard tuned them; the measurements are in GAME_DESIGN section 17.
 */
export const CUP_FIELD_TARGET: Record<ArenaField, number> = { ...KO_FIELD_TARGET, wheel: 73.5 }

/** The decade field takes club-seasons of this real team strength or more (the strongest of the decade fill it when too few are). */
export const DECADE_STRENGTH = 78
/** Places taken from each league for the Europe field (more, rank by rank, when a big cup needs them). */
export const EUROPE_PER_LEAGUE = 4

/** One tie of the bracket. `home` and `away` are club-season keys, or `USER_TEAM` for the user. */
export interface CupTie {
  home: string
  away: string
  /** Goals at 90, once played. */
  hg?: number
  ag?: number
  /** The shoot-out, when level at 90. */
  pens?: { home: number; away: number }
  winner?: string
}

/** The Cup's bracket: drawn a round at a time, with the AI sides' carried state. */
export interface CupBracket {
  /** The strongest quarter of the field, kept apart from each other in round one. */
  seeds: string[]
  /** Rating points taken off every AI side (0 on Realistic). */
  offset: number
  /** The rounds drawn so far, in bracket order (a tie's index is its position for the ties stream). */
  rounds: CupTie[][]
  /**
   * Player states that differ from a fresh arena side's, by club-season key,
   * for clubs still alive only: a 32-club cup's save stays small.
   */
  states: Record<string, Record<string, SquadPlayer>>
  /** The cup's winner, once decided (`USER_TEAM` when it is the user). */
  winner?: string
}

/** Rounds in a cup of this size. */
export function cupRoundCount(size: number): number {
  return Math.round(Math.log2(size))
}

/** Ties in round `round` (0-based) of a cup of this size. */
export function roundTies(size: number, round: number): number {
  return size / 2 ** (round + 1)
}

const ROUND_NAME: Record<number, { name: string; code: string }> = {
  16: { name: 'Round of 32', code: 'R32' },
  8: { name: 'Round of 16', code: 'R16' },
  4: { name: 'Quarter-final', code: 'QF' },
  2: { name: 'Semi-final', code: 'SF' },
  1: { name: 'Cup final', code: 'F' },
}

/** `Quarter-final` and `QF` for round `round` of a cup of this size. */
export function cupRoundName(size: number, round: number): { name: string; code: string } {
  return ROUND_NAME[roundTies(size, round)] ?? { name: `Round ${round + 1}`, code: `R${round + 1}` }
}

/** How much a round weighs: 1.1 for the first round and the round of 16, 1.15 a quarter-final, 1.25 a semi-final, 1.4 the final. */
export function cupImportance(size: number, round: number): number {
  const ties = roundTies(size, round)
  if (ties === 1) return 1.4
  if (round === 0) return 1.1
  return ties === 2 ? 1.25 : ties === 4 ? 1.15 : 1.1
}

/** Decades the data covers, as their first year (2000 for 2008-09 and 2009-10). */
export function cupDecades(firstSeason: number, lastSeason: number): number[] {
  const out: number[] = []
  for (let d = Math.floor(firstSeason / 10) * 10; d <= lastSeason; d += 10) out.push(d)
  return out
}

const byKey = (a: ClubSeason, b: ClubSeason) => (clubSeasonKey(a) < clubSeasonKey(b) ? -1 : clubSeasonKey(a) > clubSeasonKey(b) ? 1 : 0)
const strongestFirst = (u: LoadedUniverse) => (a: ClubSeason, b: ClubSeason) => teamStrengthOf(u, b) - teamStrengthOf(u, a) || byKey(a, b)

/** Draw `count` uniformly without replacement (one draw each), in key order so load order never moves a seed. */
function drawDistinct(rng: Rng, from: ClubSeason[], count: number): ClubSeason[] {
  const left = [...from].sort(byKey)
  const out: ClubSeason[] = []
  while (out.length < count && left.length) out.push(left.splice(Math.floor(rng.next() * left.length), 1)[0])
  return out
}

/**
 * Each league's latest complete season, ranked by final position (a league
 * without a table by real strength), as the Europe field reads it.
 */
export function europeStandings(u: LoadedUniverse, leagues: string[]): ClubSeason[][] {
  return leagues
    .map((id) => {
      const inLeague = u.clubSeasons.filter((cs) => cs.leagueId === id && cs.squad.length >= 11)
      if (!inLeague.length) return []
      const complete = inLeague.filter((cs) => cs.complete).map((cs) => cs.season)
      const season = Math.max(...(complete.length ? complete : inLeague.map((cs) => cs.season)))
      return inLeague.filter((cs) => cs.season === season).sort((a, b) => (a.position > 0 ? a.position : 99) - (b.position > 0 ? b.position : 99) || strongestFirst(u)(a, b))
    })
    .filter((l) => l.length > 0)
}

/** The decade field's scope: the decade replaces the era. */
export function decadeScope(scope: FieldScope, decade: number): Omit<FieldScope, 'field'> {
  return { leagues: scope.leagues, fromSeason: decade, toSeason: decade + 9 }
}

/**
 * The `count` AI entrants of a cup, from the field's stream:
 * - wheel: one club-season per club; each a season uniformly, then a club by the wheel's weighting;
 * - champions: the data's champions, uniformly;
 * - giants: the strongest 5% of the pool, uniformly;
 * - decade: club-seasons of the decade (`scope.decade`) with a real strength of 78 or more, uniformly;
 * - europe: the top four of each league's latest complete season, uniformly (no era).
 * When a field runs dry (a narrow era, a small pool), the strongest unused
 * club-seasons of its pool fill the rest; Europe goes a rank deeper in each
 * league, strongest first. The user's draft never enters it.
 */
export function cupField(u: LoadedUniverse, rng: Rng, scope: FieldScope & { decade?: number }, count: number): ClubSeason[] {
  if (count <= 0) return []
  if (scope.field === 'europe') {
    const standings = europeStandings(u, scope.leagues)
    const top = standings.flatMap((l) => l.slice(0, EUROPE_PER_LEAGUE))
    if (!top.length) throw new Error('No club-seasons in the arena field')
    if (top.length >= count) return drawDistinct(rng, top, count)
    const deeper = standings.flatMap((l) => l.slice(EUROPE_PER_LEAGUE)).sort(strongestFirst(u))
    return [...top.sort(byKey), ...deeper.slice(0, count - top.length)]
  }
  const pool = scope.field === 'decade' ? arenaPool(u, decadeScope(scope, scope.decade ?? 2010)) : arenaPool(u, scope)
  if (!pool.length) throw new Error('No club-seasons in the arena field')
  let out: ClubSeason[]
  if (scope.field === 'wheel') {
    out = []
    const clubs = new Set<string>()
    const keys = new Set<string>()
    while (out.length < count) {
      let from = pool.filter((cs) => !clubs.has(cs.clubId))
      if (!from.length) from = pool.filter((cs) => !keys.has(clubSeasonKey(cs)))
      if (!from.length) break
      const seasons = [...new Set(from.map((cs) => cs.season))].sort((a, b) => a - b)
      const season = rng.pick(seasons)
      const cs = rng.pickWeighted(
        from.filter((x) => x.season === season),
        (x) => wheelWeight(x),
      )
      out.push(cs)
      clubs.add(cs.clubId)
      keys.add(clubSeasonKey(cs))
    }
  } else {
    const from = scope.field === 'champions' ? pool.filter((cs) => cs.champions) : scope.field === 'giants' ? giantsOf(u, pool) : pool.filter((cs) => teamStrengthOf(u, cs) >= DECADE_STRENGTH)
    out = drawDistinct(rng, from, count)
  }
  if (out.length < count) {
    const used = new Set(out.map(clubSeasonKey))
    out.push(
      ...pool
        .filter((cs) => !used.has(clubSeasonKey(cs)))
        .sort(strongestFirst(u))
        .slice(0, count - out.length),
    )
  }
  return out
}

/** The seeds: the strongest quarter of a cup (2 of 8, 4 of 16, 8 of 32), strongest first, ties by key. */
export function cupSeeds(u: LoadedUniverse, field: ClubSeason[], size: number): string[] {
  return [...field]
    .sort(strongestFirst(u))
    .slice(0, Math.floor(size / 4))
    .map(clubSeasonKey)
}

/** Pair a shuffled list two by two, a coin for each home side. */
function pairUp(rng: Rng, sides: string[]): CupTie[] {
  const ties: CupTie[] = []
  for (let i = 0; i + 1 < sides.length; i += 2) ties.push(rng.chance(0.5) ? { home: sides[i], away: sides[i + 1] } : { home: sides[i + 1], away: sides[i] })
  return ties
}

/**
 * Round one: every seed is drawn against an unseeded side first (the user is
 * never seeded), then the unseeded sides that are left meet each other. Both
 * lists are shuffled, sorted first so their order in never matters; a coin
 * picks each home side.
 */
export function drawFirstRound(rng: Rng, seeds: string[], unseeded: string[]): CupTie[] {
  const s = rng.shuffle([...seeds].sort())
  const o = rng.shuffle([...unseeded].sort())
  const sides: string[] = []
  for (const seed of s) {
    const other = o.shift()
    if (other === undefined) break
    sides.push(seed, other)
  }
  return pairUp(rng, [...sides, ...o])
}

/** A later round: the sides still alive (in bracket order), shuffled and paired, a coin for each home side. */
export function drawNextRound(rng: Rng, alive: string[]): CupTie[] {
  return pairUp(rng, rng.shuffle([...alive]))
}

/** A copy of a player state (never an alias of a stored one). */
function copyState(s: SquadPlayer): SquadPlayer {
  return { ...s, recentRatings: [...s.recentRatings], injury: s.injury ? { ...s.injury } : null, seasonStats: { ...s.seasonStats } }
}

/** A fresh arena side's player state, the baseline `states` is stored against. */
function freshState(id: string): SquadPlayer {
  return newSquadPlayer(id, { familiarity: 70, sharpness: 85 })
}

/** An AI entrant as it stands: the real squad, fresh except for the states stored for it. */
export function cupClub(u: LoadedUniverse, key: string, states: Record<string, Record<string, SquadPlayer>>): AiClub {
  const cs = u.clubSeasonByKey[key]
  if (!cs) throw new Error(`Unknown club-season ${key}`)
  const club = arenaClub(u, cs)
  for (const [id, s] of Object.entries(states[key] ?? {})) if (club.state[id]) club.state[id] = copyState(s)
  return club
}

/** The states of a side worth storing: only those that differ from a fresh arena side's. */
export function changedStates(club: AiClub): Record<string, SquadPlayer> {
  const out: Record<string, SquadPlayer> = {}
  for (const [id, s] of Object.entries(club.state)) if (JSON.stringify(s) !== JSON.stringify(freshState(id))) out[id] = copyState(s)
  return out
}

/**
 * A knockout match on an AI side: the result goes onto its states, with the
 * arena's card rules in place of the league's (a red card is a one-match ban,
 * and so is every second booking of the run), and a man banned who sat this
 * one out has served his ban.
 */
export function applyArenaResult(club: AiClub, res: FullMatchResult, side: 'home' | 'away'): void {
  const stats = side === 'home' ? res.homeStats : res.awayStats
  const gf = side === 'home' ? res.homeGoals : res.awayGoals
  const ga = side === 'home' ? res.awayGoals : res.homeGoals
  const played = new Set<string>()
  for (const st of stats) {
    const s = club.state[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    const before = s.suspension
    applyMatchToAiState(s, st, res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, gf > ga ? 'W' : gf === ga ? 'D' : 'L')
    s.suspension = before
    if (st.yellow && s.yellowCards % 2 === 0) s.suspension = Math.max(s.suspension, 1)
    if (st.red) s.suspension = Math.max(s.suspension, 1)
  }
  for (const [id, s] of Object.entries(club.state)) if (s.suspension > 0 && !played.has(id)) s.suspension -= 1
}

/**
 * Play a tie between two AI sides at summary detail on its own fork of the
 * ties stream: level at 90 goes to the Season cups' team-overall shoot-out.
 * The winner's states are stored, the loser's dropped.
 */
export function playAiTie(u: LoadedUniverse, rng: Rng, tie: CupTie, b: CupBracket, importance: number, neutral: boolean): void {
  const home = cupClub(u, tie.home, b.states)
  const away = cupClub(u, tie.away, b.states)
  // Two seasons of one club (or one man's two clubs) never share him: he plays for the home side (E6-2)
  const sides = aiFixtureInputs(u, home, away, b.offset)
  const res = simulateMatch({ rng, home: sides.home, away: sides.away, importance, neutral, detail: 'summary' })
  tie.hg = res.homeGoals
  tie.ag = res.awayGoals
  let homeWins = res.homeGoals > res.awayGoals
  if (res.homeGoals === res.awayGoals) {
    const pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
    tie.pens = pens
    homeWins = pens.home > pens.away
  }
  tie.winner = homeWins ? tie.home : tie.away
  applyArenaResult(home, res, 'home')
  applyArenaResult(away, res, 'away')
  const winner = homeWins ? home : away
  b.states[winner.id] = changedStates(winner)
  delete b.states[homeWins ? away.id : home.id]
}

/**
 * Between two rounds: every stored AI state recovers by `factor` of a week
 * (one match off every injury). A man at a fresh side's state has nothing to
 * recover from and stays as he is.
 */
export function recoverCupStates(u: LoadedUniverse, b: CupBracket, factor: number): void {
  for (const states of Object.values(b.states)) {
    for (const [id, s] of Object.entries(states)) {
      const p = u.index[id]
      if (!p) continue
      const before = s.condition
      recoverWeek(s, p, true, 0)
      s.condition = Math.min(100, before + Math.round((s.condition - before) * factor))
    }
  }
}

/** The user's tie in a round, or null once he is out. */
export function userTie(round: CupTie[] | undefined): CupTie | null {
  return round?.find((t) => t.home === USER_TEAM || t.away === USER_TEAM) ?? null
}
