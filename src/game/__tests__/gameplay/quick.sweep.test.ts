/**
 * Gameplay sweep, Quick Draft and the Daily (run with GAMEPLAY_SWEEP=1; GAMEPLAY_N scales the seed count). Plays
 * random quick drafts in every mode combination and Dailies through the store, every match through the recorder.
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
import { useStore } from '../../store'
import { breathe, Chooser, driveDraft, driveQuickSeason, loadStore } from '../qaHarness'
import { dailySettings } from '../../logic/daily'
import { dailyGameSettings } from '../../logic/setup'
import { flag, report, setBucket, setContext, findings } from './recorder'
import { bracketChecks, venueChecks } from './gameChecks'
import { FORMATIONS_ALL, quickSettings, randomCombo, SWEEP, sweepN, writeReport } from './sweepSetup'
import type { Game } from '../../types'

const u = SWEEP ? loadTestUniverse(['england']) : (null as never)
const st = () => useStore.getState()

/** The finished quick season's own checks: its venues, its table against its results, the cups' brackets. */
function quickChecks(g: Game, label: string, stats: number[][]): void {
  const q = g.quickResult
  if (!q) {
    flag('quick-no-result', label)
    return
  }
  if (q.rounds) {
    const fixtures = q.rounds.weeks.flatMap((w, i) => {
      const out = []
      for (let k = 0; k < w.length; k += 4) out.push({ matchweek: i + 1, homeTeamId: q.rounds!.ids[w[k]], awayTeamId: q.rounds!.ids[w[k + 1]] })
      return out
    })
    venueChecks(fixtures, label)
  }
  if (q.results) {
    let pts = 0
    const weeks = new Set<number>()
    for (const r of q.results) {
      pts += r.gf > r.ga ? 3 : r.gf === r.ga ? 1 : 0
      if (weeks.has(r.matchweek)) flag('quick-matchweek-twice', `${label}: mw ${r.matchweek}`)
      weeks.add(r.matchweek)
      if (r.scorers.length !== r.gf) flag('quick-scorers-vs-goals', `${label} mw ${r.matchweek}: ${r.scorers.length} scorers for ${r.gf}`)
      for (let k = 0; k < r.scorers.length; k++) {
        const m = r.scorers[k].minute
        if (m < 1 || m > 95) flag('quick-scorer-minute', `${label} mw ${r.matchweek}: ${m}`)
        if (k && m < r.scorers[k - 1].minute) flag('quick-scorers-out-of-order', `${label} mw ${r.matchweek}`)
      }
      if (r.position < 1 || r.position > q.table.length) flag('quick-position-out-of-range', `${label}: ${r.position}`)
    }
    if (pts !== q.points) flag('quick-points-vs-results', `${label}: ${pts} vs ${q.points}`)
    if (q.results.at(-1) && q.results.at(-1)!.position !== q.position) flag('quick-last-position-vs-final', `${label}: ${q.results.at(-1)!.position} vs ${q.position}`)
  }
  for (const k of ['cup', 'continentalCup'] as const) {
    for (const t of q[k]?.ties ?? []) {
      if (t.scorers.length > t.gf) flag('quick-cup-scorers-vs-goals', `${label} ${k} ${t.round}: ${t.scorers.length} for ${t.gf}`)
      for (const sc of t.scorers) if (sc.minute < 1 || sc.minute > (t.et ? 121 : 95)) flag('quick-cup-scorer-minute', `${label} ${k} ${t.round}: ${sc.minute}${t.et ? ' (extra time)' : ''}`)
      if (t.pens && t.gf !== t.ga) flag('quick-cup-pens-after-decided', `${label} ${k} ${t.round}: ${t.gf}-${t.ga}`)
      if (t.won !== (t.gf > t.ga || (t.gf === t.ga && !!t.pens && t.pens.for > t.pens.against))) flag('quick-cup-won-vs-score', `${label} ${k} ${t.round}: ${t.gf}-${t.ga} pens ${JSON.stringify(t.pens)} won ${t.won}`)
    }
  }
  for (const k of ['cup', 'continentalCup'] as const) {
    const run = q[k]
    if (run?.bracket) bracketChecks(run.bracket, `${label} ${k}`)
  }
  const champion = [...q.table].sort((a, b) => b.points - a.points)[0]
  stats.push([q.points, q.won, q.position, champion.points, q.goalsFor, q.goalsAgainst])
}

describe.runIf(SWEEP)('gameplay sweep: Quick Draft', () => {
  const n = sweepN(60)
  for (let batch = 0; batch < 4; batch++) {
    it(`quick drafts batch ${batch}`, async () => {
      setBucket('quick')
      const stats: number[][] = []
      for (let i = 0; i < n; i++) {
        await breathe()
        await breathe()
      const seed = `gp-quick-${batch}-${i}`
        const ch = new Chooser(seed)
        const combo = randomCombo(ch)
        setContext(`${seed} ${combo.modes.join('+') || 'plain'} ${combo.difficulty}`)
        loadStore(u, ['england'])
        try {
          st().startGame(quickSettings(u, seed, combo, ch.pick(FORMATIONS_ALL)))
          const log = driveDraft(u, ch, { powerUps: true, autoAt: ch.chance(0.5) ? ch.int(0, 10) : undefined })
          for (const p of log.problems) flag('qa-draft', p)
          for (const p of driveQuickSeason(u, ch)) flag('qa-quick-season', p)
          const g = st().game
          if (g) {
            if (g.quickResult && g.quickResult.cup === undefined && ch.chance(0.7)) await st().playCup('cup')
            if (st().game?.quickResult && st().game!.quickResult!.continentalCup === undefined && ch.chance(0.7)) await st().playCup('continental')
            useStore.setState({ toast: null })
            quickChecks(st().game!, seed, stats)
          }
        } catch (e) {
          flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
        }
      }
      writeReport(`quick-${batch}`, report(), { stats })
      expect(findings.has('threw')).toBe(false)
    }, 1_800_000)
  }
  it('dailies', async () => {
    setBucket('daily')
    const stats: number[][] = []
    for (let i = 0; i < sweepN(60); i++) {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      await breathe()
      const seed = `daily-${day}`
      const ch = new Chooser(seed)
      setContext(seed)
      loadStore(u, ['england'])
      try {
        void dailySettings
        st().startGame(dailyGameSettings(u, seed, 'QA Daily'))
        const log = driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 10) : undefined })
        for (const p of log.problems) flag('qa-draft', p)
        for (const p of driveQuickSeason(u, ch)) flag('qa-quick-season', p)
        if (st().game) quickChecks(st().game!, seed, stats)
      } catch (e) {
        flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
      }
    }
    writeReport('daily', report(), { stats })
  }, 1_800_000)
})
