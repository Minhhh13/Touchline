/**
 * Rarity tiers for club-seasons, in the colours of a Counter-Strike case: gold,
 * red, pink, purple and blue, from the strongest squads down.
 *
 * Strength is the mean rating of a squad's best eleven. Every club-season of the
 * chosen leagues, across all seasons, is ranked once by strength and cut into
 * fixed shares (5 / 10 / 20 / 30 / 35 per cent), so a tier depends only on the
 * data and the league set, never on the draft: a club keeps its colour from the
 * first spin to the last. Presentation only; nothing here feeds the engine.
 */
import type { ClubSeason, PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'

export type Tier = 'gold' | 'red' | 'pink' | 'purple' | 'blue'

/** Strongest first. */
export const TIERS: readonly Tier[] = ['gold', 'red', 'pink', 'purple', 'blue']

/** Share of all club-seasons in each tier; sums to 1. */
export const TIER_SHARE: Record<Tier, number> = { gold: 0.05, red: 0.1, pink: 0.2, purple: 0.3, blue: 0.35 }

/** Display names: the colour and what it means. The hex values live once in styles.css as `--tier-<tier>`. */
export const TIER_INFO: Record<Tier, { colour: string; label: string }> = {
  gold: { colour: 'Gold', label: 'Elite' },
  red: { colour: 'Red', label: 'Great' },
  pink: { colour: 'Pink', label: 'Good' },
  purple: { colour: 'Purple', label: 'Decent' },
  blue: { colour: 'Blue', label: 'Underdog' },
}

/** "Gold · Elite" */
export function tierName(t: Tier): string {
  return `${TIER_INFO[t].colour} · ${TIER_INFO[t].label}`
}

/** How a player is rated for strength; season ratings by default (a Prime-ratings mode can pass its own). */
export type RatingOf = (p: PlayerSeason) => number

const seasonRating: RatingOf = (p) => p.overall

/** Players counted in a squad's strength. */
export const STRENGTH_XI = 11

/** Mean rating of the eleven highest-rated players in the squad (of all of them when fewer than eleven); 0 for an empty squad. */
export function clubSeasonStrength(cs: ClubSeason, rating: RatingOf = seasonRating): number {
  if (!cs.squad.length) return 0
  const best = cs.squad.map(rating).sort((a, b) => b - a).slice(0, STRENGTH_XI)
  return best.reduce((s, v) => s + v, 0) / best.length
}

/** `${clubId}@${season}` -> tier, for every club-season of a league set. */
export type TierTable = Readonly<Record<string, Tier>>

const memo = new WeakMap<LoadedUniverse, Map<string, WeakMap<RatingOf, TierTable>>>()

/** The leagues a tier table is built over: the given ones, or every league loaded in the universe. */
function leagueSet(u: LoadedUniverse, leagues?: readonly string[]): string[] {
  const ids = leagues?.length ? leagues : u.clubSeasons.map((cs) => cs.leagueId)
  return [...new Set(ids)].sort()
}

/**
 * The tier of every club-season in these leagues (all loaded leagues when omitted),
 * ranked across all their seasons by `clubSeasonStrength`, ties broken by the
 * club-season key so the order is stable. Memoised per universe, league set and
 * rating function.
 */
export function tierTable(u: LoadedUniverse, leagues?: readonly string[], rating: RatingOf = seasonRating): TierTable {
  const ids = leagueSet(u, leagues)
  const setKey = ids.join(',')
  let byLeagues = memo.get(u)
  if (!byLeagues) memo.set(u, (byLeagues = new Map()))
  let byRating = byLeagues.get(setKey)
  if (!byRating) byLeagues.set(setKey, (byRating = new WeakMap()))
  const hit = byRating.get(rating)
  if (hit) return hit

  const wanted = new Set(ids)
  const table: Record<string, Tier> = {}
  // Standard and classic club-seasons are ranked apart, so loading the classic pack moves no standard tier
  for (const classic of [false, true]) rankInto(table, u.clubSeasons.filter((cs) => wanted.has(cs.leagueId) && !!cs.classic === classic), rating)
  byRating.set(rating, table)
  return table
}

function rankInto(table: Record<string, Tier>, clubSeasons: readonly ClubSeason[], rating: RatingOf): void {
  const ranked = clubSeasons
    .map((cs) => ({ key: `${cs.clubId}@${cs.season}`, strength: clubSeasonStrength(cs, rating) }))
    .sort((a, b) => b.strength - a.strength || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const n = ranked.length
  // Cumulative cut-offs, rounded once each so the shares add up to every club-season exactly
  const ends: number[] = []
  let cum = 0
  for (const t of TIERS) {
    cum += TIER_SHARE[t]
    ends.push(Math.round(cum * n))
  }
  ends[ends.length - 1] = n
  let tier = 0
  ranked.forEach((r, i) => {
    while (i >= ends[tier]) tier++
    table[r.key] = TIERS[tier]
  })
}

/** The tier of one club-season in a league set, or null when it is not in those leagues. */
export function clubSeasonTier(u: LoadedUniverse, leagues: readonly string[] | undefined, clubId: string, season: number, rating?: RatingOf): Tier | null {
  return tierTable(u, leagues, rating)[`${clubId}@${season}`] ?? null
}
