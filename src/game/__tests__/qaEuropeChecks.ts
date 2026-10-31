/**
 * The Continental Cup's invariants (engine 7), shared by the QA sweeps of rounds 3 and 4: groups, tables, legs,
 * aggregates and the user's flags at any step of a Season or Dynasty.
 */
import { USER_TEAM } from '@engine/season'
import { continentalPlan, groupTable, tieScore } from '@engine/continental'
import type { Game } from '../types'

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
