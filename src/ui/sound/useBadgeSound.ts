import { useEffect } from 'react'
import { newlyEarned } from './cues'
import { prefersReducedMotion } from '../motion'
import { playSound } from './synth'

/** The badges this viewer has heard unlock (`id:tier`), per device: its own localStorage key, never the save. */
export const BADGES_HEARD_KEY = 'touchline-badges-heard'

function readHeard(): string[] | null {
  try {
    const raw = localStorage.getItem(BADGES_HEARD_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

/**
 * The Trophy Room's unlock: when it shows a badge or a tier earned since this viewer last saw it, one medal's ring (a
 * reward: the master alone governs it), however many came at once. What has been heard is then kept, sound on or off.
 */
export function useBadgeSound(earned: readonly string[]): void {
  const key = earned.join('|')
  useEffect(() => {
    const fresh = newlyEarned(readHeard(), earned)
    if (!fresh.length) return
    playSound({ id: 'badge', reduced: prefersReducedMotion() }, 0.3)
    try {
      localStorage.setItem(BADGES_HEARD_KEY, JSON.stringify(earned))
    } catch {
      // Storage blocked: heard again on the next visit
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
