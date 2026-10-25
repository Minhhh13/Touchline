/**
 * Download every dataset into the cache directory (idempotent).
 *   node scripts/import/download.mjs
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CACHE, SOURCES, OPENFOOTBALL_BASE, openfootballSeasons, openfootballPath, seasonSlug } from './config.mjs'
import { LEAGUES } from './leagues.mjs'

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
  if (!res.ok) {
    const err = new Error(`${url} -> HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
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
  for (const league of Object.values(LEAGUES)) {
    if (!league.openfootball) continue
    const ofDir = path.join(CACHE, 'openfootball', league.id)
    await mkdir(ofDir, { recursive: true })
    for (const season of openfootballSeasons(league)) {
      const slug = seasonSlug(season)
      const dest = path.join(ofDir, `${slug}.txt`)
      const missing = path.join(ofDir, `${slug}.missing`)
      if ((await exists(dest)) || (await exists(missing))) continue
      try {
        await download(`${OPENFOOTBALL_BASE}/${league.openfootball.repo}/master/${openfootballPath(season)}/${league.openfootball.file}`, dest)
      } catch (e) {
        // Only a season that really is not published is remembered as missing; a network blip is retried next run
        if (e.status === 404) await writeFile(missing, String(e.message))
        else throw e
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('download.mjs')) {
  ensureDatasets().then(() => console.log('datasets ready in', CACHE))
}
