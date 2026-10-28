/**
 * QA round 3 (r8): every club page and every league page of Explore, in all seven leagues, with the classic seasons
 * loaded (England's 1992-93 to 2007-08, clubs that only ever played then) and without: none throws, none prints NaN
 * or undefined, and the markup passes the QA checks. Compare is tried on pairs across leagues and eras.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import { ClubView, CompareView, LeagueView } from '../screens/ExploreViews'
import { markupProblems, show } from './qaSsr'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const noop = () => {}

/** The packs as a browser loads them before anything opts into the classic seasons. */
function withoutClassic(): LoadedUniverse {
  const root = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
  const read = <T,>(...p: string[]) => JSON.parse(readFileSync(path.join(root, ...p), 'utf8')) as T
  const index = read<LeaguesFile>('leagues.json')
  return mergeUniverses(ALL.map((id) => buildLeague(read<PlayersFile>(id, 'players.json'), read<MetaFile>(id, 'meta.json'))), index.leagues, index.generatedAt)
}

function sweep(classic: boolean): string[] {
  const u = classic ? loadTestUniverse(ALL) : withoutClassic()
  if (!classic && u.clubSeasons.some((cs) => cs.classic)) return ['the no-classic universe holds classic seasons']
  show({ universe: u, loadedLeagues: ALL, classicLoaded: classic, game: null, screen: 'explore' })
  const fails: string[] = []
  const render = (label: string, el: ReturnType<typeof createElement>) => {
    try {
      for (const p of markupProblems(renderToString(el))) fails.push(`${label}: ${p}`)
    } catch (e) {
      fails.push(`${label} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
    }
  }
  for (const l of u.available) {
    render(`league ${l.id}`, createElement(LeagueView, { leagueId: l.id, onClub: noop, onPlayer: noop }))
    const clubs = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === l.id).map((cs) => cs.clubId))]
    for (const c of clubs) render(`club ${l.id}/${c}`, createElement(ClubView, { leagueId: l.id, clubId: c, onClub: noop, onPlayer: noop }))
  }
  // Compare: a player from each league's first and last season, side by side in pairs
  const ids = u.available.flatMap((l) => {
    const css = u.clubSeasons.filter((cs) => cs.leagueId === l.id)
    return [css[0]?.squad[0]?.playerId, css.at(-1)?.squad.at(-1)?.playerId].filter((x): x is string => !!x)
  })
  for (let i = 0; i + 1 < ids.length; i++) render(`compare ${ids[i]} ${ids[i + 1]}`, createElement(CompareView, { ids: [ids[i], ids[i + 1]], setIds: noop, onPlayer: noop }))
  render('compare none', createElement(CompareView, { ids: [], setIds: noop, onPlayer: noop }))
  render('compare unknown', createElement(CompareView, { ids: ['nobody-at-all', ids[0]], setIds: noop, onPlayer: noop }))
  return [...new Set(fails)]
}

describe('QA r8: every Explore club and league page renders', () => {
  it('with the classic seasons', () => expect(sweep(true).slice(0, 10)).toEqual([]), 600_000)
  it('without them', () => expect(sweep(false).slice(0, 10)).toEqual([]), 600_000)
})
