#!/usr/bin/env node
// Fail when a built site holds a Supabase secret: an `sb_secret_` key, or a JWT whose role is not `anon`
// (a legacy service_role key). Vite inlines every VITE_ variable, so this is the last check before Render serves it.
// Usage: node scripts/online/check-dist-keys.mjs [dir=dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const TEXT = /\.(js|mjs|cjs|css|html|json|webmanifest|txt|map|svg)$/i
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (TEXT.test(name)) yield p
  }
}

function roleOf(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

const dir = path.resolve(process.argv[2] ?? 'dist')
const problems = []
let scanned = 0
for (const file of files(dir)) {
  scanned++
  const text = readFileSync(file, 'utf8')
  if (text.includes('sb_secret_')) problems.push(`${path.relative(dir, file)}: contains an sb_secret_ key`)
  for (const m of text.matchAll(JWT)) {
    const role = roleOf(m[0])
    if (role !== null && role !== 'anon') problems.push(`${path.relative(dir, file)}: contains a JWT with role "${role}"`)
  }
}
if (problems.length) {
  console.error(`check:dist-keys found ${problems.length} secret(s) in ${dir}:\n  ${problems.join('\n  ')}\nRemove the key from every VITE_ variable, rotate it in the Supabase dashboard, and rebuild.`)
  process.exit(1)
}
console.log(`check:dist-keys: ${scanned} files in ${path.relative(process.cwd(), dir) || '.'}, no secret keys`)
