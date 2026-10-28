import type { Game } from '../types'
import { isClassicSeason, poolClubSeasons, type LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import type { PlayerSeason } from '@engine/types'
import { newDraft } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { playerLookup, squadPlayers } from './players'
import { autoPickLineup } from '@engine/ratings'
import { SQUAD_CAP, leaveAiSquads, ownedHumans, releasePlayer, withFloors } from './marketOps'
import { openWindow } from '@engine/market'
import { WAGE_MULT } from '@engine/status'
import { logMorale } from './happiness'
import { developedOverall } from './development'
import { focusFilter } from './scouting'
import type { Contract } from '../types'
import { ageFloors, barredByAge, recordDeparture } from './departures'
import { contractDemand, proposeContract, talksClosedUntil } from './contracts'
import { postNews } from './news'
import { hashUnit } from './scouting'
import { newSquadPlayer } from '@engine/season'
import { autoPick } from './squad'

/**
 * Age a player-season by one year. Young players grow towards an estimated
 * potential; players past thirty decline, physical attributes first.
 */
export function ageOneYear(p: PlayerSeason, rng: Rng, year: number): PlayerSeason {
  const age = p.age + 1
  const attrs = { ...p.attributes }
  const potential = p.overall + Math.max(0, 27 - p.age) * 1.3 + rng.gaussian(0, 1.5)
  const growthRoom = Math.max(0, potential - p.overall)
  let delta: number
  if (age <= 23) delta = Math.min(growthRoom, rng.gaussian(2.2, 1.2))
  else if (age <= 27) delta = Math.min(growthRoom, rng.gaussian(0.8, 1))
  else if (age <= 30) delta = rng.gaussian(-0.2, 0.8)
  else if (age <= 32) delta = rng.gaussian(-1.4, 1)
  else if (age <= 34) delta = rng.gaussian(-2.6, 1.2)
  else delta = rng.gaussian(-4, 1.5)
  const physicalBias = age >= 30 ? -1 : age <= 22 ? 0.5 : 0
  const bump = (k: keyof typeof attrs, extra = 0) => {
    attrs[k] = Math.round(Math.max(1, Math.min(99, attrs[k] + delta + extra + rng.gaussian(0, 0.6))))
  }
  bump('pace', physicalBias * 1.6)
  bump('physical', physicalBias * 0.8)
  bump('shooting')
  bump('passing', age >= 30 ? 0.6 : 0)
  bump('dribbling', physicalBias * 0.6)
  bump('defending')
  bump('mentality', age >= 30 ? 1 : 0.3)
  if (p.positions[0] === 'GK') bump('goalkeeping', age >= 33 ? -0.5 : 0.5)
  // The depth attributes: stamina and jumping go with the legs from 30, strength holds to 33
  // (the yearly delta is cancelled, only noise moves it), aggression and work rate are character
  bump('stamina', physicalBias * 1.2)
  bump('jumping', physicalBias)
  bump('strength', age >= 33 ? physicalBias * 0.8 : age >= 30 ? -delta : 0)
  bump('aggression', -delta)
  bump('workRate', -delta)
  // A delta from the displayed overall, never the one the attributes derive (`developedOverall`, INV-01)
  const next: PlayerSeason = { ...p, id: `${p.playerId}@dyn${year}`, age, attributes: attrs, accolades: [], overall: developedOverall(p, attrs) }
  // Value follows the new rating and age
  const base = 0.25 * Math.pow(1.21, next.overall - 60)
  const ageF = age <= 21 ? 1.3 : age <= 26 ? 1.15 : age <= 29 ? 1 : age <= 31 ? 0.72 : age <= 33 ? 0.45 : 0.25
  next.value = Math.round(base * ageF * 10) / 10
  next.wage = Math.round(5 * Math.pow(Math.max(0.1, next.value), 0.85))
  return next
}

/** Terms that travel with a contract into the next season: the clauses and a sell-on (an agent stops shopping him in the summer). */
function carried(c: Contract): Partial<Contract> {
  return { ...(c.clauses ? { clauses: c.clauses } : {}), ...(c.sellOn ? { sellOn: c.sellOn } : {}) }
}

export interface OffseasonReport {
  retired: string[]
  /** Walked at the summer: a renewal he had turned down. */
  expired: string[]
  /** Out of contract: talks are open through pre-season, and he leaves on a free at the opener unless renewed. */
  renewals: string[]
  /** Loan players who went back to their clubs. */
  returned: string[]
  improved: Array<{ name: string; from: number; to: number }>
  declined: Array<{ name: string; from: number; to: number }>
}

/** Move the game into the next season: ageing, contracts, retirements, summer window, new league environment. */
export function advanceToNextSeason(game: Game, u: LoadedUniverse): OffseasonReport {
  const report: OffseasonReport = { retired: [], expired: [], renewals: [], returned: [], improved: [], declined: [] }
  // Only a finished season moves on; a second call (double tap, late league load) must not age the squad twice
  if (game.phase !== 'summary') return report
  const rng = Rng.fromState(game.rngState)
  const get = playerLookup(game, u)
  game.year += 1
  const targetLeague = game.pendingMove?.leagueId ?? game.settings.leagueId
  // Classic seasons are in the cycle only for a game that opted in or is playing one
  const classicOk = !!game.settings.rules.classic || isClassicSeason(u, game.settings.leagueId, game.settings.leagueSeason)
  const leagueSeasons = [...new Set(poolClubSeasons(u, classicOk).filter((cs) => cs.leagueId === targetLeague).map((cs) => cs.season))].sort()
  const idx = leagueSeasons.indexOf(game.settings.leagueSeason)
  const nextSeason = leagueSeasons[(idx + 1) % leagueSeasons.length] ?? leagueSeasons[0]
  // The host club may not exist in the next league season; pick the same club if present, else a random club of similar stature.
  const nextClubs = u.clubSeasons.filter((cs) => cs.leagueId === targetLeague && cs.season === nextSeason).map((cs) => cs.clubId)
  const wanted = game.pendingMove?.clubId ?? game.settings.hostClubId
  const host = nextClubs.includes(wanted) ? wanted : rng.pick(nextClubs)
  const move = game.pendingMove
  const bonus = move ? game.jobOffers.find((o) => o.clubId === move.clubId)?.budgetBonus ?? 0 : 0
  game.settings = { ...game.settings, leagueId: targetLeague, leagueSeason: nextSeason, hostClubId: host, wheelLeagues: game.settings.wheelLeagues.includes(targetLeague) ? game.settings.wheelLeagues : [...game.settings.wheelLeagues, targetLeague] }
  if (bonus) game.finances.budget = Math.round((game.finances.budget + bonus) * 10) / 10
  game.jobOffers = []
  game.pendingMove = null

  const ids = Object.keys(game.squad)
  const newSquad: typeof game.squad = {}
  const newContracts: typeof game.contracts = {}
  const idMap: Record<string, string> = {}
  for (const id of ids) {
    const p = get(id)
    const s = game.squad[id]
    if (!p || !s) continue
    const contract = game.contracts[id] ?? { years: 1 }
    if (contract.loan) {
      report.returned.push(p.name)
      recordDeparture(game, p)
      continue
    }
    const aged = ageOneYear(p, rng, game.year)
    // Retirement
    if (aged.age >= 34 && rng.chance(aged.age >= 37 ? 0.9 : aged.age >= 36 ? 0.6 : 0.3)) {
      report.retired.push(p.name)
      game.retiredPlayers = [...(game.retiredPlayers ?? []), p.playerId]
      continue
    }
    if (contract.renewed) {
      newContracts[aged.id] = { years: aged.age >= 32 ? 1 : 3, status: contract.status, ...carried(contract) }
    } else if (contract.years - 1 <= 0) {
      // Contract up: a renewal he turned down means he walks; anyone else is out of contract and in talks until the
      // opener (`settleRenewals`), never renewed without a word (E6-8)
      if (contract.declined) {
        report.expired.push(p.name)
        recordDeparture(game, aged)
        continue
      }
      report.renewals.push(p.name)
      newContracts[aged.id] = { years: 0, expired: true, status: contract.status, ...carried(contract) }
    } else {
      newContracts[aged.id] = { years: contract.years - 1, listed: contract.listed, status: contract.status, ...carried(contract) }
    }
    // Ageing recomputes the wage from the new value; the status premium he signed on stays
    if (contract.status) aged.wage = Math.round(aged.wage * WAGE_MULT[contract.status])
    game.customPlayers[aged.id] = aged
    if (aged.overall > p.overall + 1) report.improved.push({ name: p.name, from: p.overall, to: aged.overall })
    if (aged.overall < p.overall - 1) report.declined.push({ name: p.name, from: p.overall, to: aged.overall })
    idMap[id] = aged.id
    newSquad[aged.id] = { ...s, playerSeasonId: aged.id, condition: 95, sharpness: 60, morale: Math.max(50, s.morale), familiarity: Math.min(100, s.familiarity + 10), recentRatings: [], recentMinutes: [], injury: null, suspension: 0, yellowCards: 0, seasonStats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, cleanSheets: 0, motm: 0 }, moraleLog: undefined }
    // A new season starts a new happiness log; the summer lift is its first line
    logMorale(newSquad[aged.id], 0, s.morale, 'summer')
  }
  game.squad = newSquad
  game.contracts = newContracts
  // Every man carries a new id into the new season: the copies made for the old ids (last summer's ageing, the
  // season's development and wage changes, the men who left) are read by nothing now, and would pile up a squad a year
  const inUse = new Set([...Object.keys(newSquad), ...(game.youthIntake?.candidates ?? [])])
  for (const id of Object.keys(game.customPlayers)) if (!inUse.has(id)) delete game.customPlayers[id]
  game.lineup = {}
  game.bench = []
  game.consecutiveMissed = {}
  // Players carry new ids into the new season: follow them with the captaincy and the set-piece duties
  game.captainId = game.captainId ? idMap[game.captainId] : undefined
  if (game.tactics.setPieces) {
    const sp = game.tactics.setPieces
    game.tactics.setPieces = { penalties: sp.penalties ? idMap[sp.penalties] : undefined, freeKicks: sp.freeKicks ? idMap[sp.freeKicks] : undefined, corners: sp.corners ? idMap[sp.corners] : undefined }
  }
  game.talks = {}
  game.promisedStart = undefined
  game.markTarget = undefined
  game.season = null
  game.awards = null
  game.tier = null
  game.quickResult = null
  game.live = null
  game.weekPlayed = []
  delete game.weekUnavailable
  game.lastMatch = null
  game.lastMatchContext = null
  game.lastCupMatch = null
  game.lastCupContext = null
  game.pendingEvent = null
  game.window = null
  game.development = {}
  // Contract talks reopen, the data hub starts again and nothing is owed from last season
  delete game.negotiations
  delete game.dataHub
  delete game.bonusDue
  // Summer: bonus wheel spins scale with how many left, plus a summer market
  const lost = report.retired.length + report.expired.length + report.returned.length
  game.bonusSpins += Math.min(6, 2 + lost)
  // Never past the squad cap the market and the youth intake keep (a full squad of 23 losing four took six spins to 25)
  game.bonusSpins = Math.min(game.bonusSpins, Math.max(0, SQUAD_CAP - Object.keys(game.squad).length))
  const formation = getFormation(game.tactics.formationId)
  // The summer wheel fills the squad up to the cap at most: a 22-man squad with its two bonus spins would reach 24
  const d = newDraft(formation, { ...game.settings.rules, squadSize: Math.min(SQUAD_CAP, Object.keys(game.squad).length + game.bonusSpins), respins: 1, budget: undefined, chain: undefined })
  // Seed the draft with the existing squad: best eleven on the pitch, the rest on the bench,
  // so the bonus spins add squad depth wherever the wheel lands.
  for (const x of squadPlayers(game, u)) d.takenPlayers.push(x.p.playerId)
  // A man who retired never comes back as his younger self
  for (const id of game.retiredPlayers ?? []) if (!d.takenPlayers.includes(id)) d.takenPlayers.push(id)
  // Nor a man who left: no season of him younger than he would be now
  const floors = ageFloors(game)
  if (floors) d.ageFloor = floors
  const pool = squadPlayers(game, u).map((x) => x.p)
  const picked = autoPickLineup(formation, pool, game.tactics)
  d.lineup = picked.lineup
  const inXI = new Set(Object.values(picked.lineup))
  d.bench = pool.filter((p) => !inXI.has(p.id)).map((p) => p.id)
  game.draft = d
  game.phase = 'draft'
  game.window = openWindow({ u, rng, ownedPlayerIds: new Set([...squadPlayers(game, u).map((x) => x.p.playerId), ...(game.retiredPlayers ?? [])]), leagueSeason: nextSeason, priceLevel: 1, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues, onlyNation: game.settings.rules.onlyNation, classic: game.settings.rules.classic, focus: focusFilter(game), ...withFloors(game) }, 'summer', 40)
  game.rngState = rng.getState()
  return report
}

