/**
 * The stamp guard: one data stamp (`generatedAt`) names exactly one set of pack bytes. The online layer archives
 * packs by their stamp the first time the live site serves them and verifies ranked runs against that archive, so a
 * rebuild that changes the bytes under an existing stamp would make the archive and the live site disagree.
 *
 * packHashes.json records the SHA-256 of every file in public/data per stamp. After a rebuild (which takes a new
 * stamp: a new day, or DATA_STAMP_SUFFIX for a second rebuild the same day) record it with
 *   UPDATE_PACK_HASHES=1 npx vitest run src/online/__tests__/stamps.test.ts
 * and commit the JSON with the packs.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const DATA = path.join(ROOT, 'public', 'data')
const RECORD = path.join(__dirname, 'packHashes.json')
const COMMAND = 'UPDATE_PACK_HASHES=1 npx vitest run src/online/__tests__/stamps.test.ts'

function packFiles(dir = DATA): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = path.join(dir, name)
      return statSync(p).isDirectory() ? packFiles(p) : name.endsWith('.json') ? [path.relative(DATA, p).split(path.sep).join('/')] : []
    })
    .sort()
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(path.join(DATA, file))).digest('hex')

type Record_ = Record<string, Record<string, string>>

describe('data stamps', () => {
  const index = JSON.parse(readFileSync(path.join(DATA, 'leagues.json'), 'utf8')) as { generatedAt: string; leagues: Array<{ id: string }> }
  const stamp = index.generatedAt

  it('is the same stamp in leagues.json and every players.json, and a shape the pack archive accepts', () => {
    expect(stamp).toMatch(/^[0-9A-Za-z._:-]{1,40}$/)
    for (const l of index.leagues) {
      const players = JSON.parse(readFileSync(path.join(DATA, l.id, 'players.json'), 'utf8')) as { generatedAt: string }
      expect(players.generatedAt, `${l.id}/players.json`).toBe(stamp)
    }
  })

  it('names one set of bytes per stamp', () => {
    const current = Object.fromEntries(packFiles().map((f) => [f, sha256(f)]))
    const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record_
    if (process.env.UPDATE_PACK_HASHES === '1') {
      record[stamp] = current
      const sorted = Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]))
      writeFileSync(RECORD, `${JSON.stringify(sorted, null, 2)}\n`)
      return
    }
    const known = record[stamp]
    if (!known) throw new Error(`No recorded hashes for data stamp ${stamp}. After a rebuild, run: ${COMMAND} and commit packHashes.json`)
    const changed = [...new Set([...Object.keys(known), ...Object.keys(current)])].filter((f) => known[f] !== current[f])
    if (changed.length) {
      throw new Error(`Pack bytes changed under the existing data stamp ${stamp} (${changed.join(', ')}). Rebuild with a new stamp (a new UTC day, or DATA_STAMP_SUFFIX=2 node scripts/import/build.mjs), then run: ${COMMAND}`)
    }
  })
})
