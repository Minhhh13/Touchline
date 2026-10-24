/**
 * Deterministic pseudo-random number generation.
 *
 * Everything in the engine that needs randomness goes through an `Rng`
 * instance so that a given seed always produces the same universe, the same
 * wheel spins (daily challenge) and the same season when replayed.
 *
 * Generator: xoshiro128** (fast, good statistical quality, 128-bit state).
 * Seeding: cyrb53-style string hash expanded with splitmix32.
 */

export interface RngState {
  a: number
  b: number
  c: number
  d: number
}

/** 53-bit string hash (cyrb53). Stable across platforms. */
export function hashString(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) | 0
    let t = s ^ (s >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return (t ^ (t >>> 15)) >>> 0
  }
}

export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: string | number) {
    const n = typeof seed === 'number' ? seed >>> 0 : hashString(seed) >>> 0
    const sm = splitmix32(n)
    this.a = sm()
    this.b = sm()
    this.c = sm()
    this.d = sm()
    // Avoid the all-zero state (astronomically unlikely, but cheap to guard).
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1
  }

  /** Create a child generator whose stream is independent of this one. */
  fork(label: string): Rng {
    return new Rng(hashString(label, this.nextUint32()))
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d }
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(0)
    r.a = state.a
    r.b = state.b
    r.c = state.c
    r.d = state.d
    return r
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0
    const t = this.b << 9
    this.c ^= this.a
    this.d ^= this.b
    this.b ^= this.c
    this.a ^= this.d
    this.c ^= t
    this.d = rotl(this.d, 11)
    return result
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Standard normal via Box-Muller. */
  gaussian(mean = 0, sd = 1): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
    return mean + z * sd
  }

  /** Gaussian clamped to [min, max]. */
  gaussianClamped(mean: number, sd: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.gaussian(mean, sd)))
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array')
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** Weighted pick. `weight(item)` must be >= 0; items with 0 weight are never picked. */
  pickWeighted<T>(arr: readonly T[], weight: (item: T, index: number) => number): T {
    let total = 0
    const weights = new Array<number>(arr.length)
    for (let i = 0; i < arr.length; i++) {
      const w = Math.max(0, weight(arr[i], i))
      weights[i] = w
      total += w
    }
    if (total <= 0) return this.pick(arr)
    let r = this.next() * total
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i]
      if (r < 0) return arr[i]
    }
    return arr[arr.length - 1]
  }

  /** In-place Fisher-Yates shuffle; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }

  /** Poisson-distributed integer with mean lambda (Knuth for small lambda). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0
    if (lambda > 30) {
      // Normal approximation for large lambda (not used in practice for goals).
      return Math.max(0, Math.round(this.gaussian(lambda, Math.sqrt(lambda))))
    }
    const L = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > L)
    return k - 1
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/** Seed string for the shared daily challenge, e.g. "daily-2026-10-24". */
/** The calendar day a daily seed was set for, or null for any other seed. */
export function dailyDateOf(seed: string): Date | null {
  const m = /^daily-(\d{4})-(\d{2})-(\d{2})$/.exec(seed)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The daily seed of the day before the given daily seed. */
export function previousDailySeed(seed: string): string | null {
  const d = dailyDateOf(seed)
  return d ? dailySeed(new Date(d.getTime() - 86400000)) : null
}

export function dailySeed(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `daily-${y}-${m}-${d}`
}

/** A random, human-shareable seed such as "K7Q2-MX9A". */
export function randomSeed(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const r = new Rng(Math.floor(Math.random() * 0xffffffff))
  let out = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-'
    out += alphabet[r.int(0, alphabet.length - 1)]
  }
  return out
}
