import type { LoadedUniverse } from '@engine/universe'
import type { Fit } from '@engine/positions'
import type { SeasonTier } from '@engine/types'
import { tierLabel } from '@engine/season'
import { superTierLabel } from '@game/logic/superLeague'
import { getFormation } from '@engine/formations'

/** A season tier for display ("Champions", "Top 4"); with the position, 3rd or 4th reads as Top 4. */
export function tierName(tier: SeasonTier, position?: number, superLeague?: boolean): string {
  // The Super League's titles say whose: "Super League champions"
  return superLeague ? superTierLabel(tier, position) : tierLabel(tier, position)
}

/** A formation's display name from its id ("4-4-2-diamond" reads "4-4-2 Diamond"); an unknown id shows as it is. */
export function formationName(id: string): string {
  try {
    return getFormation(id).name
  } catch {
    return id
  }
}

export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
/*
 * The viewer's language for numbers and dates (`src/ui/i18n`). English prints exactly what it always printed
 * (`toFixed`, no grouping); any other language goes through `Intl` with its own decimal mark.
 */
let numberLocale = 'en'
const numberFormats = new Map<string, Intl.NumberFormat>()
/** Set by the language setting (`src/ui/i18n/language.ts`); 'en' or the pseudo-locale keep English figures. */
export function setFormatLocale(locale: string): void {
  numberLocale = locale === 'en-XA' ? 'en' : locale
}
/** The language numbers and dates are written in now. */
export function formatLocale(): string {
  return numberLocale
}
const isEnglish = () => numberLocale === 'en' || numberLocale.startsWith('en-')
/** A number with exactly `digits` decimals (as `toFixed`), in the viewer's language. */
export function fixed(n: number, digits: number): string {
  if (isEnglish()) return n.toFixed(digits)
  const key = `${numberLocale}|${digits}`
  let f = numberFormats.get(key)
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(numberLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })))
  return f.format(n)
}
/** A plain number in the viewer's language: English as `String(n)` (2024 stays 2024, never 2,024). */
export function formatNumber(n: number): string {
  if (isEnglish() || !Number.isFinite(n)) return String(n)
  const key = `${numberLocale}|plain`
  let f = numberFormats.get(key)
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 20, useGrouping: false })))
  return f.format(n)
}
/**
 * A date in the viewer's language: `short` "27 Oct 2026" (the default), `long` "27 October 2026", `day` "27 Oct".
 * A `YYYY-MM-DD` string is read as that day in UTC, so no time zone moves it.
 */
export function formatDate(v: Date | string | number, style: string = 'short'): string {
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const opts: Intl.DateTimeFormatOptions = style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' } : style === 'day' ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Intl.DateTimeFormat(isEnglish() ? 'en-GB' : numberLocale, { ...opts, timeZone: 'UTC' }).format(d)
}
export function money(m: number): string {
  // Nothing at all reads £0, not £0k beside figures in millions
  if (m === 0) return '£0'
  if (Math.abs(m) >= 1000) return `£${fixed(m / 1000, 2)}bn`
  if (Math.abs(m) >= 100) return `£${fixed(Math.round(m), 0)}M`
  if (Math.abs(m) >= 10) return `£${fixed(m, 1)}M`
  if (Math.abs(m) >= 1) return `£${fixed(m, 1)}M`
  return `£${fixed(Math.round(m * 1000), 0)}k`
}
export function wage(k: number): string {
  if (k >= 1000) return `£${fixed(k / 1000, 2)}M/wk`
  return `£${fixed(Math.round(k), 0)}k/wk`
}
/** @deprecated The data's emoji flag: never render it (Windows draws two letters); use NationFlag in components/Flag.tsx. */
export function flag(u: LoadedUniverse | null, nation: string): string {
  return u?.nations[nation]?.flag ?? '🏳️'
}
/** The drawn flag for a nation without one (public/flags/unknown.svg, our own). */
export const FALLBACK_FLAG = 'unknown'
/** Nations whose emoji in the data is a stand-in: Northern Ireland carries the UK flag. */
const NATION_FLAG_OVERRIDE: Record<string, string> = { NIR: 'gb-nir' }
/**
 * The flag-icons code for an emoji flag: a regional-indicator pair gives the ISO 3166-1 alpha-2 code (the pair for B and
 * E -> be), a black flag with a tag sequence the subdivision (tags "gbeng" -> gb-eng); null for anything else (the white
 * flag of an unknown nation). Mirrors `flagCodeFromEmoji` in scripts/brand/flags.mjs, which copies the SVGs.
 */
