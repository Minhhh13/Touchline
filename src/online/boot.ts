/**
 * Entry of the online layer, imported dynamically from `main.tsx` only when `onlineConfig()` is not null, so an
 * offline-only build never loads it. Later items add the auth redirect, the session listener, cloud sync and the
 * Daily outbox here; for now it only marks the layer as configured.
 */
import { onlineStore } from './state'

export function bootOnline(): void {
  onlineStore.setState({ configured: true, syncStatus: 'idle' })
}

bootOnline()
