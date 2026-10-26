/**
 * The save's storage: the persisted JSON is compressed with lz-string's
 * `compressToUTF16` before it reaches localStorage, and read back either
 * compressed or as the plain JSON every earlier build wrote (a plain save
 * starts with `{`, which a compressed one never does). Writes are coalesced:
 * a change schedules one write a moment later, which carries the latest state
 * (so a steady stream of changes still writes every moment), and a waiting
 * write goes out at once when the page is hidden or closed. A write the browser refuses
 * (its storage is full) is reported and the game carries on in memory.
 *
 * With an `encoder` (a Web Worker in the browser, `saveEncoder.ts`) the coalesced write compresses off the page's
 * main thread: the page only turns the state into JSON and stores the bytes that come back, the same bytes
 * `encodeSave` gives. One write is in flight at a time and a newer one waits for it; `flush` (the page hidden or
 * closed) still writes synchronously, and a write the worker cannot finish is compressed on the page instead.
 */
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'
import type { PersistStorage, StorageValue } from 'zustand/middleware'

/**
 * True when the text is plain JSON (every save written before compression, and
 * every export): its first character, after a byte-order mark or ASCII white
 * space a file may carry, is `{`. A compressed save of a JSON object never
 * starts that way (its first character encodes the bits of the leading `{`).
 */
