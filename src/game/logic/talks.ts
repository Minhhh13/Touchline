/**
 * One-to-one conversations with players, Football Manager style. Each player
 * can be spoken to once a week; the right word at the right time lifts morale,
 * the wrong one costs you.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { playerLookup } from './players'

export type TalkKind = 'praise' | 'criticise' | 'promise' | 'reassure'

export const TALK_LABEL: Record<TalkKind, { label: string; hint: string }> = {
  praise: { label: 'Praise his form', hint: 'Works when he has actually been playing well.' },
  criticise: { label: 'Demand more', hint: 'A poor run and a professional player will respond; a star will not.' },
  promise: { label: 'Promise a start', hint: 'He expects to start the next match. Break it and he will not forget.' },
  reassure: { label: 'Reassure about his role', hint: 'For a fringe player whose head is dropping.' },
}

/** "de Gea", "van Dijk": keep the particle with the surname. */
export function surnameOf(name: string): string {
  const parts = name.split(' ')
  if (parts.length >= 3 && /^(de|van|di|da|del|der|von|la|le|dos|du|den|el|al|bin|ter)$/i.test(parts[parts.length - 2])) return parts.slice(-2).join(' ')
  return parts[parts.length - 1]
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function talkTo(game: Game, u: LoadedUniverse, id: string, kind: TalkKind): { message: string } {
  const s = game.squad[id]
  const p = playerLookup(game, u)(id)
  if (!s || !p) return { message: 'He is not in the squad.' }
  const week = game.season?.matchweek ?? 0
  const talks = (game.talks ??= {})
  if (talks[id] === week) return { message: `You have already spoken to ${p.name} this week. Leave it there.` }
  const recent = s.recentRatings.slice(-3)
  const form = recent.length >= 2 ? recent.reduce((a, b) => a + b, 0) / recent.length : null
  const pro = Math.max(0, Math.min(1, p.traits.professionalism))
  const isStarter = Object.values(game.lineup).includes(id)
  const surname = surnameOf(p.name)
  let delta = 0
  let message = ''
  switch (kind) {
    case 'praise':
      if (form === null) {
        delta = 3
        message = `${surname} is glad to hear it, but would rather show you on the pitch.`
      } else if (form >= 7.2) {
        delta = pro < 0.5 ? 10 : 8
        message = `${surname} appreciates it. He is enjoying his football.`
      } else if (form < 6.5) {
        delta = -4
        message = `${surname} knows he has been poor. He thinks you are being sarcastic.`
      } else {
        delta = 4
        message = `${surname} takes the compliment and gets back to work.`
      }
      break
    case 'criticise':
      if (form !== null && form <= 6.6) {
        if (pro < 0.4) {
          delta = -8
          message = `${surname} sulks. He does not think it is his fault.`
        } else {
          delta = -2
          s.sharpness = clamp(s.sharpness + 6)
          s.familiarity = clamp(s.familiarity + 2)
          message = `${surname} takes it on the chin and promises to work harder. Sharpness up.`
        }
      } else if (form !== null && form >= 7.2) {
        delta = -10
        message = `${surname} is furious. He has been one of your best players and he knows it.`
      } else {
        delta = -5
        message = `${surname} disagrees but says nothing. The dressing room noticed.`
      }
      break
    case 'promise': {
      if (game.promisedStart && game.promisedStart !== id) {
        const other = playerLookup(game, u)(game.promisedStart)
        return { message: `You have already promised ${other?.name ?? 'someone'} a start this week.` }
      }
      game.promisedStart = id
      delta = 6
      message = `${surname} expects to start the next match. Break the promise and he will not forget.`
      break
    }
    case 'reassure':
      if (isStarter) {
        delta = 1
        message = `${surname} did not need telling. He is in the team.`
      } else if (s.morale < 60) {
        delta = 7
        message = `${surname} accepts that his chance will come. For now.`
      } else {
        delta = 3
        message = `${surname} is fine with his role and says so.`
      }
      break
  }
  // Professionals shrug off harsh words; mavericks take them personally.
  if (delta < 0) delta *= 1.2 - 0.5 * pro
  s.morale = clamp(s.morale + delta)
  talks[id] = week
  return { message }
}
