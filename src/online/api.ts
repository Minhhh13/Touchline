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
import { checkDisplayName, nameVerdictFrom, sendEmailCode, signInWithGoogle, verifyEmailCode, type AuthResult, type NameVerdict } from './auth'
import { normaliseCountry } from './core/country'
import { googleEnabledIn, googleForced } from './core/providers'
import { fetchAlltime, fetchAlltimeMine, fetchBoard, fetchSummary, myEntries, rankOf, type AlltimeOrder, type RankedKind } from './boards'
import { createShortLink, resolveShortCode, type Resolved, type ShareLink } from './challengeLinks'
import type { RoomManagerInput, RoomSettings } from '@game/logic/h2hRoom'

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

let googleCheck: Promise<boolean> | null = null

/**
 * Whether to offer "Continue with Google": forced on by `VITE_GOOGLE_AUTH=1`, otherwise only when the project's public
 * Auth settings report the provider enabled (read once per page; offline or unreadable means no button). Email sign-in
 * needs neither.
 */
export function googleSignInAvailable(): Promise<boolean> {
  const cfg = onlineConfig()
  if (!cfg) return Promise.resolve(false)
  if (googleForced(import.meta.env.VITE_GOOGLE_AUTH)) return Promise.resolve(true)
  googleCheck ??= fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.key } })
    .then((r) => (r.ok ? r.json() : null))
    .then(googleEnabledIn, () => false)
  return googleCheck
}

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

/** The live name check of the profile setup step: local rules first, then `display_name_check` when signed in. */
export async function checkName(name: string): Promise<NameVerdict> {
  const local = nameVerdictFrom(name, null)
  if (local.state === 'invalid') return local
  const r = await rt()
  if (!r || !r.userId) return local
  try {
    return nameVerdictFrom(name, await r.transport.rpc('display_name_check', { p_name: name }))
  } catch {
    return local
  }
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
    if (e instanceof OnlineError && e.kind === 'taken') return { ok: false, message: 'That name is taken: try another.' }
    // The table's own checks (look-alike or hidden characters the local mirror let through), said kindly
    if (e instanceof OnlineError && e.kind === 'bad' && e.code === '23514') return { ok: false, message: 'Use plain letters, digits and punctuation: some characters look like others on a board.' }
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

// ------------------------------------------------------------------ online head-to-head rooms

const noRooms = 'Online rooms are not available in this build.'

/** Open a room by its code (a `#h=` link, a typed code, a seat on this device) and keep it up to date. */
export async function openRoom(code: string): Promise<boolean> {
  const r = await rt()
  if (!r) return false
  await r.rooms.open(code)
  return true
}

/** Stop watching the room (the room screen closed); the seat stays on this device. */
export function closeRoom(): void {
  if (!onlineStore.getState().started) return
  void rt().then((r) => r?.rooms.close())
}

export async function createRoom(settings: RoomSettings, manager: RoomManagerInput, engine: string, data: string): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const r = await rt()
  return r ? r.rooms.create(settings, manager, engine, data) : { ok: false, message: noRooms }
}

export async function joinRoom(manager: RoomManagerInput, engine: string, data: string): Promise<boolean> {
  return (await (await rt())?.rooms.join(manager, engine, data)) ?? false
}

export async function pickInRoom(playerSeasonId: string, slotId: string): Promise<boolean> {
  return (await (await rt())?.rooms.pick(playerSeasonId, slotId)) ?? false
}

export async function leaveRoom(): Promise<boolean> {
  return (await (await rt())?.rooms.leave()) ?? false
}

export async function resumeRoom(): Promise<boolean> {
  return (await (await rt())?.rooms.resume()) ?? false
}

export async function refreshRoom(): Promise<void> {
  await (await rt())?.rooms.poll()
}

/** The rooms this device holds a seat in (younger than two days). */
export async function roomSeats(): Promise<string[]> {
  const r = await rt()
  return r ? r.rooms.openSeats() : []
}
