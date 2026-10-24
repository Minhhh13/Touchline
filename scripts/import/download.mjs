/**
 * Download every dataset into the cache directory (idempotent).
 *   node scripts/import/download.mjs
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CACHE, SOURCES, OPENFOOTBALL_BASE, OPENFOOTBALL_SEASONS, seasonSlug } from './config.mjs'

const run = promisify(execFile)

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function download(url, dest) {
  if (await exists(dest)) return false
  process.stdout.write(`  downloading ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  return true
}

export async function ensureDatasets() {
  await mkdir(CACHE, { recursive: true })
  for (const [key, src] of Object.entries(SOURCES)) {
    const zip = path.join(CACHE, src.zip)
    const dir = path.join(CACHE, src.dir)
    const needed = src.files.length ? src.files.map((f) => path.join(dir, f)) : [dir]
    let haveAll = true
    for (const f of needed) if (!(await exists(f))) haveAll = false
    if (haveAll) continue
    await download(src.url, zip)
    await mkdir(dir, { recursive: true })
    const args = ['-q', '-o', zip, '-d', dir]
    if (src.files.length) args.splice(3, 0, ...src.files)
    process.stdout.write(`  extracting ${key}\n`)
    await run('unzip', args)
  }
  const ofDir = path.join(CACHE, 'openfootball')
  await mkdir(ofDir, { recursive: true })
  for (const season of OPENFOOTBALL_SEASONS) {
    const slug = seasonSlug(season)
    const dest = path.join(ofDir, `${slug}.txt`)
    if (await exists(dest)) continue
    try {
      await download(`${OPENFOOTBALL_BASE}/${slug}/1-premierleague.txt`, dest)
    } catch (e) {
      process.stdout.write(`  (no results file for ${slug}: ${e.message})\n`)
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('download.mjs')) {
  ensureDatasets().then(() => console.log('datasets ready in', CACHE))
}
