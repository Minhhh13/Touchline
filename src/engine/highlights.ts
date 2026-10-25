/**
 * Highlights for a match played in summary detail (a quick-season game): the
 * moments worth watching again, the two sides' appearances by formation slot,
 * shot positions and a momentum series, everything the live pitch needs.
 *
 * The goals, cards, injuries and substitutions are the match's own events, so
 * the scoreline is the one the season recorded. A summary match keeps no log
 * of near misses or saves, so those are drawn for the reel from the `rng`
 * handed in, which the caller forks off a copy of the match's generator: the
 * reel is the same on every replay and never moves a draw of the season.
 */
import type { Appearance, FullMatchResult, MatchTeamInput } from './match'
import { CHANCE_TEXTS } from './match'
import { getFormation } from './formations'
import { momentumBins, placeEvents } from './matchDetail'
import type { Rng } from './rng'
import type { MatchEvent, Position } from './types'

export type HighlightKind = 'goal' | 'penalty' | 'own_goal' | 'chance' | 'save' | 'yellow' | 'red'

/** One moment of the reel: the event and the score once it has happened. */
export interface HighlightMoment {
  minute: number
  kind: HighlightKind
  side: 'home' | 'away'
  text: string
  /** The score after this moment. */
  score: { home: number; away: number }
}

export interface MatchHighlights {
  /** Every event of the match in minute order, the reel's chances and saves included, shots placed on the pitch. */
  events: MatchEvent[]
  moments: HighlightMoment[]
  home: { appearances: Appearance[] }
  away: { appearances: Appearance[] }
  /** The home side's share of the pressure per five-minute bin. */
  momentum: number[]
  homeGoals: number
  awayGoals: number
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const MOMENT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save', 'yellow', 'red'])
/** At most this many reel chances per side per half: the reel stays short. */
const CHANCES_PER_HALF = 2
const SHOT_WEIGHT: Record<Position, number> = { GK: 0, CB: 0.3, LB: 0.3, RB: 0.3, DM: 0.5, CM: 1, AM: 2, LW: 2, RW: 2, ST: 3 }

/**
 * Who took the pitch for a side, from its team sheet and the match's events: the XI from kick-off, a substitute from
 * the minute he came on in the slot of the man he replaced, a red card or an injury ending a man's game. Pure.
 */
export function appearancesFromEvents(input: Pick<MatchTeamInput, 'lineup' | 'tactics'>, events: MatchEvent[], side: 'home' | 'away'): Appearance[] {
  const formation = getFormation(input.tactics.formationId)
  const out: Appearance[] = formation.slots.filter((s) => input.lineup[s.id]).map((s) => ({ psId: input.lineup[s.id], slotId: s.id, position: s.position, onAt: 0, offAt: 90, red: false, injured: false }))
  for (const e of [...events].sort((a, b) => a.minute - b.minute)) {
    if (e.side !== side || !e.playerId) continue
    const a = out.find((x) => x.psId === e.playerId)
    if (!a) continue
    if (e.type === 'red') {
      a.red = true
      a.offAt = Math.min(a.offAt, e.minute)
    } else if (e.type === 'injury') {
      a.injured = true
      a.offAt = Math.min(a.offAt, e.minute)
    } else if (e.type === 'substitution' && e.secondaryId) {
      a.offAt = Math.min(a.offAt, e.minute)
      out.push({ psId: e.secondaryId, slotId: a.slotId, position: a.position, onAt: e.minute, offAt: 90, red: false, injured: false })
    }
  }
  return out
}

/** The men of a side on the pitch at a minute. */
function onAt(apps: Appearance[], minute: number): Appearance[] {
  return apps.filter((a) => a.onAt <= minute && a.offAt > minute)
}

/**
 * The highlights of a summary-detail match. `rng` should be a fork of a copy of the generator the match was played
 * from; it draws the reel's chances and saves, the shot positions and the momentum, nothing else.
 */
export function summaryHighlights(res: FullMatchResult, home: Pick<MatchTeamInput, 'lineup' | 'tactics' | 'getPlayer'>, away: Pick<MatchTeamInput, 'lineup' | 'tactics' | 'getPlayer'>, rng: Rng): MatchHighlights {
  const events: MatchEvent[] = res.events.map((e) => ({ ...e, ...(e.position ? { position: { ...e.position } } : {}) }))
  const apps = { home: appearancesFromEvents(home, res.events, 'home'), away: appearancesFromEvents(away, res.events, 'away') }
  const teams = { home, away }
  for (const side of ['home', 'away'] as const) {
    const opp = side === 'home' ? 'away' : 'home'
    const lam = side === 'home' ? res.xg.home : res.xg.away
    for (const [from, to, share] of [[1, 45, 0.47], [46, 90, 0.53]] as const) {
      const n = Math.min(CHANCES_PER_HALF, rng.poisson(lam * share * 1.1))
      for (let i = 0; i < n; i++) {
        const minute = rng.int(from, to)
        const shooters = onAt(apps[side], Math.min(minute, 89)).filter((a) => SHOT_WEIGHT[a.position] > 0)
        if (!shooters.length) continue
        const p = rng.pickWeighted(shooters, (a) => SHOT_WEIGHT[a.position])
        const gk = onAt(apps[opp], Math.min(minute, 89)).find((a) => a.position === 'GK')
        const pName = teams[side].getPlayer(p.psId)?.name ?? 'A forward'
        const gkName = gk ? teams[opp].getPlayer(gk.psId)?.name ?? 'the keeper' : 'the keeper'
        const text = rng.pick(CHANCE_TEXTS).replace('{p}', pName).replace('{gk}', gkName)
        const type = text.includes('save') || text.includes('keep out') || text.includes('straight at') ? 'save' : 'chance'
        events.push({ minute, type, side, playerId: p.psId, playerName: pName, ...(gk ? { secondaryId: gk.psId } : {}), secondaryName: gkName, text })
      }
    }
  }
  // Stable: the match's own order is kept within a minute
  events.sort((a, b) => a.minute - b.minute)
  placeEvents(rng, events, 1, 90)
  const momentum = momentumBins(rng, { lamH: res.xg.home, lamA: res.xg.away, homeTactics: home.tactics, awayTactics: away.tactics, events, from: 1, to: 90, previous: [] })
  const score = { home: 0, away: 0 }
  const moments: HighlightMoment[] = []
  for (const e of events) {
    if (!MOMENT_TYPES.has(e.type)) continue
    if (GOAL_TYPES.has(e.type)) score[e.side]++
    moments.push({ minute: e.minute, kind: e.type as HighlightKind, side: e.side, text: e.text, score: { ...score } })
  }
  return { events, moments, home: { appearances: apps.home }, away: { appearances: apps.away }, momentum, homeGoals: res.homeGoals, awayGoals: res.awayGoals }
}
