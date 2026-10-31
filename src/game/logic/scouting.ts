/**
 * Scouting and recruitment (FM-depth Batch 2). The club knows each league to a
 * level from 0 to 100; a player from a league it knows less than perfectly
 * shows every attribute as a range instead of a number, and a full scout
 * reveals him. Scouting assignments raise a league's knowledge and it fades
 * back when nobody is watching. A recruitment focus narrows the market and
 * has the scouts file graded reports.
 *
 * Nothing here draws from the game's stream: the ranges are a pure hash of the
 * player and the attribute, knowledge moves by fixed steps, and the reports are
 * drawn from a fork of a copy of the stream (`Rng.fromState(state).fork(label)`),
 * so a season that never uses any of it plays exactly as before.
 */
import type { Game, RecruitFocus, ScoutReport } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { AttributeKey, Attributes, PlayerSeason, Position } from '@engine/types'
import { Rng } from '@engine/rng'
import { askingPrice, loanable, openWindow } from '@engine/market'
import { ageFloors } from './departures'
import { staffTier, traitTags } from '@engine/staff'
import { canCover, ratingAt } from '@engine/positions'
import { getFormation } from '@engine/formations'
import { playerLookup, squadPlayers } from './players'
import { postNews } from './news'

/** Knowledge of your own league's other seasons at the start: you know the league, not every era of it. */
export const OWN_LEAGUE_KNOWLEDGE = 70
/** Knowledge of any other league with no chief scout; each scout tier adds `SCOUT_TIER_KNOWLEDGE`. */
export const OTHER_LEAGUE_KNOWLEDGE = 30
export const SCOUT_TIER_KNOWLEDGE = 20
/** A week on assignment raises a league's knowledge by this much; a week without one lets it fade by `KNOWLEDGE_FADE`, never below its starting level. */
export const ASSIGNMENT_GAIN = 5
export const KNOWLEDGE_FADE = 2
/** Fully scouted players remembered (oldest drop off). */
export const SCOUTED_CAP = 80
/** Scout reports kept, newest first, and filed each matchweek while a focus is set. */
export const REPORTS_CAP = 12
export const REPORTS_PER_WEEK = 2

/** The attributes the masked view covers, in the attribute panel's order. */
export const MASKED_KEYS: AttributeKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'mentality', 'goalkeeping', 'stamina', 'strength', 'aggression', 'jumping', 'workRate']

