/**
 * Player conversations (Football Manager depth, round 8): sit a player down
 * about his form, his football, his role or his future, and choose how to put
 * it. How he takes it follows his personality (`personality.ts`), his form,
 * his minutes against his squad status and his morale: no dice. Praise and
 * criticism stay the one-to-ones of `talks.ts`; this adds the topics. One
 * conversation a week per player, shared with those one-to-ones
 * (`Game.talks`), and every morale change goes through `logMorale`.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { EXPECTED_SHARE, naturalStatus, STATUS_LABEL, STATUS_RANK, STATUSES, type SquadStatus } from '@engine/status'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { playerLookup } from './players'
import { personalityOf, type PersonalityId } from './personality'
import { surnameOf } from './talks'
import { recentShare } from './week'
import { squadOveralls } from './marketOps'
import { setSquadStatus } from './squad'
import { makePromise, promiseProblem } from './promises'
import { shiftMorale, weekOf } from './officeCore'

export type ConversationTopic = 'form' | 'minutes' | 'role' | 'future'
export type ConversationTone = 'encourage' | 'demand' | 'explain' | 'promise' | 'promote' | 'project'

/** Each topic's answers, in the order the Office shows them. */
export const TOPIC_TONES: Record<ConversationTopic, ConversationTone[]> = {
  form: ['encourage', 'demand'],
  minutes: ['explain', 'demand', 'promise'],
  role: ['explain', 'promote', 'promise'],
  future: ['project', 'promise'],
}

/** Thick and thin skins: how a personality takes a hard word (−1 badly, 1 well). */
export const HARD_WORD: Record<PersonalityId, number> = { model: 1, professional: 1, steady: 0.5, driven: 0.5, 'big-game': 0, balanced: 0, mercurial: -0.5, fickle: -0.5, casual: -1, temperamental: -1 }

export interface ConversationResult {
  ok: boolean
  message: string
  /** His morale change, after the clamp. */
  delta?: number
}

/** His average rating over the last three matches, or null with fewer than two. */
function formOf(ratings: number[]): number | null {
  const r = ratings.slice(-3)
  return r.length >= 2 ? r.reduce((a, b) => a + b, 0) / r.length : null
}

/** Why he cannot be spoken to now, or null. */
export function conversationProblem(game: Game, u: LoadedUniverse, id: string): string | null {
  const p = playerLookup(game, u)(id)
  if (!p || !game.squad[id]) return 'He is not in your squad.'
  if (game.talks?.[id] === weekOf(game)) return `You have already spoken to ${p.name} this week.`
  return null
}

