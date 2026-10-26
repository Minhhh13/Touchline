/**
 * The assistant's briefing: a computed list of what needs doing before the
 * next match, each line with the button that does it. In pre-season it is a
 * checklist of the systems a first-time manager would otherwise find one tab
 * at a time. Pure and RNG-free: the same game state always gives the same list.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE } from '@engine/roles'
import { positionOf, seasonTable, USER_TEAM } from '@engine/season'
import { staffWages, STAFF, STAFF_ROLES, staffTier } from '@engine/staff'
import { TRAINING_LABEL } from '@engine/training'
import type { Objective } from '@engine/objectives'
import type { TeamTalk } from '@engine/match'
import { playerLookup, squadPlayers } from './players'
import { lineupProblems } from './squad'
import { nextOpponent, upcomingCupTie } from './week'
import { riskiestStarter } from './medical'

export type DugoutTab = 'squad' | 'next' | 'tactics' | 'fixtures' | 'table' | 'cup' | 'europe' | 'stats' | 'market' | 'inbox' | 'club' | 'dressing' | 'planner'

export type BriefingLevel = 'block' | 'warn' | 'info' | 'ok'

export interface BriefingAction {
  label: string
  /** Dugout tab to open. */
  tab?: DugoutTab
  /** Something to do on the way: repair the lineup, open a player, scroll to the pending decision, play a friendly. */
  op?: 'autoPick' | 'player' | 'event' | 'friendly'
  playerId?: string
}

export interface BriefingItem {
  id: string
  level: BriefingLevel
  text: string
  action?: BriefingAction
  /** Pre-season checklist: the box is ticked. */
  done?: boolean
  /** The why behind a short checklist label, shown behind an Info button. */
  hint?: string
}

/** At most this many lines, so the briefing stays a briefing. */
export const BRIEFING_CAP = 6
/** A starter below this condition is flagged as tired. */
export const BRIEFING_CONDITION = 60
/** A starter below this sharpness is flagged as short of match practice. */
export const BRIEFING_SHARPNESS = 50
/** Yellow cards per one-match ban (`applyMatchToState`). */
export const YELLOWS_PER_BAN = 5
/** Pre-season friendlies on offer. */
export const FRIENDLIES = 3
/** Objectives with a numeric pace are only judged after this many matchweeks. */
export const PACE_FROM_MATCHWEEK = 8

const TALK_LABEL: Record<TeamTalk, string> = { calm: 'Calm', encourage: 'Encourage', demand: 'Demand', 'fire-up': 'Fire up', none: 'None' }

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Why an objective is in danger, or null while it is on course. Cup and derby
 * objectives are gone the moment they fail; home form warns one defeat before the
 * limit; goals and youth starts warn once the pace falls short after
 * `PACE_FROM_MATCHWEEK`.
 */
