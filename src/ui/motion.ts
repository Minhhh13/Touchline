import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SeasonTier } from '@engine/types'

/*
 * Site motion: the few helpers the CSS cannot do alone. Everything here is
 * presentation only and never feeds the game (no engine or store state is
 * read from a timer). The rules are in docs/DESIGN_SYSTEM.md, section 12.
 */

/** Durations in ms, mirrored by --dur-1 to --dur-4 in styles.css. */
export const DURATION = { press: 150, quick: 220, base: 320, slow: 400 } as const

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** The viewer asked the device for less motion; every helper here then lands at once. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_QUERY).matches
}

/**
 * Runs a screen change (or the theme flip) inside a View Transition where the
 * browser has one: the old screen fades out over the new one and the active
 * nav pill slides to its new place. The new screen's own entrance is the CSS
 * `.page` animation, so browsers without the API (and reduced motion) get
 * the same fade and rise, just without the outgoing fade.
 */
export function withViewTransition(update: () => void): void {
  const doc = typeof document !== 'undefined' ? document : null
  if (!doc || typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  const root = doc.documentElement
  root.classList.add('vt')
  try {
    const t = doc.startViewTransition(() => flushSync(update))
    // A transition the browser aborts (the viewport resized, as a phone's does when it turns or its bars move) rejects
    // these promises; the change itself has still been made, so the rejection is only the lost animation
    t.ready.catch(() => undefined)
    void t.finished.catch(() => undefined).then(() => root.classList.remove('vt'))
  } catch {
    root.classList.remove('vt')
    update()
  }
}

/** Ease-out cubic on 0..1: quick at the start, settling at the end. */
export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return 1 - (1 - x) ** 3
}

/** The number a count-up shows `elapsed` ms into a `duration` ms run towards `target`: whole numbers, never past the target. */
export function countUpValue(target: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return target
  if (elapsed <= 0) return 0
  return Math.round(target * easeOutCubic(elapsed / duration))
}

/** Counts from zero to `target` once on mount (and again when the target changes); lands at once under reduced motion. */
export function useCountUp(target: number, duration: number = DURATION.slow): { value: number; counting: boolean } {
  const [reduced] = useState(prefersReducedMotion)
  const [value, setValue] = useState(() => (reduced || target === 0 ? target : 0))
  useEffect(() => {
    if (reduced || target === 0 || typeof requestAnimationFrame !== 'function') {
      setValue(target)
      return
    }
    let start = -1
    let id = requestAnimationFrame(function step(now) {
      if (start < 0) start = now
      setValue(countUpValue(target, now - start, duration))
      if (now - start < duration) id = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(id)
  }, [target, duration, reduced])
  return { value, counting: value !== target }
}

/** What a revealed tier earns: confetti for the perfect season, a gold flare for the other titles, nothing otherwise. */
export function celebrationFor(tier: SeasonTier): 'confetti' | 'flare' | null {
  if (tier === 'PERFECT') return 'confetti'
  if (tier === 'INVINCIBLE' || tier === 'CHAMPIONS') return 'flare'
  return null
}

export interface ConfettiPiece {
  /** Where the piece ends up, in px from the burst's centre. */
  dx: number
  dy: number
  /** Degrees of spin on the way out. */
  rot: number
  /** ms before it leaves. */
  delay: number
  /** Index into the three brand colours (gold, primary, accent). */
  colour: 0 | 1 | 2
  /** Long side in px. */
  size: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * A fixed burst of `count` pieces spread evenly round the centre by the golden
 * angle: the same picture every time, so no random numbers are drawn (the game's
 * RNG is never touched by decoration). Pieces fly 70 to 150 px wide and fall a
 * little, so they stay inside the tier banner.
 */
export function confettiPieces(count: number): ConfettiPiece[] {
  const out: ConfettiPiece[] = []
  for (let i = 0; i < count; i++) {
    const angle = i * GOLDEN_ANGLE
    const reach = 70 + ((i * 37) % 81)
    out.push({
      dx: Math.round(Math.cos(angle) * reach * 1.6),
      dy: Math.round(Math.sin(angle) * reach * 0.6 + 18),
      rot: ((i * 97) % 360) - 180,
      delay: (i * 23) % 160,
      colour: (i % 3) as 0 | 1 | 2,
      size: 6 + (i % 3) * 2,
    })
  }
  return out
}

/** Results already celebrated in this visit, so coming back to a summary does not throw the confetti again. */
const celebrated = new Set<string>()

/** True the first time `key` is revealed in this visit, and on every replay; marked once the reveal has mounted. */
export function useFirstReveal(key: string, replayed: boolean): boolean {
  const [play] = useState(() => replayed || !celebrated.has(key))
  useEffect(() => {
    celebrated.add(key)
  }, [key])
  return play
}

let heroKicked = false
const HERO_KEY = 'touchline-hero-kick'

/** The hero's ball slides in once per visit (a tab's session); blocked storage still limits it to once per page load. */
export function useOncePerVisit(): boolean {
  const [play] = useState(() => {
    if (heroKicked) return false
    try {
      return sessionStorage.getItem(HERO_KEY) !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    heroKicked = true
    try {
      sessionStorage.setItem(HERO_KEY, '1')
    } catch {
      // Storage blocked: the module flag keeps it to once per page load
    }
  }, [])
  return play
}
