/**
 * Dressing-room and media events: the Football Manager flavour layer.
 * Each event has a condition, a few choices, and consequences expressed as
 * small, legible changes to morale, condition, confidence or the squad.
 */
import type { PlayerSeason, SquadPlayer } from './types'
import type { Rng } from './rng'

export interface EventChoice {
  id: string
  label: string
  hint: string
}

export interface GameEvent {
  id: string
  title: string
  body: string
  choices: EventChoice[]
  /** Player this event is about, if any. */
  playerSeasonId?: string
  /** Second player, if any. */
  otherPlayerSeasonId?: string
}

export interface EventContext {
  rng: Rng
  matchweek: number
  squad: Array<{ p: PlayerSeason; s: SquadPlayer; consecutiveMissed: number }>
  unbeaten: boolean
  wins: number
  losses: number
  position: number
  boardTarget: number
  confidence: number
  nextOpponentIsRival: boolean
  budget: number
}

export interface EventOutcome {
  text: string
  moraleDelta?: Array<{ playerSeasonId: string; delta: number }>
  teamMoraleDelta?: number
  conditionDelta?: Array<{ playerSeasonId: string; delta: number }>
  confidenceDelta?: number
  budgetDelta?: number
  /** Promise to start a player next match; breaking it costs morale. */
  promiseStart?: string
  /** Temporary boost (%) to next match attack or defence. */
  nextMatchBoost?: { attack?: number; defence?: number }
  /** Player leaves the squad. */
  releasePlayer?: string
  /** Set captain. */
  captain?: string
}

