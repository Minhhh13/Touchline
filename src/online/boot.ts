/**
 * Entry of the online layer, imported dynamically from `main.tsx` only when `onlineConfig()` is not null, so an
 * offline-only build never loads it. It reads the sign-in redirect the page was opened with (before the App's own
 * hash handler runs), files every finished Daily, weekly challenge and casual board run (the Daily Arena, the Weekly
 * Challenge, the Run-in of the week) in the outbox (signed in or not), and starts
 * the Supabase runtime straight away only when there is a session or a redirect to finish; otherwise the runtime
 * starts when the player opens an online surface (`api.ts`).
 */
import { cleanName } from '@engine/challenge'
import { useStore } from '@game/store'
import { authRedirectAt } from './auth'
import { hasStoredSession, loadRecord, updateRecord } from './localState'
import { captureCasualEntry, captureEntry, casualFinish, enqueue, rankedFinish } from './outbox'
import { onlineStore } from './state'

const redirect = authRedirectAt(location.href)

export function bootOnline(): void {
  const rec = loadRecord()
  onlineStore.setState({ configured: true, syncStatus: 'idle', posts: rec.posts, outboxCount: rec.outbox.length })
  const file = (entry: ReturnType<typeof captureEntry>) => {
    if (!entry) return
    const next = updateRecord((r) => enqueue(r, entry))
    onlineStore.setState({ posts: next.posts, outboxCount: next.outbox.length })
    void import('./api').then((m) => m.flushOutboxSoon())
  }
  useStore.subscribe((s, prev) => {
    const owner = onlineStore.getState().session?.userId ?? null
    const g = rankedFinish(prev, s)
    if (g && s.universe) {
      const name = cleanName(s.profile.managerName) || cleanName(g.settings.teamName) || 'A friend'
      file(captureEntry(g, s.universe, name, new Date(), owner))
    }
    // The casual boards: checked after the summary has painted (a Run-in of the week replays its run-in to be sure it ranks)
    const c = casualFinish(prev, s)
    const u = s.universe
    if (c && u) {
      const name = cleanName(s.profile.managerName) || cleanName(c.settings.teamName) || 'A friend'
      setTimeout(() => file(captureCasualEntry(c, u, name, new Date(), owner)), 50)
    }
  })
  if (redirect || hasStoredSession()) void import('./runtime').then((m) => m.startRuntime(redirect))
}

bootOnline()
