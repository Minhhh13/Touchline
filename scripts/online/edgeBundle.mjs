// The hashed edge bundle: src/online/server/edgeEntry.ts and everything it pulls in, as one script that assigns its
// exports to `globalThis.__touchlineEdge` (an IIFE, no import or export statement), so the Edge Function's loader can
// run it either as a data: module or, where a runtime refuses that, through Function. Built the same way by the Vite
// build (`dist/edge/verifier-<hash16>.js`, beside build.json) and by scripts/online/build-loader.mjs (the hash the
// loader pins), so both see the same bytes. Deterministic: same sources and esbuild version, same bytes.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { forbiddenIn } from './forbidden.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const EDGE_GLOBAL = '__touchlineEdge'

export async function buildEdgeBundle() {
  const result = await build({
    entryPoints: [path.join(root, 'src/online/server/edgeEntry.ts')],
    bundle: true,
    write: false,
    platform: 'neutral',
    format: 'iife',
    globalName: '__tlEdgeExports',
    footer: { js: `globalThis.${EDGE_GLOBAL}=__tlEdgeExports;` },
    target: 'es2022',
    tsconfig: path.join(root, 'tsconfig.app.json'),
    mainFields: ['module', 'main'],
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
    legalComments: 'none',
    minify: true,
    logLevel: 'warning',
  })
  const code = result.outputFiles[0].text
  const bad = forbiddenIn(code)
  if (bad.length) throw new Error(`The edge bundle uses ${bad.join(', ')}: the server cannot run browser or Node code`)
  if (/sb_secret_[A-Za-z0-9_-]{8}|eyJ[A-Za-z0-9_-]{10,}\./.test(code)) throw new Error('A key-shaped string ended up in the edge bundle')
  const bytes = Buffer.from(code, 'utf8')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { code, bytes, sha256, file: `edge/verifier-${sha256.slice(0, 16)}.js` }
}
