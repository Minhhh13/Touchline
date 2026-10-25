/**
 * Dressing-room and media events: the Football Manager flavour layer.
 * Each event has a condition, a few choices, and consequences expressed as
 * small, legible changes to morale, condition, confidence or the squad.
 */
import type { PlayerSeason, SquadPlayer } from './types'
import type { Rng } from './rng'
import { EXPECTED_SHARE, STATUS_LABEL, STATUS_RANK, type SquadStatus } from './status'

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
  /** Players whose contracts end this season and have not yet been offered a renewal. */
  expiring: Array<{ p: PlayerSeason; s: SquadPlayer; status?: SquadStatus }>
  recentForm: Array<'W' | 'D' | 'L'>
  /** Did the last match beat a rival? */
  beatRival: boolean
  squad: Array<{
    p: PlayerSeason
    s: SquadPlayer
    consecutiveMissed: number
    /** Squad status on his contract (rotation when the game predates statuses). */
    status?: SquadStatus
    /** Share of the available minutes he has played over the last six matchweeks, null before any was recorded. */
    share?: number | null
    /** Short of his status's expected share by more than 0.25 over the last three matchweeks. */
    shortOfMinutes?: boolean
  }>
  unbeaten: boolean
  wins: number
  losses: number
  position: number
  boardTarget: number
  confidence: number
  nextOpponentIsRival: boolean
  budget: number
  /** The match just played, for post-match press conferences. */
  lastResult?: { gf: number; ga: number; opponentName: string; motmId?: string; scorerId?: string; competition: 'league' | 'cup' | 'continental' }
  /** Multi-season game: bonus spins are redeemed at the summer draft, so agents only call in a dynasty. */
  isDynasty?: boolean
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
  /** Renew the player's contract (dynasty): on this status, with wages multiplied by `wageRise`. */
  renewContract?: { playerSeasonId: string; fee: number; status?: SquadStatus; wageRise: number }
  /** Player declines renewal and will leave at season end. */
  declineContract?: string
  /** Mark a player as available for transfer. */
  transferList?: string
  /** Clear an injury now, with a chance of a setback. */
  clearInjury?: { playerSeasonId: string; setbackChance: number }
}

