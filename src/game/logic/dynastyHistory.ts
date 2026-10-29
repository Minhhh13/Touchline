/**
 * The club's history in Season and Dynasty (round 9): a season-by-season record with what the board asked for, the
 * honours, the legends with their careers, the best XI of the dynasty and the summer's player stories (a farewell, a
 * youngster's breakthrough, a milestone). Display only: every function here reads the game, and the one writer
 * (`noteSeasonEnd`, run by the store when a season is recorded) adds optional fields and draws nothing. Kept out of
 * `week.ts` and `dynasty.ts`, which the edge verifier bundles.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Position, PlayerSeason } from '@engine/types'
import { getFormation } from '@engine/formations'
import { positionFactor } from '@engine/positions'
import { compareText } from '@engine/rng'
import type { CareerRecord, Game, SeasonRecord } from '../types'
import { playerLookup, squadPlayers } from './players'

const managed = (g: Game) => g.settings.mode === 'dynasty' || g.settings.mode === 'season'

/**
 * At a finished season: the season's notes on its history line (what the board expected, the objectives, the end
 * confidence, the captain, the young player) and the legends' career details (position, peak, first and last season,
 * ratings, captaincy). Once per season: a line that already has notes is left alone. No draw. True when it wrote.
 */
export function noteSeasonEnd(game: Game, u: LoadedUniverse): boolean {
  if (!managed(game) || game.phase !== 'summary' || !game.season) return false
  const record = game.history[game.history.length - 1]
  if (!record || record.year !== game.year || record.notes) return false
  const season = game.season
  const get = playerLookup(game, u)
  const captain = game.captainId ? get(game.captainId) : undefined
  const objectives = season.objectives ?? []
  record.notes = {
    target: season.boardTarget,
    objectivesMet: objectives.filter((o) => o.met).length,
    objectivesTotal: objectives.length,
    confidence: Math.round(season.confidence),
    ...(season.sacked ? { sacked: true } : {}),
    ...(captain ? { captain: captain.name } : {}),
    ...(game.awards?.youngPlayer ? { youngName: game.awards.youngPlayer.name } : {}),
  }
  const career = game.careerStats ?? {}
  for (const { p, s } of squadPlayers(game, u)) {
    const rec = career[p.playerId]
    // `finishSeason` counted him only with an appearance this season, and stamped this year on him
    if (!rec || rec.lastYear !== game.year || !s.seasonStats.apps) continue
    if (rec.seasons === 1) {
      rec.firstAge = p.age
      rec.firstOverall = p.overall
    }
    rec.firstYear ??= game.year - rec.seasons + 1
    rec.pos = p.positions[0]
    rec.peak = Math.max(rec.peak ?? 0, p.overall)
    rec.lastAge = p.age
    rec.lastOverall = p.overall
    rec.ratingSum = Math.round(((rec.ratingSum ?? 0) + s.seasonStats.ratingSum) * 10) / 10
    if (captain && captain.playerId === p.playerId) rec.captainSeasons = (rec.captainSeasons ?? 0) + 1
  }
  return true
}

/** Whether the board's position target was reached that season (a sacked season never is). */
export function targetMet(h: SeasonRecord): boolean | null {
  if (!h.notes) return null
  return !h.notes.sacked && h.position <= h.notes.target
}

export interface Honours {
  seasons: number
  titles: number
  cups: number
  continental: number
  /** League and one cup in the same season; a Treble counts here too. */
  doubles: number
  trebles: number
  /** Seasons that ended in relegation. */
  relegations: number
  bestFinish: number | null
  /** The longest run of league titles in a row. */
  titleRun: number
  /** Seasons the board's position target was reached, of the seasons with notes. */
  targetsMet: number
  targetsSet: number
}

