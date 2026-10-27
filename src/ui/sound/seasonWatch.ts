import { clinchMatchweeks } from '@engine/story'
import { USER_TEAM } from '@engine/season'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { isQuickLike } from '@game/logic/modes'
import { prefersReducedMotion } from '../motion'
import { seasonStepCues, type WeekResult } from './seasonCues'
import { seasonScoreFor } from './seasonScores'
import { liveAudio, playScore } from './synth'

/** The plain numbers a step is read from, taken from the game before it moved. */
interface Before {
  id: string
  year: number
  matchweek: number
  live: boolean
  digest: unknown
}

/** A Season, Dynasty or Run-in game in its season (never a quick one, an arena run or a draft). */
function seasonOf(g: Game | null | undefined): Before | null {
  if (!g?.season || g.arena || isQuickLike(g.settings.mode) || g.phase === 'draft' || g.phase === 'kickoff') return null
  return { id: g.id, year: g.year, matchweek: g.season.matchweek, live: !!g.live, digest: null }
}

/** The user's league results in matchweeks (from, to], in order: the scores a compacted save keeps. */
function resultsBetween(g: Game, from: number, to: number): WeekResult[] {
  const out: WeekResult[] = []
  for (const f of g.season?.fixtures ?? []) {
    if (f.matchweek <= from || f.matchweek > to || !f.result) continue
    const home = f.homeTeamId === USER_TEAM
    if (!home && f.awayTeamId !== USER_TEAM) continue
    out.push({ matchweek: f.matchweek, gf: home ? f.result.homeGoals : f.result.awayGoals, ga: home ? f.result.awayGoals : f.result.homeGoals })
  }
  return out.sort((a, b) => a.matchweek - b.matchweek)
}

let watching = false

/**
 * The sounds of a Season or Dynasty simulated without the match day: one result cue after Play matchweek on Sim
 * result, the digest's cue after Sim 5 or Sim to end (and Sim to the next big match), and the title or relegation
 * stinger when the step sealed it (`seasonStepCues`). A watched or auto-played match is the dashboard's: a step
 * that starts or ends a live match plays nothing here. It only reads the store, after the step's last update (a
 * microtask later, so Sim 5's digest is in). With sound off, before a gesture or without Web Audio it does nothing
 * beyond comparing two numbers. Started once by the Dugout's chunk; safe to call again.
 */
export function watchSeasonSounds(): void {
  if (watching) return
  watching = true
  let queued: Before | null = null
  useStore.subscribe((state, prev) => {
    if (state.game === prev.game || queued) return
    const b = seasonOf(prev.game)
    const a = seasonOf(state.game)
    if (!b || !a || a.id !== b.id || a.year !== b.year || a.matchweek <= b.matchweek) return
    queued = { ...b, digest: prev.digest }
    queueMicrotask(() => {
      const before = queued
      queued = null
      const s = useStore.getState()
      const g = s.game
      if (!before || !g?.season || g.id !== before.id || !liveAudio()) return
      const digest = !!s.digest && s.digest !== before.digest
      // A live match (watched or auto-played) has its own sounds on the dashboard
      if (!digest && (before.live || g.live)) return
      const season = g.season
      const from = before.matchweek
      const to = season.matchweek
      const ids = [USER_TEAM, ...Object.keys(season.ai)]
      // A run-in is decided from the week it took over, on the table it carried in
      const fixtures = season.takeoverAt ? season.fixtures.filter((f) => f.matchweek > season.takeoverAt!) : season.fixtures
      const clinch = clinchMatchweeks(fixtures, ids, USER_TEAM, 3, season.carryIn)
      const cues = seasonStepCues({ fromMatchweek: from, toMatchweek: to, results: resultsBetween(g, from, to), digest, clinch, ended: g.phase === 'summary', sacked: !!season.sacked, reduced: prefersReducedMotion() })
      for (const c of cues) playScore(seasonScoreFor(c.req), c.at)
    })
  })
}
