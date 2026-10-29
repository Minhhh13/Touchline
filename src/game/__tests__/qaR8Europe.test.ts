import { afterEach, describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { compactGame } from '../logic/compact'
import { continentalRun } from '../logic/week'
import { encodeSave, parseSave } from '../saveStorage'
import { canonicalJson } from '../../online/core/canonical'
import { persistedState, useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { matchPreview, nextLeagueFixture, nextTieFixture, storylines, summerReview } from '../logic/storylines'
import { previewLines, previewTitle, storylineText, summerText } from '../../ui/storyText'
import { continentalProblems } from './qaEuropeChecks'
import { badValues, breathe, Chooser, crashToast, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

/**
 * QA round 3 (r8): engine 7's Continental Cup in a managed Season and Dynasty, every league loaded. After every
 * driver step the cup's state is checked whole (groups, tables, legs, aggregates, the user's flags), and each run is
 * played twice, once with the page reloaded at random steps (the save persisted, compacted, compressed and merged into
 * a fresh store), and must end on the same game.
 */
const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)
const st = () => useStore.getState()
type Store = ReturnType<typeof useStore.getState>

function reloadNow(): void {
  const s = st()
  const raw = encodeSave(JSON.stringify({ state: persistedState(s), version: 1 }))
  const value = parseSave<Record<string, unknown>>(raw)
  const merge = useStore.persist.getOptions().merge!
  const fresh: Store = { ...useStore.getInitialState(), universe: s.universe, loadedLeagues: s.loadedLeagues }
  useStore.setState(merge(value.state, fresh) as Store, true)
}

function comparable(g: Game | null): string {
  if (!g) return 'null'
  return canonicalJson(compactGame(g)).split(g.id).join('ID').replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"T"')
}

/** The storylines' words at this step (display only, `src/ui/storyText.ts`): every preview, story and summer review sound. */
function storyProblems(g: Game): string[] {
  const out: string[] = []
  const words: string[] = []
  try {
    const key = `${g.id}|${g.year}|${g.season?.matchweek}`
    if (g.season && (g.phase === 'week' || g.phase === 'preseason')) {
      for (const f of [nextLeagueFixture(g), nextTieFixture(g)]) {
        if (!f) continue
        const p = matchPreview(g, u, f)
        if (!p) continue
        words.push(previewTitle(p, u), ...previewLines(p, u, g.settings.teamName, key).map((l) => l.text))
      }
      for (const s of storylines(g, u)) {
        const t = storylineText(s, u, g.settings.teamName, key)
        words.push(t.text, t.title, t.chip ?? '')
      }
    }
    if (g.phase === 'summary' || (g.phase === 'draft' && g.year > 1)) {
      const r = summerReview(g)
      if (r) {
        const t = summerText(r, u, key)
        words.push(t.headline, ...t.lines.map((l) => l.text))
      }
    }
  } catch (e) {
    out.push(`storylines threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
  }
  out.push(...badValues(words, 'story words'))
  for (const w of words) if (/\b(undefined|NaN|null)\b|\{[a-z]+\}/.test(w)) out.push(`story words: ${w}`)
  return out
}

function settings(mode: Mode, seed: string, ch: Chooser, leagueId: string): GameSettings {
  const stops = wheelSeasons(u, [leagueId], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: 18 }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: false, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.complete && !cs.classic).map((cs) => cs.season))].sort()
  const leagueSeason = mode === 'dynasty' ? seasons[Math.max(0, seasons.length - 4)] : ch.pick(seasons)
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode, seed, formationId: '4-3-3', teamName: 'R8 Europa', shortName: shortNameFor('R8 Europa'), leagueId, wheelLeagues: [leagueId], hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: false, difficulty: 'calibrated', continental: true }
}

function play(mode: Mode, seed: string, leagueId: string, p: number, bias: number): { problems: string[]; game: string; reloads: number; groups: boolean; liveCup: number } {
  const ch = new Chooser(seed)
  const reloads = new Rng(`reload:${seed}`)
  let n = 0
  let groups = false
  let liveCup = 0
  const problems: string[] = []
  stepHook.run = () => {
    const g = st().game
    if (g?.season?.continental?.groups) groups = true
    if (g?.live?.comp === 'continental') liveCup++
    if (g && problems.length < 6) problems.push(...[...continentalProblems(g), ...storyProblems(g)].map((x) => `y${g.year} mw ${g.season?.matchweek} ${g.phase}: ${x}`))
    if (p > 0 && reloads.chance(p) && !st().digest) {
      reloadNow()
      n++
    }
  }
  loadStore(u, ALL)
  const draft = (label: string) => driveDraft(u, ch, { autoAt: 0 }).problems.map((x) => `${label}: ${x}`)
  st().startGame(settings(mode, seed, ch, leagueId))
  problems.push(...draft('draft'))
  if (!problems.length) problems.push(...driveSeason(u, ch, { years: mode === 'dynasty' ? 1 : 0, draft, simBias: bias }).problems)
  const g = st().game
  if (g?.phase === 'summary' && g.season?.continental?.groups) {
    const h = g.history.at(-1)
    if (h && h.continentalRun !== continentalRun(g.season)) problems.push(`history run ${h.continentalRun}, the cup says ${continentalRun(g.season)}`)
  }
  const crash = crashToast()
  if (crash) problems.push(crash)
  stepHook.run = undefined
  return { problems, game: comparable(st().game), reloads: n, groups, liveCup }
}

afterEach(() => {
  stepHook.run = undefined
})

describe('QA r8: the Continental Cup in a managed season, checked at every step and across reloads', () => {
  // The bias is how often the manager sims rather than plays a week live (of 10): low plays the cup's matches live
  const runs: Array<[Mode, string, number]> = [['season', 'england', 2], ['season', 'spain', 6], ['season', 'germany', 2], ['dynasty', 'italy', 4], ['season', 'france', 3], ['dynasty', 'england', 6], ['season', 'portugal', 1], ['season', 'netherlands', 3]]
  for (const [i, [mode, leagueId, bias]] of runs.entries()) {
    if (i >= seeds(runs.length)) continue
    it(`${mode} in ${leagueId}`, async () => {
      const seed = `r8-europe-${mode}-${leagueId}`
      await breathe()
      const a = play(mode, seed, leagueId, 0, bias)
      await breathe()
      const b = play(mode, seed, leagueId, 0.12, bias)
      expect(a.groups, 'the cup had groups').toBe(true)
      if (bias <= 3) expect(a.liveCup, 'a cup match played live').toBeGreaterThan(0)
      expect([...a.problems, ...b.problems.map((x) => `reloaded: ${x}`)]).toEqual([])
      if (a.game !== b.game) {
        const ga = JSON.parse(a.game) as Record<string, unknown>
        const gb = JSON.parse(b.game) as Record<string, unknown>
        const diff = Object.keys({ ...ga, ...gb }).filter((k) => JSON.stringify(ga[k]) !== JSON.stringify(gb[k]))
        expect(diff, `${b.reloads} reloads`).toEqual([])
      }
      expect(b.reloads).toBeGreaterThan(0)
    }, 300_000)
  }
})
