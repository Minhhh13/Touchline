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
import { QUICK_RULES, type QuickMode } from '@engine/draft'
import { setupRules, shortNameFor, startFormation } from '../logic/setup'
import { withCap, type CapPreset } from '../logic/cap'
import { classicFromFor } from '../logic/era'
import { wheelSeasons } from '@engine/era'
import { useStore } from '../store'
import type { GameSettings } from '../types'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { quickCupProblem } from '../logic/quickCups'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { badValues, breathe, QA_FULL, seeds, Chooser, coverage, crashToast, driveDraft, driveQuickSeason, expectReloadSame, loadStore, reloadState, squadProblems, tableProblems } from './qaHarness'

const u = loadTestUniverse(['england'])
const FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond', '5-3-2', '3-4-3', '4-1-4-1']

interface QuickCombo {
  modes: Array<QuickMode | 'upgrader'>
  difficulty: 'easy' | 'normal' | 'hard'
  powerUps: boolean
  endCase: boolean
  managers: 'spin' | 'pick' | 'off'
  bench: number
  cap: CapPreset
  chain: boolean
  classic: boolean
  draftMode: 'squad' | 'position'
  ratings: 'season' | 'prime'
  january: boolean
  era: [number, number] | null
}

/** The settings the Setup screen's Start sends for these choices (its `buildSettings`, England only). */
function quickSettings(seed: string, c: QuickCombo, formationId: string): GameSettings {
  const classicFrom = classicFromFor(u, ['england'])
  const classic = c.classic && classicFrom !== undefined
  const stops = wheelSeasons(u, ['england'], classic)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const [eraFrom, eraTo] = c.era ?? [first, last]
  const chosen = setupRules(QUICK_RULES, { difficulty: c.difficulty, showRatings: true, draftMode: c.draftMode, ratings: c.ratings, eraFrom, eraTo, first, last, twists: true, leagues: ['england'], benchPicks: c.bench, modes: c.modes, powerUps: c.powerUps, classic, managers: c.managers !== 'off', managerSpin: c.managers === 'spin', endCase: c.endCase })
  const rules = withCap({ ...chosen, ...(c.chain ? { chain: true } : {}) }, { preset: c.cap, custom: 180 })
  const leagueSeason = 2025
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return {
    mode: 'quick',
    seed,
    formationId: startFormation(rules, seed, formationId),
    teamName: 'QA XI',
    shortName: shortNameFor('QA XI'),
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: clubs[seed.length % clubs.length],
    leagueSeason,
    rules,
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: false,
    january: c.january,
  }
}

function randomCombo(ch: Chooser): QuickCombo {
  const modes: Array<QuickMode | 'upgrader'> = (['crazy', 'underdog', 'legends', 'speedrun', 'gamble', 'upgrader'] as const).filter(() => ch.chance(0.25))
  return {
    modes,
    difficulty: ch.pick(['easy', 'normal', 'hard'] as const),
    powerUps: ch.chance(0.35),
    endCase: ch.chance(0.5),
    managers: ch.pick(['spin', 'pick', 'off'] as const),
    bench: ch.pick([0, 0, 1, 3, 5]),
    cap: ch.pick(['off', 'off', 'shoestring', 'moneyball', 'big-spender'] as const),
    chain: ch.chance(0.2),
    classic: ch.chance(0.2),
    draftMode: ch.chance(0.3) ? 'position' : 'squad',
    ratings: ch.pick(['season', 'prime'] as const),
    january: ch.chance(0.75),
    era: ch.chance(0.2) ? ch.pick([[2016, 2026], [2010, 2015], [2008, 2012]] as Array<[number, number]>) : null,
  }
}

