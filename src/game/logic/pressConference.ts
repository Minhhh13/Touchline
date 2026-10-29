/**
 * Press conferences (Football Manager depth, round 8), optional: once a
 * matchweek the manager may face the media before the next match. The
 * questions follow the week (the next opponent, the run of results, a player
 * who wants out, the board's mood, a prospect, the title race), three of them
 * chosen by a pure hash of the game and the week; each answer moves the
 * squad's morale, one player's or the board's confidence by fixed amounts.
 * Skipping it changes nothing. Before a big league match (a derby, a title
 * decider, a run-in) the press asks about it, and a manager who says "we
 * will win it" is held to it after the match (`settleBoast`): a win lifts the
 * squad and the board, a defeat costs the board. No draws. The words are the screen's
 * (`src/ui/i18n/en/office.ts`); this module holds only ids and effects.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { hashUnit } from './scouting'
import { nextOpponent } from './week'
import { personalityOf } from './personality'
import { playerLookup } from './players'
import { officeOf, postOfficeNews, shiftMorale, squadIdOf, weekOf } from './officeCore'
import { openRequests } from './transferRequests'
import { nextStop, type StopReason } from './seasonHighlights'

export type PressQuestion = 'opponent' | 'good-run' | 'bad-run' | 'wantaway' | 'board' | 'prospect' | 'title' | 'big-match' | 'big-tie'

export interface PressEffect {
  /** Every squad man's morale. */
  team?: number
  /** The player the question is about. */
  player?: number
  /** Board confidence. */
  board?: number
}

/** Each question's answers and what they do. */
export const PRESS_ANSWERS: Record<PressQuestion, Record<string, PressEffect>> = {
  opponent: { respect: { team: 1 }, confident: { team: 2, board: 1 }, 'mind-games': { team: 3, board: -1 } },
  'good-run': { 'credit-players': { team: 3 }, 'more-to-come': { board: 2 }, 'luck': { team: -2, board: -1 } },
  'bad-run': { 'take-blame': { team: 3, board: -2 }, 'players-improve': { team: -3, board: 2 }, 'stay-calm': { team: 1 } },
  wantaway: { 'going-nowhere': { player: -4, team: 1, board: 2 }, 'his-choice': { player: 4, team: -1 }, 'no-comment': {} },
  board: { 'full-backing': { board: 3 }, 'judge-me': { board: 1 }, unfair: { board: -3, team: 2 } },
  prospect: { 'big-future': { player: 5, team: -1 }, patience: { player: 1 }, 'no-pressure': { player: 2 } },
  title: { favourites: { team: 2, board: 2 }, 'one-game': { team: 1 }, 'others-favourites': { team: -1, board: -1 } },
  'big-match': { 'we-will-win': { team: 2 }, 'relish-it': { team: 2, board: 1 }, 'just-three-points': { team: 1 } },
  'big-tie': { 'relish-it': { team: 2, board: 1 }, 'one-step': { team: 1 }, underdogs: { team: -1, board: 1 } },
}

/** The answer that holds the manager to a win, and what it does once the match is played. */
export const BOAST_ANSWER = 'we-will-win'
export const BOAST_WON = { team: 2, board: 3 } as const
export const BOAST_LOST = { team: -1, board: -4 } as const

/** Stops that bring the press's big-match question: league matches, and the cups' semi-finals and finals. */
const BIG_LEAGUE: ReadonlyArray<StopReason['kind']> = ['derby', 'title-decider', 'title-run-in', 'survival-run-in', 'brief']
const BIG_TIE: ReadonlyArray<StopReason['kind']> = ['final', 'semi-final']

/** The big match the press wants to talk about this week, if the next one is (`nextStop`'s match stops). Pure. */
export function bigMatchOf(game: Game, u: LoadedUniverse): StopReason | null {
  const stop = nextStop(game, u)
  return stop && (BIG_LEAGUE.includes(stop.kind) || BIG_TIE.includes(stop.kind)) ? stop : null
}

/** Questions a conference holds. */
export const PRESS_QUESTIONS = 3

