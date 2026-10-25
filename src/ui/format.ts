import type { LoadedUniverse } from '@engine/universe'

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
  if (v >= 85) return 'var(--accent)'
  if (v >= 70) return 'var(--gold)'
  if (v >= 55) return 'var(--warn)'
  return 'var(--danger)'
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

/** The flag shown beside a league's name: its country's, read from the nation table by name, a few fixed by id. */
const LEAGUE_FLAGS: Record<string, string> = { england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', spain: '🇪🇸', italy: '🇮🇹', germany: '🇩🇪', france: '🇫🇷', netherlands: '🇳🇱', portugal: '🇵🇹' }
export function leagueFlag(u: LoadedUniverse | null, leagueId: string): string {
  if (LEAGUE_FLAGS[leagueId]) return LEAGUE_FLAGS[leagueId]
  const country = u?.available.find((l) => l.id === leagueId)?.country
  const n = country && u ? Object.values(u.nations).find((x) => x.name === country) : undefined
  return n?.flag ?? '🏳️'
}
