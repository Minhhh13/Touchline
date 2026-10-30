import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { freshTestUniverse } from '../../engine/__tests__/helpers'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import { knownWheelChances, wheelChances } from '../logic/exploreDb'
import { withClassic } from '../packs'
import { tidyUniverseNames } from '../logic/playerNames'

// QA round 11 (r14): Explore's wheel chances are kept across universes by the club-seasons they were worked out over
// (round 13, `wheelsByPool`). The browser loads leagues one at a time, adds the classic pack later, and tidies the names
// in place, so the same objects come back in many universes: a kept wheel must equal one worked out afresh in each.

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(file: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', file), 'utf8')) as T
const index = read<LeaguesFile>('leagues.json')

/** One league as `packs.ts` builds it: standard only, then (on demand) with its classic pack added to the same objects. */
function standardLeague(id: string): { u: LoadedUniverse; meta: MetaFile; header: Omit<PlayersFile, 'rows'> } {
  const players = read<PlayersFile>(`${id}/players.json`)
  const meta = read<MetaFile>(`${id}/meta.json`)
  const info = index.leagues.find((l) => l.id === id)
  return { u: buildLeague(players, meta, info), meta, header: { version: players.version, generatedAt: players.generatedAt, columns: players.columns } }
}

const merge = (parts: LoadedUniverse[]) => tidyUniverseNames(mergeUniverses(parts, index.leagues, index.generatedAt)).universe

describe('QA r14: wheel chances kept across league loads', { timeout: 60_000 }, () => {
  it('a league load, a second league, the classic pack and the name tidy all read the wheel worked out afresh', () => {
    const eng = standardLeague('england')
    const spa = standardLeague('spain')
    const engInfo = index.leagues.find((l) => l.id === 'england')
    // As the browser goes: England alone, then Spain beside it, then the Classic toggle
    const first = merge([eng.u])
    expect(knownWheelChances(first, 'england')).toBeNull()
    const engWheel = wheelChances(first, 'england')
    const both = merge([eng.u, spa.u])
    expect(knownWheelChances(both, 'england')).toBe(engWheel)
    expect(knownWheelChances(both, 'spain')).toBeNull()
    const spaWheel = wheelChances(both, 'spain')
    const full = withClassic(eng.u, eng.header, eng.meta, engInfo, read<PlayersFile>('england/players-classic.json'))
    const classic = merge([full, spa.u])
    // The standard wheel holds the same club-seasons with the classic pack loaded: kept
    expect(knownWheelChances(classic, 'england')).toBe(engWheel)
    expect(knownWheelChances(classic, 'spain')).toBe(spaWheel)
    expect(knownWheelChances(classic, 'england', true)).toBeNull()
    const classicWheel = wheelChances(classic, 'england', true)

    // Each kept wheel equals the one a never-seen universe works out (new objects, so nothing is kept)
    const fresh = freshTestUniverse(['england', 'spain'])
    expect(knownWheelChances(fresh, 'england')).toBeNull()
    expect(wheelChances(fresh, 'england')).toEqual(engWheel)
    expect(wheelChances(fresh, 'spain')).toEqual(spaWheel)
    expect(wheelChances(fresh, 'england', true)).toEqual(classicWheel)
    // And England's standard wheel on its own pack, classic-free, is the same wheel too
    const lone = freshTestUniverse(['england'])
    expect(wheelChances(lone, 'england')).toEqual(engWheel)
    // Every chance on a wheel adds up to the whole wheel
    for (const w of [engWheel, spaWheel, classicWheel]) expect([...w.values()].reduce((a, c) => a + c.p, 0)).toBeCloseTo(1, 9)
  })

  it('a wheel worked out on one universe is never handed to a universe whose club-seasons differ', () => {
    const a = freshTestUniverse(['italy'])
    const wheel = wheelChances(a, 'italy')
    // The same league with one club-season fewer (a different pool): worked out again, not kept
    const fewer: LoadedUniverse = { ...a, clubSeasons: a.clubSeasons.filter((cs) => !(cs.leagueId === 'italy' && cs.season === 2026)) }
    expect(knownWheelChances(fewer, 'italy')).toBeNull()
    const other = wheelChances(fewer, 'italy')
    expect(other).not.toBe(wheelChances(a, 'italy'))
    expect([...other.keys()].some((k) => k.endsWith('@2026'))).toBe(false)
    expect(wheel.size).toBeGreaterThan(other.size)
  })
})
