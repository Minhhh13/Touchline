/**
 * The shapes a sign-in redirect lands on the game with, and how to strip them again without touching the game's own
 * link fragment (`#c=`, `#s=`, `#h=`):
 *  - `?token_hash=...&type=email` from the email template's link (verified by our own `verifyOtp` call, so a mail
 *    scanner that prefetches the link signs nobody in);
 *  - `?code=...` from Google (PKCE; supabase-js exchanges it);
 *  - `?error=...&error_description=...` or `#error=...&error_description=...` when the provider refused.
 */

export type AuthRedirect =
  | { kind: 'token_hash'; tokenHash: string; type: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string; description: string }

const AUTH_PARAMS = ['token_hash', 'type', 'code', 'error', 'error_code', 'error_description', 'state']
const OTP_TYPES = new Set(['email', 'signup', 'magiclink', 'recovery', 'invite', 'email_change'])

function hashParams(hash: string): URLSearchParams | null {
  // Only an error fragment is an auth fragment; the game's own fragments never carry `error=`
  if (!/^#(.*&)?error(_description|_code)?=/.test(hash)) return null
  return new URLSearchParams(hash.slice(1))
}

/** What a URL carries from a sign-in redirect, or null. */
export function parseAuthRedirect(href: string): AuthRedirect | null {
  const url = new URL(href)
  const q = url.searchParams
  const h = hashParams(url.hash)
  const error = q.get('error') ?? h?.get('error')
  if (error) return { kind: 'error', error, description: q.get('error_description') ?? h?.get('error_description') ?? error }
  const tokenHash = q.get('token_hash')
  const type = q.get('type')
  if (tokenHash && type && OTP_TYPES.has(type)) return { kind: 'token_hash', tokenHash, type }
  const code = q.get('code')
  if (code) return { kind: 'code', code }
  return null
}

/** The URL with every auth parameter removed and the game's fragment kept (for `history.replaceState`). */
export function cleanAuthParams(href: string): string {
  const url = new URL(href)
  for (const p of AUTH_PARAMS) url.searchParams.delete(p)
  if (hashParams(url.hash)) url.hash = ''
  const search = url.searchParams.toString()
  return `${url.origin}${url.pathname}${search ? `?${search}` : ''}${url.hash}`
}
