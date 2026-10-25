import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from './helpers'
import { bannedIn } from './banned'
import type { LeaguesFile, MetaFile } from '../universe'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'leagues.json'), 'utf8')) as LeaguesFile
const ALL = index.leagues.map((l) => l.id)

/** The display name each league carries in the packs: neutral, by country. */
const DISPLAY: Record<string, string> = {
  england: 'English League',
  spain: 'Spanish League',
  italy: 'Italian League',
  germany: 'German League',
  france: 'French League',
  netherlands: 'Dutch League',
  portugal: 'Portuguese League',
}

describe('neutral league names in the packs', () => {
  it('ships the seven leagues in their fixed order', () => {
    expect(ALL).toEqual(['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'])
  })

  it('names every league by its country in leagues.json, each meta.json and the loaded universe', () => {
    const u = loadTestUniverse(ALL)
    for (const id of ALL) {
      const meta = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', id, 'meta.json'), 'utf8')) as MetaFile
      expect(meta.league.name).toBe(DISPLAY[id])
      expect(index.leagues.find((l) => l.id === id)?.name).toBe(DISPLAY[id])
      expect(u.leagues.find((l) => l.id === id)?.name).toBe(DISPLAY[id])
    }
  })

  it('carries no real competition name in any league name or short name', () => {
    const u = loadTestUniverse(ALL)
    for (const id of ALL) {
      const meta = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', id, 'meta.json'), 'utf8')) as MetaFile
      const texts = [meta.league.name, meta.league.shortName, meta.league.country ?? '']
      const listed = index.leagues.find((l) => l.id === id)!
      texts.push(listed.name, listed.shortName, listed.country)
      const loaded = u.leagues.find((l) => l.id === id)!
      texts.push(loaded.name, loaded.shortName)
      for (const t of texts) expect(bannedIn(t), `${id}: "${t}"`).toEqual([])
    }
  })
})
