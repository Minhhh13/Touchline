import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { MetaFile } from '../universe'

/**
 * The classic loader (scripts/import/historic/index.mjs) is deterministic: two
 * runs on the committed facts give identical records. It needs the European
 * Soccer Database from the dataset cache, so it is skipped where that cache
 * is absent (CI); the committed pack is checked by classicPack.test.ts.
 */
const root = path.resolve(__dirname, '..', '..', '..')
const cache = process.env.DATA_CACHE || path.join(root, '.cache', 'datasets')
const esdFile = path.join(cache, 'eurosoccer', 'database.sqlite')

interface Loader {
  loadHistoric: (league: string, opts: Record<string, unknown>) => { records: Array<{ id: string; season: number; club: string; overall: number }> }
}
interface Ratings {
  backProject: (x: number, age: number, gap: number) => number
  adjustClub: (rows: Array<{ raw: number; team: number; p: Record<string, unknown>; adj?: number }>) => Array<{ raw: number; adj?: number }>
}

describe('classic loader', () => {
  it('keeps the order inside a club through the star adjustment and steps the age curve back one season at a time', async () => {
    const r = (await import(pathToFileURL(path.join(root, 'scripts', 'import', 'historic', 'ratings.mjs')).href)) as Ratings
    // a champion: a big positive team term; a relegated club: a negative one
    for (const team of [6, -3]) {
      const rows = Array.from({ length: 25 }, (_, i) => ({ raw: 84 - i * 0.7, team, p: { links: 20, caps: 0 } }))
      const adj = r.adjustClub(rows).map((x) => x.adj ?? 0)
      for (let i = 1; i < adj.length; i++) expect(adj[i]).toBeLessThan(adj[i - 1])
      // the three stars keep a strong club's context; the regulars lose it
      if (team > 0) { expect(adj[0]).toBeCloseTo(84, 5); expect(adj[20]).toBeCloseTo(rows[20].raw - team, 5) }
    }
    expect(r.backProject(80, 25, 0)).toBe(80)
    expect(r.backProject(r.backProject(80, 26, 1), 25, 1)).toBeCloseTo(r.backProject(80, 25, 2), 10)
  })

  it.skipIf(!existsSync(esdFile))('gives identical records on two runs over the committed facts', async () => {
    const loader = (await import(pathToFileURL(path.join(root, 'scripts', 'import', 'historic', 'index.mjs')).href)) as Loader
    const { TEMPLATES } = (await import(pathToFileURL(path.join(root, 'scripts', 'import', 'historic', 'attributes.mjs')).href)) as { TEMPLATES: unknown }
    const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'meta.json'), 'utf8')) as MetaFile
    const tables = Object.fromEntries(meta.seasons.filter((s) => s.classic).map((s) => [s.season, { table: s.table, complete: s.complete }]))
    const unit = (s: string, salt: number) => { let h = salt; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return (h % 100000) / 100000 }
    const helpers = { deriveAttributes: () => ({ pace: 60, shooting: 60, passing: 60, dribbling: 60, defending: 60, physical: 60, mentality: 60, goalkeeping: 10 }), traitsFor: () => [50, 50, 50, 50], modelValue: (o: number) => o / 10, modelWage: (v: number) => v, unit, shortName: (n: string) => n }
    const run = () => {
      const db = new DatabaseSync(esdFile, { readOnly: true })
      const out = loader.loadHistoric('england', { tables, db, sofifaIndex: new Map(), ranges: {}, helpers, templates: TEMPLATES })
      db.close()
      return out.records
    }
    const a = run()
    expect(a.length).toBeGreaterThan(8000)
    expect(run()).toEqual(a)
  }, 600_000)
})
