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
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { weeklySeed } from '@engine/rng'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { classicFromFor } from '../logic/era'
import { cupGameSettings, type ArenaChoices } from '../logic/arena'
import { dailyArenaGameSettings } from '../logic/arenaDaily'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { quickCupProblem } from '../logic/quickCups'
import { useStore } from '../store'
import type { GameSettings, Mode } from '../types'
import { badValues, breathe, QA_FULL, seeds, Chooser, crashToast, driveDraft, driveQuickSeason, expectReloadSame, loadStore, tableProblems } from './qaHarness'
import { driveArena, driveSeason } from './qaSeasonHarness'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)
const st = () => useStore.getState()

function quickEurope(seed: string, ch: Chooser, opts: { superLeague?: boolean; europe?: boolean; leagueId: string }): GameSettings {
  const wheel = opts.europe || opts.superLeague ? ALL : [opts.leagueId]
  const classic = ch.chance(0.3) && classicFromFor(u, wheel) !== undefined
  const stops = wheelSeasons(u, wheel, classic)
  const rules = setupRules(QUICK_RULES, { difficulty: ch.pick(['easy', 'normal', 'hard'] as const), showRatings: true, draftMode: 'squad', ratings: ch.pick(['season', 'prime'] as const), eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: true, leagues: wheel, benchPicks: ch.pick([0, 2]), modes: ch.chance(0.3) ? ['crazy'] : [], powerUps: ch.chance(0.3), classic, superLeague: !!opts.superLeague, managers: true, managerSpin: ch.chance(0.5), endCase: ch.chance(0.5) })
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === opts.leagueId && cs.complete && !cs.classic).map((cs) => cs.season))]
  const leagueSeason = ch.pick(seasons)
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === opts.leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode: 'quick', seed, formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2']), teamName: 'QA Europa', shortName: 'QAE', leagueId: opts.leagueId, wheelLeagues: wheel, hostClubId: defaultHostClub(u, opts.leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january: ch.chance(0.7) }
}