export function isPlainSave(raw: string): boolean {
  return /^[\uFEFF \t\r\n]*\{/.test(raw)
}

export function encodeSave(json: string): string {
  return compressToUTF16(json)
}

/** The JSON text of a stored or imported save, plain or compressed; null when it cannot be read. */
export function decodeSave(raw: string): string | null {
  if (isPlainSave(raw)) return raw
  try {
    const out = decompressFromUTF16(raw)
    return out && isPlainSave(out) ? out : null
  } catch {
    return null
  }
}

/** Parse a save file or a stored save (plain or compressed) into its persisted value, or throw. */
export function parseSave<S>(raw: string): StorageValue<S> {
  const json = decodeSave(raw)
  if (json === null) throw new Error('not a Touchline save')
  const parsed: unknown = JSON.parse(json.replace(/^\uFEFF/, ''))
  if (!parsed || typeof parsed !== 'object' || !('state' in parsed) || !parsed.state || typeof parsed.state !== 'object') throw new Error('not a Touchline save')
  return parsed as StorageValue<S>
}

/** The browser refused the write because the site's storage is full. */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const { name, code } = e as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

/** Compresses a save's JSON somewhere else than the page's main thread, to exactly what `encodeSave` gives. */
export interface SaveEncoder {
  encode: (json: string) => Promise<string>
}

export interface SaveStorageOptions {
  /** The backing storage; undefined (or a throw) when the browser has none. */
  storage: () => Storage | undefined
  /** Milliseconds from the first unsaved change to the write that carries the latest state; 0 writes at once. */
  delayMs: number
  /** Called after every write the browser accepted. */
  onWrite?: () => void
  /** Called when a write fails; `quota` when the storage is full. The state stays in memory. */
  onError?: (error: unknown, quota: boolean) => void
  /** Compresses the coalesced writes off the main thread; absent (or null), every write compresses on the page. */
  encoder?: SaveEncoder | null
}

export interface SaveStorage<S> extends PersistStorage<S, void> {
  /** Write the pending state now, if there is one. */
  flush: () => void
  /** Drop the pending write and refuse any later one (an import or a wipe is about to reload the page). */
  freeze: () => void
  /** Whether a write is waiting. */
  pending: () => boolean
}

export function createSaveStorage<S>(opts: SaveStorageOptions): SaveStorage<S> {
  let queued: { name: string; value: StorageValue<S> } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let frozen = false
  // Writes are numbered as they start; bytes older than the newest stored write are dropped when they come back
  let started = 0
  let stored = 0
  let inflight: { seq: number; name: string; value: StorageValue<S>; json: string } | null = null
  // The state last given, by reference: the store hands the same object again when only its transient state changed
  let last: { name: string; state: unknown; version: number | undefined } | null = null
  const backing = (): Storage | undefined => {
    try {
      return opts.storage()
    } catch {
      return undefined
    }
  }
  const put = (name: string, encoded: string, seq: number) => {
    if (frozen || seq <= stored) return
    stored = seq
    const store = backing()
    if (!store) return
    try {
      store.setItem(name, encoded)
    } catch (e) {
      opts.onError?.(e, isQuotaError(e))
      return
    }
    opts.onWrite?.()
  }
  const stringify = (value: StorageValue<S>): string | null => {
    try {
      return JSON.stringify(value)
    } catch (e) {
      opts.onError?.(e, false)
      return null
    }
  }
  const encodeHere = (name: string, json: string, seq: number) => {
    let encoded: string
    try {
      encoded = encodeSave(json)
    } catch (e) {
      opts.onError?.(e, false)
      return
    }
    put(name, encoded, seq)
  }
  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    const job = queued
    queued = null
    if (frozen) return
    if (job) {
      // Newer than anything in flight, whose bytes are then dropped
      inflight = null
      const seq = ++started
      if (!backing()) return
      const json = stringify(job.value)
      if (json !== null) encodeHere(job.name, json, seq)
      return
    }
    // The worker's bytes are not back yet: write that state now
    const left = inflight
    inflight = null
    if (left) encodeHere(left.name, left.json, left.seq)
  }
  const schedule = (ms: number) => {
    if (timer === null && !frozen) timer = setTimeout(writeSoon, ms)
  }
  /** The coalesced write: compressed by the encoder when there is one, one write in flight at a time. */
  const writeSoon = () => {
    timer = null
    const encoder = opts.encoder
    if (!encoder) return flush()
    // The latest state waits for the write in flight, then goes
    if (inflight || !queued || frozen) return
    const job = queued
    queued = null
    if (!backing()) return
    const json = stringify(job.value)
    if (json === null) return
    const seq = ++started
    inflight = { seq, name: job.name, value: job.value, json }
    const done = () => {
      if (inflight?.seq === seq) inflight = null
      if (queued) schedule(0)
    }
    let asked: Promise<string>
    try {
      asked = encoder.encode(json)
    } catch (e) {
      asked = Promise.reject(e)
    }
    asked.then(
      (encoded) => {
        if (inflight?.seq === seq) put(job.name, encoded, seq)
        done()
      },
      () => {
        // No worker after all: compress it here
        if (inflight?.seq === seq) encodeHere(job.name, json, seq)
        done()
      },
    )
  }
  return {
    getItem: (name) => {
      // A write still waiting (or still being compressed) is newer than what is stored
      if (queued && queued.name === name) return queued.value
      if (inflight && inflight.name === name) return inflight.value
      const raw = backing()?.getItem(name)
      if (!raw) return null
      try {
        return parseSave<S>(raw)
      } catch (e) {
        console.warn(`Could not read the save: ${e instanceof Error ? e.message : String(e)}`)
        return null
      }
    },
    setItem: (name, value) => {
      if (frozen) return
      // The very state just given (an update elsewhere in the store): nothing new to write
      if (last && last.name === name && last.state === value.state && last.version === value.version) return
      last = { name, state: value.state, version: value.version }
      queued = { name, value }
      if (opts.delayMs <= 0) flush()
      else schedule(opts.delayMs)
    },
    removeItem: (name) => {
      if (last?.name === name) last = null
      if (queued?.name === name) queued = null
      if (inflight?.name === name) {
        inflight = null
        stored = started
      }
      backing()?.removeItem(name)
    },
    flush,
    freeze: () => {
      frozen = true
      queued = null
      inflight = null
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    pending: () => queued !== null || inflight !== null,
  }
}