/** Sit him down: `topic` put with `tone`. */
export function converse(game: Game, u: LoadedUniverse, id: string, topic: ConversationTopic, tone: ConversationTone): ConversationResult {
  const problem = conversationProblem(game, u, id)
  if (problem) return { ok: false, message: problem }
  if (!TOPIC_TONES[topic].includes(tone)) return { ok: false, message: 'That is not how this conversation goes.' }
  const p = playerLookup(game, u)(id)!
  const s = game.squad[id]
  const c = game.contracts[id]
  const week = weekOf(game)
  const name = surnameOf(p.name)
  const personality = personalityOf(p).id
  const skin = HARD_WORD[personality]
  const form = formOf(s.recentRatings)
  const status: SquadStatus = c?.status ?? 'rotation'
  const share = recentShare(s)
  const short = share !== null && share < EXPECTED_SHARE[status] - 0.15
  let delta = 0
  let message = ''
  let note = ''
  switch (topic) {
    case 'form':
      note = 'Talk about his form'
      if (tone === 'encourage') {
        if (form === null) [delta, message] = [2, `${name} says he is ready whenever you need him.`]
        else if (form < 6.6) [delta, message] = [skin >= 0.5 ? 5 : 3, `${name} appreciates the arm round the shoulder. He knows he has to be better.`]
        else [delta, message] = [3, `${name} is enjoying his football and says so.`]
      } else {
        if (form !== null && form >= 7.2) [delta, message] = [-8, `${name} cannot believe it. He has been one of your best.`]
        else if (skin >= 0.5) {
          delta = -1
          s.sharpness = Math.min(100, s.sharpness + 5)
          message = `${name} takes it on the chin and stays behind after training. Sharpness up.`
        } else if (skin <= -0.5) [delta, message] = [-7, `${name} storms out. He thinks you have it in for him.`]
        else [delta, message] = [-3, `${name} nods, but he did not like hearing it.`]
      }
      break
    case 'minutes':
      note = 'Talk about his football'
      if (tone === 'explain') {
        if (!short) [delta, message] = [2, `${name} accepts that. He is getting the football he expected.`]
        else if (skin >= 0.5) [delta, message] = [2, `${name} understands, for now. He wants his chance soon.`]
        else [delta, message] = [skin <= -0.5 ? -5 : -2, `${name} has heard it before. He wants to play.`]
      } else if (tone === 'demand') {
        if (skin >= 0.5) {
          delta = 0
          s.sharpness = Math.min(100, s.sharpness + 4)
          message = `${name} will prove it in training. Sharpness up.`
        } else [delta, message] = [skin <= -0.5 ? -6 : -3, `${name} thinks he has earned it already.`]
      } else {
        const made = makePromise(game, u, id, 'minutes')
        if (!made.ok) return made
        message = made.message
      }
      break
    case 'role': {
      note = 'Talk about his role'
      const natural = naturalStatus(p, squadOveralls(game, u, id))
      const undervalued = STATUS_RANK[natural] > STATUS_RANK[status]
      if (tone === 'explain') {
        if (!undervalued) [delta, message] = [3, `${name} sees where he stands as ${STATUS_LABEL[status].toLowerCase()} and is content.`]
        else [delta, message] = [personality === 'driven' || skin <= -0.5 ? -6 : -2, `${name} sees himself as ${STATUS_LABEL[natural].toLowerCase()}, not ${STATUS_LABEL[status].toLowerCase()}.`]
      } else if (tone === 'promote') {
        const up = STATUSES[Math.max(0, STATUSES.indexOf(status) - 1)]
        if (up === status) return { ok: false, message: `${name} is already a key player.` }
        if (c?.loan) return { ok: false, message: `${name} is on loan: his terms are his parent club's.` }
        // The status change itself moves his morale and his wage (`setSquadStatus`)
        setSquadStatus(game, u, id, up)
        message = `${name} is now ${STATUS_LABEL[up].toLowerCase()}: he expects ${Math.round(EXPECTED_SHARE[up] * 100)}% of the minutes, and his wage follows.`
      } else {
        const made = makePromise(game, u, id, 'contract')
        if (!made.ok) return made
        message = made.message
      }
      break
    }
    case 'future': {
      note = 'Talk about his future'
      const season = game.season
      if (tone === 'project') {
        const pos = season ? positionOf(seasonTable(season), USER_TEAM) : 0
        const clubs = season ? Object.keys(season.ai).length + 1 : 20
        const good = !season || season.matchweek < 4 || pos <= Math.ceil(clubs / 2)
        if (good) [delta, message] = [personality === 'driven' || personality === 'big-game' ? 6 : 4, `${name} buys into the project. He wants to win things here.`]
        else [delta, message] = [personality === 'driven' ? -4 : -1, `${name} looks at the table and is not sold.`]
      } else {
        const problem = promiseProblem(game, u, id, 'signing')
        if (problem) return { ok: false, message: problem }
        const made = makePromise(game, u, id, 'signing')
        if (!made.ok) return made
        message = `${made.message} He wants to see ambition.`
      }
      break
    }
  }
  const applied = delta ? shiftMorale(s, week, delta, note) : 0
  ;(game.talks ??= {})[id] = week
  return { ok: true, message, delta: applied }
}