/** The player a question is about, if it is about one. */
export function pressSubject(game: Game, u: LoadedUniverse, q: PressQuestion): string | undefined {
  if (q === 'wantaway') {
    const req = openRequests(game)[0] ?? Object.values(game.office?.requests ?? {}).find((r) => r.stage === 'refused' && r.year === game.year)
    return req ? squadIdOf(game, u, req.playerId) : undefined
  }
  if (q === 'prospect') {
    const get = playerLookup(game, u)
    return Object.keys(game.squad)
      .filter((id) => game.contracts[id]?.status === 'prospect')
      .sort((a, b) => (get(b)?.overall ?? 0) - (get(a)?.overall ?? 0) || a.localeCompare(b))[0]
  }
  return undefined
}

/** Results of the last three league matches, newest last. */
function lastResults(game: Game): Array<'W' | 'D' | 'L'> {
  const s = game.season
  if (!s) return []
  return s.fixtures
    .filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
    .sort((a, b) => a.matchweek - b.matchweek)
    .slice(-3)
    .map((f) => {
      const home = f.homeTeamId === USER_TEAM
      const gf = home ? f.result!.homeGoals : f.result!.awayGoals
      const ga = home ? f.result!.awayGoals : f.result!.homeGoals
      return gf > ga ? 'W' : gf === ga ? 'D' : 'L'
    })
}

/** Whether a conference can be held now, and why not. */
export function pressProblem(game: Game): string | null {
  const s = game.season
  if (!s || s.sacked || s.matchweek >= s.matchweeks) return 'There is no match to talk about.'
  if (game.live) return 'Finish the match first.'
  return null
}

/** The questions this week's conference would ask (the same all week). */
export function pressQuestions(game: Game, u: LoadedUniverse): PressQuestion[] {
  const s = game.season
  if (!s) return []
  const held = game.office?.press
  if (held && held.year === game.year && held.week === s.matchweek) return held.questions as PressQuestion[]
  const pool: PressQuestion[] = []
  if (nextOpponent(game)) pool.push('opponent')
  const res = lastResults(game)
  if (res.length >= 3 && res.filter((r) => r === 'W').length >= 2) pool.push('good-run')
  if (res.length >= 3 && res.filter((r) => r === 'L').length >= 2) pool.push('bad-run')
  if (pressSubject(game, u, 'wantaway')) pool.push('wantaway')
  if (s.confidence < 50) pool.push('board')
  if (pressSubject(game, u, 'prospect')) pool.push('prospect')
  if (s.matchweek >= 10 && positionOf(seasonTable(s), USER_TEAM) <= 3) pool.push('title')
  // A big match is always asked about, first; the rest in a fixed order for the week from a hash of the game
  const big = bigMatchOf(game, u)
  const first: PressQuestion[] = big ? [BIG_TIE.includes(big.kind) ? 'big-tie' : 'big-match'] : []
  const key = `${game.settings.seed}|${game.year}|${s.matchweek}`
  const rest = pool
    .map((q) => ({ q, h: hashUnit(`press|${key}|${q}`) }))
    .sort((a, b) => a.h - b.h)
    .map((x) => x.q)
  // A big league match is the week's opponent question
  return [...first, ...rest.filter((q) => !(big && q === 'opponent'))].slice(0, PRESS_QUESTIONS)
}

/** What an answer does, as `answerPress` applies it: the player's share after his personality. Pure: the Office shows it on each answer. */
export function pressEffect(game: Game, u: LoadedUniverse, q: PressQuestion, answer: string): PressEffect | null {
  const effect = PRESS_ANSWERS[q]?.[answer]
  if (!effect) return null
  const subject = pressSubject(game, u, q)
  const out: PressEffect = {}
  if (effect.team) out.team = effect.team
  if (effect.player && subject) {
    const p = playerLookup(game, u)(subject)
    // A big-game player loves the spotlight; a temperamental one takes a hard line personally
    const kind = p ? personalityOf(p).id : 'balanced'
    out.player = effect.player > 0 && kind === 'big-game' ? effect.player + 2 : effect.player < 0 && kind === 'temperamental' ? effect.player - 2 : effect.player
  }
  if (effect.board) out.board = effect.board
  return out
}

