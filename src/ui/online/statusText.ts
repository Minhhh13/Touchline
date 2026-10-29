/**
 * The online layer's own words on screen, through `t()` (r10): the save status (`savedLine` in
 * `src/online/core/status.ts`), this device's posts (`postLabel`, `postLine` and `devicePosts` in
 * `src/online/postText.ts`) and a failed online read (`onlineErrorText`). Those stay pure and English for the
 * online layer; the screens read these mirrors, built from the same facts, and a reason or a message the server wrote
 * reads through the logic's mirror (`logicLine`). `copyMirror.test.ts` holds every one equal in English. Display only.
 */
import type { PostState, SyncStatus } from '../../online/state'
import type { SavedLine } from '../../online/core/status'
import { devicePosts, sentence, type DevicePost } from '../../online/postText'
import { formatLocale } from '../format'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'
import { logicLine } from '../i18n/logicText'

const t = translator(online)

/** "just now", "2 min ago", "3 h ago", "4 days ago" (`ago` in core/status.ts). */
export function agoText(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 45) return t('agoJustNow')
  const m = Math.round(s / 60)
  if (m < 60) return t('agoMinutes', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('agoHours', { n: h })
  return t('agoDays', { n: Math.round(h / 24) })
}

/** The save status line, its tone as `savedLine` gives it. */
export function savedLineText(status: SyncStatus, lastSyncAt: string | null, now: number): SavedLine {
  if (status === 'syncing') return { text: t('savedSyncing'), tone: 'busy' }
  if (status === 'offline') return { text: t('savedOffline'), tone: 'warn' }
  if (status === 'error') return { text: t('savedError'), tone: 'warn' }
  if (status === 'paused') return { text: t('savedPaused'), tone: 'warn' }
  if (status === 'off') return { text: t('savedOff'), tone: 'muted' }
  const at = lastSyncAt ? Date.parse(lastSyncAt) : NaN
  if (Number.isNaN(at)) return { text: t('savedGettingReady'), tone: 'busy' }
  return { text: t('savedAgo', { ago: agoText(at, now) }), tone: 'good' }
}

const LABEL_KINDS = new Set(['daily', 'weekly', 'chase', 'arena', 'themed', 'runin'])

/** The board a post key names, in words; null for a key this build does not know (`postLabel`). */
export function postLabelText(key: string): string | null {
  const kind = key.slice(0, key.indexOf(':'))
  const id = key.slice(key.indexOf(':') + 1)
  if (!id || !LABEL_KINDS.has(kind)) return null
  return t(`postLabel_${kind}` as 'postLabel_daily', { id })
}

/** A post's line (`postLine`): the reason the server gave reads through the logic's mirror. */
export function postLineText(p: PostState, signedIn: boolean): string {
  if (p.state === 'waiting') {
    const points = p.points ?? 'none'
    if (p.reason === 'sign_in') return t(signedIn ? 'postWaitingAccount' : 'postSignInFirst', { points })
    if (p.reason === 'retry') return t('postRetrying', { points })
    return t('postPosting')
  }
  if (p.state === 'posted') return t('postPosted', { what: p.detail && !/^[A-Z_ ]+$/.test(p.detail) ? logicLine(p.detail) : t('postPoints', { points: p.points }), position: p.position, total: p.total.toLocaleString(formatLocale()) })
  if (p.state === 'unranked') return t('postUnranked', { reason: sentence(logicLine(p.reason)) })
  if (p.state === 'rejected') return t('postRejected', { reason: sentence(logicLine(p.reason)) })
  return t('postClosed')
}

/** This device's newest posts in the viewer's language, in `devicePosts`' order. */
export function devicePostsText(posts: Record<string, PostState>, signedIn: boolean, limit = 8): DevicePost[] {
  return devicePosts(posts, signedIn, limit).map((d) => ({ ...d, label: postLabelText(d.key) ?? d.label, line: postLineText(posts[d.key], signedIn) }))
}

/** A failed online read in the player's words (`onlineErrorText`). */
export function onlineErrorUi(e: unknown): string {
  const kind = e && typeof e === 'object' && 'kind' in e ? (e as { kind: unknown }).kind : null
  const message = e instanceof Error ? e.message : String(e ?? '')
  if (kind === 'network' || (!kind && /fetch|network|load failed|offline/i.test(message))) return t('errorNoConnection')
  if (kind === 'rate') return t('errorTooMany')
  if (kind === 'unavailable') return message ? logicLine(message) : t('errorNoAnswer')
  if (kind === 'auth') return t('errorSignInAgain')
  return message ? logicLine(message) : t('errorSomething')
}
