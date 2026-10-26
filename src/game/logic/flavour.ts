/**
 * Display-only variety: a line picked from a bank by a pure hash of things
 * already known (a match key and minute, a news item, a season's id), so the
 * same input always reads the same and nothing is ever drawn from an `Rng`.
 * Used by the match commentary's colour, the inbox's flavour and the pundit's
 * verdict. Pure: no React, no store, no RNG, no `Math.random`.
 */
import { hashString } from '@engine/rng'

/** A non-negative integer for `key`, the same on every device and every run. */
export function flavourHash(key: string): number {
  return hashString(key, 0x7a11)
}

/** One entry of `bank`, chosen by `key`. The bank must not be empty. */
export function pickVariant<T>(bank: readonly T[], key: string): T {
  return bank[flavourHash(key) % bank.length]
}

/** True for about `num` in `den` keys: a hashed coin for "say something extra here, sometimes". */
export function flavourChance(key: string, num: number, den: number): boolean {
  return flavourHash(`${key}~chance`) % den < num
}

/** Fill `{name}` placeholders (every occurrence); unknown ones are left as they are. */
export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinalOf(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
