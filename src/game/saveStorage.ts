/**
 * The save's storage: the persisted JSON is compressed with lz-string's
 * `compressToUTF16` before it reaches localStorage, and read back either
 * compressed or as the plain JSON every earlier build wrote (a plain save
 * starts with `{`, which a compressed one never does). Writes are coalesced:
 * the latest state is written once the store has been quiet for a moment, and
 * at once when the page is hidden or closed. A write the browser refuses
 * (its storage is full) is reported and the game carries on in memory.
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

export interface SaveStorageOptions {
  /** The backing storage; undefined (or a throw) when the browser has none. */
  storage: () => Storage | undefined
  /** Milliseconds of quiet before a write; 0 writes at once. */
  delayMs: number
  /** Called after every write the browser accepted. */
  onWrite?: () => void
  /** Called when a write fails; `quota` when the storage is full. The state stays in memory. */
  onError?: (error: unknown, quota: boolean) => void
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
  const backing = (): Storage | undefined => {
    try {
      return opts.storage()
    } catch {
      return undefined
    }
  }
  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    const job = queued
    queued = null
    if (!job || frozen) return
    const store = backing()
    if (!store) return
    let encoded: string
    try {
      encoded = encodeSave(JSON.stringify(job.value))
    } catch (e) {
      opts.onError?.(e, false)
      return
    }
    try {
      store.setItem(job.name, encoded)
    } catch (e) {
      opts.onError?.(e, isQuotaError(e))
      return
    }
    opts.onWrite?.()
  }
  return {
    getItem: (name) => {
      // A write still waiting is newer than what is stored
      if (queued && queued.name === name) return queued.value
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
      queued = { name, value }
      if (opts.delayMs <= 0) flush()
      else if (timer === null) timer = setTimeout(flush, opts.delayMs)
    },
    removeItem: (name) => {
      if (queued?.name === name) queued = null
      backing()?.removeItem(name)
    },
    flush,
    freeze: () => {
      frozen = true
      queued = null
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    pending: () => queued !== null,
  }
}