/** A 32-bit FNV-1a hash of a string, as a number in [0, 1). */
export function hashUnit(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

/** The league a player-season was played in. */
export function leagueOfPlayer(u: LoadedUniverse, p: Pick<PlayerSeason, 'clubId'>): string {
  return u.clubById[p.clubId]?.leagueId ?? ''
}

/** Where a league's knowledge starts and fades back to: your own league 70, any other 30 plus 20 a scout tier. */
export function baseKnowledge(game: Game, leagueId: string): number {
  if (leagueId === game.settings.leagueId) return OWN_LEAGUE_KNOWLEDGE
  return Math.min(100, OTHER_LEAGUE_KNOWLEDGE + SCOUT_TIER_KNOWLEDGE * staffTier(game.staff, 'scout'))
}

/** The club's knowledge of a league now, 0 to 100. */
export function knowledgeOf(game: Game, leagueId: string): number {
  return Math.max(0, Math.min(100, Math.max(baseKnowledge(game, leagueId), game.knowledge?.[leagueId] ?? 0)))
}

/** Leagues that can be scouted: the ones the market draws from. */
export function scoutableLeagues(game: Game): string[] {
  return game.settings.wheelLeagues.length ? game.settings.wheelLeagues : [game.settings.leagueId]
}

/** Scouting assignments the chief scout can run at once: one, plus one a scout tier. */
export function maxAssignments(game: Game): number {
  return 1 + staffTier(game.staff, 'scout')
}

/** A range of an attribute as the club sees it: the true value is always inside. */
export interface AttrRange {
  lo: number
  hi: number
}

/** The width of a masked range at a knowledge level: (100 − knowledge) / 5, at least 2 (±1); exact at 100. */
export function rangeWidth(knowledge: number): number {
  if (knowledge >= 100) return 0
  return Math.max(2, Math.round((100 - knowledge) / 5))
}

/**
 * One attribute as a range. Where the true value sits inside it is a pure hash
 * of the player and the attribute, so the same player always shows the same
 * range at the same knowledge, and nothing is drawn.
 */
export function maskRange(playerId: string, key: string, value: number, knowledge: number): AttrRange {
  const w = rangeWidth(knowledge)
  if (!w) return { lo: value, hi: value }
  const offset = Math.floor(hashUnit(`${playerId}|${key}`) * (w + 1))
  const lo = value - offset
  return { lo: Math.max(1, lo), hi: Math.min(99, lo + w) }
}

/** What the club can see of a player: exact, or ranges, and the scout's pros and cons once he is scouted. */
export interface MaskedView {
  exact: boolean
  scouted: boolean
  knowledge: number
  overall: AttrRange
  attrs: Record<AttributeKey, AttrRange>
  pros: string[]
  cons: string[]
}

const PROS = new Set(['Consistent', 'Ironman', 'Big-game player', 'Model professional'])

/** Is he one of ours, fully scouted, or playing in the very league season we face every week? Then we know him exactly. */
export function isKnownExactly(game: Game, u: LoadedUniverse, p: PlayerSeason): boolean {
  if (game.squad[p.id]) return true
  if (game.scouted?.includes(p.id)) return true
  const season = game.season
  return !!season && p.season === season.leagueSeason && leagueOfPlayer(u, p) === season.leagueId
}

/** The masked view of a player: never masked for our own squad, a fully scouted man or the league season we play in. */
export function maskedView(game: Game, u: LoadedUniverse, p: PlayerSeason): MaskedView {
  const scouted = !!game.scouted?.includes(p.id)
  const exact = isKnownExactly(game, u, p)
  const knowledge = exact ? 100 : knowledgeOf(game, leagueOfPlayer(u, p))
  const attrs = {} as Record<AttributeKey, AttrRange>
  for (const k of MASKED_KEYS) attrs[k] = maskRange(p.playerId, k, p.attributes[k], knowledge)
  const tags = scouted ? traitTags(p.traits) : []
  return { exact, scouted, knowledge, overall: maskRange(p.playerId, 'overall', p.overall, knowledge), attrs, pros: tags.filter((t) => PROS.has(t)), cons: tags.filter((t) => !PROS.has(t)) }
}

/** The masked attributes as numbers (each range's midpoint), for a rating the club can estimate at a position. */
function seenAttributes(p: PlayerSeason, view: MaskedView): Attributes {
  const out = { ...p.attributes }
  for (const k of MASKED_KEYS) out[k] = Math.round((view.attrs[k].lo + view.attrs[k].hi) / 2)
  return out
}

/** The slot the next full scout uses: one each market day while a window is open, otherwise one each matchweek. */
export function scoutSlotKey(game: Game): string {
  const mw = game.season?.matchweek ?? 0
  return game.window ? `${game.year}-${game.window.kind}-${mw}-d${game.window.day}` : `${game.year}-mw${mw}`
}

export function canFullScout(game: Game): boolean {
  return game.scoutSlot !== scoutSlotKey(game)
}

/** Send the scout to watch one player properly: his attributes show exactly and his hidden traits come back as pros and cons. */
export function fullScout(game: Game, u: LoadedUniverse, playerSeasonId: string): { ok: boolean; message: string } {
  const p = u.index[playerSeasonId]
  if (!p) return { ok: false, message: 'Player not found.' }
  if (isKnownExactly(game, u, p)) return { ok: false, message: `You already know everything about ${p.name}.` }
  if (!canFullScout(game)) return { ok: false, message: game.window ? 'Your scout has already watched someone today. Try again tomorrow.' : 'Your scout has already watched someone this week.' }
  const list = (game.scouted ??= [])
  list.push(p.id)
  if (list.length > SCOUTED_CAP) list.splice(0, list.length - SCOUTED_CAP)
  game.scoutSlot = scoutSlotKey(game)
  const view = maskedView(game, u, p)
  const notes = [...view.pros, ...view.cons]
  return { ok: true, message: `Scouted: ${p.name} is a ${p.overall}.${notes.length ? ` ${notes.join(', ')}.` : ''}` }
}

/** Put a league on (or take it off) the scouting assignments, up to the chief scout's limit. */
export function setAssignment(game: Game, leagueId: string, on: boolean): { ok: boolean; message: string } {
  if (!scoutableLeagues(game).includes(leagueId)) return { ok: false, message: 'Your scouts only cover the leagues the market draws from.' }
  const list = game.assignments ?? []
  if (!on) {
    game.assignments = list.filter((l) => l !== leagueId)
    return { ok: true, message: 'Assignment ended.' }
  }
  if (list.includes(leagueId)) return { ok: true, message: 'Already on assignment.' }
  if (list.length >= maxAssignments(game)) return { ok: false, message: `Your scouts can run ${maxAssignments(game)} assignment${maxAssignments(game) === 1 ? '' : 's'} at once. A better chief scout runs more.` }
  game.assignments = [...list, leagueId]
  return { ok: true, message: 'Your scouts are on it: knowledge rises 5 a week.' }
}

/** Is any part of the focus set? */
export function focusActive(f: RecruitFocus | undefined): f is RecruitFocus {
  return !!f && (f.position !== undefined || f.age !== undefined || f.maxFee !== undefined || f.deal !== undefined)
}

export function ageFits(band: RecruitFocus['age'], age: number): boolean {
  switch (band) {
    case 'u21':
      return age <= 21
    case 'u24':
      return age <= 24
    case 'prime':
      return age >= 25 && age <= 29
    case 'veteran':
      return age >= 30
    default:
      return true
  }
}

/** Does a player match the focus? Position natural, age band, asking price at the market's level, and loanable for a loan. */
export function matchesFocus(f: RecruitFocus, p: PlayerSeason): boolean {
  if (f.position && !p.positions.includes(f.position)) return false
  if (!ageFits(f.age, p.age)) return false
  if (f.maxFee !== undefined && askingPrice(p, { priceLevel: 1.05 }).price > f.maxFee) return false
  if (f.deal === 'loan' && !loanable(p)) return false
  return true
}

/** The market's filter for the game's focus, or undefined with none set (the market then draws exactly as before). */
export function focusFilter(game: Game): ((p: PlayerSeason) => boolean) | undefined {
  const f = game.recruitFocus
  if (!focusActive(f)) return undefined
  return (p) => matchesFocus(f, p)
}

/** Set (or with an empty focus, clear) the recruitment focus; the scouts file their first two reports at once. */
export function setRecruitFocus(game: Game, u: LoadedUniverse, focus: RecruitFocus | null): { ok: boolean; message: string } {
  const clean: RecruitFocus = {}
  if (focus?.position) clean.position = focus.position
  if (focus?.age) clean.age = focus.age
  if (focus?.maxFee !== undefined && Number.isFinite(focus.maxFee) && focus.maxFee > 0) clean.maxFee = Math.round(focus.maxFee * 10) / 10
  if (focus?.deal) clean.deal = focus.deal
  if (!focusActive(clean)) {
    delete game.recruitFocus
    return { ok: true, message: 'Recruitment focus cleared.' }
  }
  game.recruitFocus = clean
  const filed = fileReports(game, u, `scout-set-${game.year}-${game.season?.matchweek ?? 0}-${(game.scoutReports ?? []).length}`)
  return { ok: true, message: filed.length ? `Focus set. Your scouts file ${filed.length} report${filed.length === 1 ? '' : 's'}.` : 'Focus set. Nobody fits it yet.' }
}

/** Describe the focus in a few words, for the box and the inbox. */
export function focusLabel(f: RecruitFocus | undefined): string {
  if (!focusActive(f)) return 'No focus'
  const age = { u21: '21 or under', u24: '24 or under', prime: '25 to 29', veteran: '30 or over' } as const
  return [f.position ?? 'Any position', f.age ? age[f.age] : null, f.maxFee !== undefined ? `up to £${f.maxFee}M` : null, f.deal === 'loan' ? 'loan' : f.deal === 'permanent' ? 'permanent' : null].filter(Boolean).join(' · ')
}

/** The man a recruit at `pos` would replace: the weakest starter there, or the best cover when the shape has no such slot. */
export function incumbentAt(game: Game, u: LoadedUniverse, pos: Position): { name: string; rating: number } | null {
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const starters = formation.slots
    .filter((sl) => sl.position === pos && game.lineup[sl.id])
    .map((sl) => get(game.lineup[sl.id]))
    .filter((p): p is PlayerSeason => !!p)
    .map((p) => ({ name: p.name, rating: Math.round(ratingAt(p, pos)) }))
    .sort((a, b) => a.rating - b.rating)
  if (starters.length) return starters[0]
  const cover = squadPlayers(game, u)
    .filter((x) => canCover(x.p, pos, 'accomplished'))
    .map((x) => ({ name: x.p.name, rating: Math.round(ratingAt(x.p, pos)) }))
    .sort((a, b) => b.rating - a.rating)
  return cover[0] ?? null
}

/** Grade a player A to D on what the club can see of him, against the man he would replace. */
export function gradePlayer(game: Game, u: LoadedUniverse, p: PlayerSeason): { grade: ScoutReport['grade']; note: string; seen: number } {
  const pos = game.recruitFocus?.position && p.positions.includes(game.recruitFocus.position) ? game.recruitFocus.position : p.positions[0]
  const view = maskedView(game, u, p)
  const seen = Math.round(ratingAt({ positions: p.positions, attributes: seenAttributes(p, view) }, pos))
  const inc = incumbentAt(game, u, pos)
  const diff = inc ? seen - inc.rating : 99
  const grade: ScoutReport['grade'] = diff >= 3 ? 'A' : diff >= -1 ? 'B' : diff >= -5 ? 'C' : 'D'
  const read = view.exact ? `${seen}` : `about ${seen} (${view.overall.lo}-${view.overall.hi} overall)`
  const note = inc ? `${pos}: rated ${read} against ${inc.name}'s ${inc.rating}.` : `${pos}: rated ${read}; nobody in the squad covers it.`
  return { grade, note, seen }
}

/**
 * File scout reports on players who fit the focus, from a fork of a copy of the
 * stream labelled `label`: the game's own stream does not move.
 */
export function fileReports(game: Game, u: LoadedUniverse, label: string, n = REPORTS_PER_WEEK): ScoutReport[] {
  const focus = focusFilter(game)
  if (!focus) return []
  const rng = Rng.fromState(game.rngState).fork(label)
  const owned = new Set(squadPlayers(game, u).map((x) => x.p.playerId))
  for (const id of game.draft?.takenPlayers ?? []) owned.add(id)
  for (const id of game.retiredPlayers ?? []) owned.add(id)
  // Nobody already reported on, or already on the market, is reported again
  for (const r of game.scoutReports ?? []) owned.add(u.index[r.playerSeasonId]?.playerId ?? '')
  for (const l of game.window?.listings ?? []) owned.add(u.index[l.playerSeasonId]?.playerId ?? '')
  const rules = game.settings.rules
  const floor = ageFloors(game)
  const found = openWindow({ u, rng, ownedPlayerIds: owned, leagueSeason: game.season?.leagueSeason ?? game.settings.leagueSeason, priceLevel: 1.05, fromSeason: rules.fromSeason, toSeason: rules.toSeason, leagues: game.settings.wheelLeagues, onlyNation: rules.onlyNation, classic: rules.classic, focus, ...(floor ? { ageFloor: floor } : {}) }, 'january', n).listings
  const mw = game.season?.matchweek ?? 0
  const reports: ScoutReport[] = found.map((l) => {
    const p = u.index[l.playerSeasonId]!
    const g = gradePlayer(game, u, p)
    return { playerSeasonId: p.id, mw, grade: g.grade, note: g.note }
  })
  if (!reports.length) return reports
  game.scoutReports = [...reports, ...(game.scoutReports ?? [])].slice(0, REPORTS_CAP)
  postNews(game, { matchweek: mw, kind: 'transfer', title: `Scout report${reports.length > 1 ? 's' : ''}: ${focusLabel(game.recruitFocus)}`, body: reports.map((r) => `${u.index[r.playerSeasonId]?.name} (${r.grade})`).join(', ') + '. See the Market tab.' })
  return reports
}

/**
 * The week's scouting: assignments raise their league's knowledge, every other
 * league fades back towards its starting level, and with a focus set the
 * scouts file this week's reports. A game that has never used scouting is left
 * untouched.
 */
export function weeklyScouting(game: Game, u: LoadedUniverse): void {
  const assigned = game.assignments ?? []
  if (assigned.length || game.knowledge) {
    const k: Record<string, number> = { ...(game.knowledge ?? {}) }
    for (const league of new Set([...scoutableLeagues(game), ...Object.keys(k)])) {
      const now = knowledgeOf(game, league)
      const next = assigned.includes(league) ? Math.min(100, now + ASSIGNMENT_GAIN) : Math.max(baseKnowledge(game, league), now - KNOWLEDGE_FADE)
      if (next > baseKnowledge(game, league)) k[league] = next
      else delete k[league]
    }
    game.knowledge = k
  }
  if (focusActive(game.recruitFocus)) fileReports(game, u, `scout-${game.year}-${game.season?.matchweek ?? 0}`)
}
