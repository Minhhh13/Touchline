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
import { USER_TEAM } from '@engine/season'
import { defaultHostClub, shortNameFor } from '../logic/setup'
import { digestAhead } from '../logic/digestAhead'
import { weeklyBriefing } from '../logic/briefing'
import { officeItems } from '../logic/office'
import { useStore } from '../store'
import type { Game, GameSettings, Mode } from '../types'
import { badValues, breathe, Chooser, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

/**
 * QA round 6 (r11, docs/QA.md): what round 10 added to the managed season, read at every step of random Seasons and
 * Dynasties played through the store. The digest's next match and who misses it (`digestAhead`): every man injured or
 * banned is named, nobody else, the opponent is the next league fixture's, and a man it names does not play that
 * match. The Office's briefing line (`officeLine` through `weeklyBriefing`): there exactly while the Office has items,
 * counted as the Office counts them, a warning only with a request or a promise a matchweek or less from its end.
 */
const u = loadTestUniverse(['england'])
const st = () => useStore.getState()
/** How often each check met something to check, so a sweep that checks nothing fails. */
const met = { outNamed: 0, matchChecked: 0, officeLine: 0, officeWarn: 0 }

function settings(mode: Mode, seed: string, ch: Chooser): GameSettings {
  const leagueSeason = ch.pick([2014, 2019, 2024])
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode, seed, formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2']), teamName: 'R11 Town', shortName: shortNameFor('R11 Town'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: defaultHostClub(u, 'england', leagueSeason, clubs), leagueSeason, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: ch.chance(0.5), difficulty: 'calibrated', continental: false, playerPower: ch.chance(0.7) }
}

interface Seen {
  year: number
  matchweek: number
  out: Set<string>
  apps: Map<string, number>
}

/** The checks on one step's game; `seen` is the last step's read, for the match it promised. */
function stepProblems(g: Game, seen: Seen | null): { problems: string[]; next: Seen | null } {
  const problems: string[] = []
  const s = g.season
  if (!s || g.phase === 'draft' || g.live) return { problems, next: null }
  const label = `y${g.year} ${g.phase} mw ${s.matchweek}`
  const ahead = digestAhead(g, u)
  if (ahead) {
    problems.push(...badValues(ahead, `${label} ahead`))
    const named = new Set(ahead.out.map((m) => m.id))
    for (const [id, sp] of Object.entries(g.squad)) {
      const out = (sp.injury?.weeksOut ?? 0) > 0 || sp.suspension > 0
      if (out !== named.has(id)) problems.push(`${label}: ${id} ${out ? 'out but not named' : 'named but fit'}`)
    }
    if (ahead.out.length) met.outNamed++
    for (let i = 1; i < ahead.out.length; i++) if (ahead.out[i].weeks > ahead.out[i - 1].weeks) problems.push(`${label}: ahead not longest out first`)
    const f = s.fixtures.find((x) => x.matchweek === ahead.matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
    if ((f ? (f.homeTeamId === USER_TEAM ? f.awayTeamId : f.homeTeamId) : undefined) !== ahead.opponentId) problems.push(`${label}: ahead opponent ${ahead.opponentId}`)
  } else if (s.matchweek < s.matchweeks && !s.sacked) problems.push(`${label}: no next match with ${s.matchweeks - s.matchweek} to play`)
  // The match the last read promised, once played: the men it named did not play in it
  if (seen && seen.year === g.year && s.matchweek === seen.matchweek + 1) {
    if (seen.out.size) met.matchChecked++
    for (const id of seen.out) {
      const apps = g.squad[id]?.seasonStats.apps
      if (apps !== undefined && apps > (seen.apps.get(id) ?? 0)) problems.push(`${label}: ${id} was named out of matchweek ${s.matchweek} but played`)
    }
  }
  // The Office's line: there exactly while the Office waits on the manager
  if (g.phase === 'week' || g.phase === 'preseason') {
    const items = officeItems(g, u)
    const line = weeklyBriefing(g, u).find((b) => b.id === 'office')
    if (!!line !== items.length > 0) problems.push(`${label}: office line ${line ? 'shown' : 'missing'} with ${items.length} items`)
    if (line && items.length > 1 && !line.text.startsWith(`${items.length} things`)) problems.push(`${label}: office line "${line.text}" for ${items.length} items`)
    if (line) met.officeLine++
    if (line?.level === 'warn') met.officeWarn++
    if (line) problems.push(...badValues(line, `${label} office line`))
    if (line && /undefined|NaN|Infinity/.test(line.text)) problems.push(`${label}: office line "${line.text}"`)
  }
  const next: Seen | null = ahead ? { year: g.year, matchweek: s.matchweek, out: new Set(ahead.out.map((m) => m.id)), apps: new Map(Object.entries(g.squad).map(([id, sp]) => [id, sp.seasonStats.apps])) } : null
  return { problems, next }
}

async function play(mode: Mode, seed: string, years: number): Promise<string[]> {
  const ch = new Chooser(seed)
  loadStore(u, ['england'])
  st().startGame(settings(mode, seed, ch))
  const draft = (label: string) => driveDraft(u, ch, { autoAt: 0 }).problems.map((p) => `${label}: ${p}`)
  const first = draft('draft')
  if (first.length) return first
  const problems: string[] = []
  let seen: Seen | null = null
  stepHook.run = () => {
    const g = st().game
    if (!g || problems.length > 5) return
    const r = stepProblems(g, seen)
    problems.push(...r.problems.map((p) => `${seed} ${p}`))
    // A step that read nothing (a live match) keeps the last read for the match it promised
    if (r.next || g.phase === 'summary' || g.phase === 'draft') seen = r.next
  }
  try {
    const run = driveSeason(u, ch, { years, draft, simBias: 7 })
    problems.push(...run.problems)
  } finally {
    stepHook.run = undefined
  }
  return problems
}

afterEach(() => {
  if (process.env.QA_REPORT) console.log(JSON.stringify(met))
  stepHook.run = undefined
})

describe('QA r11: the digest’s next match and the Office’s line in managed seasons', () => {
  const n = seeds(6)
  for (let i = 0; i < n; i++) {
    it(`Season and Dynasty ${i}`, async () => {
      const problems = [...(await play('season', `r11-season-${i}`, 0))]
      await breathe()
      problems.push(...(await play('dynasty', `r11-dynasty-${i}`, 1)))
      expect(problems).toEqual([])
    }, 60_000)
  }
  it('met something to check', () => {
    expect(met.outNamed).toBeGreaterThan(5)
    expect(met.matchChecked).toBeGreaterThan(2)
    expect(met.officeLine).toBeGreaterThan(0)
  })
})
