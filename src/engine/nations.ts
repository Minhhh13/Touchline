/**
 * One-Nation Draft support: which nations have enough players in the loaded
 * data to fill a formation twice over, so the wheel never runs dry in year one.
 */
import type { Formation, PlayerSeason, Position } from './types'
import { canCover, type Fit } from './positions'
import { isClassic, type LoadedUniverse } from './universe'

/** Nationality code the data uses for a player whose nation is not known; never a valid draft nation. */
export const UNKNOWN_NATION = 'UNK'

/** Distinct humans a nation must have for every slot of a position: twice the formation's demand. */
export const NATION_SLOT_COVER = 2
/** Distinct humans a nation must have beyond the squad size, so a season draft keeps a few options after the XI. */
export const NATION_SQUAD_MARGIN = 6

export interface NationDepth {
  /** ISO3 code as stored in `PlayerSeason.nationality`. */
  nation: string
  name: string
  flag: string
  /** Distinct humans of that nation in the wheel leagues and era. */
  players: number
}

/** A nation's depth before the squad-size test: whether every position of the formation is covered twice. */
export interface NationCover extends NationDepth {
  covered: boolean
}

export interface EraRange {
  fromSeason?: number
  toSeason?: number
  /** Count classic seasons' players too (`DraftRules.classic`). */
  classic?: boolean
}

/**
 * One pass over the loaded player-seasons: for every known nation inside
 * `leagues` and `era`, its distinct humans and whether, for every position in
 * `formation`, at least `NATION_SLOT_COVER` times as many distinct humans can
 * cover it at `minFit` (the same predicate the draft rules use). The squad
 * size is not an input, so a caller can scan once and filter per squad size
 * with `nationDepthFrom`. Sorted by name.
 */
export function nationCover(u: LoadedUniverse, leagues: string[], era: EraRange, formation: Formation, minFit: Fit = 'accomplished'): NationCover[] {
  const demand = new Map<Position, number>()
  for (const s of formation.slots) demand.set(s.position, (demand.get(s.position) ?? 0) + 1)
  const positions = [...demand.keys()]
  const leagueSet = new Set(leagues)
  const perNation = new Map<string, { humans: Set<string>; cover: Map<Position, Set<string>> }>()
  const inScope = (p: PlayerSeason): boolean => {
    if (p.nationality === UNKNOWN_NATION || !p.nationality) return false
    if (era.fromSeason !== undefined && p.season < era.fromSeason) return false
    if (era.toSeason !== undefined && p.season > era.toSeason) return false
    if (!era.classic && isClassic(u, p)) return false
    const league = u.clubById[p.clubId]?.leagueId
    return !!league && leagueSet.has(league)
  }
  for (const p of Object.values(u.index)) {
    if (!inScope(p)) continue
    let entry = perNation.get(p.nationality)
    if (!entry) {
      entry = { humans: new Set(), cover: new Map() }
      perNation.set(p.nationality, entry)
    }
    entry.humans.add(p.playerId)
    for (const pos of positions) {
      if (!canCover(p, pos, minFit)) continue
      let set = entry.cover.get(pos)
      if (!set) {
        set = new Set()
        entry.cover.set(pos, set)
      }
      set.add(p.playerId)
    }
  }
  const out: NationCover[] = []
  for (const [nation, entry] of perNation) {
    const covered = positions.every((pos) => (entry.cover.get(pos)?.size ?? 0) >= NATION_SLOT_COVER * (demand.get(pos) ?? 0))
    out.push({ nation, name: u.nations[nation]?.name ?? nation, flag: u.nations[nation]?.flag ?? '🏳️', players: entry.humans.size, covered })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The nations from a `nationCover` scan deep enough for `squadSize` picks: covered, with `squadSize + NATION_SQUAD_MARGIN` humans in all. */
export function nationDepthFrom(cover: NationCover[], squadSize: number): NationDepth[] {
  return cover.filter((n) => n.covered && n.players >= squadSize + NATION_SQUAD_MARGIN).map(({ nation, name, flag, players }) => ({ nation, name, flag, players }))
}

/**
 * Nations deep enough for a one-nation draft of `formation` with `squadSize`
 * picks, drawn from `leagues` inside `era`. A nation qualifies when, for every
 * position in the formation, at least `NATION_SLOT_COVER` times as many distinct
 * humans can cover it at `minFit` (the same predicate the draft rules use), and
 * it has at least `squadSize + NATION_SQUAD_MARGIN` distinct humans in total.
 * Unknown nationalities are never offered. Sorted by name.
 */
export function nationDepth(u: LoadedUniverse, leagues: string[], era: EraRange, formation: Formation, squadSize: number, minFit: Fit = 'accomplished'): NationDepth[] {
  return nationDepthFrom(nationCover(u, leagues, era, formation, minFit), squadSize)
}

/** Display label for a nation option: "🇧🇷 Brazil · 412 players". */
export function nationDepthLabel(n: NationDepth): string {
  return `${n.flag} ${n.name} · ${n.players} players`
}
