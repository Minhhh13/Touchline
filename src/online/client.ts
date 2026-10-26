/**
 * The Supabase client, created once and only by `runtime.ts`, which is itself loaded with a dynamic `import()`, so
 * supabase-js is its own chunk and never part of the offline game's first load. The publishable key is the only
 * key a browser ever holds (`onlineConfig()` refuses anything else).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { OnlineConfig } from './config'
import { AUTH_KEY } from './localState'

export function createOnlineClient(cfg: OnlineConfig): SupabaseClient {
  return createClient(cfg.url, cfg.key, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY },
  })
}
