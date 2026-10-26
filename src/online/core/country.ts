/**
 * The optional country on a player's online profile: an ISO 3166-1 alpha-2 code in upper case (`GB`, `VN`), the
 * same shape `profiles.country` and every board's `p_country` filter accept. It is copied onto each board row when
 * the row is posted, like the display name.
 */

const COUNTRY_RE = /^[A-Z]{2}$/

/** A code as typed (any case, surrounding spaces), or null when it is not two letters. */
export function normaliseCountry(input: string | null | undefined): string | null {
  const c = (input ?? '').trim().toUpperCase()
  return COUNTRY_RE.test(c) ? c : null
}

/** The flag emoji for a code (two regional-indicator letters); an empty string for anything else. */
export function countryFlag(code: string | null | undefined): string {
  const c = normaliseCountry(code)
  if (!c) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}
