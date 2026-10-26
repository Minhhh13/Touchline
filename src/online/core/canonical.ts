/**
 * Canonical JSON and fingerprints: the same value gives the same text and hash on every device and on the server,
 * whatever order its keys were written in. Used for cloud-save content hashes, the Daily pin's settings hash and the
 * draft fingerprint. Pure; also bundled into the verifier.
 */
import { hashString } from '@engine/rng'

/**
 * JSON with the keys of every object sorted (by UTF-16 code unit, as `Array.prototype.sort` does). Arrays keep their
 * order; `undefined` members of objects are dropped and `undefined` in arrays becomes `null`, exactly as
 * `JSON.stringify` does. Throws on a value JSON cannot hold (a function, a bigint, a cycle, a non-finite number).
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>()
  const walk = (v: unknown): string => {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v)
      case 'boolean':
        return v ? 'true' : 'false'
      case 'number':
        if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number')
        return JSON.stringify(v)
      case 'object': {
        const o = v as object
        if (seen.has(o)) throw new Error('canonicalJson: cycle')
        seen.add(o)
        let out: string
        if (Array.isArray(o)) out = `[${o.map((x) => (x === undefined ? 'null' : walk(x))).join(',')}]`
        else {
          const rec = o as Record<string, unknown>
          const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort()
          out = `{${keys.map((k) => `${JSON.stringify(k)}:${walk(rec[k])}`).join(',')}}`
        }
        seen.delete(o)
        return out
      }
      default:
        throw new Error(`canonicalJson: cannot encode a ${typeof v}`)
    }
  }
  return walk(value)
}

/** A short base-36 fingerprint of a value's canonical JSON (the engine's `hashString`, 53 bits). */
export function fingerprint(value: unknown): string {
  return hashString(canonicalJson(value)).toString(36)
}