/** The men whose contracts ran out this summer, still in talks (Dynasty). */
export function renewalList(game: Game): string[] {
  return Object.keys(game.squad).filter((id) => game.contracts[id]?.expired)
}

/** Pre-season's Inbox item: who is out of contract, and what happens at the opener. Posted once by the store after `beginSeason`. */
export function postRenewals(game: Game, u: LoadedUniverse): void {
  const ids = renewalList(game)
  if (!ids.length || !game.season) return
  const get = playerLookup(game, u)
  const names = ids.map((id) => get(id)?.name ?? id)
  postNews(game, { matchweek: 0, kind: 'board', title: `Contracts up: ${ids.length} to renew`, body: `Out of contract: ${names.join(', ')}. Offer terms on the Contracts tab, or let them go. At the opener the assistant renews the ones worth keeping who want to stay; the rest leave on a free.`, playerId: ids.length === 1 ? ids[0] : undefined })
}

/** Let an out-of-contract man go on a free now (pre-season), while the summer window is still open to replace him. */
export function letContractGo(game: Game, u: LoadedUniverse, id: string): { ok: boolean; message: string } {
  const p = playerLookup(game, u)(id)
  if (!p || !game.contracts[id]?.expired) return { ok: false, message: 'He is not out of contract.' }
  releasePlayer(game, u, id)
  postNews(game, { matchweek: game.season?.matchweek ?? 0, kind: 'transfer', title: `${p.name} leaves on a free`, body: 'His contract ran out and he was not offered a new one.' })
  return { ok: true, message: `${p.name} leaves on a free.` }
}

