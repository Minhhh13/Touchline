import type { LoadedUniverse } from '@engine/universe'
import type { Fit } from '@engine/positions'
import type { SeasonTier } from '@engine/types'
import { TIER_LABEL } from '@engine/season'

/** A tier for display in sentence case ("Title race", "38-0: The perfect season"); the engine's labels are capitals. */
export function tierName(tier: SeasonTier): string {
  const lower = TIER_LABEL[tier].toLowerCase()
  const i = lower.search(/[a-z]/)
  return i < 0 ? lower : lower.slice(0, i) + lower[i].toUpperCase() + lower.slice(i + 1)
}

export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
export function money(m: number): string {
  if (Math.abs(m) >= 1000) return `£${(m / 1000).toFixed(2)}bn`
  if (Math.abs(m) >= 100) return `£${Math.round(m)}M`
  if (Math.abs(m) >= 10) return `£${m.toFixed(1)}M`
  if (Math.abs(m) >= 1) return `£${m.toFixed(1)}M`
  return `£${Math.round(m * 1000)}k`
}
export function wage(k: number): string {
  if (k >= 1000) return `£${(k / 1000).toFixed(2)}M/wk`
  return `£${Math.round(k)}k/wk`
}
export function flag(u: LoadedUniverse | null, nation: string): string {
  return u?.nations[nation]?.flag ?? '🏳️'
}
export function nationName(u: LoadedUniverse | null, nation: string): string {
  return u?.nations[nation]?.name ?? nation
}
export function clubName(u: LoadedUniverse | null, clubId: string): string {
  return u?.clubById[clubId]?.name ?? clubId
}
export function clubShort(u: LoadedUniverse | null, clubId: string): string {
  return u?.clubById[clubId]?.shortName ?? clubId
}
export function minuteLabel(m: number): string {
  if (m > 90) return `90+${m - 90}'`
  return `${m}'`
}
export function ratingBand(v: number): string {
  if (v >= 90) return 'r90'
  if (v >= 85) return 'r85'
  if (v >= 80) return 'r80'
  if (v >= 75) return 'r75'
  if (v >= 70) return 'r70'
  return ''
}
export function conditionColour(v: number): string {
  if (v >= 85) return 'var(--good)'
  if (v >= 70) return 'var(--meter-mid)'
  if (v >= 55) return 'var(--warn)'
  return 'var(--danger)'
}
/** Pitch disc ring for an out-of-position player: amber for accomplished (acc.), red for awkward or worse (awk.). */
export const FIT_AMBER = 'var(--gold)'
export const FIT_RED = 'var(--pitch-bad)'

/**
 * The inline ring colour a pitch disc takes from the player's fit, or undefined to leave the disc's own class border.
 * The fit colour is the lowest priority: an injured or suspended player (`warn`) keeps the red ring, and a selected or
 * eligible slot (`highlighted`) keeps its gold or green highlight.
 */
export function fitRingColour(fit: Fit, { warn, highlighted }: { warn: boolean; highlighted: boolean }): string | undefined {
  if (fit === 'natural' || warn || highlighted) return undefined
  return fit === 'accomplished' ? FIT_AMBER : FIT_RED
}
export function moraleWord(v: number): string {
  if (v >= 85) return 'Superb'
  if (v >= 70) return 'Good'
  if (v >= 55) return 'Okay'
  if (v >= 40) return 'Poor'
  return 'Very poor'
}
export function textColourFor(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return '#fff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111' : '#fff'
}
