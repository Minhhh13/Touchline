/**
 * Era presets for the wheel: All-time, 2000s+, 2010s+ and Modern (2016+), plus a
 * custom from/to range, all expressed as `rules.fromSeason` / `rules.toSeason`
 * (a season is its start year: 2016 is 2016-17). A preset never starts before
 * the data's first season, so 2000s+ starts at 2008-09 with the current packs.
 */
import type { EraRange } from './nations'
import type { LoadedUniverse } from './universe'
import { seasonLabel } from './universe'

export type EraPreset = 'all' | '2000s' | '2010s' | 'modern' | 'custom'

/** Presets in display order with the first season each one admits (none for All-time). */
export const ERA_PRESETS: ReadonlyArray<{ id: Exclude<EraPreset, 'custom'>; label: string; from?: number }> = [
  { id: 'all', label: 'All-time' },
  { id: '2000s', label: '2000s+', from: 2000 },
  { id: '2010s', label: '2010s+', from: 2010 },
  { id: 'modern', label: 'Modern (2016+)', from: 2016 },
]

/**
 * The season bounds of an era choice. All-time has none; a preset starts at its year or the
 * data's first season, whichever is later, and runs to the newest season; a custom range is
 * ordered (from and to may be given either way round) and clamped to the data.
 */
export function eraRange(preset: EraPreset, firstSeason: number, lastSeason: number, custom?: { from: number; to: number }): EraRange {
  if (preset === 'all') return {}
  if (preset === 'custom') {
    const lo = Math.max(firstSeason, Math.min(custom?.from ?? firstSeason, custom?.to ?? lastSeason))
    const hi = Math.min(lastSeason, Math.max(custom?.from ?? firstSeason, custom?.to ?? lastSeason))
    return { fromSeason: lo, toSeason: hi }
  }
  const from = ERA_PRESETS.find((p) => p.id === preset)?.from ?? firstSeason
  return { fromSeason: Math.max(from, firstSeason) }
}

export interface EraCount {
  /** Seasons inside the range. */
  n: number
  /** Seasons the wheel leagues have in all. */
  m: number
  /** "11 of 19 seasons" */
  label: string
  /** "2016-17 to 2026-27", or "No seasons" when the range is empty. */
  caption: string
}

/** How many of the wheel leagues' seasons an era admits, for the setup line "N of M seasons". */
export function eraCount(u: LoadedUniverse, leagues: string[], range: EraRange): EraCount {
  const all = [...new Set(u.clubSeasons.filter((cs) => leagues.includes(cs.leagueId)).map((cs) => cs.season))].sort((a, b) => a - b)
  const inside = all.filter((s) => (range.fromSeason === undefined || s >= range.fromSeason) && (range.toSeason === undefined || s <= range.toSeason))
  const caption = inside.length ? (inside.length === 1 ? seasonLabel(inside[0]) : `${seasonLabel(inside[0])} to ${seasonLabel(inside[inside.length - 1])}`) : 'No seasons'
  return { n: inside.length, m: all.length, label: `${inside.length} of ${all.length} season${all.length === 1 ? '' : 's'}`, caption }
}
