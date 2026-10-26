import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { h2hComplete, h2hEligibleSlots, h2hUsable } from '@engine/h2h'
import { runInCatalogue, suggestRunIns, type RunInTemplate } from '@engine/scenario'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { cupGameSettings, finalGameSettings, gauntletGameSettings, stepWon, type ArenaChoices } from '../logic/arena'
import { runInGameSettings } from '../logic/runin'
import { dailySettings } from '../logic/daily'
import { dailyGameSettings } from '../logic/setup'
import { arenaChallengeFromGame, challengeFromGame, replayChallenge } from '../logic/challenge'
import { useStore } from '../store'
import { badValues, breathe, QA_FULL, seeds, Chooser, coverage, driveDraft, driveQuickSeason, expectReloadSame, loadStore, squadProblems, tableProblems } from './qaHarness'
import { driveArena, driveSeason } from './qaSeasonHarness'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

function arenaChoices(seed: string, ch: Chooser): ArenaChoices {
  return { teamName: 'QA Arena', formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']), field: ch.pick(['giants', 'wheel', 'decade', 'champions'] as const), wheelLeagues: ['england'], difficulty: ch.pick(['calibrated', 'realistic'] as const), seed, hardMode: ch.chance(0.2), twists: ch.chance(0.5), ...(ch.chance(0.2) ? { capXI: ch.pick([180, 250]) } : {}), decade: ch.pick([2010, 2020]) }
}

describe('QA: the arena through the store', () => {
  for (const format of ['final', 'cup', 'gauntlet'] as const) {
    it(`plays random ${format} runs to the summary and files each once`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(12); i++) {
      await breathe()
        const seed = `qa-arena-${format}-${i}`
        const ch = new Chooser(seed)
        loadStore(u, ['england'])
        const c = arenaChoices(seed, ch)
        const s = format === 'final' ? finalGameSettings(u, c, 'QAA') : format === 'cup' ? cupGameSettings(u, { ...c, size: ch.pick([8, 16, 32] as const) }, 'QAA') : gauntletGameSettings(u, c, 'QAA')
        try {
          st().startGame(s)
          const problems = driveDraft(u, ch, { autoAt: ch.chance(0.5) ? ch.int(0, 15) : undefined }).problems
          if (!problems.length) problems.push(...driveArena(u, ch))
          const g = st().game!
          if (!problems.length) {
            if (g.phase !== 'summary') problems.push(`ended in ${g.phase}`)
            const a = g.arena!
            if (!a.over) problems.push('run not over at the summary')
            if (a.won !== undefined && a.won !== stepWon(a.log[a.log.length - 1])) problems.push('won flag does not match the last step')
            const runs = st().profile.arenaRuns ?? []
            if (runs.filter((r) => r.id.startsWith(g.id)).length !== 1) problems.push(`${runs.length} best-run rows`)
            const profile = st().profile
            st().recordResult()
            if (st().profile !== profile) problems.push('recordResult filed the run twice')
            if (profile.leaderboard.length) problems.push('an arena run reached the leaderboard')
            expectReloadSame(`${seed} summary`)
            // An assistant-managed Cup or Gauntlet replays from its link
            if (format !== 'final' && !a.handManaged) {
              const payload = arenaChallengeFromGame(g, u, 'QA')
              if (!payload) problems.push('no arena link for an assistant run')
              else {
                const out = replayChallenge(u, decodeChallenge(encodeChallenge(payload)))
                if (out.verified !== 'yes') problems.push(`arena link replay: ${out.verified} (${out.reason})`)
              }
            }
          }
          if (problems.length) fails.push(`${seed} ${JSON.stringify(c)}\n  ${problems.slice(0, 6).join('\n  ')}`)
        } catch (e) {
          fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
        }
      }
      expect(fails).toEqual([])
    }, 60_000)
  }
})