/** Squad places the assistant keeps among the men out of contract: anyone in the best 18 by overall. */
export const RENEW_TOP = 18
/** A man this young is always kept, if he is willing. */
export const RENEW_YOUNG = 23
/** Past this age the assistant lets him go. */
export const RENEW_MAX_AGE = 34

/**
 * The opener: every man still out of contract is settled. The assistant renews
 * him at his own ask (his status, two seasons, one from 32) when he is willing
 * (morale 50 or more, talks open), not past 34 and worth keeping: in the best
 * 18 by overall, 23 or under, or one of the two best keepers; and only when his
 * ask fits the wage cap. Anyone else leaves on a free. No draws.
 */
export function settleRenewals(game: Game, u: LoadedUniverse): { renewed: string[]; left: string[] } {
  const out = { renewed: [] as string[], left: [] as string[] }
  const ids = renewalList(game)
  if (!ids.length) return out
  const get = playerLookup(game, u)
  const all = squadPlayers(game, u)
  const rank = all.map((x) => x.p).sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
  const top = new Set(rank.slice(0, RENEW_TOP).map((p) => p.id))
  const keepers = new Set(rank.filter((p) => p.positions[0] === 'GK').slice(0, 2).map((p) => p.id))
  for (const id of ids) {
    const p = get(id)
    const s = game.squad[id]
    const c = game.contracts[id]
    if (!p || !s || !c) continue
    const willing = s.morale >= 50 && talksClosedUntil(game, u, id) === null
    const worth = top.has(id) || p.age <= RENEW_YOUNG || keepers.has(id)
    let kept = false
    if (willing && worth && p.age <= RENEW_MAX_AGE) {
      const status = c.status ?? 'rotation'
      const demand = contractDemand(game, u, id, status)
      if (demand) kept = proposeContract(game, u, id, { wage: demand.wage, years: Math.min(demand.maxYears, p.age >= 32 ? 1 : 2), status, signingFee: 0, release: c.clauses?.release, appearance: c.clauses?.appearance ?? 0, goal: c.clauses?.goal ?? 0 }).accepted
    }
    if (kept) out.renewed.push(p.name)
    else {
      releasePlayer(game, u, id)
      out.left.push(p.name)
    }
  }
  const lines = [out.renewed.length ? `Renewed by the assistant: ${out.renewed.join(', ')}.` : '', out.left.length ? `Left on a free: ${out.left.join(', ')}.` : ''].filter(Boolean)
  postNews(game, { matchweek: 0, kind: 'transfer', title: 'Contracts settled', body: lines.join(' ') })
  return out
}

