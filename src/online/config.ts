/**
 * Whether this build carries the online layer, and where it points.
 *
 * The layer is optional (CLAUDE.md invariant 13): with either `VITE_SUPABASE_*` variable missing, or holding
 * something that is not a public URL and a publishable key, `onlineConfig()` is null, nothing imports supabase-js
 * and the game is exactly the offline build.
 */
import { ENGINE_VERSION } from '@engine/version'

/** The Supabase project's region (project `yvqpmyqomkwtudxmkeou`, Sydney). Edge Function calls are pinned to it. */
export const SUPABASE_REGION = 'ap-southeast-2'

/** One Edge Function per engine version, so yesterday's board and live rooms finish on their own engine. */
export const FUNCTION_PREFIX = 'touchline-e'

export interface OnlineConfig {
  url: string
  key: string
  functionName: string
  region: string
}

export interface OnlineEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

/** A key that must never reach a browser: a secret key, or a legacy JWT whose role is not `anon`. */
export function isForbiddenClientKey(key: string): boolean {
  // A character class, so the built bundle never holds the literal prefix that `check:dist-keys` looks for
  if (/^sb_s[e]cret_/.test(key)) return true
  const parts = key.split('.')
  if (parts.length === 3 && parts[0].startsWith('eyJ')) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { role?: unknown }
      return claims.role !== 'anon'
    } catch {
      return true
    }
  }
  return false
}

/** The configuration from a set of build variables; null when the layer is off. */
export function onlineConfigFrom(env: OnlineEnv): OnlineConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !key) return null
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return null
  if (isForbiddenClientKey(key)) return null
  return { url, key, functionName: FUNCTION_PREFIX + ENGINE_VERSION, region: SUPABASE_REGION }
}

/** This build's online configuration (Vite inlines the variables at build time). */
export function onlineConfig(): OnlineConfig | null {
  return onlineConfigFrom(import.meta.env)
}
