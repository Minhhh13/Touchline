/**
 * The case-opening reel, dealt as plain data so it can be tested without a DOM.
 *
 * The engine has already chosen the club-season (`spin` draws the season first,
 * then a club inside it); the reel only presents that draw: a season drum that
 * rolls through the seasons this wheel could land on and stops on the drawn
 * one, then a strip of every club of that season in the draft's leagues, the
 * ones the wheel could actually stop on lit and the rest dimmed, with the drawn
 * club-season deep in the strip at `REEL_LAND`.
 *
 * The random source is injected: the UI passes `Math.random` (cosmetic only, it
 * never feeds the game), tests pass a seeded one.
 */
import { isComplete, wheelPool, type DraftRules, type DraftState } from '@engine/draft'
import type { H2HDraft } from '@engine/h2h'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { tierTable, type Tier } from './rarity'

/** Cards in one strip, and the index the drawn club-season sits at. */
export const REEL_CARDS = 70
export const REEL_LAND = 60
/** Labels on the season drum, and the index of the drawn season (one more label shows below it). */
export const DRUM_LABELS = 22
export const DRUM_LAND = 20
/** The near-miss jitter: the strip stops up to this fraction of a card either side of the card's centre. */
export const REEL_JITTER = 1 / 3

/** Three-letter league codes for the small tag on a card when the draft spans several leagues. */
const LEAGUE_CODES: Record<string, string> = { england: 'ENG', spain: 'ESP', italy: 'ITA', germany: 'GER', france: 'FRA', netherlands: 'NED', portugal: 'POR' }

export interface ReelCard {
  /** `${clubId}@${season}` */
  key: string
  clubId: string
  season: number
  leagueId: string
  /** Club code on the card face (MCI). */
  code: string
  /** League code (ENG), only when the draft spans several leagues. */
  league: string | null
  colour: string
  secondary: string
  tier: Tier
  /** Whether the wheel could stop here on this spin; the others are dimmed. */
  lit: boolean
}

export interface ReelDeal {
  /** The drawn season. */
  season: number
  /** Season drum labels top to bottom; `drum[DRUM_LAND]` is the drawn season. */
  drum: number[]
  cards: ReelCard[]
  /** Index of the drawn club-season in `cards` (always `REEL_LAND`). */
  land: number
  /** Where the strip stops relative to the landing card's centre, in cards (-REEL_JITTER to +REEL_JITTER). */
  jitter: number
  target: ReelCard
}

/** The leagues a draft's wheel and tiers use: the rules' leagues, or every loaded league when the rules name none. */
export function reelLeagues(u: LoadedUniverse, rules: Pick<DraftRules, 'leagues'>): string[] {
  if (rules.leagues?.length) return [...rules.leagues]
  return [...new Set(u.clubSeasons.map((cs) => cs.leagueId))]
}

/** What the wheel could land on for the spin now showing in a draft: exactly the pool `spin` drew from. */
export function draftReelPool(u: LoadedUniverse, d: DraftState): ClubSeason[] {
  return wheelPool(u, d)
}

/**
 * The pool a head-to-head spin draws from (the same narrowing as `h2hSpin`: the
 * club-seasons useful to both managers still drafting, else the first picker's
 * wheel). Read right after the spin it equals the pool the spin used, since
 * nothing it depends on changes until the first pick.
 */
