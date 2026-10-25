/**
 * Managers for the Quick Draft: the real head coaches of the club-seasons a draft landed on (Wikidata P286, built by
 * `scripts/import/managers.mjs` into `data/managers.json`), with a few invented archetypes when the facts run short.
 *
 * A manager has one style, and the style gives the side a small edge on expected goals through the match engine's
 * existing boost path (`MatchTeamInput.managerBoost`, multiplied into `TeamSnapshot.boost`). The edge is a little
 * bigger when the team instructions suit the style, and never more than `MANAGER_EDGE` either way. Pure: nothing here
 * draws from an `Rng`, so a draft without a manager plays exactly as before managers existed.
 */
import facts from './data/managers.json'
import { hashString } from './rng'
import type { PlayerSeason, Tactics } from './types'

export type ManagerStyle = 'pressing' | 'attacking' | 'defensive' | 'set-pieces' | 'youth' | 'balanced'
export const MANAGER_STYLES: readonly ManagerStyle[] = ['pressing', 'attacking', 'defensive', 'set-pieces', 'youth', 'balanced']

/** A manager the user can pick: a real one (a Wikidata id) with the club-season he managed, or an archetype (`arch-...`). */
export interface Manager {
  id: string
  name: string
  style: ManagerStyle
  /** The club-season he was in charge of that the draft landed on; absent for an archetype. */
  clubId?: string
  season?: number
  archetype?: boolean
}

interface ManagerFacts {
  source: string
  generatedAt: string
  /** Wikidata id to [name, style]. */
  managers: Record<string, string[]>
  seasons: Record<string, Record<string, string[]>>
}

const FACTS = facts as ManagerFacts

/** When the manager facts were built and where from, for the data credits. */
export const MANAGER_SOURCE = { source: FACTS.source, generatedAt: FACTS.generatedAt }

const isStyle = (s: string): s is ManagerStyle => (MANAGER_STYLES as readonly string[]).includes(s)

/** The real managers of a club-season, the man in charge longest first; empty when the facts have none. */
export function managersOf(clubId: string, season: number): Manager[] {
  const ids = FACTS.seasons[clubId]?.[String(season)] ?? []
  const out: Manager[] = []
  for (const id of ids) {
    const m = FACTS.managers[id]
    if (!m) continue
    const style = m[1] ?? ''
    out.push({ id, name: m[0] ?? id, style: isStyle(style) ? style : 'balanced', clubId, season })
  }
  return out
}

/** Invented managers, one per style, offered when the real ones run short. Names are ours and nobody's. */
export const ARCHETYPES: readonly Manager[] = [
  { id: 'arch-pressing', name: 'The Press Conductor', style: 'pressing', archetype: true },
  { id: 'arch-attacking', name: 'The Showman', style: 'attacking', archetype: true },
  { id: 'arch-defensive', name: 'The Pragmatist', style: 'defensive', archetype: true },
  { id: 'arch-set-pieces', name: 'The Dead-Ball Coach', style: 'set-pieces', archetype: true },
  { id: 'arch-youth', name: 'The Academy Builder', style: 'youth', archetype: true },
  { id: 'arch-balanced', name: 'The Steady Hand', style: 'balanced', archetype: true },
]

/** The fewest managers a pick offers: archetypes make up the rest. */
export const MANAGER_OPTIONS_MIN = 3
/** The most managers a pick offers. */
export const MANAGER_OPTIONS_MAX = 6

/**
 * The managers a finished draft may pick from: the real managers of the club-seasons its players were drafted from,
 * those the draft took most players from first (then in draft order), each man once; then archetypes of styles not
 * yet offered, starting at a place fixed by the club-seasons drafted, until there are `MANAGER_OPTIONS_MIN`. Pure.
 */
export function managerOptions(drafted: Array<{ clubId: string; season: number }>): Manager[] {
  const counts = new Map<string, { clubId: string; season: number; n: number; first: number }>()
  drafted.forEach((cs, i) => {
    const key = `${cs.clubId}@${cs.season}`
    const c = counts.get(key)
    if (c) c.n++
    else counts.set(key, { clubId: cs.clubId, season: cs.season, n: 1, first: i })
  })
  const order = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)
  const out: Manager[] = []
  for (const cs of order) {
    for (const m of managersOf(cs.clubId, cs.season)) {
      if (out.length >= MANAGER_OPTIONS_MAX) break
      if (!out.some((x) => x.id === m.id)) out.push(m)
    }
  }
  if (out.length < MANAGER_OPTIONS_MIN) {
    const start = hashString(order.map((c) => `${c.clubId}@${c.season}`).join(',')) % ARCHETYPES.length
    for (let i = 0; i < ARCHETYPES.length && out.length < MANAGER_OPTIONS_MIN; i++) {
      const a = ARCHETYPES[(start + i) % ARCHETYPES.length]
      if (!out.some((x) => x.style === a.style)) out.push({ ...a })
    }
  }
  return out
}

/** The largest change a manager makes to either side's expected goals: 4%. */
export const MANAGER_EDGE = 0.04
/** Age at or under which a player counts as young for a youth manager. */
export const YOUTH_AGE = 23

/** Each style's edge before the tactics: `attack` on the side's own expected goals, `defence` on the opponent's (below 0 is fewer conceded). */
const STYLE_EDGE: Record<ManagerStyle, { attack: number; defence: number }> = {
  pressing: { attack: 0.015, defence: -0.015 },
  attacking: { attack: 0.03, defence: 0.01 },
  defensive: { attack: -0.01, defence: -0.03 },
  'set-pieces': { attack: 0.015, defence: -0.01 },
  youth: { attack: 0.005, defence: -0.005 },
  balanced: { attack: 0.01, defence: -0.01 },
}

