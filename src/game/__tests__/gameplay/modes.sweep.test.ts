/**
 * Gameplay sweep, the arena formats, the Run-in and head-to-head (run with GAMEPLAY_SWEEP=1; GAMEPLAY_N scales the
 * seed count). Every match goes through the recorder; the arena's bracket and ladder and the run-in's table are checked.
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
import { h2hComplete, h2hEligibleSlots, h2hUsable } from '@engine/h2h'
import { runInCatalogue, suggestRunIns, type RunInTemplate } from '@engine/scenario'
import { seasonTable, USER_TEAM } from '@engine/season'
import { cupGameSettings, finalGameSettings, gauntletGameSettings, type ArenaChoices } from '../../logic/arena'
import { runInGameSettings } from '../../logic/runin'
import { useStore } from '../../store'
import type { Game } from '../../types'
import { breathe, Chooser, driveDraft, loadStore } from '../qaHarness'
import { driveArena, driveSeason } from '../qaSeasonHarness'
import { findings, flag, report, setBucket, setContext } from './recorder'
import { cupChecks, squadChecks, venueChecks } from './gameChecks'
import { SWEEP, sweepN, writeReport } from './sweepSetup'

const u = SWEEP ? loadTestUniverse(['england']) : (null as never)
const st = () => useStore.getState()

function arenaChoices(seed: string, ch: Chooser): ArenaChoices {
  return { teamName: 'QA Arena', formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']), field: ch.pick(['giants', 'wheel', 'decade', 'champions'] as const), wheelLeagues: ['england'], difficulty: ch.pick(['calibrated', 'realistic'] as const), seed, hardMode: ch.chance(0.2), twists: ch.chance(0.5), ...(ch.chance(0.2) ? { capXI: ch.pick([180, 250]) } : {}), decade: ch.pick([2010, 2020]) }
}

/** The arena's own record: steps that add up, the bracket's rounds, the ladder climbed in order. */
function arenaChecks(g: Game, label: string, stats: number[][]): void {
  const a = g.arena
  if (!a) return
  for (const s of a.log) {
    if (s.gf < 0 || s.ga < 0 || s.gf > 12 || s.ga > 12) flag('arena-impossible-score', `${label}: ${s.gf}-${s.ga}`)
    if (s.pens && s.gf !== s.ga) flag('arena-pens-after-decided-tie', `${label}: ${s.gf}-${s.ga}`)
    if (s.pens && s.pens.us === s.pens.them) flag('arena-drawn-shootout', label)
  }
  const losses = a.log.filter((s) => s.gf < s.ga || (s.gf === s.ga && s.pens && s.pens.us < s.pens.them))
  if (losses.length > 1) flag('arena-played-on-after-defeat', `${label}: ${losses.length} defeats`)
  if (losses.length === 1 && a.log.indexOf(losses[0]) !== a.log.length - 1) flag('arena-step-after-defeat', label)
  if (a.bracket) {
    for (let r = 0; r < a.bracket.rounds.length; r++) {
      const ties = a.bracket.rounds[r]
      if (r > 0 && ties.length * 2 !== a.bracket.rounds[r - 1].length) flag('arena-bracket-round-size', `${label}: round ${r} ${ties.length} after ${a.bracket.rounds[r - 1].length}`)
      if (r > 0) {
        const winners = new Set(a.bracket.rounds[r - 1].map((t) => t.winner))
        for (const t of ties) for (const side of [t.home, t.away]) if (!winners.has(side)) flag('arena-bracket-side-not-a-winner', `${label}: ${side} in round ${r}`)
      }
      for (const t of ties) {
        if (!t.winner || t.hg === undefined || t.ag === undefined) continue
        const h = t.hg + (t.pens?.home ?? 0) / 100
        const aw = t.ag + (t.pens?.away ?? 0) / 100
        if ((h > aw ? t.home : aw > h ? t.away : null) !== t.winner) flag('arena-bracket-winner-vs-score', `${label}: ${t.home} ${t.hg}-${t.ag} ${t.away} pens ${JSON.stringify(t.pens)} -> ${t.winner}`)
        if (t.pens && t.hg !== t.ag) flag('arena-bracket-pens-after-decided', label)
      }
    }
    if (a.over && a.bracket.winner === undefined) flag('arena-bracket-no-winner', label)
    const userTies = a.bracket.rounds.flat().filter((t) => (t.home === USER_TEAM || t.away === USER_TEAM) && t.winner !== undefined)
    if (userTies.length !== a.log.length) flag('arena-bracket-vs-log', `${label}: ${userTies.length} ties, ${a.log.length} steps`)
  }
  if (a.ladder) {
    const opp = a.log.map((s) => s.opponent)
    if (new Set(opp).size !== opp.length) flag('gauntlet-same-opponent-twice', `${label}: ${opp.join(',')}`)
  }
  stats.push([a.log.length, a.won ? 1 : 0, a.log.reduce((t, s) => t + s.gf, 0), a.log.reduce((t, s) => t + s.ga, 0)])
}

