/**
 * Which sign-in providers to offer. Email (a code or a link) always; Google only when the build says so
 * (`VITE_GOOGLE_AUTH=1`) or the project's public Auth settings (`GET /auth/v1/settings`, readable with the publishable
 * key) report it enabled, so the Account screen never shows a button the project would refuse. Pure.
 */

/** Whether a build flag forces the Google button on. */
export function googleForced(flag: string | undefined): boolean {
  return (flag ?? '').trim() === '1'
}

/** Whether `/auth/v1/settings` says Google sign-in is enabled; anything unreadable is false. */
export function googleEnabledIn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  const external = (settings as { external?: unknown }).external
  return !!external && typeof external === 'object' && (external as Record<string, unknown>).google === true
}