/** Whether the team instructions suit a style: the edge grows a little when they do. */
export function suitsStyle(style: ManagerStyle, t: Tactics): boolean {
  switch (style) {
    case 'pressing':
      return t.pressing === 'high'
    case 'attacking':
      return t.mentality === 'attacking'
    case 'defensive':
      return t.mentality === 'defensive' || t.defensiveLine === 'deep'
    case 'set-pieces':
      return !!(t.setPieces?.penalties || t.setPieces?.corners || t.setPieces?.freeKicks)
    case 'youth':
      return false
    case 'balanced':
      return t.mentality === 'balanced'
  }
}

const clampEdge = (x: number) => Math.max(-MANAGER_EDGE, Math.min(MANAGER_EDGE, x))

/**
 * The multipliers a manager puts on his side's expected goals (`attack`) and on the opponent's (`defence`), from his
 * style, whether the instructions suit it and, for a youth manager, how much of the XI is young. Both lie within
 * `1 ± MANAGER_EDGE`. Pure and deterministic.
 */
export function managerBoost(style: ManagerStyle, t: Tactics, xi: PlayerSeason[]): { attack: number; defence: number } {
  const base = STYLE_EDGE[style]
  let attack = base.attack
  let defence = base.defence
  if (suitsStyle(style, t)) {
    if (style === 'pressing' || style === 'balanced') {
      attack += 0.005
      defence -= 0.005
    } else if (style === 'defensive') defence -= 0.01
    else attack += 0.01
  }
  if (style === 'youth' && xi.length) {
    const young = xi.filter((p) => p.age <= YOUTH_AGE).length / xi.length
    attack += 0.025 * young
    defence -= 0.02 * young
  }
  return { attack: 1 + clampEdge(attack), defence: 1 + clampEdge(defence) }
}

/** A style's name for the screens and share text. */
export const MANAGER_STYLE_LABEL: Record<ManagerStyle, string> = {
  pressing: 'Pressing',
  attacking: 'Attacking',
  defensive: 'Defensive',
  'set-pieces': 'Set pieces',
  youth: 'Youth',
  balanced: 'Balanced',
}

/** What a style does, in a line. */
export const MANAGER_STYLE_HELP: Record<ManagerStyle, string> = {
  pressing: 'Wins the ball high: a little more up front, a little less at the back. More with a high press.',
  attacking: 'Goes for goals and leaves gaps. More with an attacking mentality.',
  defensive: 'Hard to beat, short of goals. More with a defensive mentality or a deep line.',
  'set-pieces': 'Corners and free kicks drilled on the training ground. More with a named taker.',
  youth: 'Gets the best from young legs: the more of the XI aged 23 or under, the bigger the lift.',
  balanced: 'A steady lift at both ends. More with a balanced mentality.',
}

// ------------------------------------------------------------------ The manager spin

/** Reels in the manager spin: three managers land side by side and the user picks one. */
export const MANAGER_SPIN_REELS = 3
/** The label the manager spin forks the game's stream with (`Rng.fork`), on a copy: the game's own stream never moves. */
export const MANAGER_SPIN_FORK = 'manager-spin'

/** What the manager spin's wheel is built from: the club-seasons a set of draft rules admits (leagues, era, classic, one club). */
export interface ManagerWheelRules {
  leagues?: readonly string[]
  fromSeason?: number
  toSeason?: number
  classic?: boolean
  onlyClub?: string
}

/**
 * Every real manager on a draft's wheel, once per club-season he managed there: the club-seasons of the rules' leagues,
 * era and club (classic ones only when the rules allow them), in the universe's order, each club-season's managers
 * longest in charge first. Pure; every entry is equally likely on a reel.
 */
export function managerWheel(clubSeasons: ReadonlyArray<{ clubId: string; season: number; leagueId: string; classic?: boolean }>, r: ManagerWheelRules): Manager[] {
  const leagues = r.leagues?.length ? new Set(r.leagues) : null
  const out: Manager[] = []
  for (const cs of clubSeasons) {
    if (leagues && !leagues.has(cs.leagueId)) continue
    if (cs.classic && !r.classic) continue
    if (r.fromSeason !== undefined && cs.season < r.fromSeason) continue
    if (r.toSeason !== undefined && cs.season > r.toSeason) continue
    if (r.onlyClub && cs.clubId !== r.onlyClub) continue
    out.push(...managersOf(cs.clubId, cs.season))
  }
  return out
}

/**
 * The manager spin: `MANAGER_SPIN_REELS` different managers, each reel one uniform draw from the wheel (`managerWheel`)
 * among the men not already landed; archetypes of styles not yet landed fill any reel the wheel cannot (a one-club wheel
 * with few managers). The draws come from `rng` alone, in reel order.
 */
export function spinManagers(wheel: readonly Manager[], rng: { int(min: number, max: number): number }): Manager[] {
  const out: Manager[] = []
  for (let reel = 0; reel < MANAGER_SPIN_REELS; reel++) {
    const left = wheel.filter((m) => !out.some((x) => x.id === m.id))
    if (left.length) {
      out.push({ ...left[rng.int(0, left.length - 1)] })
      continue
    }
    const arch = ARCHETYPES.find((a) => !out.some((x) => x.style === a.style || x.id === a.id))
    if (arch) out.push({ ...arch })
  }
  return out
}