export function h2hReelPool(u: LoadedUniverse, h: H2HDraft): ClubSeason[] {
  const active = ([0, 1] as const).filter((i) => !isComplete(h.drafts[i]))
  if (!active.length) return []
  const firstIdx = active.includes(h.first) ? h.first : active[0]
  const pools = active.map((i) => wheelPool(u, h.drafts[i]))
  let both = pools[0]
  if (pools.length === 2) {
    const second = new Set(pools[1].map((cs) => `${cs.clubId}@${cs.season}`))
    both = pools[0].filter((cs) => second.has(`${cs.clubId}@${cs.season}`))
  }
  return both.length ? both : pools[active.indexOf(firstIdx)]
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

/** The seasons the drum rolls through: the seasons in the pool, ascending, with the drawn one always present. */
export function drumSeasons(pool: readonly ClubSeason[], season: number): number[] {
  return [...new Set([...pool.map((cs) => cs.season), season])].sort((a, b) => a - b)
}

/**
 * Deal one run of the reel for a drawn club-season.
 *
 * - The drum counts up through the pool's seasons in order and stops on the drawn season at `DRUM_LAND`.
 * - The strip holds `REEL_CARDS` cards, all club-seasons of the drawn season in `leagues` (the whole
 *   league that year, every league's clubs when there are several), in random order with no card twice
 *   in a row; the drawn club-season is at `REEL_LAND`.
 * - A card is lit when it is in `pool` (what the wheel could stop on this spin); the drawn card always is.
 */
export function dealReel(u: LoadedUniverse, opts: { leagues: readonly string[]; pool: readonly ClubSeason[]; target: { clubId: string; season: number } }, random: () => number): ReelDeal {
  const { leagues, pool, target } = opts
  const season = target.season
  const leagueIds = new Set(leagues)
  const tiers = tierTable(u, leagues)
  const multi = leagueIds.size > 1
  const lit = new Set(pool.filter((cs) => cs.season === season).map((cs) => `${cs.clubId}@${cs.season}`))
  const targetKey = `${target.clubId}@${season}`
  lit.add(targetKey)

  const seasonSet = u.clubSeasons.filter((cs) => cs.season === season && leagueIds.has(cs.leagueId))
  const card = (clubId: string, leagueId: string): ReelCard => {
    const club = u.clubById[clubId]
    const key = `${clubId}@${season}`
    const leagueCode = LEAGUE_CODES[leagueId] ?? (u.leagues.find((l) => l.id === leagueId)?.shortName ?? leagueId).slice(0, 3).toUpperCase()
    return { key, clubId, season, leagueId, code: club?.code ?? clubId.slice(0, 3).toUpperCase(), league: multi ? leagueCode : null, colour: club?.colours.primary ?? '#555555', secondary: club?.colours.secondary ?? '#ffffff', tier: tiers[key] ?? 'blue', lit: lit.has(key) }
  }
  const candidates = seasonSet.map((cs) => card(cs.clubId, cs.leagueId))
  let targetCard = candidates.find((c) => c.key === targetKey)
  if (!targetCard) {
    // A drawn club-season outside the league set (never from a real spin) still lands
    targetCard = card(target.clubId, u.clubSeasonByKey[targetKey]?.leagueId ?? u.clubById[target.clubId]?.leagueId ?? '')
    candidates.push(targetCard)
  }

  const cards: ReelCard[] = []
  let prev = ''
  for (let i = 0; i < REEL_CARDS; i++) {
    if (i === REEL_LAND) {
      cards.push(targetCard)
      prev = targetKey
      continue
    }
    // No card twice in a row, the drawn card's left neighbour included, unless the season has too few clubs to avoid it
    const avoid = i === REEL_LAND - 1 ? [prev, targetKey] : [prev]
    let options = candidates.filter((c) => !avoid.includes(c.key))
    if (!options.length) options = candidates.filter((c) => c.key !== prev)
    if (!options.length) options = candidates
    const next = pickOne(options, random)
    cards.push(next)
    prev = next.key
  }

  const seasons = drumSeasons(pool, season)
  const at = seasons.indexOf(season)
  const m = seasons.length
  const drum = Array.from({ length: DRUM_LABELS }, (_, i) => seasons[(((at - (DRUM_LAND - i)) % m) + m) % m])
  const jitter = (random() * 2 - 1) * REEL_JITTER
  return { season, drum, cards, land: REEL_LAND, jitter, target: targetCard }
}
