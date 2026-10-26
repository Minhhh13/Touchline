/**
 * The January gamble of a Quick Draft's quick season: at the halfway pause, besides the transfer market
 * (`./january`) and a pass, the window offers two casino-style deals, of which the manager takes at most one.
 *
 *  - **The January spin**: one case from the wheel. It lands on a player-season of the draft's wheel (its leagues,
 *    era, club and nation rules) whose player is not in the squad and who can cover some slot of the XI at the draft's
 *    minimum fit. The draw is a rarity tier first, at exact whole-per-cent odds (`JANUARY_SPIN_WEIGHTS`, a tier with
 *    nobody in it drops out and the rest share its weight), then one player of that tier, evenly. He then comes into a
 *    slot he can cover for the second half, or the XI is kept.
 *  - **The January Upgrader**: the draft's Player Upgrader (`@engine/upgrader`) once more, on one of the XI, for the
 *    second half only: +2, +5 or +10 at the engine's own odds (`upgradeChance`, worse for a bigger boost and a better
 *    player); a loss drops him by half the boost.
 *
 * A player's tier is his place in the whole wheel, every player once at his best season (the game's lookup, so Prime
 * counts), cut by the reel's shares (`TIER_SHARE`: the best 5% gold, then 10% red, 20% pink, 30% purple, 35% blue).
 *
 * Every draw comes from a named fork of a copy of the season's stream at the halfway mark (`JANUARY_SPIN_FORK`,
 * `JANUARY_UPGRADE_FORK`), the copy the listings already fork: the season's own stream never moves, so a season that
 * passes, or takes a listing, replays exactly as before. The functions here are pure over that stream; `./quick` holds
 * the season's side (rolling at the window, checking and applying the deal when the season is played).
 *
 * Only a Quick Draft offers the gamble: the Daily and the weekly challenge (the ranked boards) keep the plain window.
 */
import type { Game, JanuaryUpgradeResult, QuickJanuary, QuickResult } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import type { Lineup, PlayerSeason } from '@engine/types'
import { getFormation } from '@engine/formations'
import { describeFit, ratingAt } from '@engine/positions'
import { boostedPlayer, upgradeChance, upgradeGain, upgradeLoss, type UpgradeBoost } from '@engine/upgrader'
import { TIERS, TIER_SHARE, type Tier } from './rarity'
import { canPlayFor } from './quickBench'
import { playerLookup } from './players'
import { slotLabel } from './slotSheet'

/** The labels the two gambles fork the halfway copy of the season's stream with. */
export const JANUARY_SPIN_FORK = 'january-spin'
export const JANUARY_UPGRADE_FORK = 'january-upgrade'

/** The January spin's chance of each tier, whole per cent, rarest first (sums to 100). */
export const JANUARY_SPIN_WEIGHTS: Readonly<Record<Tier, number>> = { gold: 3, red: 9, pink: 20, purple: 30, blue: 38 }

/** Whether this game's January window offers the spin and the Upgrader: a Quick Draft, not the weekly challenge's seed. */
export function januaryGambleOn(game: Pick<Game, 'settings'>): boolean {
  return game.settings.mode === 'quick' && !/^weekly-/.test(game.settings.seed)
}

/** Whether the window's one deal is already a gamble (a spin opened or an upgrade rolled). */
export function januaryGambleMade(j: Pick<QuickJanuary, 'spin' | 'upgrade'> | null | undefined): boolean {
  return !!j && (!!j.spin || !!j.upgrade)
}

export interface SpinCandidate {
  p: PlayerSeason
  /** His overall, as the game's lookup rates him. */
  rating: number
  tier: Tier
}

/** The January spin's pool by tier: who the case can land on, best first within each tier (ties by id). */
export type JanuarySpinPool = Readonly<Record<Tier, readonly SpinCandidate[]>>

const wheelMemo = new WeakMap<LoadedUniverse, Map<string, SpinCandidate[]>>()

/**
 * Every player the wheel could have offered, once at his best season (as the game's lookup rates him: Prime counts),
 * ranked and cut into the reel's tiers. Depends only on the data and the rules, never on the squad. Memoised per
 * universe and rules.
 */
