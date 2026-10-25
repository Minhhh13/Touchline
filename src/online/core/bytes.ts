/**
 * Bytes for cloud saves: gzip through the platform's CompressionStream (browsers and Node 22) and SHA-256 through
 * Web Crypto. No dependency.
 */

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Gzip of a string's UTF-8 bytes. */
export function gzipText(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('gzip'))
}

/** The string inside a gzip; throws when the bytes are not gzip. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')))
}

/** Lower-case hex SHA-256 of a string's UTF-8 bytes, or of raw bytes. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
