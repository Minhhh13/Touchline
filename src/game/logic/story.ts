import type { LoadedUniverse } from '@engine/universe'
import type { LeagueSeasonRow, SeasonTier } from '@engine/types'
import { matchweeksFor, USER_TEAM } from '@engine/season'
import { clinchMatchweeks } from '@engine/story'
import { ordinal } from '@engine/awards'
import type { Game, QuickGameResult } from '../types'
import { bestWin, outcomeOf, recordUserGames, type Outcome } from './gameByGame'
import { playerLookup } from './players'

/** A run of consecutive games, by the matchweeks it spans. */
export interface StoryRun {
  length: number
  from: number
  to: number
}

export interface SeasonStory {
  /** The games the story was told from. */
  results: QuickGameResult[]
  /** One cell per game, in the order they were played. */
  strip: Outcome[]
  winRun: StoryRun | null
  unbeatenRun: StoryRun | null
  cleanSheets: number
  /** Games the user failed to score in. */
  blanks: number
  best: QuickGameResult | null
  worst: QuickGameResult | null
  /** The first game that dropped points after a winning start, with the wins before it. */
  startEnded: { wins: number; game: QuickGameResult } | null
  /** Undefined when not known (a quick save written before the story existed). */
  clinchedAt: number | null | undefined
  doomedAt: number | null | undefined
  /** The one line that tells the season. */
  moment: string
}

export interface StoryContext {
  clinchedAt: number | null | undefined
  doomedAt: number | null | undefined
  tier: SeasonTier
  /** League matchweeks in the season (38 for 20 clubs). */
  matchweeks: number
  /** Clubs in the league, for the drop zone when the doom week is not known. */
  clubs: number
  nameOf: (teamId: string) => string
  /** The board sacked the manager: the season stops at the last game played. */
  sacked?: boolean
}

/** The minimum length a winning start needs before its end is the story. */
export const STORY_START_MIN = 8
/** The minimum winning run worth a line of its own. */
export const STORY_RUN_MIN = 6

function longestRun(results: QuickGameResult[], keep: (o: Outcome) => boolean): StoryRun | null {
  let best: StoryRun | null = null
  let cur: StoryRun | null = null
  for (const r of results) {
    if (keep(outcomeOf(r))) {
      cur = cur ? { length: cur.length + 1, from: cur.from, to: r.matchweek } : { length: 1, from: r.matchweek, to: r.matchweek }
      if (!best || cur.length > best.length) best = cur
    } else cur = null
  }
  return best
}

/** The heaviest defeat: widest margin, then most goals conceded, then the earliest matchweek. */
export function worstDefeat(results: QuickGameResult[]): QuickGameResult | null {
  let worst: QuickGameResult | null = null
  for (const r of results) {
    if (r.gf >= r.ga) continue
    if (!worst || r.ga - r.gf > worst.ga - worst.gf || (r.ga - r.gf === worst.ga - worst.gf && r.ga > worst.ga)) worst = r
  }
  return worst
}

/** The closest call of a perfect season: the smallest margin, then the fewest goals scored, then the latest matchweek. */
export function closestCall(results: QuickGameResult[]): QuickGameResult | null {
  let c: QuickGameResult | null = null
  for (const r of results) {
    if (r.gf <= r.ga) continue
    if (!c || r.gf - r.ga < c.gf - c.ga || (r.gf - r.ga === c.gf - c.ga && (r.gf < c.gf || (r.gf === c.gf && r.matchweek > c.matchweek)))) c = r
  }
  return c
}

/** "1-0 v Spurs (MW 31)", or "at Spurs" away. */
export function gameLabel(r: QuickGameResult, nameOf: (teamId: string) => string): string {
  return `${r.gf}-${r.ga} ${r.home ? 'v' : 'at'} ${nameOf(r.opponentId)} (MW ${r.matchweek})`
}

/** The first matchweek from which the position stayed inside `ok` to the end, or null when the last game is outside it. */
function since(results: QuickGameResult[], ok: (position: number) => boolean): number | null {
  let from: number | null = null
  for (const r of results) {
    if (ok(r.position)) from ??= r.matchweek
    else from = null
  }
  return from
}

/**
 * The shape of a season from the user's games: the strip, the runs, clean
 * sheets and blanks, the best and worst results, the end of a winning start
 * and one `moment` line chosen by priority (perfect, invincible, champions,
 * relegated, a long winning start that ended, a winning run, the best
 * result). Pure; the results already exist, so nothing here draws a number.
 */
export function seasonStory(results: QuickGameResult[], ctx: StoryContext): SeasonStory {
  const strip = results.map(outcomeOf)
  const winRun = longestRun(results, (o) => o === 'W')
  const unbeatenRun = longestRun(results, (o) => o !== 'L')
  const firstDropped = strip.findIndex((o) => o !== 'W')
  const startEnded = firstDropped > 0 ? { wins: firstDropped, game: results[firstDropped] } : null
  const story: SeasonStory = {
    results,
    strip,
    winRun,
    unbeatenRun,
    cleanSheets: results.filter((r) => r.ga === 0).length,
    blanks: results.filter((r) => r.gf === 0).length,
    best: bestWin(results),
    worst: worstDefeat(results),
    startEnded,
    clinchedAt: ctx.clinchedAt,
    doomedAt: ctx.doomedAt,
    moment: '',
  }
  story.moment = momentLine(results, story, ctx)
  return story
}

