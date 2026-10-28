/**
 * The Stats tab's season records for the user's side: biggest win and heaviest defeat (our score first, as the
 * summary's Season story reads them), the runs, clean sheets and games scored in, over the league fixtures played.
 * Pure, no RNG.
 */
import { USER_TEAM, type SeasonState } from '@engine/season'

export interface SeasonRecords {
  played: number
  bigWin: string
  bigLoss: string
  bestUnbeaten: number
  bestWinning: number
  cleanSheets: number
  scoredIn: number
  unbeatenNow: number
  winningNow: number
}

/** Null before the first league match; `nameOf` names the opponent (a club id in). */
export function seasonRecords(season: SeasonState, nameOf: (clubId: string) => string): SeasonRecords | null {
  const mine = season.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)).sort((a, b) => a.matchweek - b.matchweek)
  if (!mine.length) return null
  type Game = { gf: number; ga: number; home: boolean; opp: string; matchweek: number }
  let bigWin: Game | null = null
  let bigLoss: Game | null = null
  let unbeaten = 0
  let bestUnbeaten = 0
  let winning = 0
  let bestWinning = 0
  let cleanSheets = 0
  let scoredIn = 0
  for (const f of mine) {
    const home = f.homeTeamId === USER_TEAM
    const g: Game = { gf: home ? f.result!.homeGoals : f.result!.awayGoals, ga: home ? f.result!.awayGoals : f.result!.homeGoals, home, opp: home ? f.awayTeamId : f.homeTeamId, matchweek: f.matchweek }
    const margin = g.gf - g.ga
    if (margin > 0 && (!bigWin || margin > bigWin.gf - bigWin.ga)) bigWin = g
    if (margin < 0 && (!bigLoss || margin < bigLoss.gf - bigLoss.ga)) bigLoss = g
    unbeaten = margin >= 0 ? unbeaten + 1 : 0
    winning = margin > 0 ? winning + 1 : 0
    bestUnbeaten = Math.max(bestUnbeaten, unbeaten)
    bestWinning = Math.max(bestWinning, winning)
    if (g.ga === 0) cleanSheets++
    if (g.gf > 0) scoredIn++
  }
  const describe = (g: Game | null) => (g ? `${g.gf}-${g.ga} ${g.home ? 'v' : 'at'} ${nameOf(g.opp)} (MW ${g.matchweek})` : '–')
  return { played: mine.length, bigWin: describe(bigWin), bigLoss: describe(bigLoss), bestUnbeaten, bestWinning, cleanSheets, scoredIn, unbeatenNow: unbeaten, winningNow: winning }
}
