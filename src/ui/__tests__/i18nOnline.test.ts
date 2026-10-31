/**
 * The signed-in online screens in the pseudo-locale (r10): Account signed in, the profile setup step, the save status
 * in every state, the conflict cards, this device's posts in every state, the Profile's account link and the World
 * board's states, server-rendered from the online store's own states (no Supabase: the store is what the runtime
 * fills). No missing key, sound markup, and no English left but data.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { onlineStore, initialOnlineState, type OnlineState, type PostState, type SyncConflict } from '../../online/state'
import type { SaveMeta } from '../../online/core/slots'
import { setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { AccountLink, AccountScreen } from '../online/AccountPanel'
import { ConflictCards } from '../online/ConflictCard'
import { OnlineRecord } from '../online/OnlineRecord'
import { BoardState } from '../online/WorldBoard'
import { onlineErrorUi } from '../online/statusText'
import { dataNames, leftover } from './i18nLeftover'
import { openFiltered, show } from './qaSsr'

vi.stubEnv('VITE_SUPABASE_URL', 'https://fake-touchline.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_fakeTouchlineKey123')

const u = loadTestUniverse(['england'])
const DATA = dataNames(u, ['Ada Lovelace', 'Far Away FC', 'Near Home FC', 'K7Q2MX9A3B', 'a•••@example.com'])
const SESSION = { userId: 'user-1', maskedEmail: 'a•••@example.com', provider: 'email' }
const meta = (teamName: string, phase: string, matchweek: number): SaveMeta => ({ teamName, mode: 'season', phase, matchweek, year: 1, deviceLabel: 'iPhone', savedAt: '2026-10-28T09:00:00Z' }) as unknown as SaveMeta

const POSTS: Record<string, PostState> = {
  'daily:2026-10-29': { state: 'posted', position: 12, total: 1234, countryPosition: 3, countryTotal: 210, country: 'GB', points: 71, claimMatched: true, already: false },
  'daily:2026-10-28': { state: 'waiting', reason: 'retry', points: 66 },
  'daily:2026-10-27': { state: 'waiting', reason: 'sign_in', points: 60 },
  'weekly:2026-W44': { state: 'waiting', reason: 'sending', points: 64 },
  'arena:2026-10-27': { state: 'unranked', code: 'hand_managed', reason: 'You managed this run yourself, so it stays off the board.' },
  'themed:2026-W43': { state: 'rejected', code: 'replay_mismatch', reason: 'The replay did not match the run posted.' },
  'runin:2026-W43': { state: 'closed' },
  'chase:K7Q2MX9A3B': { state: 'posted', position: 4, total: 98, points: 88, claimMatched: true, already: true, weekPosition: 2, weekTotal: 40, perfect: true },
}
const CONFLICTS: SyncConflict[] = [
  { kind: 'different', slot: 'season', local: meta('Near Home FC', 'week', 12), remote: meta('Far Away FC', 'week', 20), baseRevision: 3 },
  { kind: 'abandoned', slot: 'quick', remote: meta('Far Away FC', 'summary', 38), baseRevision: 2, at: '2026-10-28T09:00:00Z' },
  { kind: 'newer', slot: 'dynasty', remote: meta('Far Away FC', 'january', 19) },
]

/** A board's error as the screen words it when it fails, in the pseudo-locale (the board keeps the words it got then). */
function pseudoError(): string {
  setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
  try {
    return onlineErrorUi({ kind: 'network' })
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
}

const report: Record<string, string[]> = {}
const fails: string[] = []
function check(name: string, C: ComponentType<never>, state: Partial<OnlineState>, props: Record<string, unknown> = {}): void {
  onlineStore.setState({ ...initialOnlineState, configured: true, started: true, ...state })
  // A server render reads the store's initial state, as `show()` does for the game store
  Object.assign(onlineStore.getInitialState(), onlineStore.getState())
  show({ universe: u, loadedLeagues: ['england'], game: null, screen: 'account' })
  let pseudo = ''
  try {
    setLocaleMessages({ id: 'en', messages: {} })
    const en = renderToString(createElement(C, props as never))
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    pseudo = renderToString(createElement(C, props as never))
    if (en.includes('⟦') || pseudo.includes('⟦')) fails.push(`${name}: a missing key`)
  } catch (e) {
    fails.push(`${name} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
  if (pseudo && !isPseudo(pseudo)) fails.push(`${name}: no pseudo text`)
  for (const p of openFiltered(pseudo)) fails.push(`${name}: ${p}`)
  report[name] = [...new Set([...(report[name] ?? []), ...leftover(pseudo, DATA)])]
}

describe('the signed-in online screens in the pseudo-locale (r10)', () => {
  it('Account, the setup step, the save status, the conflicts, the posts, the account link and the boards', () => {
    const signedIn = { session: SESSION, account: { displayName: 'Ada Lovelace', country: 'GB' }, accountLoaded: true, lastSyncAt: new Date().toISOString() }
    for (const syncStatus of ['idle', 'syncing', 'offline', 'error', 'paused', 'off'] as const) check(`Account ${syncStatus}`, AccountScreen as ComponentType<never>, { ...signedIn, syncStatus, syncMessage: syncStatus === 'error' ? 'Sync failed: The server did not answer' : syncStatus === 'paused' ? 'Cloud sync is off since you deleted your cloud data. Press Sync now to upload the games on this device again.' : null, posts: POSTS })
    check('Account setup', AccountScreen as ComponentType<never>, { session: SESSION, account: null, accountLoaded: true })
    check('Account loading', AccountScreen as ComponentType<never>, { session: SESSION, account: null, accountLoaded: false })
    check('Account load error', AccountScreen as ComponentType<never>, { session: SESSION, account: null, accountLoaded: false, accountError: 'No connection: it loads when you are back online.' })
    check('Account switch', AccountScreen as ComponentType<never>, { ...signedIn, accountSwitch: { previousUserId: 'user-0' } })
    check('Conflicts', ConflictCards as ComponentType<never>, { ...signedIn, conflicts: CONFLICTS })
    check('Posts', OnlineRecord as ComponentType<never>, { ...signedIn, posts: POSTS })
    check('Posts signed out', OnlineRecord as ComponentType<never>, { posts: POSTS })
    check('Account link', AccountLink as ComponentType<never>, { ...signedIn, syncStatus: 'idle' })
    const retry = () => {}
    check('Board states', BoardState as ComponentType<never>, signedIn, { rows: null, error: null, retry, empty: 'x' })
    check('Board states', BoardState as ComponentType<never>, signedIn, { rows: null, error: pseudoError(), offline: true, retry, empty: 'x' })
    expect(fails).toEqual([])
    if (process.env.I18N_REPORT === '1') for (const [k, v] of Object.entries(report)) if (v.length) console.log(`${k}:\n  ${v.join('\n  ')}`)
    const left = Object.entries(report).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(' | ')}`)
    expect(left).toEqual([])
  })
})
