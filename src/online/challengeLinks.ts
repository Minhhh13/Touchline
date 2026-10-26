/**
 * Challenge short links: `#s=K7Q2MX9A` instead of the long `#c=` link. Minting needs a signed-in account and a
 * connection (`create_challenge`, the same payload from the same owner always gets the same code); resolving needs
 * only a connection (`get_challenge`, readable signed out). Any failure to mint falls back to the long link, which
 * keeps working offline, so nothing regresses. The server never marks a challenge verified: the opener's replay
 * decides, exactly as for a long link.
 */
import { encodeChallenge, type ChallengePayload } from '@engine/challenge'
import { challengeLink } from '@game/logic/challenge'
import { formatCode, normaliseCode } from './core/codes'
import type { OnlineTransport } from './transport'
import { OnlineError } from './transport'

export interface ShareLink {
  url: string
  /** `K7Q2-MX9A` when a short code was minted. */
  code: string | null
  /** Why the long link was used instead (null when the short one was minted). */
  fallback: null | 'offline' | 'signed_out' | 'unavailable' | 'rate' | 'not_configured'
  longUrl: string
}

export function shortLinkUrl(code: string, origin: string, pathname: string): string {
  return `${origin}${pathname}#s=${code}`
}

export async function createShortLink(t: OnlineTransport | null, signedIn: boolean, payload: ChallengePayload, origin: string, pathname: string, online = true): Promise<ShareLink> {
  const longUrl = challengeLink(payload, origin, pathname)
  const long = (fallback: ShareLink['fallback']): ShareLink => ({ url: longUrl, code: null, fallback, longUrl })
  if (!t) return long('not_configured')
  if (!signedIn) return long('signed_out')
  if (!online) return long('offline')
  try {
    const raw = await t.rpc<unknown>('create_challenge', { p_payload: payload })
    const code = typeof raw === 'string' ? normaliseCode(raw) : null
    if (!code) return long('unavailable')
    return { url: shortLinkUrl(code, origin, pathname), code: formatCode(code), fallback: null, longUrl }
  } catch (e) {
    if (e instanceof OnlineError) return long(e.kind === 'network' ? 'offline' : e.kind === 'auth' || e.kind === 'guest' ? 'signed_out' : e.kind === 'rate' ? 'rate' : 'unavailable')
    return long('unavailable')
  }
}

export type Resolved = { ok: true; encoded: string } | { ok: false; message: string }

/** A short code's challenge, encoded the way `openChallenge` takes a `#c=` link. */
export async function resolveShortCode(t: OnlineTransport | null, input: string): Promise<Resolved> {
  const code = normaliseCode(input)
  if (!code) return { ok: false, message: 'That is not a challenge code.' }
  if (!t) return { ok: false, message: 'Short links need the online build: ask your friend for the long link.' }
  try {
    const payload = await t.rpc<unknown>('get_challenge', { p_code: code })
    if (!payload || typeof payload !== 'object') return { ok: false, message: `No challenge with the code ${formatCode(code)} (it may have expired).` }
    return { ok: true, encoded: encodeChallenge(payload as ChallengePayload) }
  } catch (e) {
    if (e instanceof OnlineError && e.kind === 'network') return { ok: false, message: 'Short links need a connection; ask for the long link.' }
    return { ok: false, message: `Could not open the challenge: ${e instanceof Error ? e.message : String(e)}` }
  }
}