export function objectiveRisk(o: Objective, game: Game, u: LoadedUniverse): string | null {
  const season = game.season
  if (!season || o.met !== undefined) return null
  const mine = season.fixtures.filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))
  const mw = season.matchweek
  const reached = (ties: { round: string; homeTeamId: string; awayTeamId: string }[], round: string) => ties.some((t) => t.round === round && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
  switch (o.id) {
    case 'cup-qf':
    case 'cup-sf': {
      const round = o.id === 'cup-qf' ? 'QF' : 'SF'
      if (season.cupEliminated && !reached(season.cup, round)) return `Knocked out of the cup: the ${o.id === 'cup-qf' ? 'quarter-final' : 'semi-final'} objective is gone`
      return null
    }
    case 'continental-qf': {
      if (season.continental?.eliminated && !reached(season.continental.ties, 'QF')) return 'Out of Europe in the round of 16: the quarter-final objective is gone'
      return null
    }
    case 'home-form': {
      const limit = o.target ?? 0
      const losses = mine.filter((f) => f.homeTeamId === USER_TEAM && f.result!.homeGoals < f.result!.awayGoals).length
      if (losses > limit) return `${losses} home defeats, ${limit} allowed: the objective is gone`
      if (losses >= limit - 1 && losses > 0) return `${losses} home defeat${losses === 1 ? '' : 's'} of ${limit} allowed`
      return null
    }
    case 'rivals': {
      const rivals = u.clubById[season.hostClubId]?.rivals ?? []
      const lost = mine.filter((f) => {
        const home = f.homeTeamId === USER_TEAM
        const opp = home ? f.awayTeamId : f.homeTeamId
        if (!rivals.includes(opp)) return false
        return (home ? f.result!.homeGoals : f.result!.awayGoals) < (home ? f.result!.awayGoals : f.result!.homeGoals)
      }).length
      return lost ? `Lost ${lost === 1 ? 'a derby' : `${lost} derbies`}: the unbeaten-against-rivals objective is gone` : null
    }
    case 'goals': {
      if (mw < PACE_FROM_MATCHWEEK) return null
      const target = o.target ?? 0
      const gf = seasonTable(season).find((r) => r.teamId === USER_TEAM)?.goalsFor ?? 0
      const pace = Math.round((gf / mw) * season.matchweeks)
      return pace < target ? `On pace for ${pace} of the ${target} league goals asked (${gf} so far)` : null
    }
    case 'youth': {
      if (mw < PACE_FROM_MATCHWEEK) return null
      const target = o.target ?? 0
      const best = Math.max(0, ...squadPlayers(game, u).filter((x) => x.p.age <= 21).map((x) => x.s.seasonStats.starts))
      const pace = Math.round((best / mw) * season.matchweeks)
      return pace < target ? `Best under-21 on pace for ${pace} of the ${target} starts asked (${best} so far)` : null
    }
    case 'title':
    case 'top-four':
    case 'survive':
      // A run-in's brief: the takeover banner shows where it stands every week
      return null
  }
}

/** The mentality a captain must exceed to lift the side: the pivot of the engine's `leadership` modifier. */
export const LEADER_MENTALITY = 75

/**
 * The squad player the engine's `leadership` modifier rates highest, so who the
 * assistant would hand the armband: `(mentality - 75) × (0.6 + 0.8 × professionalism)`,
 * plus 10 for a starter because only a captain on the pitch counts. A man under
 * 75 mentality scores below zero however professional he is.
 */
