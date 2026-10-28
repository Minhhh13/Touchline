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
import { USER_TEAM } from '@engine/season'
import { continentalPlan, groupTable, tieScore } from '@engine/continental'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { compactGame } from '../logic/compact'
import { continentalRun } from '../logic/week'
import { encodeSave, parseSave } from '../saveStorage'
import { canonicalJson } from '../../online/core/canonical'
import { persistedState, useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { breathe, Chooser, crashToast, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
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

/** Everything that must hold of an engine 7 Continental Cup at any step. */
export function continentalProblems(g: Game): string[] {
  const s = g.season
  const c = s?.continental
  if (!s || !c?.groups) return []
  const out: string[] = []
  const plan = continentalPlan(s.matchweeks)
  const mw = s.matchweek
  const liveWeek = g.live?.comp === 'continental' ? g.live.ctx.matchweek : null
  const teams = c.groups.flatMap((x) => x.teams)
  if (c.groups.length !== 4 || teams.length !== 16 || new Set(teams).size !== 16) out.push(`groups ${c.groups.map((x) => x.teams.length).join('/')} distinct ${new Set(teams).size}`)
  if (!teams.includes(USER_TEAM)) out.push('the user is not in the groups')
  for (const id of teams) if (id !== USER_TEAM && !c.clubs[id]) out.push(`group side ${id} not in the field`)
  for (const grp of c.groups) {
    if (grp.matches.length !== 12) out.push(`group ${grp.name}: ${grp.matches.length} matches`)
    for (const m of grp.matches) {
      if (m.result && m.matchweek > mw) out.push(`group ${grp.name} md ${m.matchday} played before its week (${m.matchweek} > ${mw})`)
      // Every match of a midweek past is in, except the user's own live one
      if (!m.result && m.matchweek < mw && m.matchweek !== liveWeek) out.push(`group ${grp.name} md ${m.matchday} after mw ${m.matchweek} unplayed at mw ${mw}`)
    }
    const table = groupTable(grp)
    const played = table.reduce((n, r) => n + r.played, 0)
    if (played !== 2 * grp.matches.filter((m) => m.result).length) out.push(`group ${grp.name}: table counts ${played}`)
  }
  const byRound = (r: string) => c.ties.filter((t) => t.round === r)
  const qf = byRound('QF')
  const sf = byRound('SF')
  const f = byRound('F')
  if (qf.length && qf.length !== 4) out.push(`${qf.length} quarter-finals`)
  if (sf.length && sf.length !== 2) out.push(`${sf.length} semi-finals`)
  if (f.length > 1) out.push(`${f.length} finals`)
  if (c.ties.some((t) => t.round !== 'QF' && t.round !== 'SF' && t.round !== 'F')) out.push(`an odd round: ${c.ties.map((t) => t.round).join(',')}`)
  if (qf.length && mw < plan.groupWeeks[5]) out.push('quarter-finals before the groups ended')
  for (const t of c.ties) {
    const label = `${t.round} ${t.homeTeamId} v ${t.awayTeamId}`
    if (t.round !== 'F' && !t.firstLeg) out.push(`${label}: no first leg`)
    if (t.round === 'F' && t.firstLeg) out.push(`${label}: a two-legged final`)
    if (t.result && t.firstLeg && !t.firstLeg.result) out.push(`${label}: second leg before the first`)
    if (t.result && !t.winnerId && liveWeek !== t.afterMatchweek) out.push(`${label}: played, no winner`)
    if (t.winnerId && t.winnerId !== t.homeTeamId && t.winnerId !== t.awayTeamId) out.push(`${label}: winner ${t.winnerId}`)
    if (t.winnerId) {
      const sc = tieScore(t)
      if (!sc) out.push(`${label}: settled, no score`)
      else {
        const homeWins = sc.home > sc.away || (sc.home === sc.away && !!sc.pens && sc.pens.home > sc.pens.away)
        if ((t.winnerId === t.homeTeamId) !== homeWins) out.push(`${label}: winner ${t.winnerId} against the score ${JSON.stringify(sc)}`)
        if (sc.home === sc.away && !sc.pens) out.push(`${label}: level with no shoot-out`)
        if (sc.pens && sc.pens.home === sc.pens.away) out.push(`${label}: a level shoot-out`)
        if (sc.legs && t.firstLeg && sc.legs.length !== 2) out.push(`${label}: ${sc.legs.length} legs`)
      }
    }
    if (t.firstLeg?.result && t.firstLeg.afterMatchweek > mw) out.push(`${label}: first leg played early`)
    if (!t.firstLeg?.result && t.firstLeg && t.firstLeg.afterMatchweek < mw && liveWeek !== t.firstLeg.afterMatchweek) out.push(`${label}: first leg after ${t.firstLeg.afterMatchweek} unplayed at ${mw}`)
    if (!t.result && t.afterMatchweek < mw && liveWeek !== t.afterMatchweek) out.push(`${label}: deciding match after ${t.afterMatchweek} unplayed at ${mw}`)
  }
  // Every quarter-finalist came through its group; every later side won the round before
  const through = new Set(c.groups.flatMap((grp) => groupTable(grp).slice(0, 2).map((r) => r.teamId)))
  for (const t of qf) for (const id of [t.homeTeamId, t.awayTeamId]) if (!through.has(id)) out.push(`QF side ${id} not top two`)
  for (const [r, prev] of [[sf, qf], [f, sf]] as const) {
    const winners = new Set(prev.map((t) => t.winnerId))
    for (const t of r) for (const id of [t.homeTeamId, t.awayTeamId]) if (!winners.has(id)) out.push(`${t.round} side ${id} did not win the round before`)
  }
  // The user's flags agree with the ties
  const userLost = c.ties.some((t) => t.winnerId && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM) && t.winnerId !== USER_TEAM)
  const outOfGroup = qf.length > 0 && !through.has(USER_TEAM)
  const finalWon = f.some((t) => t.winnerId === USER_TEAM)
  if (c.eliminated !== (userLost || outOfGroup)) out.push(`eliminated ${c.eliminated}, ties say ${userLost || outOfGroup}`)
  if (c.won !== finalWon) out.push(`won ${c.won}, the final says ${finalWon}`)
  if (c.won && c.eliminated) out.push('won and eliminated')
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
    if (g && problems.length < 6) problems.push(...continentalProblems(g).map((x) => `y${g.year} mw ${g.season?.matchweek} ${g.phase}: ${x}`))
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
