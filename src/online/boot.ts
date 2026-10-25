/**
 * Entry of the online layer, imported dynamically from `main.tsx` only when `onlineConfig()` is not null, so an
 * offline-only build never loads it. It reads the sign-in redirect the page was opened with (before the App's own
 * hash handler runs), files every finished Daily and weekly challenge in the outbox (signed in or not), and starts
 * the Supabase runtime straight away only when there is a session or a redirect to finish; otherwise the runtime
 * starts when the player opens an online surface (`api.ts`).
 */
import { cleanName } from '@engine/challenge'
import { useStore } from '@game/store'
import { authRedirectAt } from './auth'
import { hasStoredSession, loadRecord, updateRecord } from './localState'
import { captureEntry, enqueue, rankedFinish } from './outbox'
import { onlineStore } from './state'

const redirect = authRedirectAt(location.href)

export function bootOnline(): void {
  const rec = loadRecord()
  onlineStore.setState({ configured: true, syncStatus: 'idle', posts: rec.posts, outboxCount: rec.outbox.length })
  useStore.subscribe((s, prev) => {
    const g = rankedFinish(prev, s)
    if (!g || !s.universe) return
    const name = cleanName(s.profile.managerName) || cleanName(g.settings.teamName) || 'A friend'
    const entry = captureEntry(g, s.universe, name, new Date())
    if (!entry) return
    const next = updateRecord((r) => enqueue(r, entry))
    onlineStore.setState({ posts: next.posts, outboxCount: next.outbox.length })
    void import('./api').then((m) => m.flushOutboxSoon())
  })
  if (redirect || hasStoredSession()) void import('./runtime').then((m) => m.startRuntime(redirect))
}

bootOnline()
