/**
 * Sign-in: an email code (or the `token_hash` link in the same email), or Google. Every function takes the auth
 * client as an argument (`AuthLike`, the slice of supabase-js `auth` this file uses), so the tests drive it with a
 * fake. Accounts only: an anonymous session is never treated as signed in here.
 *
 * Why a code and a `token_hash` link rather than a PKCE magic link: the code is typed in the same tab (so it works
 * inside the installed app, where links open another browser), the link needs no PKCE verifier (so it works when
 * the email is opened on another device), and a mail scanner that prefetches the link signs nobody in, because the
 * link is verified only by TouchLine's own `verifyOtp` call.
 */
import { cleanName } from '@engine/challenge'
import { cleanAuthParams, parseAuthRedirect, type AuthRedirect } from './core/authUrl'
import { HIDDEN_CHARS } from './server/dailyVerify'
import type { OnlineSession } from './state'

interface AuthErrorLike {
  message: string
  status?: number
  code?: string
}

interface UserLike {
  id: string
  email?: string | null
  is_anonymous?: boolean
  app_metadata?: { provider?: string }
}

export interface SessionLike {
  user: UserLike
}

/** The slice of supabase-js `auth` used by the online layer. */
export interface AuthLike {
  signInWithOtp(a: { email: string; options?: { emailRedirectTo?: string; shouldCreateUser?: boolean } }): PromiseLike<{ error: AuthErrorLike | null }>
  verifyOtp(a: { email: string; token: string; type: 'email' } | { token_hash: string; type: 'email' | 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change' }): PromiseLike<{ error: AuthErrorLike | null }>
  signInWithOAuth(a: { provider: 'google'; options?: { redirectTo?: string } }): PromiseLike<{ error: AuthErrorLike | null }>
  signOut(a?: { scope?: 'global' | 'local' | 'others' }): PromiseLike<{ error: AuthErrorLike | null }>
  getSession(): PromiseLike<{ data: { session: SessionLike | null } }>
}

export type AuthResult = { ok: true } | { ok: false; message: string }

/** `minh@gmail.com` → `m•••@gmail.com`; the full address never enters app state. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

/** The app's view of a supabase-js session: null when signed out or a guest (accounts only). */
export function sessionOf(s: SessionLike | null | undefined): OnlineSession | null {
  if (!s?.user?.id || s.user.is_anonymous) return null
  return { userId: s.user.id, maskedEmail: maskEmail(s.user.email), provider: s.user.app_metadata?.provider ?? 'email' }
}

/** Where a sign-in comes back to: this page, without its query or fragment. */
export function redirectTo(loc: { origin: string; pathname: string } = location): string {
  return loc.origin + loc.pathname
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/

function friendly(e: AuthErrorLike): string {
  const m = e.message || 'Something went wrong'
  if (e.status === 429 || /rate limit|too many|seconds/i.test(m)) return 'Too many requests: wait a minute, then try again.'
  if (/expired|invalid/i.test(m) && /otp|token|code/i.test(m)) return 'That code is wrong or has expired. Check the latest email, or send a new code.'
  if (/fetch|network/i.test(m)) return 'No connection: try again when you are back online.'
  return m
}

export async function sendEmailCode(auth: AuthLike, email: string, back = redirectTo()): Promise<AuthResult> {
  const addr = email.trim()
  if (!EMAIL_RE.test(addr)) return { ok: false, message: 'That does not look like an email address.' }
  try {
    const { error } = await auth.signInWithOtp({ email: addr, options: { emailRedirectTo: back, shouldCreateUser: true } })
    return error ? { ok: false, message: friendly(error) } : { ok: true }
  } catch (e) {
    return { ok: false, message: friendly({ message: e instanceof Error ? e.message : String(e) }) }
  }
}

export async function verifyEmailCode(auth: AuthLike, email: string, code: string): Promise<AuthResult> {
  const token = code.replace(/\s+/g, '')
  if (!/^\d{6,10}$/.test(token)) return { ok: false, message: 'The code is the six digits in the email.' }
  try {
    const { error } = await auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    return error ? { ok: false, message: friendly(error) } : { ok: true }
  } catch (e) {
    return { ok: false, message: friendly({ message: e instanceof Error ? e.message : String(e) }) }
  }
}

export async function signInWithGoogle(auth: AuthLike, back = redirectTo()): Promise<AuthResult> {
  try {
    const { error } = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } })
    return error ? { ok: false, message: friendly(error) } : { ok: true }
  } catch (e) {
    return { ok: false, message: friendly({ message: e instanceof Error ? e.message : String(e) }) }
  }
}

