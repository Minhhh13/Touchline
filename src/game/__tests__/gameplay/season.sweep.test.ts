/**
 * Gameplay sweep, Season and Dynasty (run with GAMEPLAY_SWEEP=1; GAMEPLAY_N scales the seed count). A random manager
 * works the store week by week; every match goes through the recorder and every state the store takes is checked.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
vi.mock('@engine/match', async (importOriginal) => {
  const m = await importOriginal<typeof import('@engine/match')>()
  const r = await import('./recorder')
  return { ...m, ...r.wrap(m) }
})
import { loadTestUniverse } from '../../../engine/__tests__/helpers'
import { seasonTable } from '@engine/season'
import { useStore } from '../../store'
import type { Game, Mode } from '../../types'
import { breathe, Chooser, driveDraft, loadStore } from '../qaHarness'
import { driveSeason } from '../qaSeasonHarness'
import { findings, flag, report, setBucket, setContext } from './recorder'
import { awardChecks, cupChecks, DynastyWatch, squadChecks, venueChecks } from './gameChecks'
import { managedSettings, SWEEP, sweepN, writeReport } from './sweepSetup'

const u = SWEEP ? loadTestUniverse(['england']) : (null as never)
const st = () => useStore.getState()

/** Checks on every store state: the squad each matchweek, the season's fixtures and cups and awards at its summary. */
function watch(label: string, stats: number[][]): () => void {
  let lastKey = ''
  let checkedSeason = ''
  const dyn = new DynastyWatch()
  return useStore.subscribe((s) => {
    const g: Game | null = s.game
    if (!g || g.phase === 'draft') return
    const key = `${g.year}:${g.phase}:${g.season?.matchweek}`
    if (key === lastKey) return
    lastKey = key
    const at = `${label} y${g.year} ${g.phase} mw${g.season?.matchweek}`
    setContext(at)
    squadChecks(g, u, at)
    if (g.phase === 'preseason' && g.season?.matchweek === 0) {
      dyn.check(g, u, at)
      venueChecks(g.season.fixtures, at)
    }
    if (g.phase === 'summary' && g.season && checkedSeason !== `${g.year}`) {
      checkedSeason = `${g.year}`
      awardChecks(g, at)
      cupChecks(g.season.cup, `${at} cup`)
      if (g.season.continental) cupChecks(g.season.continental.ties, `${at} continental`)
      if (!g.season.sacked) {
        const table = seasonTable(g.season)
        const me = table.findIndex((r) => r.teamId === 'user')
        stats.push([table[0].points, table[me].points, me + 1, table.at(-1)!.points, g.season.matchweeks])
        for (const r of table) if (r.played !== g.season.matchweeks) flag('table-played-short', `${at}: ${r.teamId} ${r.played}/${g.season.matchweeks}`)
      }
    }
  })
}

async function play(mode: Mode, seed: string, years: number, stats: number[][]): Promise<void> {
  const ch = new Chooser(seed)
  loadStore(u, ['england'])
  st().startGame(managedSettings(u, mode, seed, ch))
  setContext(seed)
  const stop = watch(seed, stats)
  try {
    const draft = (label: string) => driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 14) : undefined }).problems.map((p) => `${label}: ${p}`)
    for (const p of draft('draft')) flag('qa-draft', `${seed}: ${p}`)
    const run = driveSeason(u, ch, { years, draft, simBias: 6 })
    for (const p of run.problems) flag('qa-season', `${seed}: ${p}`)
    if (mode === 'dynasty' && run.seasons < years + 1 && !st().game?.season?.sacked) flag('dynasty-short', `${seed}: ${run.seasons} seasons`)
  } finally {
    stop()
  }
}

describe.runIf(SWEEP)('gameplay sweep: managed seasons', () => {
  for (let batch = 0; batch < 3; batch++) {
    it(`seasons batch ${batch}`, async () => {
      setBucket('season')
      const stats: number[][] = []
      for (let i = 0; i < sweepN(12); i++) {
        await breathe()
        await breathe()
      const seed = `gp-season-${batch}-${i}`
        try {
          await play('season', seed, 0, stats)
        } catch (e) {
          flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
        }
      }
      writeReport(`season-${batch}`, report(), { stats })
      expect(findings.has('threw')).toBe(false)
    }, 3_600_000)
  }
  for (let batch = 0; batch < 2; batch++) {
    it(`dynasties batch ${batch}, five seasons each`, async () => {
      setBucket('dynasty')
      const stats: number[][] = []
      for (let i = 0; i < sweepN(4); i++) {
        await breathe()
        await breathe()
      const seed = `gp-dynasty-${batch}-${i}`
        try {
          await play('dynasty', seed, 4, stats)
        } catch (e) {
          flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
        }
      }
      writeReport(`dynasty-${batch}`, report(), { stats })
      expect(findings.has('threw')).toBe(false)
    }, 3_600_000)
  }
})