/** Play one random Quick Draft through the store and return every invariant that failed. */
async function playOne(seed: string): Promise<{ problems: string[]; combo: QuickCombo }> {
  const ch = new Chooser(seed)
  const combo = randomCombo(ch)
  loadStore(u, ['england'])
  const problems: string[] = []
  useStore.getState().startGame(quickSettings(seed, combo, ch.pick(FORMATIONS)))
  const log = driveDraft(u, ch, { powerUps: true, autoAt: ch.chance(0.3) ? ch.int(0, 10) : undefined })
  problems.push(...log.problems)
  if (log.problems.length) return { problems, combo }
  // A mid-flow reload at the kick-off step
  expectReloadSame(`${seed} kick-off`)
  problems.push(...driveQuickSeason(u, ch))
  const s = useStore.getState()
  const g = s.game
  if (!g || g.phase !== 'summary' || !g.quickResult) {
    problems.push(`not at the summary: ${g?.phase}`)
    return { problems, combo }
  }
  const q = g.quickResult
  const games = (q.table.length - 1) * 2
  problems.push(...tableProblems(q.table, games, `${seed} final table`))
  if (q.won + q.drawn + q.lost !== games) problems.push(`record ${q.won}-${q.drawn}-${q.lost} is not ${games} games`)
  if (q.results && q.results.length !== games) problems.push(`${q.results.length} results for ${games} games`)
  const me = q.table.find((r) => r.teamId === 'user')!
  if (me.points !== q.points) problems.push(`table points ${me.points} vs result ${q.points}`)
  problems.push(...squadProblems(g.lineup, g.bench, (id) => (g.customPlayers[id] ?? u.index[id])?.playerId, 'final XI'))
  if (Object.keys(g.lineup).length !== 11) problems.push(`final XI has ${Object.keys(g.lineup).length}`)
  problems.push(...badValues(q, 'quickResult'))
  problems.push(...badValues(g.draft?.history, 'history'))
  if (crashToast()) problems.push(`crash: ${crashToast()}`)
  // Credited once: the leaderboard holds the result, and recording again changes nothing
  const profile = useStore.getState().profile
  const rows = profile.leaderboard.filter((e) => e.id.startsWith(g.id))
  if (rows.length !== 1) problems.push(`leaderboard rows for the game: ${rows.length}`)
  useStore.getState().recordResult()
  if (useStore.getState().profile !== profile) problems.push('recordResult changed the profile a second time')
  expectReloadSame(`${seed} summary`)
  const re = reloadState()
  expect(re.profile.cabinet).toEqual(profile.cabinet)
  // The post-season cup: played (credited once, a second tap does nothing) or skipped
  if (!quickCupProblem(g, u, 'cup')) {
    if (ch.chance(0.6)) {
      const played = await useStore.getState().playCup('cup')
      if (!played) problems.push(`cup not played: ${useStore.getState().toast}`)
      const cab = useStore.getState().profile.cabinet
      const again = await useStore.getState().playCup('cup')
      if (again || useStore.getState().profile.cabinet !== cab) problems.push('the cup credited twice')
      useStore.setState({ toast: null })
      const run = useStore.getState().game!.quickResult!.cup
      if (!run) problems.push('cup run missing after playCup')
      else problems.push(...badValues(run, 'cup run'))
    } else useStore.getState().skipCup('cup')
  }
  if (crashToast()) problems.push(`crash in the cups: ${crashToast()}`)
  // The challenge link of the finished game replays to the same claim
  const done = useStore.getState().game!
  const payload = challengeFromGame(done, u, 'QA')
  if (!payload) problems.push('no challenge link for a finished game')
  else {
    const decoded = decodeChallenge(encodeChallenge(payload))
    expect(decoded).toEqual(JSON.parse(JSON.stringify(payload)))
    const out = replayChallenge(u, decoded)
    if (out.verified !== 'yes') problems.push(`challenge replay: ${out.verified} (${out.reason})`)
  }
  return { problems, combo }
}

describe('QA: Quick Draft fuzz through the store', () => {
  for (let batch = 0; batch < 10; batch++) {
    it(`plays random Quick Drafts (batch ${batch}) with every mode combination and keeps every invariant`, async () => {
      const fails: string[] = []
      for (let i = 0; i < seeds(15); i++) {
      await breathe()
        const seed = `qa-quick-${batch}-${i}`
        try {
          const { problems, combo } = await playOne(seed)
          if (problems.length) fails.push(`${seed} ${JSON.stringify(combo)}\n  ${problems.slice(0, 6).join('\n  ')}`)
        } catch (e) {
          fails.push(`${seed} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
        }
      }
      expect(fails).toEqual([])
    }, 60_000)
  }
  // The full sweep only (QA_FULL=1): a share of the seeds need not reach every action
  it.runIf(QA_FULL)('exercised every step of the flow', async () => {
    // Runs after the batches in this file: each action the screens offer ran at least once
    for (const key of ['draft:spin', 'draft:pick', 'draft:respin', 'draft:chooseSlot', 'draft:autoDraftRest', 'draft:speedrunPick', 'draft:rerollSeason', 'draft:swapSlots', 'draft:upgradePlayer', 'season:pickManager', 'season:openCase', 'season:kickOff', 'season:closeJanuary listing', 'season:closeJanuary pass', 'season:januarySpin', 'season:januaryUpgrade', 'season:benchChange', 'season:endPlayback']) expect(coverage[key] ?? 0, key).toBeGreaterThan(0)
  })
})