export function flagCodeFromEmoji(emoji: string): string | null {
  const cps = [...emoji].map((c) => c.codePointAt(0) ?? 0)
  if (cps.length === 2 && cps.every((c) => c >= 0x1f1e6 && c <= 0x1f1ff)) return cps.map((c) => String.fromCharCode(c - 0x1f1e6 + 97)).join('')
  if (cps.length > 2 && cps[0] === 0x1f3f4 && cps[cps.length - 1] === 0xe007f) {
    const tag = cps.slice(1, -1).map((c) => ((c >= 0xe0061 && c <= 0xe007a) || (c >= 0xe0030 && c <= 0xe0039) ? String.fromCharCode(c - 0xe0000) : '?')).join('')
    if (/^[a-z]{2}[a-z0-9]{1,3}$/.test(tag)) return `${tag.slice(0, 2)}-${tag.slice(2)}`
  }
  return null
}
/** The file under public/flags (without .svg) drawn for a nation code from the packs. */
export function nationFlagCode(u: LoadedUniverse | null, nation: string): string {
  const fixed = NATION_FLAG_OVERRIDE[nation]
  if (fixed) return fixed
  const emoji = u?.nations[nation]?.flag
  return (emoji ? flagCodeFromEmoji(emoji) : null) ?? FALLBACK_FLAG
}
const LEAGUE_FLAG: Record<string, string> = { england: 'gb-eng', spain: 'es', italy: 'it', germany: 'de', france: 'fr', netherlands: 'nl', portugal: 'pt', europe: 'eu' }
/** The flag drawn beside a league's name; 'europe' (the European Nights and the all-leagues wheel) is the EU flag. */
export function leagueFlagCode(leagueId: string): string {
  return LEAGUE_FLAG[leagueId] ?? FALLBACK_FLAG
}
export function nationName(u: LoadedUniverse | null, nation: string): string {
  return u?.nations[nation]?.name ?? nation
}
export function clubName(u: LoadedUniverse | null, clubId: string): string {
  return u?.clubById[clubId]?.name ?? clubId
}
/** A chemistry link line from the engine ("2 links from arsenal@2015") with the club and season in words ("2 links from Arsenal 2015-16"); any other line as it is. */
export function chemistryLinkLabel(u: LoadedUniverse | null, line: string): string {
  const m = line.match(/^(.* from )([^@\s]+)@(\d{4})$/)
  return m ? `${m[1]}${clubName(u, m[2])} ${seasonLabel(Number(m[3]))}` : line
}
/** A signed figure with a true minus sign: "+0.4", "−0.31", "0". */
export function signedValue(v: number): string {
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0'
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
/** Text on a kit colour (the match day's codes, shirts and discs, the reel's cards): the same WCAG choice as `inkOn`. */
export function textColourFor(bg: string): string {
  // It used a brightness cut-off (0.6), which put white on orange and mid reds at 2.9 to 4.5:1
  return inkOn(bg)
}

/** A 0-100 meter value (condition, morale, sharpness, familiarity) as a whole number: the engine keeps floats (79.99999999999999). */
export function meterValue(v: number): string {
  return String(Math.round(v))
}
export type Outcome = 'W' | 'D' | 'L'
/** One colour rule for results everywhere: a win is --good, a draw --draw (amber), a loss --bad (`.res-w`, `.res-d`, `.res-l` in styles.css). */
export function outcomeClass(o: Outcome | null | undefined): string {
  return o === 'W' ? 'res-w' : o === 'D' ? 'res-d' : o === 'L' ? 'res-l' : ''
}
/** The outcome for the side that scored `gf` and conceded `ga`. */
export function outcomeOf(gf: number, ga: number): Outcome {
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D'
}
/** WCAG relative luminance of a #rrggbb colour (null for anything else). */
function luminance(hex: string): number | null {
  const h = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
/** The ink (near-black or white) with the higher WCAG contrast on a kit colour: a club badge's code stays legible on pale and mid kits. */
export function inkOn(bg: string): string {
  const l = luminance(bg)
  if (l === null) return '#fff'
  const dark = (l + 0.05) / 0.0556
  const light = 1.05 / (l + 0.05)
  // A mid red (Arsenal's #ef0107) passes with neither white nor #111, so it takes pure black, which always clears 4.5:1
  if (Math.max(dark, light) < 4.5) return (l + 0.05) / 0.05 > light ? '#000' : '#fff'
  return dark > light ? '#111' : '#fff'
}
/** The WCAG contrast ratio of two #rrggbb colours (1 for anything else). */
export function contrastRatio(a: string, b: string): number {
  const long = (c: string) => (/^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c)
  const la = luminance(long(a))
  const lb = luminance(long(b))
  if (la === null || lb === null) return 1
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