describe('QA: the Run-in through the store', () => {
  it('takes random run-in jobs to the verdict and files each once', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(12); i++) {
      await breathe()
      const seed = `qa-runin-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      const template = ch.pick(['title', 'europe', 'survival'] as RunInTemplate[])
      const jobs = runInCatalogue(u, template).filter((j) => j.leagueId === 'england')
      const job = ch.chance(0.5) ? suggestRunIns(jobs, seed)[0] : ch.pick(jobs)
      try {
        st().startGame(runInGameSettings(u, job, { seed, formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2']) }))
        const problems = driveDraft(u, ch, {}).problems
        if (!problems.length) problems.push(...driveSeason(u, ch, { draft: () => ['a second draft in a run-in'], simBias: 3 }).problems)
        const g = st().game!
        if (!problems.length) {
          if (g.phase !== 'summary') problems.push(`ended in ${g.phase}`)
          const rows = st().profile.runIns ?? []
          if (rows.filter((r) => r.id.startsWith(g.id)).length !== 1) problems.push(`${rows.length} run-in rows`)
          if (st().profile.leaderboard.length) problems.push('a run-in reached the leaderboard')
          const profile = st().profile
          st().recordResult()
          if (st().profile !== profile) problems.push('recordResult filed the run-in twice')
          expectReloadSame(`${seed} summary`)
        }
        if (problems.length) fails.push(`${seed} ${job.clubId} ${job.season} ${template}\n  ${problems.slice(0, 6).join('\n  ')}`)
      } catch (e) {
        fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
      }
    }
    expect(fails).toEqual([])
  }, 60_000)
})

describe('QA: the Daily through the store', () => {
  for (let batch = 0; batch < 3; batch++)
  it(`plays Dailies on their days: one result a day, the replay link (batch ${batch})`, async () => {
    const fails: string[] = []
    for (let i = batch * 10; i < batch * 10 + seeds(10); i++) {
      await breathe()
      const day = `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`
      const seed = `daily-${day}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      try {
        const d = dailySettings(u, seed)
        st().startGame(dailyGameSettings(u, seed, 'QA Daily'))
        const g0 = st().game!
        if (g0.settings.formationId !== d.formationId) fails.push(`${seed}: formation ${g0.settings.formationId} vs ${d.formationId}`)
        const problems = driveDraft(u, ch, { autoAt: ch.chance(0.3) ? 5 : undefined }).problems
        if (!problems.length) problems.push(...driveQuickSeason(u, ch))
        const g = st().game!
        if (!problems.length) {
          const q = g.quickResult!
          problems.push(...tableProblems(q.table, (q.table.length - 1) * 2, 'daily table'))
          problems.push(...squadProblems(g.lineup, g.bench, (id) => u.index[id]?.playerId))
          const results = Object.values(st().profile.dailyResults)
          if (results.length !== 1) problems.push(`${results.length} daily results`)
          const payload = challengeFromGame(g, u, 'QA')
          const out = payload ? replayChallenge(u, decodeChallenge(encodeChallenge(payload))) : null
          if (out?.verified !== 'yes') problems.push(`daily link: ${out?.verified} ${out?.reason}`)
          expectReloadSame(`${seed}`)
        }
        if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
      } catch (e) {
        fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
      }
    }
    expect(fails).toEqual([])
  }, 60_000)
})

describe('QA: hot-seat head-to-head through the store', () => {
  it('drafts and plays head-to-heads; the season is credited once and a second Finish changes nothing', async () => {
    const fails: string[] = []
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2024).map((cs) => cs.clubId)
    for (let i = 0; i < seeds(20); i++) {
      await breathe()
      const seed = `qa-h2h-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ['england'])
      const problems: string[] = []
      const host0 = ch.pick(clubs)
      const host1 = ch.pick(clubs.filter((c) => c !== host0))
      st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: ch.pick(['4-3-3', '4-4-2']), hostClubId: host0 }, { name: 'Bob', shortName: 'BOB', formationId: ch.pick(['3-5-2', '4-2-3-1']), hostClubId: host1 }], 'england', ['england'], 2024, 'calibrated', ch.chance(0.2), seed)
      for (let step = 0; step < 300 && !h2hComplete(st().h2h!.draft); step++) {
        const h = st().h2h!
        if (h.draft.picking === null) st().h2hSpin()
        else if (ch.chance(0.3)) st().h2hAuto()
        else {
          const usable = h2hUsable(u, h.draft)
          const options = usable.flatMap((p) => h2hEligibleSlots(h.draft, p).map((s) => ({ id: p.id, slot: s.id })))
          if (!options.length) st().h2hAuto()
          else {
            const o = ch.pick(options)
            st().h2hPick(o.id, o.slot)
          }
        }
        if (st().toast) {
          problems.push(`toast in the draft: ${st().toast}`)
          useStore.setState({ toast: null })
        }
      }
      const h = st().h2h!
      if (!h2hComplete(h.draft)) problems.push('h2h draft did not complete')
      for (const [k, d] of h.draft.drafts.entries()) problems.push(...squadProblems(d.lineup, d.bench, (id) => u.index[id]?.playerId, `manager ${k}`))
      const both = new Set([...Object.values(h.draft.drafts[0].lineup), ...h.draft.drafts[0].bench].map((id) => u.index[id]?.playerId))
      for (const id of [...Object.values(h.draft.drafts[1].lineup), ...h.draft.drafts[1].bench]) if (both.has(u.index[id]?.playerId)) problems.push(`both managers drafted ${id}`)
      st().h2hFinish()
      const r = st().h2h!.result
      if (!r) problems.push('no result')
      else {
        const games = (r.table.length - 1) * 2
        problems.push(...tableProblems(r.table, games, 'h2h table'))
        problems.push(...badValues(r, 'h2h result'))
        const cab = st().profile.cabinet
        // A second tap on Finish: the result and the cabinet stay as they are
        st().h2hFinish()
        if (st().profile.cabinet !== cab) problems.push('a second Finish credited the cabinet again')
        if (JSON.stringify(st().h2h!.result) !== JSON.stringify(r)) problems.push('a second Finish replayed the season with a different result')
      }
      if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
    }
    expect(fails).toEqual([])
  }, 60_000)
})

describe('QA: coverage of the casual modes', () => {
  // The full sweep only (QA_FULL=1): a share of the seeds need not reach every action
  it.runIf(QA_FULL)('exercised the arena flow', async () => {
    for (const key of ['arena:live', 'arena:auto', 'arena:penalties', 'arena:lifeline', 'arena:simToEnd', 'arena:bonusSpin']) expect(coverage[key] ?? 0, key).toBeGreaterThan(0)
  })
})
