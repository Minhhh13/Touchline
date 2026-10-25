#!/usr/bin/env node
// Build the loader form of `touchline-e{ENGINE_VERSION}`: supabase/functions/touchline/loader.ts with the engine, the
// Supabase package versions deno.json pins and the SHA-256 of the edge bundle (scripts/online/edgeBundle.mjs) filled
// in. The site build publishes that bundle as dist/edge/verifier-<hash16>.js; the loader fetches it from the live site
// and runs it only when its hash is this one, so deploy the loader after the live site serves the same build.
//
//   node scripts/online/build-loader.mjs [outfile]
//     default outfile: supabase/functions/touchline-e{V}-loader/index.ts (gitignored, like the staged function)
//
// Deploy it as `touchline-e{V}` with Verify JWT on; no deno.json or lock is needed (npm: specifiers inline).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEdgeBundle } from './edgeBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const engine = /export const ENGINE_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(path.join(root, 'src/engine/version.ts'), 'utf8'))?.[1]
if (!engine) throw new Error('ENGINE_VERSION not found')
const imports = JSON.parse(readFileSync(path.join(root, 'supabase/functions/touchline/deno.json'), 'utf8')).imports
const version = (name) => {
  const m = /@([0-9][^@]*)$/.exec(imports[name] ?? '')
  if (!m) throw new Error(`deno.json pins no version for ${name}`)
  return m[1]
}
const edge = await buildEdgeBundle()
const template = readFileSync(path.join(root, 'supabase/functions/touchline/loader.ts'), 'utf8')
const code = template
  .replaceAll('__ENGINE__', engine)
  .replaceAll('__VERIFIER_SHA256__', edge.sha256)
  .replaceAll('__SUPABASE_JS__', version('@supabase/supabase-js'))
  .replaceAll('__SUPABASE_SERVER__', version('@supabase/server'))
if (/__[A-Z_]+__/.test(code)) throw new Error('A placeholder was left in the loader')
const outfile = path.resolve(process.argv[2] ?? path.join(root, 'supabase', 'functions', `touchline-e${engine}-loader`, 'index.ts'))
mkdirSync(path.dirname(outfile), { recursive: true })
writeFileSync(outfile, code)
console.log(`touchline-e${engine} loader: ${path.relative(root, outfile) || outfile}, ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB; pins ${edge.file} sha256 ${edge.sha256}`)
