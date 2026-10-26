/**
 * `dist/build.json`, written by the `buildInfo()` plugin in `vite.config.ts`: which engine and which data stamp this
 * build serves. The live site's copy is the online layer's source of truth for "current" (the Daily pin and the pack
 * archive read it). Pure and import-free, because `vite.config.ts` (the node project) also compiles it.
 */
export interface BuildInfo {
  engine: string
  data: string
  builtAt: string
  /** The hashed edge bundle this build publishes (`edge/verifier-<hash16>.js`) and its SHA-256: what an Edge Function
   * deployed for this engine pins. For people and checks only; the function trusts its own constant, never this. */
  verifier?: { path: string; sha256: string }
}

/** Build info from the text of `src/engine/version.ts` and of `public/data/leagues.json`; throws when either is unreadable. */
export function buildInfoFrom(versionTs: string, leaguesJson: string, builtAt: string): BuildInfo {
  const m = /export const ENGINE_VERSION\s*=\s*'([^']+)'/.exec(versionTs)
  if (!m) throw new Error('ENGINE_VERSION not found in src/engine/version.ts')
  const index = JSON.parse(leaguesJson) as { generatedAt?: unknown }
  if (typeof index.generatedAt !== 'string' || !index.generatedAt) throw new Error('generatedAt missing from public/data/leagues.json')
  return { engine: m[1], data: index.generatedAt, builtAt }
}