/** Answer one of the week's questions. Each is answered once. */
export function answerPress(game: Game, u: LoadedUniverse, q: PressQuestion, answer: string): { ok: boolean; message: string } {
  const problem = pressProblem(game)
  if (problem) return { ok: false, message: problem }
  const s = game.season!
  const questions = pressQuestions(game, u)
  if (!questions.includes(q)) return { ok: false, message: 'Nobody asked that this week.' }
  const effect = pressEffect(game, u, q, answer)
  if (!effect) return { ok: false, message: 'That is not an answer to the question.' }
  const o = officeOf(game)
  if (!o.press || o.press.year !== game.year || o.press.week !== s.matchweek) o.press = { year: game.year, week: s.matchweek, questions, answers: {} }
  if (o.press.answers[q]) return { ok: false, message: 'You have answered that one.' }
  o.press.answers[q] = answer
  const week = weekOf(game)
  const subject = pressSubject(game, u, q)
  const parts: string[] = []
  if (effect.team) {
    for (const sp of Object.values(game.squad)) shiftMorale(sp, week, effect.team, 'Press conference')
    parts.push(effect.team > 0 ? 'the squad liked it' : 'the squad did not')
  }
  if (effect.player && subject) {
    const p = playerLookup(game, u)(subject)
    shiftMorale(game.squad[subject], week, effect.player, 'Press conference')
    parts.push(`${p?.name ?? 'he'} ${effect.player > 0 ? 'was pleased' : 'was not pleased'}`)
  }
  if (effect.board) {
    s.confidence = Math.max(0, Math.min(100, s.confidence + effect.board))
    parts.push(effect.board > 0 ? 'the board approved' : 'the board winced')
  }
  const big = q === 'big-match' && answer === BOAST_ANSWER ? bigMatchOf(game, u) : null
  if (big) {
    o.boast = { year: game.year, week: big.matchweek, ...(big.opponentClubId ? { opponentId: big.opponentClubId } : {}) }
    parts.push('the papers will hold you to it')
  }
  return { ok: true, message: parts.length ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : 'A quiet answer: nothing changes.' }
}

/** The league result of the user's match in matchweek `week`, if it has been played. */
function userResult(game: Game, week: number): 'W' | 'D' | 'L' | null {
  const f = game.season?.fixtures.find((x) => x.matchweek === week && x.result && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
  if (!f?.result) return null
  const home = f.homeTeamId === USER_TEAM
  const gf = home ? f.result.homeGoals : f.result.awayGoals
  const ga = home ? f.result.awayGoals : f.result.homeGoals
  return gf > ga ? 'W' : gf === ga ? 'D' : 'L'
}

/**
 * The boast comes home (the office's tick): once the big match is played, a win lifts the squad and the board, a
 * draw passes, a defeat costs the board and the dressing room. A boast from an earlier season, or for a week with no
 * league match of ours, is let go. Returns the result it settled on, or null.
 */
export function settleBoast(game: Game): 'W' | 'D' | 'L' | null {
  const o = game.office
  const b = o?.boast
  const s = game.season
  if (!o || !b) return null
  if (!s || b.year !== game.year) {
    delete o.boast
    return null
  }
  if (s.matchweek < b.week && !s.sacked) return null
  const r = userResult(game, b.week)
  delete o.boast
  if (!r) return null
  const week = weekOf(game)
  const fx = r === 'W' ? BOAST_WON : r === 'L' ? BOAST_LOST : null
  if (fx) {
    for (const sp of Object.values(game.squad)) shiftMorale(sp, week, fx.team, r === 'W' ? 'Backed up the boast' : 'The boast came back to bite')
    s.confidence = Math.max(0, Math.min(100, s.confidence + fx.board))
  }
  const title = r === 'W' ? 'You called it' : r === 'L' ? 'Words to eat' : 'A point, not the win you promised'
  const body = r === 'W' ? 'You said you would win it, and you did. The board likes a manager who delivers.' : r === 'L' ? 'You promised the press a win and lost. The back pages will not let it go.' : 'You promised a win and drew. The press let it pass, just.'
  postOfficeNews(game, { matchweek: b.week, kind: 'board', title, body })
  return r
}

/** The answers given this week, by question. */
export function pressAnswers(game: Game): Record<string, string> {
  const p = game.office?.press
  return p && p.year === game.year && p.week === (game.season?.matchweek ?? -1) ? p.answers : {}
}
