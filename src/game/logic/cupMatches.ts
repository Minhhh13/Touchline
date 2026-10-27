/**
 * The user's cup and Continental Cup matches of a season in one list, whatever the format: a domestic cup tie or an
 * engine 6 Continental Cup tie (one match each), or engine 7's group matches and legs. For the digest, the season
 * calendar and anything else that lists the user's midweeks. Reads scores only, so a compacted save gives the same
 * list. Pure.
 */
import { USER_TEAM, continentalRounds, cupRounds, type Competition, type CupTie, type SeasonState } from '@engine/season'
import { continentalPlan, tieScore } from '@engine/continental'

export interface UserCupMatch {
  matchweek: number
  comp: Competition
  /** The knockout round, `G` for a group match. */
  round: CupTie['round'] | 'G'
  /** "Fourth round", "Continental Cup, Group B", "Continental quarter-final, first leg". */
  label: string
  opponentId: string
  /** At home in this match (a final is listed from the tie's draw). */
  home: boolean
  /** Played yet. */
  played: boolean
  /** This match's goals (a single tie's ninety minutes). */
  gf: number
  ga: number
  /** A group match or a first leg: the match's result. A tie's deciding match: through (W) or out (L). */
  outcome?: 'W' | 'D' | 'L'
  /** The deciding match of a tie that needed penalties, from the user's side. */
  penalties?: { gf: number; ga: number }
  /** A two-legged tie's second leg: goals over both legs, extra time included. */
  aggregate?: { gf: number; ga: number }
  /** The deciding match went to extra time (engine 7's knockouts). */
  et?: boolean
  leg?: 1 | 2
}

const mine = (m: { homeTeamId: string; awayTeamId: string }) => m.homeTeamId === USER_TEAM || m.awayTeamId === USER_TEAM
const LEG = { 1: 'first leg', 2: 'second leg' } as const

function single(t: CupTie, comp: Competition, label: string): UserCupMatch {
  const home = t.homeTeamId === USER_TEAM
  const s = tieScore(t)
  const p = s?.pens
  return {
    matchweek: t.afterMatchweek,
    comp,
    round: t.round,
    label,
    opponentId: home ? t.awayTeamId : t.homeTeamId,
    home,
    played: !!t.result,
    gf: t.result ? (home ? t.result.homeGoals : t.result.awayGoals) : 0,
    ga: t.result ? (home ? t.result.awayGoals : t.result.homeGoals) : 0,
    ...(t.winnerId ? { outcome: t.winnerId === USER_TEAM ? ('W' as const) : ('L' as const) } : {}),
    ...(p ? { penalties: { gf: home ? p.home : p.away, ga: home ? p.away : p.home } } : {}),
    ...(s?.et ? { et: true, aggregate: { gf: home ? s.home : s.away, ga: home ? s.away : s.home } } : {}),
  }
}

/** Every cup and Continental Cup match of the user's this season, played or drawn, in matchweek order. */
export function userCupMatches(season: SeasonState): UserCupMatch[] {
  const out: UserCupMatch[] = []
  const cupLabels = cupRounds(season.matchweeks)
  for (const t of season.cup.filter(mine)) out.push(single(t, 'cup', cupLabels.find((r) => r.round === t.round)?.label ?? 'Cup tie'))
  const c = season.continental
  if (c?.groups) {
    const plan = continentalPlan(season.matchweeks)
    for (const g of c.groups) {
      for (const m of g.matches.filter(mine)) {
        const home = m.homeTeamId === USER_TEAM
        const r = m.result
        const gf = r ? (home ? r.homeGoals : r.awayGoals) : 0
        const ga = r ? (home ? r.awayGoals : r.homeGoals) : 0
        out.push({ matchweek: m.matchweek, comp: 'continental', round: 'G', label: `Continental Cup, Group ${g.name}`, opponentId: home ? m.awayTeamId : m.homeTeamId, home, played: !!r, gf, ga, ...(r ? { outcome: gf > ga ? ('W' as const) : gf < ga ? ('L' as const) : ('D' as const) } : {}) })
      }
    }
    for (const t of c.ties.filter(mine)) {
      const label = plan.rounds.find((r) => r.round === t.round)?.label ?? 'Continental Cup'
      if (!t.firstLeg) {
        out.push(single(t, 'continental', label))
        continue
      }
      const tieHome = t.homeTeamId === USER_TEAM
      const opponentId = tieHome ? t.awayTeamId : t.homeTeamId
      const l1 = t.firstLeg.result
      const gf1 = l1 ? (tieHome ? l1.homeGoals : l1.awayGoals) : 0
      const ga1 = l1 ? (tieHome ? l1.awayGoals : l1.homeGoals) : 0
      out.push({ matchweek: t.firstLeg.afterMatchweek, comp: 'continental', round: t.round, label: `${label}, ${LEG[1]}`, opponentId, home: tieHome, played: !!l1, gf: gf1, ga: ga1, leg: 1, ...(l1 ? { outcome: gf1 > ga1 ? ('W' as const) : gf1 < ga1 ? ('L' as const) : ('D' as const) } : {}) })
      // The second leg at the other ground: its result keeps that match's own sides
      const l2 = t.result
      const s = tieScore(t)
      out.push({
        matchweek: t.afterMatchweek,
        comp: 'continental',
        round: t.round,
        label: `${label}, ${LEG[2]}`,
        opponentId,
        home: !tieHome,
        played: !!l2,
        gf: l2 ? (tieHome ? l2.awayGoals : l2.homeGoals) : 0,
        ga: l2 ? (tieHome ? l2.homeGoals : l2.awayGoals) : 0,
        leg: 2,
        ...(t.winnerId ? { outcome: t.winnerId === USER_TEAM ? ('W' as const) : ('L' as const) } : {}),
        ...(t.agg && s ? { aggregate: { gf: tieHome ? s.home : s.away, ga: tieHome ? s.away : s.home } } : {}),
        ...(s?.et ? { et: true } : {}),
        ...(s?.pens ? { penalties: { gf: tieHome ? s.pens.home : s.pens.away, ga: tieHome ? s.pens.away : s.pens.home } } : {}),
      })
    }
  } else if (c) {
    const labels = continentalRounds(season.matchweeks)
    for (const t of c.ties.filter(mine)) out.push(single(t, 'continental', labels.find((r) => r.round === t.round)?.label ?? 'Continental Cup'))
  }
  return out.sort((a, b) => a.matchweek - b.matchweek)
}

/** A match's score as the calendar and the digest print it, home side first: "2-1", "1-1 (4-3p)", "2-2 (agg 3-3, 5-4p)". */
export function cupMatchScore(m: UserCupMatch): string | undefined {
  if (!m.played) return undefined
  const [h, a] = m.home ? [m.gf, m.ga] : [m.ga, m.gf]
  const agg = m.aggregate && m.leg === 2 ? (m.home ? [m.aggregate.gf, m.aggregate.ga] : [m.aggregate.ga, m.aggregate.gf]) : null
  const pens = m.penalties ? (m.home ? `${m.penalties.gf}-${m.penalties.ga}p` : `${m.penalties.ga}-${m.penalties.gf}p`) : ''
  const extra = [agg ? `agg ${agg[0]}-${agg[1]}` : m.et ? 'aet' : '', pens].filter(Boolean).join(', ')
  return extra ? `${h}-${a} (${extra})` : `${h}-${a}`
}
