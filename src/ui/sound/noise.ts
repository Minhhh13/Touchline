/*
 * The noise the sounds are made from, as plain numbers: white noise, and pink
 * noise (softer at the top, the colour of a crowd) by Paul Kellet's filter.
 * Seeded, so a render is the same every time (the offline WAVs, the tests);
 * every buffer is scaled to a peak of exactly 1, so a voice's envelope is a
 * true bound on what it sends. Pure: no audio, no DOM, no game RNG.
 */

/** A small seeded generator for cosmetic variation (mulberry32 over a string hash). Never the game's RNG. */
export function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type NoiseColour = 'white' | 'pink'

/** `n` samples of noise peaking at exactly 1 (either sign). */
export function noiseSamples(n: number, colour: NoiseColour, seed = 'touchline-noise'): Float32Array {
  const r = seeded(`${seed}:${colour}`)
  const out = new Float32Array(Math.max(1, n))
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1
    if (colour === 'white') {
      out[i] = w
      continue
    }
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak
  return out
}