/** The honours of a history: every count from the season lines alone. */
export function honoursOf(history: SeasonRecord[]): Honours {
  let run = 0
  let titleRun = 0
  const out: Honours = { seasons: history.length, titles: 0, cups: 0, continental: 0, doubles: 0, trebles: 0, relegations: 0, bestFinish: null, titleRun: 0, targetsMet: 0, targetsSet: 0 }
  for (const h of history) {
    const champion = h.position === 1 && h.tier !== 'RELEGATED' && !h.notes?.sacked
    if (champion) out.titles++
    if (h.cupWon) out.cups++
    if (h.continentalWon) out.continental++
    if (champion && h.cupWon && h.continentalWon) out.trebles++
    if (champion && (h.cupWon || h.continentalWon)) out.doubles++
    if (h.tier === 'RELEGATED') out.relegations++
    out.bestFinish = out.bestFinish === null ? h.position : Math.min(out.bestFinish, h.position)
    run = champion ? run + 1 : 0
    titleRun = Math.max(titleRun, run)
    const met = targetMet(h)
    if (met !== null) {
      out.targetsSet++
      if (met) out.targetsMet++
    }
  }
  out.titleRun = titleRun
  return out
}

/** A legend's average match rating with us, or null without ratings (an older save) or appearances. */
export function legendAverage(r: CareerRecord): number | null {
  if (r.ratingSum === undefined || !r.apps) return null
  return Math.round((r.ratingSum / r.apps) * 100) / 100
}

/** How a legend ranks for the best XI: his peak, twice his average rating and up to ten for a long career. */
export function legendScore(r: CareerRecord): number {
  return (r.peak ?? 0) + 2 * (legendAverage(r) ?? 6) + Math.min(10, r.apps / 19)
}

export interface Legend extends CareerRecord {
  playerId: string
  /** Still in the squad. */
  current: boolean
}

/** The club's legends, most appearances first (then goals, then name), each marked when he is still in the squad. */
export function legendsOf(game: Game, u: LoadedUniverse): Legend[] {
  const here = new Set(squadPlayers(game, u).map((x) => x.p.playerId))
  return Object.entries(game.careerStats ?? {})
    .map(([playerId, r]) => ({ ...r, playerId, current: here.has(playerId) }))
    .sort((a, b) => b.apps - a.apps || b.goals - a.goals || compareText(a.name, b.name))
}

export interface BestXISlot {
  slotId: string
  position: Position
  legend: Legend | null
}

/** The fewest appearances a man needs for the best XI. */
export const BEST_XI_MIN_APPS = 10

/**
 * The best XI of the dynasty in the side's formation: every slot filled by the best legend for it by `legendScore`,
 * a natural at the position before any cover (the scarcest slots first: a slot with fewer naturals picks first), each
 * man once. A legend without a known position (an older save's) or under `BEST_XI_MIN_APPS` is left out.
 */
export function bestXI(game: Game, u: LoadedUniverse, formationId = game.tactics.formationId): BestXISlot[] {
  const slots = getFormation(formationId).slots
  const pool = legendsOf(game, u).filter((l) => l.pos && l.apps >= BEST_XI_MIN_APPS)
  const naturals = (pos: Position) => pool.filter((l) => l.pos === pos).length
  const order = [...slots].sort((a, b) => naturals(a.position) - naturals(b.position) || compareText(a.id, b.id))
  const used = new Set<string>()
  const chosen: Record<string, Legend> = {}
  // Naturals first, then the best cover (a factor of the position fit), never a keeper outfield or the other way
  for (const pass of ['natural', 'cover'] as const) {
    for (const sl of order) {
      if (chosen[sl.id]) continue
      let best: Legend | null = null
      let bestScore = -Infinity
      for (const l of pool) {
        if (used.has(l.playerId)) continue
        const fit = positionFactor({ positions: [l.pos!] }, sl.position)
        if (pass === 'natural' ? fit < 1 : fit < 0.8) continue
        const score = legendScore(l) * fit
        if (score > bestScore || (score === bestScore && best && compareText(l.name, best.name) < 0)) [best, bestScore] = [l, score]
      }
      if (best) {
        chosen[sl.id] = best
        used.add(best.playerId)
      }
    }
  }
  return slots.map((sl) => ({ slotId: sl.id, position: sl.position, legend: chosen[sl.id] ?? null }))
}

/** What the summer stories need from the squad before the summer runs (it drops last season's men and stats). */
export interface SummerSnapshot {
  year: number
  captain?: string
  men: Array<{ playerId: string; name: string; age: number; overall: number; apps: number; goals: number }>
}