export function rollEvent(ctx: EventContext): GameEvent | null {
  const { rng, squad } = ctx
  const candidates: Array<{ weight: number; make: () => GameEvent | null }> = []

  // A star wants minutes: a benched 78+, or a key or first-team player well short of the football his status promised
  const shortChanged = squad.filter((x) => x.shortOfMinutes && (x.status === 'key' || x.status === 'first-team') && !x.s.injury)
  const benched = squad.filter((x) => (x.consecutiveMissed >= 3 && x.p.overall >= 78 && !x.s.injury) || shortChanged.includes(x))
  if (benched.length) {
    candidates.push({
      weight: shortChanged.length ? 6 : 3,
      make: () => {
        const x = rng.pick(benched)
        const status = x.status ?? 'rotation'
        const pct = x.share === null || x.share === undefined ? null : Math.round(x.share * 100)
        const statusLine = shortChanged.includes(x) && pct !== null ? ` He signed as ${STATUS_LABEL[status].toLowerCase().replace('key player', 'a key player')} and has had ${pct}% of the minutes; he expected ${Math.round(EXPECTED_SHARE[status] * 100)}%.` : ''
        return {
          id: 'wants-minutes',
          title: `${x.p.name} wants to talk`,
          body: `${x.p.name} has knocked on your door. ${x.consecutiveMissed > 0 ? `He has not played in ${x.consecutiveMissed} match${x.consecutiveMissed === 1 ? '' : 'es'} and feels` : 'He feels'} he deserves a place in the side.${statusLine}`,
          playerSeasonId: x.p.id,
          choices: [
            { id: 'promise', label: 'Promise him a start', hint: 'Morale up now. Break it and it hurts.' },
            { id: 'earn', label: 'Tell him to earn it', hint: 'He may sulk, or he may respond.' },
            { id: 'listen', label: 'Hear him out, promise nothing', hint: 'Small, safe gain.' },
            { id: 'list', label: 'Tell him he can leave', hint: 'He goes on the transfer list; offers will come. He settles while he waits.' },
          ],
        }
      },
    })
  }

  // Post-match press conference
  const last = ctx.lastResult
  if (last && last.competition === 'league') {
    const star = squad.find((x) => x.p.id === (last.motmId ?? last.scorerId))
    if (last.gf > last.ga) {
      candidates.push({
        weight: 1.6,
        make: () => ({
          id: 'press-win',
          title: `Press conference: ${last.gf}-${last.ga} v ${last.opponentName}`,
          body: star ? `The press want a word about ${star.p.name}'s performance. The cameras are on.` : 'A good result. The press want to know who gets the credit.',
          playerSeasonId: star?.p.id,
          choices: [
            ...(star ? [{ id: 'praise-star', label: `Single out ${star.p.name}`, hint: 'He will love it. One or two team-mates may not.' }] : []),
            { id: 'praise-team', label: 'Credit the whole squad', hint: 'Small lift for everyone.' },
            { id: 'warn', label: 'Say there is more to come', hint: 'Keeps feet on the ground. The board likes ambition.' },
          ],
        }),
      })
    } else if (last.gf < last.ga) {
      candidates.push({
        weight: 1.6,
        make: () => ({
          id: 'press-loss',
          title: `Press conference: ${last.gf}-${last.ga} v ${last.opponentName}`,
          body: 'A defeat to explain. The questions are not friendly.',
          choices: [
            { id: 'blame-self', label: 'Take the blame yourself', hint: 'The players appreciate it. The board notes it.' },
            { id: 'blame-players', label: 'Call the performance unacceptable', hint: 'Professionals respond; the rest sulk. The board likes the honesty.' },
            { id: 'blame-ref', label: 'Blame the referee', hint: 'Deflects everything. A fine is possible.' },
            { id: 'no-comment', label: 'Keep it short', hint: 'Nothing changes.' },
          ],
        }),
      })
    }
  }
  // The job question
  if (ctx.matchweek >= 12 && ctx.position > ctx.boardTarget + 4 && ctx.confidence < 45) {
    candidates.push({
      weight: 1.5,
      make: () => ({
        id: 'press-job',
        title: 'Press conference: are you worried about your job?',
        body: `${ctx.position}th with the board expecting ${ctx.boardTarget}th or better. The question was always coming.`,
        choices: [
          { id: 'confident', label: 'I have the full backing of the board', hint: 'Bold. Pays off or blows up.' },
          { id: 'focus', label: 'My focus is the next match', hint: 'Nothing changes.' },
          { id: 'players', label: 'The players are behind me', hint: 'The squad rallies a little. The board stays unmoved.' },
        ],
      }),
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
        const rivals = squad.filter((x) => x !== a && x.p.positions[0] === a.p.positions[0])
        if (!rivals.length) return null
        const b = rng.pick(rivals)
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

  // Free agent pitched by an agent: a bonus spin, redeemed at next summer's draft (dynasty only)
  if (ctx.isDynasty && rng.chance(0.5)) {
    candidates.push({
      weight: 1.2,
      make: () => ({
        id: 'agent',
        title: 'An agent calls',
        body: 'An agent is pitching a client who is between clubs. He will not say who until you agree to a meeting, but promises he can play at this level.',
        choices: [
          { id: 'meet', label: 'Take the meeting', hint: 'A bonus spin of the wheel at the summer draft.' },
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

  // Contract renewal
  if (ctx.matchweek >= 24 && ctx.expiring.length) {
    candidates.push({
      weight: 4,
      make: () => {
        const x = rng.pick(ctx.expiring)
        const fee = Math.max(0.5, Math.round(x.p.value * 0.08 * 10) / 10)
        const upper = renewalStatus(x.status)
        return {
          id: 'contract',
          title: `${x.p.name}'s contract is running down`,
          body: `${x.p.name} (${x.p.age}) is out of contract in the summer. His agent wants a new deal: a £${fee}M signing-on fee, and the terms depend on the role you promise him.`,
          playerSeasonId: x.p.id,
          choices: [
            { id: 'renew', label: `Renew as ${upper === 'key' ? 'a key player' : 'first team'} (£${fee}M, +10% wages)`, hint: 'Keeps him for the dynasty. Morale up.' },
            { id: 'renew-rotation', label: `Renew as rotation (£${fee}M, no rise)`, hint: isSenior(x.status) ? 'A lesser role: he may refuse, and he will not love it if he accepts.' : 'He signs happily on his current money.' },
            { id: 'let-go', label: 'Let him run it down', hint: 'He leaves in the summer. Morale dips now.' },
          ],
        }
      },
    })
  }
  // Wantaway player
  const unhappy = squad.filter((x) => x.s.morale < 40 && x.p.overall >= 76)
  if (unhappy.length && ctx.matchweek >= 8) {
    candidates.push({
      weight: 2.5,
      make: () => {
        const x = rng.pick(unhappy)
        return {
          id: 'wantaway',
          title: `${x.p.name} wants out`,
          body: `${x.p.name} has told the press he wants to leave. The dressing room is watching.`,
          playerSeasonId: x.p.id,
          choices: [
            { id: 'list', label: 'Fine. He goes in the next window', hint: 'He plays on with better morale; offers will come.' },
            { id: 'refuse', label: 'Nobody leaves', hint: 'Morale drops further; squad respects the stance.' },
            { id: 'talk', label: 'Talk him round', hint: 'Depends on his professionalism.' },
          ],
        }
      },
    })
  }
  // Media criticism after three defeats
  if (ctx.recentForm.slice(-3).every((r) => r === 'L') && ctx.recentForm.length >= 3) {
    candidates.push({
      weight: 3,
      make: () => ({
        id: 'media',
        title: 'The press turn',
        body: 'Three defeats in a row. The papers are asking whether the manager has lost the dressing room.',
        choices: [
          { id: 'defend', label: 'Defend the players', hint: 'Players appreciate it; board less so.' },
          { id: 'criticise', label: 'Criticise the players publicly', hint: 'Board likes accountability; squad does not.' },
          { id: 'silence', label: 'No comment', hint: 'Nothing changes.' },
        ],
      }),
    })
  }
  // Rushed return from injury
  const nearlyFit = squad.filter((x) => x.s.injury && x.s.injury.weeksOut <= 2 && x.p.overall >= 80)
  if (nearlyFit.length) {
    candidates.push({
      weight: 2,
      make: () => {
        const x = rng.pick(nearlyFit)
        return {
          id: 'rush',
          title: `Rush ${x.p.name} back?`,
          body: `${x.p.name} could be declared fit early. The physio is not keen.`,
          playerSeasonId: x.p.id,
          choices: [
            { id: 'rush', label: 'Declare him fit', hint: 'Available now; raised chance of a setback.' },
            { id: 'wait', label: 'Wait', hint: 'Back when fully healed.' },
          ],
        }
      },
    })
  }
  // Board bonus for beating a rival
  if (ctx.beatRival) {
    candidates.push({
      weight: 3,
      make: () => ({
        id: 'rival-bonus',
        title: 'Bragging rights',
        body: 'The chairman loved the derby win. He is offering something to mark it.',
        choices: [
          { id: 'budget', label: 'Transfer funds', hint: '+£8M to the budget.' },
          { id: 'party', label: 'A night out for the squad', hint: 'Team morale up, condition slightly down.' },
        ],
      }),
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
      if (choiceId === 'list') return { text: 'He is told he can go. He is on the list and, oddly, calmer for it.', moraleDelta: [{ playerSeasonId: p!, delta: 6 }], transferList: p }
      return { text: 'A civil chat. He appreciates being heard.', moraleDelta: [{ playerSeasonId: p!, delta: 4 }] }
    case 'press-win': {
      if (choiceId === 'praise-star' && p) {
        const others = ctx.squad.filter((x) => x.p.id !== p && x.p.traits.professionalism < 0.4 && x.p.overall >= 78).slice(0, 2)
        return { text: 'He beams through the mixed zone.', moraleDelta: [{ playerSeasonId: p, delta: 7 }, ...others.map((x) => ({ playerSeasonId: x.p.id, delta: -3 }))] }
      }
      if (choiceId === 'praise-team') return { text: 'The dressing room appreciates the shared credit.', teamMoraleDelta: 2 }
      return { text: 'Ambition noted upstairs. The players keep working.', confidenceDelta: 2 }
    }
    case 'press-loss': {
      if (choiceId === 'blame-self') return { text: 'The players respect it. The board writes it down.', teamMoraleDelta: 3, confidenceDelta: -2 }
      if (choiceId === 'blame-players') {
        const deltas = ctx.squad.map((x) => ({ playerSeasonId: x.p.id, delta: x.p.traits.professionalism >= 0.6 ? 2 : -5 }))
        return { text: 'Harsh words in public. Some respond, some sulk.', moraleDelta: deltas, confidenceDelta: 2 }
      }
      if (choiceId === 'blame-ref') return rng.chance(0.4) ? { text: 'The authorities fine you for the comments.', budgetDelta: -0.5 } : { text: 'The headlines are about the referee, not you.' }
      return { text: 'Short and dull. Nobody writes anything.' }
    }
    case 'press-job':
      if (choiceId === 'confident') return rng.chance(0.5) ? { text: 'The chairman backs you publicly the next morning.', confidenceDelta: 6, teamMoraleDelta: 2 } : { text: 'Silence from the boardroom. That told everyone something.', confidenceDelta: -6, teamMoraleDelta: -2 }
      if (choiceId === 'players') return { text: 'The captain echoes it in his own interview.', teamMoraleDelta: 3 }
      return { text: 'A straight bat. The story runs anyway.' }
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
      if (choiceId === 'meet') return { text: 'You agree to meet the player. You will get an extra spin of the wheel at the summer draft.', captain: undefined, nextMatchBoost: undefined, releasePlayer: undefined, promiseStart: undefined, budgetDelta: 0, moraleDelta: [], teamMoraleDelta: 0, conditionDelta: [], confidenceDelta: 0 }
      return { text: 'You pass.' }
    case 'physio':
      if (choiceId === 'rest') return { text: 'Two days off. Fresh legs, slightly rusty touch.', conditionDelta: ctx.squad.map((x) => ({ playerSeasonId: x.p.id, delta: 8 })), teamMoraleDelta: 2 }
      return { text: 'The physio shrugs and restocks the ice.' }
    case 'captain': {
      const id = choiceId.replace('cap:', '')
      return { text: 'The armband is handed over.', captain: id, moraleDelta: [{ playerSeasonId: id, delta: 8 }], teamMoraleDelta: 1 }
    }
    case 'contract': {
      const player = ctx.squad.find((x) => x.p.id === p)
      const fee = Math.max(0.5, Math.round((player?.p.value ?? 5) * 0.08 * 10) / 10)
      if (choiceId === 'renew') return { text: `${player?.p.name} signs on for the long term.`, moraleDelta: [{ playerSeasonId: p!, delta: 10 }], budgetDelta: -fee, renewContract: { playerSeasonId: p!, fee, status: renewalStatus(player?.status), wageRise: 1.1 } }
      if (choiceId === 'renew-rotation') {
        if (isSenior(player?.status)) {
          // A key or first-team player offered a lesser role: professionals swallow it more often
          if (!rng.chance(0.3 + (player?.p.traits.professionalism ?? 0.5) * 0.5)) return { text: 'He will not accept a lesser role. He sees out his contract and moves on.', moraleDelta: [{ playerSeasonId: p!, delta: -8 }], declineContract: p }
          return { text: 'He signs, through gritted teeth, as a rotation player.', moraleDelta: [{ playerSeasonId: p!, delta: -6 }], budgetDelta: -fee, renewContract: { playerSeasonId: p!, fee, status: 'rotation', wageRise: 1 } }
        }
        return { text: `${player?.p.name} is glad to stay on the same money.`, moraleDelta: [{ playerSeasonId: p!, delta: 8 }], budgetDelta: -fee, renewContract: { playerSeasonId: p!, fee, status: 'rotation', wageRise: 1 } }
      }
      return { text: 'He will see out the season and move on.', moraleDelta: [{ playerSeasonId: p!, delta: -8 }], declineContract: p }
    }
    case 'wantaway':
      if (choiceId === 'list') return { text: 'He is placed on the transfer list and knuckles down.', moraleDelta: [{ playerSeasonId: p!, delta: 12 }], transferList: p }
      if (choiceId === 'refuse') return { text: 'He is going nowhere, and he knows it.', moraleDelta: [{ playerSeasonId: p!, delta: -8 }], teamMoraleDelta: 2 }
      {
        const player = ctx.squad.find((x) => x.p.id === p)
        const ok = rng.chance(0.3 + (player?.p.traits.professionalism ?? 0.5) * 0.5)
        return ok ? { text: 'A long talk. He recommits.', moraleDelta: [{ playerSeasonId: p!, delta: 18 }] } : { text: 'He nods politely and changes nothing.', moraleDelta: [{ playerSeasonId: p!, delta: -3 }] }
      }
    case 'media':
      if (choiceId === 'defend') return { text: 'The players feel backed. The board notes the excuses.', teamMoraleDelta: 4, confidenceDelta: -2 }
      if (choiceId === 'criticise') return { text: 'Accountability, says the board. Mutiny, mutter the players.', teamMoraleDelta: -6, confidenceDelta: 4 }
      return { text: 'The story moves on.' }
    case 'rush':
      if (choiceId === 'rush') return { text: 'Declared fit. Fingers crossed.', clearInjury: { playerSeasonId: p!, setbackChance: 0.35 } }
      return { text: 'He finishes his rehab.' }
    case 'rival-bonus':
      if (choiceId === 'budget') return { text: 'The chairman adds £8M to the pot.', budgetDelta: 8 }
      return { text: 'The squad hits the town. Spirits high, legs heavy.', teamMoraleDelta: 6, conditionDelta: ctx.squad.map((x) => ({ playerSeasonId: x.p.id, delta: -6 })) }
  }
  return { text: 'Nothing happens.' }
}

/** The better renewal offer keeps a key player key and makes anyone else first team. */
function renewalStatus(status: SquadStatus | undefined): SquadStatus {
  return status === 'key' ? 'key' : 'first-team'
}

function isSenior(status: SquadStatus | undefined): boolean {
  return !!status && STATUS_RANK[status] >= STATUS_RANK['first-team']
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