/** A Dynasty season never starts with fewer keepers or men than these. */
export const MIN_SEASON_KEEPERS = 2
export const MIN_SEASON_SQUAD = 16
/** The free agents the assistant may sign as cover: a modest band, cheap. */
const COVER_MIN = 55
const COVER_MAX = 70
const COVER_MAX_VALUE = 3

/**
 * The opener's cover: while the squad has fewer than two keepers or sixteen men,
 * the assistant signs a free agent on a one-season backup deal: a real player of
 * the wheel leagues (this season first), 55 to 70 overall, worth £3M at most,
 * nobody we hold, a retired man or a younger season of a man who left; keepers
 * first, then the outfield position with the fewest natural men against the
 * formation's slots. The order is a pure hash of the seed, the year and the
 * player-season: no draws. He leaves every AI squad holding him.
 */
export function coverSquad(game: Game, u: LoadedUniverse): string[] {
  const signed: string[] = []
  const rules = game.settings.rules
  const classicOk = !!rules.classic || isClassicSeason(u, game.settings.leagueId, game.settings.leagueSeason)
  const floors = ageFloors(game)
  const keeperCount = () => squadPlayers(game, u).filter((x) => x.p.positions[0] === 'GK').length
  const short = () => keeperCount() < MIN_SEASON_KEEPERS || Object.keys(game.squad).length < MIN_SEASON_SQUAD
  if (!short()) return signed
  const season = game.settings.leagueSeason
  const pool = poolClubSeasons(u, classicOk)
    .filter((cs) => game.settings.wheelLeagues.includes(cs.leagueId))
    .flatMap((cs) => cs.squad)
    .filter((p) => p.overall >= COVER_MIN && p.overall <= COVER_MAX && p.value <= COVER_MAX_VALUE && p.age >= 19 && p.age <= 33 && (!rules.onlyNation || p.nationality === rules.onlyNation) && !barredByAge(floors, p))
  const key = (p: PlayerSeason) => (p.season === season ? 0 : 1) + hashUnit(`${game.settings.seed}|cover|${game.year}|${p.id}`)
  const slots = getFormation(game.tactics.formationId).slots
  for (let guard = 0; guard < MIN_SEASON_SQUAD && short(); guard++) {
    const owned = ownedHumans(game, u)
    let want: (p: PlayerSeason) => boolean
    if (keeperCount() < MIN_SEASON_KEEPERS) want = (p) => p.positions[0] === 'GK'
    else {
      const naturals = squadPlayers(game, u).map((x) => x.p.positions[0])
      const need = [...new Set(slots.map((sl) => sl.position).filter((pos) => pos !== 'GK'))]
        .map((pos) => ({ pos, gap: naturals.filter((n) => n === pos).length - slots.filter((sl) => sl.position === pos).length }))
        .sort((a, b) => a.gap - b.gap || a.pos.localeCompare(b.pos))[0]?.pos
      want = (p) => p.positions[0] !== 'GK' && (!need || p.positions[0] === need)
    }
    let best: PlayerSeason | null = null
    let bestKey = Infinity
    for (const p of pool) {
      if (owned.has(p.playerId) || !want(p)) continue
      const k = key(p)
      if (k < bestKey) {
        best = p
        bestKey = k
      }
    }
    // An empty position band falls back to anyone outfield
    if (!best && keeperCount() >= MIN_SEASON_KEEPERS) for (const p of pool) if (!owned.has(p.playerId) && p.positions[0] !== 'GK' && key(p) < bestKey) [best, bestKey] = [p, key(p)]
    if (!best) break
    game.squad[best.id] = newSquadPlayer(best.id, { familiarity: 30, sharpness: 60 })
    game.contracts[best.id] = { years: 1, status: 'backup' }
    if (!game.bench.includes(best.id)) game.bench.push(best.id)
    leaveAiSquads(game, u, best.playerId)
    signed.push(best.name)
    postNews(game, { matchweek: 0, kind: 'transfer', title: `${best.name} signs as cover`, body: `The squad was short, so the assistant signed the ${best.age}-year-old ${best.positions[0]} on a free, a one-season backup deal (£${best.wage}k a week).`, playerId: best.id })
  }
  if (signed.length) autoPick(game, u, true)
  return signed
}

/** The Dynasty opener (`startSeasonProper`): contracts settled, then the cover the squad needs. */
export function dynastyOpener(game: Game, u: LoadedUniverse): void {
  if (game.settings.mode !== 'dynasty') return
  settleRenewals(game, u)
  coverSquad(game, u)
}