export function summerSnapshot(game: Game, u: LoadedUniverse): SummerSnapshot {
  const get = playerLookup(game, u)
  return {
    year: game.year,
    captain: game.captainId ? get(game.captainId)?.playerId : undefined,
    men: squadPlayers(game, u).map(({ p, s }) => ({ playerId: p.playerId, name: p.name, age: p.age, overall: p.overall, apps: s.seasonStats.apps, goals: s.seasonStats.goals })),
  }
}

export interface Farewell {
  name: string
  age: number
  seasons: number
  apps: number
  goals: number
  titles: number
  captain: boolean
}

export interface Breakthrough {
  name: string
  age: number
  from: number
  to: number
  /** His overall when he first played for us, when known and lower than now. */
  joined?: number
}

export interface Milestone {
  name: string
  kind: 'apps' | 'goals'
  /** The round number he passed this season. */
  mark: number
}

export interface SummerStories {
  farewells: Farewell[]
  breakthroughs: Breakthrough[]
  milestones: Milestone[]
}

/** Appearance and goal marks a legend's career passes on the way. */
export const APPS_MARKS = [100, 150, 200, 250, 300, 400, 500]
export const GOALS_MARKS = [50, 100, 150, 200, 250, 300]
/** A breakthrough: 23 or under after the summer, up two or more. */
export const BREAKTHROUGH_AGE = 23

/**
 * The summer's stories, from the snapshot taken before `advanceToNextSeason` and the game after it: every man who
 * retired with his career for us (the captain marked), the youngsters who grew two or more, and the appearance and goal
 * marks the season took a legend past. Pure, no draw.
 */
export function summerStories(snap: SummerSnapshot, retired: string[], game: Game, u: LoadedUniverse): SummerStories {
  const career = game.careerStats ?? {}
  const gone = new Set(retired)
  const farewells: Farewell[] = []
  for (const m of snap.men) {
    if (!gone.has(m.name)) continue
    const r = career[m.playerId]
    farewells.push({ name: m.name, age: m.age, seasons: r?.seasons ?? 0, apps: r?.apps ?? 0, goals: r?.goals ?? 0, titles: r?.titles ?? 0, captain: snap.captain === m.playerId })
  }
  const before = new Map(snap.men.map((m) => [m.playerId, m]))
  const breakthroughs: Breakthrough[] = []
  for (const { p } of squadPlayers(game, u)) {
    const m = before.get(p.playerId)
    if (!m || p.age > BREAKTHROUGH_AGE || p.overall < m.overall + 2) continue
    const joined = career[p.playerId]?.firstOverall
    breakthroughs.push({ name: p.name, age: p.age, from: m.overall, to: p.overall, ...(joined !== undefined && joined < m.overall ? { joined } : {}) })
  }
  const milestones: Milestone[] = []
  for (const m of snap.men) {
    const r = career[m.playerId]
    if (!r || r.lastYear !== snap.year) continue
    const passed = (marks: number[], total: number, season: number) => marks.filter((k) => total - season < k && total >= k).pop()
    const apps = passed(APPS_MARKS, r.apps, m.apps)
    if (apps) milestones.push({ name: m.name, kind: 'apps', mark: apps })
    const goals = passed(GOALS_MARKS, r.goals, m.goals)
    if (goals) milestones.push({ name: m.name, kind: 'goals', mark: goals })
  }
  const byName = <T extends { name: string }>(a: T, b: T) => compareText(a.name, b.name)
  return {
    farewells: farewells.sort((a, b) => b.apps - a.apps || byName(a, b)),
    breakthroughs: breakthroughs.sort((a, b) => b.to - b.from - (a.to - a.from) || byName(a, b)),
    milestones: milestones.sort((a, b) => b.mark - a.mark || byName(a, b)),
  }
}

/** The board's last word for the Club tab: last season's target and finish, when the history has notes. */
export function lastVerdict(history: SeasonRecord[]): { target: number; position: number; met: boolean } | null {
  const h = history[history.length - 1]
  if (!h?.notes) return null
  return { target: h.notes.target, position: h.position, met: !!targetMet(h) }
}

/** The legend's player-season for the player card: his current one when he is still here. */
export function legendInSquad(game: Game, u: LoadedUniverse, playerId: string): PlayerSeason | undefined {
  const get = playerLookup(game, u)
  for (const id of Object.keys(game.squad)) {
    const p = get(id)
    if (p?.playerId === playerId) return p
  }
  return undefined
}