function momentLine(results: QuickGameResult[], s: SeasonStory, ctx: StoryContext): string {
  const name = ctx.nameOf
  const lastDay = (week: number) => week >= ctx.matchweeks || !results.some((r) => r.matchweek > week)
  const toPlay = (week: number) => results.filter((r) => r.matchweek > week).length
  const won = s.strip.filter((o) => o === 'W').length
  if (ctx.sacked) return `🪑 Sacked after MW ${results.at(-1)?.matchweek ?? 0}`
  if (ctx.tier === 'PERFECT') {
    const c = closestCall(results)
    return `💎 ${won} from ${results.length}${c ? ` · closest call ${gameLabel(c, name)}` : ''}`
  }
  const title = (): string => {
    const c = ctx.clinchedAt
    if (c === undefined) {
      const top = since(results, (p) => p === 1)
      return top !== null && !lastDay(top) ? `top from MW ${top}` : 'won on the last day'
    }
    if (c === null || lastDay(c)) return 'won on the last day'
    return `title sealed at MW ${c}`
  }
  if (ctx.tier === 'INVINCIBLE') return `🛡️ Unbeaten · ${title()}`
  if (ctx.tier === 'CHAMPIONS') {
    const c = ctx.clinchedAt
    if (c === undefined) {
      const t = title()
      return t === 'won on the last day' ? '🏁 Won it on the last day' : `🏆 Champions · ${t}`
    }
    if (c === null || lastDay(c)) return '🏁 Won it on the last day'
    return `🏆 Title sealed at MW ${c} with ${toPlay(c)} to play`
  }
  if (ctx.tier === 'RELEGATED') {
    const d = ctx.doomedAt
    if (d === undefined) {
      const down = since(results, (p) => p > ctx.clubs - 3)
      return down !== null && !lastDay(down) ? `⬇️ In the bottom three from MW ${down}` : '⬇️ Relegated on the last day'
    }
    if (d === null || lastDay(d)) return '⬇️ Relegated on the last day'
    return `⬇️ Down at MW ${d}`
  }
  if (s.startEnded && s.startEnded.wins >= STORY_START_MIN) {
    const g = s.startEnded.game
    return `💔 ${s.startEnded.wins}-0 until MW ${g.matchweek}: ${g.gf}-${g.ga} ${g.home ? 'v' : 'at'} ${name(g.opponentId)}`
  }
  if (s.winRun && s.winRun.length >= STORY_RUN_MIN) return `📈 ${s.winRun.length}-match winning run (MW ${s.winRun.from}-${s.winRun.to})`
  if (s.best) return `💥 Best: ${gameLabel(s.best, name)}`
  if (s.unbeatenRun) return `🧱 Unbeaten in ${s.unbeatenRun.length} (MW ${s.unbeatenRun.from}-${s.unbeatenRun.to}), never a win`
  return `🥶 ${results.length} played, ${results.length} lost`
}

/**
 * The story of the game on the summary screen, for every mode with a league
 * season: a quick season reads its stored results (and the clinch weeks
 * stored with them; an older save without them is retold from the positions),
 * Season and Dynasty retell the finished season's fixtures. Null when there
 * are no games to tell (a quick save written before the results existed).
 */
export function storyForGame(game: Game, u: LoadedUniverse): SeasonStory | null {
  const nameOf = (id: string) => u.clubById[id]?.name ?? id
  const tier = game.tier ?? 'MID_TABLE'
  const q = game.quickResult
  if (q) {
    if (!q.results?.length) return null
    const story = seasonStory(q.results, { clinchedAt: q.clinchedAt, doomedAt: q.doomedAt, tier, matchweeks: matchweeksFor(q.table.length), clubs: q.table.length, nameOf })
    // The line written when the season was played wins over a retelling
    return q.moment ? { ...story, moment: q.moment } : story
  }
  const season = game.season
  if (!season) return null
  const ids = [USER_TEAM, ...Object.keys(season.ai)]
  const get = playerLookup(game, u)
  const results = recordUserGames(season.fixtures, ids, USER_TEAM, (id) => get(id)?.name)
  if (!results.length) return null
  const clinch = clinchMatchweeks(season.fixtures, ids, USER_TEAM)
  return seasonStory(results, { ...clinch, tier, matchweeks: season.matchweeks, clubs: ids.length, nameOf, sacked: season.sacked })
}

/** How the club the user replaced really did that season, when its club-season is complete and the league has the table. */
export function realSeasonRow(u: LoadedUniverse, leagueId: string, leagueSeason: number, hostClubId: string): LeagueSeasonRow | null {
  const cs = u.clubSeasonByKey[`${hostClubId}@${leagueSeason}`]
  if (!cs?.complete) return null
  return u.tables[leagueId]?.[leagueSeason]?.find((r) => r.clubId === hostClubId) ?? null
}

/** "📊 The real Burnley finished 19th on 22 · you 1st on 93". */
export function realityLine(real: Pick<LeagueSeasonRow, 'position' | 'points'>, hostName: string, mine: { position: number; points: number }): string {
  return `📊 The real ${hostName} finished ${ordinal(real.position)} on ${real.points} · you ${ordinal(mine.position)} on ${mine.points}`
}