describe('QA: every league loaded', () => {
  for (let batch = 0; batch < 6; batch++)
  it(`plays Quick Drafts across the seven leagues, the Super League and European Nights, with both post-season cups and the link (batch ${batch})`, async () => {
    const fails: string[] = []
    for (let i = batch * 4; i < batch * 4 + seeds(4); i++) {
      await breathe()
      const seed = `qa-eu-quick-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ALL)
      const s = quickEurope(seed, ch, { leagueId: ALL[i % ALL.length], superLeague: i % 6 === 1, europe: i % 4 === 2 })
      const problems: string[] = []
      try {
        st().startGame(s)
        problems.push(...driveDraft(u, ch, { powerUps: true, autoAt: ch.chance(0.5) ? ch.int(0, 10) : undefined }).problems)
        if (!problems.length) problems.push(...driveQuickSeason(u, ch))
        const g = st().game!
        if (!problems.length) {
          const q = g.quickResult!
          problems.push(...tableProblems(q.table, (q.table.length - 1) * 2, 'final table'))
          for (const comp of ['cup', 'continental'] as const) {
            if (quickCupProblem(st().game!, u, comp)) continue
            const ok = await st().playCup(comp)
            if (!ok) problems.push(`${comp} not played: ${st().toast}`)
            problems.push(...badValues(st().game!.quickResult![comp === 'cup' ? 'cup' : 'continentalCup'], comp))
          }
          if (crashToast()) problems.push(`crash: ${crashToast()}`)
          const payload = challengeFromGame(st().game!, u, 'QA')
          const out = payload ? replayChallenge(u, decodeChallenge(encodeChallenge(payload))) : null
          if (out?.verified !== 'yes') problems.push(`link: ${out?.verified} ${out?.reason}`)
          expectReloadSame(seed)
        }
      } catch (e) {
        problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
      }
      if (problems.length) fails.push(`${seed} ${s.leagueId} ${s.leagueSeason} super ${!!s.rules.superLeague} wheel ${s.wheelLeagues.length}\n  ${problems.slice(0, 6).join('\n  ')}`)
    }
    expect(fails).toEqual([])
  }, 60_000)

  it('plays Weeklies through the store, one result filed per week', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(16); i++) {
      await breathe()
      const date = new Date(Date.UTC(2026, 0, 5 + 7 * i * 3))
      const seed = weeklySeed(date)
      const ch = new Chooser(seed)
      loadStore(u, ALL)
      const problems: string[] = []
      try {
        const ok = await st().startWeekly(seed, 'QA Weekly')
        if (!ok) problems.push('startWeekly refused')
        else {
          problems.push(...driveDraft(u, ch, { autoAt: ch.chance(0.5) ? 4 : undefined }).problems)
          if (!problems.length) problems.push(...driveQuickSeason(u, ch))
          const g = st().game!
          if (!problems.length) {
            if (g.settings.mode !== 'weekly') problems.push(`mode ${g.settings.mode}`)
            const w = st().profile.weekly
            if (!w || Object.keys(w.results ?? {}).length !== 1) problems.push(`weekly book ${JSON.stringify(w)}`)
            if (Object.keys(st().profile.dailyResults).length) problems.push('the Weekly touched the Daily')
            expectReloadSame(seed)
          }
        }
      } catch (e) {
        problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
      }
      if (problems.length) fails.push(`${seed}\n  ${problems.slice(0, 6).join('\n  ')}`)
    }
    expect(fails).toEqual([])
  }, 60_000)

  for (const leagueId of ALL)
  it(`manages a Season with the Continental Cup and a three-season Dynasty in ${leagueId}, job moves included`, async () => {
    const fails: string[] = []
    {
      for (const mode of ['season', 'dynasty'] as Mode[]) {
        await breathe()
        const seed = `qa-eu-${mode}-${leagueId}`
        const ch = new Chooser(seed)
        loadStore(u, ALL)
        const stops = wheelSeasons(u, [leagueId], false)
        const rules = setupRules({ ...SEASON_RULES, squadSize: 18 }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: false, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false })
        const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.complete && !cs.classic).map((cs) => cs.season))].sort()
        const leagueSeason = mode === 'dynasty' ? seasons[Math.max(0, seasons.length - 5)] : ch.pick(seasons)
        const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
        const s: GameSettings = { mode, seed, formationId: '4-3-3', teamName: 'QA Europa', shortName: shortNameFor('QA Europa'), leagueId, wheelLeagues: [leagueId], hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: true, difficulty: 'calibrated', continental: true }
        const problems: string[] = []
        try {
          st().startGame(s)
          const draft = (label: string) => driveDraft(u, ch, { autoAt: 0 }).problems.map((p) => `${label}: ${p}`)
          problems.push(...draft('draft'))
          if (!problems.length) {
            // A more active market and the job offers: years 2 and 3 take any offer half the time
            const run = driveSeason(u, ch, { years: mode === 'dynasty' ? (QA_FULL ? 2 : 1) : 0, draft, simBias: 7 })
            problems.push(...run.problems)
            if (!problems.length && st().game?.phase !== 'summary') problems.push(`ended in ${st().game?.phase}`)
            if (!problems.length) expectReloadSame(seed)
          }
        } catch (e) {
          problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
        }
        if (problems.length) fails.push(`${seed} ${leagueSeason}\n  ${problems.slice(0, 6).join('\n  ')}`)
      }
    }
    expect(fails).toEqual([])
  }, 60_000)

  it('plays Daily Arenas and Cups drawn from every league', async () => {
    const fails: string[] = []
    for (let i = 0; i < seeds(10); i++) {
      await breathe()
      const seed = i < 4 ? `arena-2026-11-${String(10 + i).padStart(2, '0')}` : `qa-eu-arena-${i}`
      const ch = new Chooser(seed)
      loadStore(u, ALL)
      const c: ArenaChoices = { teamName: 'QA Arena', formationId: '4-3-3', field: ch.pick(['europe', 'champions', 'giants', 'decade'] as const), wheelLeagues: ch.chance(0.5) ? ALL : [ch.pick(ALL)], difficulty: 'calibrated', seed, hardMode: false, twists: true, size: ch.pick([8, 16, 32] as const) }
      const s = i < 4 ? dailyArenaGameSettings(u, seed, 'QA Arena') : cupGameSettings(u, c, 'QAA')
      const problems: string[] = []
      try {
        st().startGame(s)
        problems.push(...driveDraft(u, ch, { autoAt: ch.chance(0.5) ? 3 : undefined }).problems)
        if (!problems.length) problems.push(...driveArena(u, ch))
        const g = st().game!
        if (!problems.length) {
          if (g.phase !== 'summary') problems.push(`ended in ${g.phase}`)
          if ((st().profile.arenaRuns ?? []).length !== 1) problems.push('best run not filed once')
          if (i < 4 && !st().profile.arenaDaily) problems.push('the Daily Arena filed no streak')
          expectReloadSame(seed)
        }
      } catch (e) {
        problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
      }
      if (problems.length) fails.push(`${seed} ${JSON.stringify(s.arena)}\n  ${problems.slice(0, 6).join('\n  ')}`)
    }
    expect(fails).toEqual([])
  }, 60_000)
})
