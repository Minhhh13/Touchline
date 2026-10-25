import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'

let cached: LoadedUniverse | null = null

export function loadTestUniverse(leagues: string[] = ['england']): LoadedUniverse {
  if (cached && leagues.length === 1 && leagues[0] === 'england') return cached
  const root = path.resolve(__dirname, '..', '..', '..')
  const parts = leagues.map((id) => {
    const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', id, 'players.json'), 'utf8')) as PlayersFile
    const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', id, 'meta.json'), 'utf8')) as MetaFile
    // The classic pack (1992-93 to 2007-08) loads as the browser loads it: when the league has one
    const classicFile = path.join(root, 'public', 'data', id, 'players-classic.json')
    const classic = existsSync(classicFile) ? (JSON.parse(readFileSync(classicFile, 'utf8')) as PlayersFile) : undefined
    return buildLeague(players, meta, undefined, classic)
  })
  const index = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'leagues.json'), 'utf8')) as LeaguesFile
  const u = mergeUniverses(parts, index.leagues, index.generatedAt)
  if (leagues.length === 1 && leagues[0] === 'england') cached = u
  return u
}
