/**
 * Short codes (challenge links `#s=K7Q2MX9A`, head-to-head invites `#h=...`): eight characters from the game's
 * seed alphabet, without I, O, 0 or 1, so a code read aloud or typed from a screenshot cannot be misread. The
 * server's `private.normalise_code` and the `challenges.code` check use the same alphabet.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

/** A code as typed or pasted (any case, with dashes or spaces), or null when it is not one. */
export function normaliseCode(input: string): string | null {
  if (input.length > 24) return null
  const code = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return CODE_RE.test(code) ? code : null
}

/** The display form: `K7Q2-MX9A`. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export type GameHash = { kind: 'c'; payload: string } | { kind: 's'; code: string } | { kind: 'h'; code: string }

/** The game's own link fragments: a long challenge `#c=`, a short challenge `#s=` or a head-to-head invite `#h=`. */
export function parseGameHash(hash: string): GameHash | null {
  const m = /^#([csh])=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!m) return null
  if (m[1] === 'c') return { kind: 'c', payload: m[2] }
  const code = normaliseCode(m[2])
  if (!code) return null
  return m[1] === 's' ? { kind: 's', code } : { kind: 'h', code }
}
