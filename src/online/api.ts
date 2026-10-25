/**
 * What the screens call: one async function per online action. It is safe to import anywhere (it holds no
 * Supabase code): each call starts the runtime with a dynamic `import()` when the build is configured, and does
 * nothing (or falls back to the offline behaviour) when it is not, so an offline build never loads supabase-js.
 */
import type { ChallengePayload } from '@engine/challenge'
import { challengeLink } from '@game/logic/challenge'
import { onlineConfig } from './config'
import { onlineStore } from './state'
import type { AccountProfile } from './state'
import type { Runtime } from './runtime'
import type { Resolution } from './sync'
import type { CloudRow, ChallengeRow } from './transport'
import { OnlineError } from './transport'
import { checkDisplayName, sendEmailCode, signInWithGoogle, verifyEmailCode, type AuthResult } from './auth'
import { normaliseCountry } from './core/country'
import { fetchAlltime, fetchAlltimeMine, fetchBoard, fetchSummary, myEntries, rankOf, type AlltimeOrder, type RankedKind } from './boards'
import { createShortLink, resolveShortCode, type Resolved, type ShareLink } from './challengeLinks'

/** Whether this build carries the online layer at all. */
export const onlineAvailable = (): boolean => onlineConfig() !== null

async function rt(): Promise<Runtime | null> {
  // Constant-folded by Vite in a build without the variables, so the runtime chunk is never even emitted there
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return null
  if (!onlineConfig()) return null
  const m = await import('./runtime')
  return m.startRuntime()
}

/** Start the layer (an online surface opened). */
export async function startOnline(): Promise<boolean> {
  const r = await rt()
  if (r) await r.ready
  return !!r
}

const notAvailable: AuthResult = { ok: false, message: 'Online features are not available in this build.' }

export async function emailCode(email: string): Promise<AuthResult> {
  const r = await rt()
  return r ? sendEmailCode(r.auth, email) : notAvailable
}

export async function emailVerify(email: string, code: string): Promise<AuthResult> {
  const r = await rt()
  return r ? verifyEmailCode(r.auth, email, code) : notAvailable
}

export async function googleSignIn(): Promise<AuthResult> {
  const r = await rt()
  return r ? signInWithGoogle(r.auth) : notAvailable
}

export async function signOutOnline(): Promise<void> {
  await (await rt())?.signOut()
}

/** Save the name on the leaderboards and the flag. */
export async function saveAccount(name: string, country: string | null): Promise<AuthResult> {
  const r = await rt()
  if (!r) return notAvailable
  const uid = r.userId
  if (!uid) return { ok: false, message: 'Sign in first.' }
  const check = checkDisplayName(name)
  if (!check.ok) return { ok: false, message: check.message }
  const account: AccountProfile = { displayName: check.name, country: normaliseCountry(country) }
  try {
    await r.transport.saveAccount(uid, account, onlineStore.getState().account !== null)
    onlineStore.setState({ account })
    return { ok: true }
  } catch (e) {
    if (e instanceof OnlineError && e.kind === 'taken') return { ok: false, message: 'That name is taken.' }
    if (e instanceof OnlineError && e.kind === 'network') return { ok: false, message: 'No connection: try again when you are back online.' }
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** The player's "Sync now": also turns sync back on after "Delete my cloud data". */
export async function syncNow(): Promise<void> {
  await (await rt())?.syncNow({ force: true, resume: true })
}

export async function resolveConflict(res: Resolution): Promise<void> {
  const r = await rt()
  if (!r) return
  onlineStore.setState({ conflicts: onlineStore.getState().conflicts.filter((c) => c.slot !== res.slot) })
  await r.syncNow({ force: true, resolve: res })
}

export async function chooseAccount(choice: 'upload' | 'keep' | 'replace'): Promise<void> {
  await (await rt())?.chooseAccount(choice)
}

export async function cloudHistory(): Promise<CloudRow[]> {
  const r = await rt()
  return r ? r.cloudHistory() : []
}

export async function restorePrevious(row: CloudRow): Promise<boolean> {
  const r = await rt()
  return r ? r.restorePrevious(row) : false
}

export async function deleteCloudData(): Promise<number> {
  const r = await rt()
  return r ? r.deleteCloudData() : 0
}

export async function deleteAccount(): Promise<{ ok: boolean; message: string }> {
  const r = await rt()
  return r ? r.deleteAccount() : { ok: false, message: 'Online features are not available in this build.' }
}

export async function flushOutboxSoon(): Promise<void> {
  // Only a runtime that is already up flushes: a signed-out player's post waits for sign-in
  if (!onlineStore.getState().started) return
  await (await rt())?.flushOutbox()
}

export async function refreshPins(): Promise<void> {
  await (await rt())?.refreshPins()
}

// ------------------------------------------------------------------ boards

export async function board(kind: RankedKind, key: string, country: string | null, offset = 0) {
  const r = await rt()
  return r ? fetchBoard(r.transport, kind, key, country, offset) : []
}

export async function boardSummary(kind: RankedKind, key: string, country: string | null) {
  const r = await rt()
  return r ? fetchSummary(r.transport, kind, key, country) : null
}

export async function boardRank(kind: RankedKind, key: string, result: { points: number; lost: number; goalDiff: number; goalsFor: number }, country: string | null) {
  const r = await rt()
  return r ? rankOf(r.transport, kind, key, result, country) : null
}

export async function alltime(order: AlltimeOrder, country: string | null, offset = 0) {
  const r = await rt()
  return r ? fetchAlltime(r.transport, order, country, offset) : []
}

export async function alltimeMine(order: AlltimeOrder, country: string | null) {
  const r = await rt()
  return r && r.signedIn ? fetchAlltimeMine(r.transport, order, country) : null
}

export async function mine(kind: RankedKind) {
  const r = await rt()
  return r && r.signedIn ? myEntries(r.transport, kind) : []
}

// ------------------------------------------------------------------ challenge links

export async function shareLink(payload: ChallengePayload): Promise<ShareLink> {
  const r = await rt()
  if (!r) {
    const longUrl = challengeLink(payload, location.origin, location.pathname)
    return { url: longUrl, code: null, fallback: 'not_configured', longUrl }
  }
  return createShortLink(r.transport, r.signedIn, payload, location.origin, location.pathname, navigator.onLine !== false)
}

export async function resolveShort(code: string): Promise<Resolved> {
  const r = await rt()
  return resolveShortCode(r ? r.transport : null, code)
}

export async function myChallenges(): Promise<ChallengeRow[]> {
  const r = await rt()
  return r && r.signedIn ? r.transport.myChallenges() : []
}

export async function deleteChallenge(code: string): Promise<void> {
  const r = await rt()
  if (r) await r.transport.deleteChallenge(code)
}