function wheelTiers(game: Game, u: LoadedUniverse, get: (id: string) => PlayerSeason | undefined): SpinCandidate[] {
  const r = game.settings.rules
  const leagues = r.leagues ?? game.settings.wheelLeagues
  const key = JSON.stringify([leagues, r.classic ?? false, r.fromSeason ?? null, r.toSeason ?? null, r.onlyClub ?? null, r.onlyNation ?? null, r.ratings ?? null])
  let byKey = wheelMemo.get(u)
  if (!byKey) wheelMemo.set(u, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit
  const best = new Map<string, { p: PlayerSeason; rating: number }>()
  for (const cs of u.clubSeasons) {
    if (!leagues.includes(cs.leagueId)) continue
    if (cs.classic && !r.classic) continue
    if (r.fromSeason !== undefined && cs.season < r.fromSeason) continue
    if (r.toSeason !== undefined && cs.season > r.toSeason) continue
    if (r.onlyClub && cs.clubId !== r.onlyClub) continue
    for (const raw of cs.squad) {
      if (r.onlyNation && raw.nationality !== r.onlyNation) continue
      const p = get(raw.id) ?? raw
      const was = best.get(p.playerId)
      if (!was || p.overall > was.rating || (p.overall === was.rating && p.id < was.p.id)) best.set(p.playerId, { p, rating: p.overall })
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.rating - a.rating || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
  // The reel's shares, cumulative cut-offs rounded once each (as `tierTable` cuts club-seasons)
  const ends: number[] = []
  let cum = 0
  for (const t of TIERS) {
    cum += TIER_SHARE[t]
    ends.push(Math.round(cum * ranked.length))
  }
  ends[ends.length - 1] = ranked.length
  let tier = 0
  const out = ranked.map((x, i) => {
    while (i >= ends[tier]) tier++
    return { p: x.p, rating: x.rating, tier: TIERS[tier] }
  })
  byKey.set(key, out)
  return out
}

/**
 * The January spin's pool for this XI and bench: the wheel's players by tier, less anyone whose player is in the
 * squad (bench included) and anyone who cannot cover a slot of the XI's shape at the draft's minimum fit. Pure.
 */
export function januarySpinPool(game: Game, u: LoadedUniverse, lineup: Lineup, bench: readonly string[], get: (id: string) => PlayerSeason | undefined): JanuarySpinPool {
  const inSquad = new Set([...Object.values(lineup), ...bench].map((id) => get(id)?.playerId ?? id))
  const positions = [...new Set(getFormation(game.tactics.formationId).slots.map((s) => s.position))]
  const canPlay = canPlayFor(game)
  const out: Record<Tier, SpinCandidate[]> = { gold: [], red: [], pink: [], purple: [], blue: [] }
  for (const c of wheelTiers(game, u, get)) {
    if (inSquad.has(c.p.playerId)) continue
    if (!positions.some((pos) => canPlay(c.p, pos))) continue
    out[c.tier].push(c)
  }
  return out
}

/** The exact chance of each tier on the January spin, rarest first: a tier's weight over the weights of the tiers with someone in them. */
export function januarySpinOdds(pool: JanuarySpinPool): Array<{ tier: Tier; p: number }> {
  const total = TIERS.reduce((s, t) => s + (pool[t].length ? JANUARY_SPIN_WEIGHTS[t] : 0), 0)
  return TIERS.map((tier) => ({ tier, p: total && pool[tier].length ? JANUARY_SPIN_WEIGHTS[tier] / total : 0 }))
}

/** Open the January case: a roll over the weights of the tiers with someone in them, then one of that tier, evenly. Null for an empty pool. */
export function drawJanuarySpin(pool: JanuarySpinPool, rng: Rng): SpinCandidate | null {
  const live = TIERS.filter((t) => pool[t].length > 0)
  if (!live.length) return null
  const total = live.reduce((s, t) => s + JANUARY_SPIN_WEIGHTS[t], 0)
  const roll = rng.int(0, total - 1)
  let at = 0
  let tier = live[live.length - 1]
  for (const t of live) {
    at += JANUARY_SPIN_WEIGHTS[t]
    if (roll < at) {
      tier = t
      break
    }
  }
  return rng.pick(pool[tier])
}

/** One slot the spun player could take: where, his rating there and whether it is his position, who makes way. */
export interface JanuarySpinChoice {
  slotId: string
  label: string
  rating: number
  fit: 'fits' | 'can cover'
  outId: string
  outName: string
  outRating: number
}

/** The slots the spun player may take (a starter there, and the draft's position rule), the biggest gain first, ties in formation order. Pure. */
export function januarySpinChoices(game: Game, lineup: Lineup, p: PlayerSeason, get: (id: string) => PlayerSeason | undefined): JanuarySpinChoice[] {
  const formation = getFormation(game.tactics.formationId)
  const canPlay = canPlayFor(game)
  return formation.slots
    .filter((s) => !!lineup[s.id] && canPlay(p, s.position))
    .map((s, i) => {
      const out = get(lineup[s.id])
      return { i, choice: { slotId: s.id, label: slotLabel(formation, s), rating: Math.round(ratingAt(p, s.position)), fit: describeFit(p, s.position) === 'natural' ? 'fits' : 'can cover', outId: lineup[s.id], outName: out?.name ?? lineup[s.id], outRating: out ? Math.round(ratingAt(out, s.position)) : 0 } satisfies JanuarySpinChoice }
    })
    .sort((a, b) => b.choice.rating - b.choice.outRating - (a.choice.rating - a.choice.outRating) || a.i - b.i)
    .map((x) => x.choice)
}

/** The rating the January Upgrader works from: the player's overall as the game's lookup rates him. */
export function januaryUpgradeBase(get: (id: string) => PlayerSeason | undefined, id: string): number | null {
  const p = get(id)
  return p ? p.overall : null
}

/**
 * Roll the January Upgrader on `stream` (a copy of the season's stream at the halfway mark): forked by
 * `JANUARY_UPGRADE_FORK`, then by the player and the boost, so each choice has its own roll and a replay that saw one
 * learns nothing about another. `roll < chance` wins, the chance being `upgradeChance`, exactly as shown. Pure.
 */
export function drawJanuaryUpgrade(stream: Rng, id: string, rating: number, boost: UpgradeBoost): JanuaryUpgradeResult {
  const chance = upgradeChance(rating, boost)
  const roll = stream.fork(JANUARY_UPGRADE_FORK).fork(`${id}:${boost}`).int(0, 99)
  const won = roll < chance
  return { id, boost, chance, roll, won, delta: won ? upgradeGain(rating, boost) : -upgradeLoss(boost) }
}

/** A lookup that sees the January Upgrader's change on its player (overall and every attribute), the rest as `get` has them. */
export function withJanuaryUpgrade(get: (id: string) => PlayerSeason | undefined, up: JanuaryUpgradeResult | undefined): (id: string) => PlayerSeason | undefined {
  if (!up?.delta) return get
  return (id) => {
    const p = get(id)
    return p && id === up.id ? boostedPlayer(p, up.delta) : p
  }
}

/**
 * The lookup for what comes after the league season (the post-season cups): the game's, with a January upgrade on
 * once the window has closed.
 */
export function seasonEndLookup(game: Game, u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
  const j = game.quickJanuary
  const get = playerLookup(game, u)
  return j && j.move !== undefined ? withJanuaryUpgrade(get, j.upgrade) : get
}

/** "🎰 January spin: Haaland in for Watkins" / "⬆️ January Upgrader: Saka +5 (won at 47%)", for the summary and the share text. Null without a gamble. */
export function januaryGambleLine(g: QuickResult['januaryGamble']): string | null {
  if (!g) return null
  const short = (n: string) => n.split(/\s+/).slice(-1)[0] ?? n
  if (g.kind === 'spin') return g.outName ? `🎰 January spin: ${short(g.inName)} in for ${short(g.outName)}` : `🎰 January spin: ${short(g.inName)}, XI kept`
  return `⬆️ January Upgrader: ${short(g.name)} ${g.delta > 0 ? `+${g.delta}` : g.delta} (${g.won ? 'won' : 'lost'} at ${g.chance}%)`
}

/** Up to `n` of the pool's players for the reel's strip, each tier as often as its chance, spread evenly through each tier (no RNG). */
export function januarySpinFillers(pool: JanuarySpinPool, n = 60): SpinCandidate[] {
  const odds = januarySpinOdds(pool)
  const out: SpinCandidate[] = []
  for (const { tier, p } of odds) {
    const list = pool[tier]
    const k = Math.min(list.length, Math.max(p > 0 ? 1 : 0, Math.round(p * n)))
    for (let i = 0; i < k; i++) out.push(list[Math.floor((i * list.length) / k)])
  }
  return out
}