describe.runIf(SWEEP)('gameplay sweep: casual modes', () => {
  for (const format of ['final', 'cup', 'gauntlet'] as const) {
    it(`arena ${format}`, async () => {
      setBucket(`arena-${format}`)
      const stats: number[][] = []
      for (let i = 0; i < sweepN(40); i++) {
        await breathe()
        await breathe()
      const seed = `gp-arena-${format}-${i}`
        const ch = new Chooser(seed)
        setContext(seed)
        loadStore(u, ['england'])
        const c = arenaChoices(seed, ch)
        try {
          st().startGame(format === 'final' ? finalGameSettings(u, c, 'QAA') : format === 'cup' ? cupGameSettings(u, { ...c, size: ch.pick([8, 16, 32] as const) }, 'QAA') : gauntletGameSettings(u, c, 'QAA'))
          for (const p of driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 15) : undefined }).problems) flag('qa-draft', `${seed}: ${p}`)
          for (const p of driveArena(u, ch)) flag('qa-arena', `${seed}: ${p}`)
          const g = st().game!
          squadChecks(g, u, seed)
          arenaChecks(g, seed, stats)
        } catch (e) {
          flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
        }
      }
      writeReport(`arena-${format}`, report(), { stats })
      expect(findings.has('threw')).toBe(false)
    }, 3_600_000)
  }

  it('run-ins', async () => {
    setBucket('runin')
    const stats: number[][] = []
    for (let i = 0; i < sweepN(40); i++) {
      await breathe()
      const seed = `gp-runin-${i}`
      const ch = new Chooser(seed)
      setContext(seed)
      loadStore(u, ['england'])
      const template = ch.pick(['title', 'europe', 'survival'] as RunInTemplate[])
      const jobs = runInCatalogue(u, template).filter((j) => j.leagueId === 'england')
      const job = ch.chance(0.5) ? suggestRunIns(jobs, seed)[0] : ch.pick(jobs)
      try {
        st().startGame(runInGameSettings(u, job, { seed, formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2']) }))
        for (const p of driveDraft(u, ch, {}).problems) flag('qa-draft', `${seed}: ${p}`)
        const g0 = st().game!
        if (g0.season) venueChecks(g0.season.fixtures, `${seed} run-in`, g0.season.takeoverAt ?? 0, false)
        for (const p of driveSeason(u, ch, { draft: () => ['a second draft in a run-in'], simBias: 3 }).problems) flag('qa-season', `${seed}: ${p}`)
        const g = st().game!
        squadChecks(g, u, seed)
        if (g.season) {
          cupChecks(g.season.cup, `${seed} cup`)
          const t = seasonTable(g.season)
          const me = t.findIndex((r) => r.teamId === USER_TEAM)
          stats.push([me + 1, t[me].points, template === 'title' ? 0 : template === 'europe' ? 1 : 2])
          for (const r of t) if (r.played !== g.season.matchweeks && !g.season.sacked) flag('runin-played-short', `${seed}: ${r.teamId} ${r.played}`)
        }
      } catch (e) {
        flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
      }
    }
    writeReport('runin', report(), { stats })
    expect(findings.has('threw')).toBe(false)
  }, 3_600_000)

  it('head-to-head', async () => {
    setBucket('h2h')
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2024).map((cs) => cs.clubId)
    for (let i = 0; i < sweepN(40); i++) {
      await breathe()
      const seed = `gp-h2h-${i}`
      const ch = new Chooser(seed)
      setContext(seed)
      loadStore(u, ['england'])
      try {
        const host0 = ch.pick(clubs)
        const host1 = ch.pick(clubs.filter((c) => c !== host0))
        st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: ch.pick(['4-3-3', '4-4-2']), hostClubId: host0 }, { name: 'Bob', shortName: 'BOB', formationId: ch.pick(['3-5-2', '4-2-3-1']), hostClubId: host1 }], 'england', ['england'], 2024, ch.pick(['calibrated', 'realistic'] as const), ch.chance(0.2), seed)
        for (let step = 0; step < 300 && !h2hComplete(st().h2h!.draft); step++) {
          const h = st().h2h!
          if (h.draft.picking === null) st().h2hSpin()
          else if (ch.chance(0.5)) st().h2hAuto()
          else {
            const options = h2hUsable(u, h.draft).flatMap((p) => h2hEligibleSlots(h.draft, p).map((s) => ({ id: p.id, slot: s.id })))
            if (!options.length) st().h2hAuto()
            else {
              const o = ch.pick(options)
              st().h2hPick(o.id, o.slot)
            }
          }
          if (st().toast) useStore.setState({ toast: null })
        }
        st().h2hFinish()
        const r = st().h2h!.result
        if (!r) flag('h2h-no-result', seed)
      } catch (e) {
        flag('threw', `${seed}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
      }
    }
    writeReport('h2h', report(), {})
    expect(findings.has('threw')).toBe(false)
  }, 3_600_000)
})