export function suggestedCaptain(game: Game, u: LoadedUniverse): string | undefined {
  const inXI = new Set(Object.values(game.lineup))
  return squadPlayers(game, u)
    .map((x) => ({ id: x.p.id, score: (x.p.attributes.mentality - LEADER_MENTALITY) * (0.6 + x.p.traits.professionalism * 0.8) + (inXI.has(x.p.id) ? 10 : 0) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]?.id
}

function preseasonChecklist(game: Game, u: LoadedUniverse): BriefingItem[] {
  const items: BriefingItem[] = []
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const squad = squadPlayers(game, u)
  const check = (id: string, done: boolean, text: string, hint: string, action?: BriefingAction) => items.push({ id, level: done ? 'ok' : 'info', text, hint, done, action })

  const played = Math.min(FRIENDLIES, game.friendliesPlayed)
  check('friendlies', played >= FRIENDLIES, `Friendlies ${played}/${FRIENDLIES}`, 'Each friendly builds sharpness and tactical familiarity, with a small injury risk.', played < FRIENDLIES ? { label: 'Play friendly', op: 'friendly' } : undefined)

  const captain = game.captainId && game.squad[game.captainId] ? get(game.captainId) : undefined
  const suggestion = suggestedCaptain(game, u)
  check('captain', !!captain, captain ? `Captain: ${captain.name}` : 'Captain', 'A leader with a strong mentality lifts the side in big matches.', captain ? undefined : { label: 'Choose', op: 'player', playerId: suggestion })

  const rolesTouched = formation.slots.some((s) => (game.tactics.roles[s.id] ?? DEFAULT_ROLE[s.position]) !== DEFAULT_ROLE[s.position])
  check('roles', rolesTouched, 'Roles', 'Each player has a rating in his role, and the team rating follows.', rolesTouched ? undefined : { label: 'Tactics', tab: 'tactics' })

  const hired = STAFF_ROLES.some((r) => staffTier(game.staff, r) > 0)
  const room = game.finances.wageCap - squad.reduce((s, x) => s + x.p.wage, 0) - staffWages(game.staff)
  const cheapest = Math.min(...STAFF_ROLES.map((r) => STAFF[r].tiers[1].wage))
  check('staff', hired, `Staff ${STAFF_ROLES.filter((r) => staffTier(game.staff, r) > 0).length}/${STAFF_ROLES.length}`, hired ? 'Backroom staff are paid from the wage cap.' : room >= cheapest ? `£${Math.round(room)}k a week of wage room; a senior physio costs £${cheapest}k.` : `No wage room for staff (£${Math.round(room)}k a week); they are paid from the cap.`, hired ? undefined : { label: 'Club', tab: 'club' })

  const sp = game.tactics.setPieces
  const takers = !!(sp?.penalties || sp?.freeKicks || sp?.corners)
  check('set-pieces', takers, 'Set pieces', 'Penalties, free kicks and corners go to the men you choose.', takers ? undefined : { label: 'Tactics', tab: 'tactics' })

  if (game.youthIntake) {
    const decided = game.youthIntake.chosen !== undefined
    check('youth', decided, decided ? (game.youthIntake.chosen ? `Youth: ${get(game.youthIntake.chosen)?.name ?? 'a prospect'} promoted` : 'Youth intake passed') : 'Youth intake', `${game.youthIntake.candidates.length} academy prospects: sign one for nothing or pass.`, decided ? undefined : { label: 'Squad', tab: 'squad' })
  }
  return items
}

function seasonBriefing(game: Game, u: LoadedUniverse): BriefingItem[] {
  const season = game.season!
  const items: BriefingItem[] = []
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)

  if (game.pendingEvent) items.push({ id: 'event', level: 'block', text: `Decision needed: ${game.pendingEvent.title}`, action: { label: 'Decide', op: 'event' } })

  const problems = lineupProblems(game, u)
  if (problems.length > 2) items.push({ id: 'lineup', level: 'warn', text: `${problems.length} lineup issues: ${list(problems)}`, action: { label: 'Auto-pick', op: 'autoPick' } })
  else for (const [i, p] of problems.entries()) items.push({ id: `lineup-${i}`, level: 'warn', text: p, action: { label: 'Auto-pick', op: 'autoPick' } })

  // Starters who will play tired or rusty, excluding anyone the lineup check already named
  const starters = formation.slots.map((sl) => game.lineup[sl.id]).filter((id): id is string => !!id)
  for (const id of starters) {
    const p = get(id)
    const s = game.squad[id]
    if (!p || !s || s.injury || s.suspension > 0) continue
    if (s.condition < BRIEFING_CONDITION) items.push({ id: `tired-${id}`, level: 'warn', text: `${p.name} is tired (condition ${Math.round(s.condition)})`, action: { label: 'View', op: 'player', playerId: id } })
    else if (s.sharpness < BRIEFING_SHARPNESS) items.push({ id: `rusty-${id}`, level: 'warn', text: `${p.name} is short of sharpness (${Math.round(s.sharpness)})`, action: { label: 'View', op: 'player', playerId: id } })
  }
  for (const id of starters) {
    const p = get(id)
    const s = game.squad[id]
    if (p && s && s.suspension <= 0 && s.yellowCards % YELLOWS_PER_BAN === YELLOWS_PER_BAN - 1) items.push({ id: `yellow-${id}`, level: 'warn', text: `${p.name} is one yellow card from a ban`, action: { label: 'View', op: 'player', playerId: id } })
  }
  // The starter the medical view rates at high risk, when tired legs are part of it (proneness alone is no news)
  const risk = riskiestStarter(game, u)
  if (risk && (game.squad[risk.id]?.condition ?? 100) < 80 && !items.some((i) => i.id === `tired-${risk.id}`)) items.push({ id: `risk-${risk.id}`, level: 'warn', text: `${risk.name} is at high injury risk (${risk.matchPct}% a match)`, action: { label: 'Medical', tab: 'planner' } })
  if (game.promisedStart && !starters.includes(game.promisedStart)) {
    const p = get(game.promisedStart)
    if (p && game.squad[game.promisedStart]) items.push({ id: 'promise', level: 'warn', text: `You promised ${p.name} a start and he is not in the XI`, action: { label: 'View', op: 'player', playerId: game.promisedStart } })
  }

  const w = game.window
  if (w) {
    const open = w.offers.filter((o) => o.status === 'open').length
    const deadline = w.day >= w.days - 1
    const name = w.kind === 'summer' ? 'Summer' : 'January'
    const offers = open ? ` · ${open} offer${open === 1 ? '' : 's'} for your players` : ''
    items.push({ id: 'window', level: 'info', text: deadline ? `Deadline day in the ${name.toLowerCase()} window: discounts today, then it shuts${offers}` : `${name} window open, day ${w.day + 1} of ${w.days}${offers}`, action: { label: 'Market', tab: 'market' } })
  }

  const tie = upcomingCupTie(game)
  if (tie) {
    const opp = tie.tie.homeTeamId === USER_TEAM ? tie.tie.awayTeamId : tie.tie.homeTeamId
    const club = u.clubById[opp]
    items.push({ id: 'cup', level: 'info', text: `${tie.label} ${tie.tie.homeTeamId === USER_TEAM ? 'v' : 'at'} ${club?.shortName ?? opp} midweek. Rotate, you play again Thursday`, action: { label: tie.comp === 'cup' ? 'Cup' : 'Europe', tab: tie.comp === 'cup' ? 'cup' : 'europe' } })
  }

  for (const o of season.objectives ?? []) {
    const risk = objectiveRisk(o, game, u)
    if (risk) items.push({ id: `objective-${o.id}`, level: 'info', text: `${o.label}: ${risk}`, action: { label: 'Club', tab: 'club' } })
  }

  const next = nextOpponent(game)
  const table = seasonTable(season)
  const where = next ? ` for ${u.clubById[next.clubId]?.shortName ?? next.clubId} (${positionOf(table, next.clubId)}${ordinalSuffix(positionOf(table, next.clubId))})` : ''
  items.push({ id: 'knobs', level: 'ok', text: `Training ${TRAINING_LABEL[game.training]}, team talk ${TALK_LABEL[game.teamTalk]}${where}`, action: { label: 'Tactics', tab: 'tactics' } })
  return items
}

function ordinalSuffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10] ?? 'th'
}

/**
 * The briefing for the dugout: in season the problems and chances before the
 * next match in priority order (pending decision, lineup, condition and
 * sharpness, bookings, promises, the window, the midweek tie, objectives at
 * risk, then one line on training and the team talk); in pre-season a checklist.
 * `ok` lines are dropped as soon as a `warn` or `block` exists, and the list is
 * capped at `BRIEFING_CAP` items. Empty once the season is over.
 */
export function weeklyBriefing(game: Game, u: LoadedUniverse): BriefingItem[] {
  if (!game.season || game.season.sacked || game.season.matchweek >= game.season.matchweeks) return []
  const items = game.phase === 'preseason' ? preseasonChecklist(game, u) : seasonBriefing(game, u)
  const urgent = items.some((i) => i.level === 'warn' || i.level === 'block')
  return (urgent ? items.filter((i) => i.level !== 'ok') : items).slice(0, BRIEFING_CAP)
}

/** The one line for the phone's bottom bar: the most urgent undone item. */
export function briefingHeadline(items: BriefingItem[]): BriefingItem | undefined {
  return items.find((i) => !i.done) ?? items[0]
}
