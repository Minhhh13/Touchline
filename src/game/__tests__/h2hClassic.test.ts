import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { getFormation } from '@engine/formations'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '@engine/h2h'
import { buildLeague, mergeUniverses, type LeaguesFile, type LoadedUniverse, type MetaFile, type PlayersFile } from '@engine/universe'
import type { DraftRules } from '@engine/draft'
import { h2hRules, runH2HSeason, type H2HManager } from '../logic/h2h'
import { h2hNeedsClassic, h2hRulesFor, h2hSeasonChoices } from '../logic/h2hClassic'

/**
 * Classic seasons in a hot-seat head-to-head are opt-in: with the toggle off a seeded head-to-head is the same, byte
 * for byte, as before the toggle existed (pinned to hashes taken from release-e6 at 4899025), on England's standard
 * pack alone and with the classic pack loaded beside it. With it on, the wheel never runs dry.
 */

const root = path.resolve(__dirname, '..', '..', '..')
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, 'public', 'data', rel), 'utf8')) as T

function standardOnly(): LoadedUniverse {
  const players = read<PlayersFile>('england/players.json')
  const meta = read<MetaFile>('england/meta.json')
  const index = read<LeaguesFile>('leagues.json')
  return mergeUniverses([buildLeague(players, { ...meta, seasons: meta.seasons.filter((s) => !s.classic) })], index.leagues, index.generatedAt)
}

const standard = standardOnly()
const full = loadTestUniverse()
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

const managers: [H2HManager, H2HManager] = [
  { name: 'Ana', shortName: 'ANA', formationId: '4-3-3', hostClubId: 'everton' },
  { name: 'Ben', shortName: 'BEN', formationId: '4-4-2', hostClubId: 'fulham' },
]

/** A whole hot-seat head-to-head as the store plays it: one seeded stream for the spins, the assistant picking for both, then the season. */
function play(u: LoadedUniverse, seed: string, rules: DraftRules, leagueSeason = 2024, season = true, sides = managers) {
  const rng = new Rng(seed)
  const h = newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], rules)
  let guard = 0
  while (!h2hComplete(h) && guard++ < 200) {
    if (h.picking === null) h2hSpin(u, h, rng)
    else h2hAutoPick(u, h)
  }
  const result = season ? runH2HSeason(u, rng, sides, h.drafts, 'england', leagueSeason, 'calibrated') : null
  return { h, result, rng: rng.getState() }
}

const SEEDS = Array.from({ length: 24 }, (_, i) => `h2h-classic-off-${i}`)

describe('head-to-head classic seasons', () => {
  it('a classic-off draft keeps the rules object it had: no classic key', () => {
    expect(h2hRulesFor(['england'], false, false)).toEqual(h2hRules(['england'], false))
    expect('classic' in h2hRulesFor(['england'], true, false)).toBe(false)
    expect(h2hRulesFor(['england'], false, true).classic).toBe(true)
  })

  it('toggle off: every seeded head-to-head is byte-identical to release-e6, with or without the classic pack loaded', () => {
    const before = SEEDS.map((s) => hash(play(standard, s, h2hRules(['england'], false))))
    const offStandard = SEEDS.map((s) => hash(play(standard, s, h2hRulesFor(['england'], false, false))))
    const offFull = SEEDS.map((s) => hash(play(full, s, h2hRulesFor(['england'], false, false))))
    expect(offStandard).toEqual(before)
    expect(offFull).toEqual(before)
    expect(hash(before)).toBe('2dc6b050f1be3d1aa8c2ad632812df3fdd7cff84e2b99692ad1c96ff67b451bf')
  }, 180_000)

  it('toggle off: 100 more seeded drafts, normal and hard mode, match release-e6 with the classic pack loaded', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => `h2h-classic-draft-${i}`)
    const draftOf = (u: LoadedUniverse, rules: DraftRules) => seeds.map((s) => hash(play(u, s, rules, 2024, false)))
    expect(draftOf(full, h2hRulesFor(['england'], false, false))).toEqual(draftOf(standard, h2hRules(['england'], false)))
    const hard = draftOf(full, h2hRulesFor(['england'], true, false))
    expect(hard).toEqual(draftOf(standard, h2hRules(['england'], true)))
    expect(hash(hard)).toBe('cb027158b98cfe9b8abde5fc391906c6f859c569c34b7688568acabe3b09bc65')
  }, 180_000)

  it('toggle off: the season picker offers no classic season', () => {
    const off = h2hSeasonChoices(full, 'england', false)
    expect(off.some((c) => c.classic || c.season < full.firstSeason)).toBe(false)
    expect(off.map((c) => c.season)).toEqual(h2hSeasonChoices(standard, 'england', false).map((c) => c.season))
    const on = h2hSeasonChoices(full, 'england', true)
    expect(on[0]).toEqual({ season: 1992, classic: true })
    expect(on.filter((c) => c.classic).length).toBe(16)
  })

  it('toggle on: 200 seeded drafts complete without the wheel running dry, and classic sides come up', () => {
    let classicSpins = 0
    for (let i = 0; i < 200; i++) {
      const { h } = play(full, `h2h-classic-on-${i}`, h2hRulesFor(['england'], i % 3 === 0, true), 2024, false)
      expect(h2hComplete(h)).toBe(true)
      classicSpins += h.drafts[0].usedClubSeasons.filter((k) => full.clubSeasonByKey[k]?.classic).length
    }
    expect(classicSpins).toBeGreaterThan(200)
  }, 180_000)

  it('toggle on: a classic league season (22 clubs, 42 games) plays through', () => {
    const { result } = play(full, 'h2h-classic-1993', h2hRulesFor(['england'], false, true), 1993, true, [managers[0], { ...managers[1], hostClubId: 'chelsea' }])
    expect(result!.table.length).toBe(22)
    expect(result!.rows[0].played).toBe(42)
    expect(result!.results![0].length).toBe(42)
  }, 60_000)

  it('the store knows to load the classic pack for a classic head-to-head only', () => {
    const draft = (classic: boolean) => ({ draft: newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], h2hRulesFor(['england'], false, classic)) })
    expect(h2hNeedsClassic(draft(true))).toBe(true)
    expect(h2hNeedsClassic(draft(false))).toBe(false)
    expect(h2hNeedsClassic(null)).toBe(false)
  })
})
