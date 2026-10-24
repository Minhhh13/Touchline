import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLeague, mergeUniverses, type LoadedUniverse, type MetaFile, type PlayersFile } from '../universe'

let cached: LoadedUniverse | null = null

export function loadTestUniverse(leagues: string[] = ['england']): LoadedUniverse {
  if (cached && leagues.length === 1 && leagues[0] === 'england') return cached
  const root = path.resolve(__dirname, '..', '..', '..')
  const parts = leagues.map((id) => {
    const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', id, 'players.json'), 'utf8')) as PlayersFile
    const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', id, 'meta.json'), 'utf8')) as MetaFile
    return buildLeague(players, meta)
  })
  const available = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'leagues.json'), 'utf8')).leagues
  const u = mergeUniverses(parts, available)
  if (leagues.length === 1 && leagues[0] === 'england') cached = u
  return u
}
