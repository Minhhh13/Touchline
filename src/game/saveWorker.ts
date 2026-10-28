/**
 * The save's compression off the page's main thread: the JSON in, `compressToUTF16` of it out (exactly what
 * `encodeSave` in saveStorage.ts gives). Imports lz-string only; started by `saveEncoder.ts`.
 */
import { compressToUTF16 } from 'lz-string'

interface Ask {
  id: number
  json: string
}

self.onmessage = (e: MessageEvent<Ask>) => {
  const { id, json } = e.data
  try {
    self.postMessage({ id, encoded: compressToUTF16(json) })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