export function rollEvent(ctx: EventContext): GameEvent | null {
  const { rng, squad } = ctx
  const candidates: Array<{ weight: number; make: () => GameEvent | null }> = []

  // A star wants minutes
  const benched = squad.filter((x) => x.consecutiveMissed >= 3 && x.p.overall >= 78 && !x.s.injury)
  if (benched.length) {
    candidates.push({
      weight: 3,
      make: () => {
        const x = rng.pick(benched)
        return {
          id: 'wants-minutes',
          title: `${x.p.name} wants to talk`,
          body: `${x.p.name} has knocked on your door. He has not started in ${x.consecutiveMissed} matches and feels he deserves a place in the side.`,
          playerSeasonId: x.p.id,
          choices: [
            { id: 'promise', label: 'Promise him a start', hint: 'Morale up now. Break it and it hurts.' },
            { id: 'earn', label: 'Tell him to earn it', hint: 'He may sulk, or he may respond.' },
            { id: 'listen', label: 'Hear him out, promise nothing', hint: 'Small, safe gain.' },
          ],
        }
      },
    })
  }

  // Press asks about the perfect season
  if (ctx.unbeaten && ctx.matchweek >= 10 && ctx.wins >= 8) {
    candidates.push({
      weight: 2,
      make: () => ({
        id: 'press-unbeaten',
        title: 'Press conference: can you go unbeaten?',
        body: `${ctx.wins} wins from ${ctx.matchweek}. The press want to know whether a perfect season is on.`,
        choices: [
          { id: 'embrace', label: 'Embrace it: we are here to make history', hint: 'Lifts the squad. Adds pressure in big games.' },
          { id: 'deflect', label: 'One game at a time', hint: 'Nothing changes.' },
          { id: 'dismiss', label: 'Laugh it off', hint: 'Takes the pressure off. Slight morale dip.' },
        ],
      }),
    })
  }

  // Training ground bust-up between two players of the same position group
  if (squad.length >= 14 && rng.chance(0.5)) {
    candidates.push({
      weight: 1.5,
      make: () => {
        const a = rng.pick(squad)
        const b = rng.pick(squad.filter((x) => x !== a && x.p.positions[0] === a.p.positions[0]))
        if (!b) return null
        return {
          id: 'bust-up',
          title: 'Training ground bust-up',
          body: `${a.p.name} and ${b.p.name} had to be separated in training after a heavy challenge. The squad is watching how you handle it.`,
          playerSeasonId: a.p.id,
          otherPlayerSeasonId: b.p.id,
          choices: [
            { id: 'fine-both', label: 'Fine both players', hint: 'Both lose a little morale; squad respects the discipline.' },
            { id: 'side-a', label: `Back ${a.p.name}`, hint: `${a.p.name} up, ${b.p.name} down.` },
            { id: 'side-b', label: `Back ${b.p.name}`, hint: `${b.p.name} up, ${a.p.name} down.` },
            { id: 'ignore', label: 'Let them sort it out', hint: 'Could go either way.' },
          ],
        }
      },
    })
  }

  // Derby week hype
  if (ctx.nextOpponentIsRival) {
    candidates.push({
      weight: 3,
      make: () => ({
        id: 'derby',
        title: 'Derby week',
        body: 'The city is talking about nothing else. Your captain asks how you want the week to feel.',
        choices: [
          { id: 'hype', label: 'Feed the fire', hint: 'Attack boost, discipline risk.' },
          { id: 'calm', label: 'Treat it like any other game', hint: 'Steady defence boost.' },
        ],
      }),
    })
  }

  // Board check-in when behind target
  if (ctx.matchweek >= 12 && ctx.position > ctx.boardTarget + 3 && ctx.confidence < 50) {
    candidates.push({
      weight: 2.5,
      make: () => ({
        id: 'board',
        title: 'The board wants a word',
        body: `You sit ${ctx.position}th; the board expected ${ordinal(ctx.boardTarget)}. They want to hear a plan.`,
        choices: [
          { id: 'backing', label: 'Ask for backing in the market', hint: 'Budget up if they agree, confidence down if not.' },
          { id: 'time', label: 'Ask for time', hint: 'Small confidence recovery, nothing else.' },
          { id: 'blame', label: 'Blame the players', hint: 'Board like it; dressing room does not.' },
        ],
      }),
    })
  }

  // Youth prospect catching the eye / free agent pitched by an agent
  if (rng.chance(0.5)) {
    candidates.push({
      weight: 1.2,
      make: () => ({
        id: 'agent',
        title: 'An agent calls',
        body: 'An agent is pitching a client who is between clubs. He will not say who until you agree to a meeting, but promises he can play at this level.',
        choices: [
          { id: 'meet', label: 'Take the meeting', hint: 'A bonus spin of the wheel for a free agent.' },
          { id: 'pass', label: 'Not interested', hint: 'Nothing happens.' },
        ],
      }),
    })
  }

  // Fatigue warning from the physio
  const tired = squad.filter((x) => x.s.condition < 65 && !x.s.injury)
  if (tired.length >= 3) {
    candidates.push({
      weight: 2,
      make: () => ({
        id: 'physio',
        title: 'Physio: the squad is running on empty',
        body: `${tired.length} players are below 65% condition. The physio suggests a lighter week.`,
        choices: [
          { id: 'rest', label: 'Give them two days off', hint: 'Condition up across the squad, sharpness slightly down.' },
          { id: 'push', label: 'Push through it', hint: 'Nothing changes. Injury risk stays high.' },
        ],
      }),
    })
  }

  // Captaincy
  if (ctx.matchweek === 1 || (ctx.matchweek === 20 && rng.chance(0.5))) {
    candidates.push({
      weight: 4,
      make: () => {
        const leaders = [...squad].sort((a, b) => b.p.attributes.mentality + b.p.age - (a.p.attributes.mentality + a.p.age)).slice(0, 3)
        if (leaders.length < 2) return null
        return {
          id: 'captain',
          title: 'Name your captain',
          body: 'The dressing room needs a leader. Your senior players have been talking about who it should be.',
          choices: leaders.map((x) => ({ id: `cap:${x.p.id}`, label: x.p.name, hint: `${x.p.age} years old, mentality ${x.p.attributes.mentality}` })),
        }
      },
    })
  }

  if (!candidates.length) return null
  const chosen = rng.pickWeighted(candidates, (c) => c.weight)
  return chosen.make()
}