/** Sign out on this device only; local saves stay (they belong to the device). */
export async function signOut(auth: AuthLike): Promise<void> {
  try {
    await auth.signOut({ scope: 'local' })
  } catch {
    // the local session is dropped by supabase-js even when the revoke call fails
  }
}

/**
 * Finish a sign-in redirect the page was opened with: a `token_hash` link is verified here; a Google `?code=` was
 * exchanged by supabase-js while the client started (waiting for `getSession` lets it finish); an `error` is
 * reported. The auth parameters are then stripped from the address, keeping the game's own fragment.
 */
export async function consumeAuthRedirect(auth: AuthLike, redirect: AuthRedirect | null, replaceUrl: (href: string) => void, currentHref: () => string): Promise<AuthResult | null> {
  if (!redirect) return null
  let out: AuthResult
  if (redirect.kind === 'error') out = { ok: false, message: `Sign-in did not finish: ${redirect.description}` }
  else if (redirect.kind === 'token_hash') {
    try {
      const type = redirect.type as 'email' | 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change'
      const { error } = await auth.verifyOtp({ token_hash: redirect.tokenHash, type })
      out = error ? { ok: false, message: friendly(error) } : { ok: true }
    } catch (e) {
      out = { ok: false, message: friendly({ message: e instanceof Error ? e.message : String(e) }) }
    }
  } else {
    const { data } = await auth.getSession()
    out = data.session ? { ok: true } : { ok: false, message: 'Google sign-in did not finish. Try again.' }
  }
  replaceUrl(cleanAuthParams(currentHref()))
  return out
}

/** What the current address carries from a sign-in, read once when the layer boots. */
export function authRedirectAt(href: string): AuthRedirect | null {
  try {
    return parseAuthRedirect(href)
  } catch {
    return null
  }
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }

/** The live name check's answer as the profile setup step shows it. `unknown`: the server could not say (offline, or
 * the `display_name_check` migration is not applied); saving still checks, so the step never blocks on it. */
export type NameVerdict = { state: 'invalid'; message: string } | { state: 'taken'; name: string } | { state: 'free'; name: string } | { state: 'unknown'; name: string }

/** Combine the local rules with `display_name_check`'s reply (`{ name, available, reason }`), or null for no reply. Pure. */
export function nameVerdictFrom(raw: string, reply: unknown): NameVerdict {
  const local = checkDisplayName(raw)
  if (!local.ok) return { state: 'invalid', message: local.message }
  const r = reply as { available?: unknown; reason?: unknown } | null
  if (!r || typeof r !== 'object' || typeof r.available !== 'boolean') return { state: 'unknown', name: local.name }
  if (r.available) return { state: 'free', name: local.name }
  if (r.reason === 'taken') return { state: 'taken', name: local.name }
  // The server's rules are the table's; a refusal the local mirror missed reads like the mirror's own message
  return { state: 'invalid', message: 'Use plain letters, digits and punctuation: some characters look like others on a board.' }
}

/** "Name on the leaderboards": 3 to 24 visible characters, the shape `profiles` accepts. */
export function checkDisplayName(raw: string): NameCheck {
  const collapsed = raw.replace(/ +/g, ' ').trim()
  if (HIDDEN_CHARS.test(collapsed)) return { ok: false, message: 'Use visible letters, digits and punctuation only.' }
  if ([...collapsed].length > 24) return { ok: false, message: 'A name is at most 24 characters.' }
  const name = cleanName(collapsed)
  const n = [...name].length
  if (n < 3) return { ok: false, message: 'A name needs at least 3 characters.' }
  if (n > 24) return { ok: false, message: 'A name is at most 24 characters.' }
  if (/[<>]/.test(name)) return { ok: false, message: 'A name cannot hold < or >.' }
  if (HIDDEN_CHARS.test(name)) return { ok: false, message: 'Use visible letters, digits and punctuation only.' }
  return { ok: true, name }
}