export function resolveEvent(ev: GameEvent, choiceId: string, ctx: EventContext): EventOutcome {
  const { rng } = ctx
  const p = ev.playerSeasonId
  const q = ev.otherPlayerSeasonId
  switch (ev.id) {
    case 'wants-minutes':
      if (choiceId === 'promise') return { text: 'He leaves happy. You had better start him.', moraleDelta: [{ playerSeasonId: p!, delta: 12 }], promiseStart: p }
      if (choiceId === 'earn') {
        const player = ctx.squad.find((x) => x.p.id === p)
        const responds = rng.chance(0.4 + (player?.p.traits.professionalism ?? 0.5) * 0.4)
        return responds ? { text: 'He takes it on the chin and trains like a demon.', moraleDelta: [{ playerSeasonId: p!, delta: 4 }], conditionDelta: [{ playerSeasonId: p!, delta: 3 }] } : { text: 'He storms out. The squad noticed.', moraleDelta: [{ playerSeasonId: p!, delta: -10 }], teamMoraleDelta: -1 }
      }
      return { text: 'A civil chat. He appreciates being heard.', moraleDelta: [{ playerSeasonId: p!, delta: 4 }] }
    case 'press-unbeaten':
      if (choiceId === 'embrace') return { text: 'The players walk taller. Big games will carry more weight now.', teamMoraleDelta: 5 }
      if (choiceId === 'dismiss') return { text: 'Pressure off, but a few players wanted you to back them.', teamMoraleDelta: -2, confidenceDelta: 1 }
      return { text: 'Nothing to see here.' }
    case 'bust-up':
      if (choiceId === 'fine-both') return { text: 'Both fined a week\'s wages. The rest of the squad nods.', moraleDelta: [{ playerSeasonId: p!, delta: -5 }, { playerSeasonId: q!, delta: -5 }], teamMoraleDelta: 2 }
      if (choiceId === 'side-a') return { text: 'You backed one side. The other will remember.', moraleDelta: [{ playerSeasonId: p!, delta: 6 }, { playerSeasonId: q!, delta: -9 }] }
      if (choiceId === 'side-b') return { text: 'You backed one side. The other will remember.', moraleDelta: [{ playerSeasonId: q!, delta: 6 }, { playerSeasonId: p!, delta: -9 }] }
      return rng.chance(0.5) ? { text: 'They shook hands by Thursday.', teamMoraleDelta: 1 } : { text: 'It festered. The dressing room is split.', teamMoraleDelta: -4 }
    case 'derby':
      if (choiceId === 'hype') return { text: 'The week crackles. Expect tackles.', nextMatchBoost: { attack: 5 }, teamMoraleDelta: 2 }
      return { text: 'Calm heads. Shape first.', nextMatchBoost: { defence: 4 } }
    case 'board':
      if (choiceId === 'backing') return rng.chance(0.5) ? { text: 'They release funds. Deliver.', budgetDelta: 20, confidenceDelta: -3 } : { text: 'They decline, and they are not impressed you asked.', confidenceDelta: -6 }
      if (choiceId === 'time') return { text: 'They grant you a few weeks.', confidenceDelta: 4 }
      return { text: 'The board accepts the explanation. The players read about it in the papers.', confidenceDelta: 5, teamMoraleDelta: -6 }
    case 'agent':
      if (choiceId === 'meet') return { text: 'You agree to meet the player. Spin to see who turns up.', captain: undefined, nextMatchBoost: undefined, releasePlayer: undefined, promiseStart: undefined, budgetDelta: 0, moraleDelta: [], teamMoraleDelta: 0, conditionDelta: [], confidenceDelta: 0 }
      return { text: 'You pass.' }
    case 'physio':
      if (choiceId === 'rest') return { text: 'Two days off. Fresh legs, slightly rusty touch.', conditionDelta: ctx.squad.map((x) => ({ playerSeasonId: x.p.id, delta: 8 })), teamMoraleDelta: 2 }
      return { text: 'The physio shrugs and restocks the ice.' }
    case 'captain': {
      const id = choiceId.replace('cap:', '')
      return { text: 'The armband is handed over.', captain: id, moraleDelta: [{ playerSeasonId: id, delta: 8 }], teamMoraleDelta: 1 }
    }
  }
  return { text: 'Nothing happens.' }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
