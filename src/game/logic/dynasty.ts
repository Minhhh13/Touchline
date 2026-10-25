import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import type { PlayerSeason } from '@engine/types'
import { overallOf } from '@engine/positions'
import { newDraft } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { playerLookup, squadPlayers } from './players'
import { autoPickLineup } from '@engine/ratings'
import { releasePlayer } from './marketOps'
import { openWindow } from '@engine/market'
import { WAGE_MULT } from '@engine/status'

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
  const next: PlayerSeason = { ...p, id: `${p.playerId}@dyn${year}`, age, attributes: attrs, accolades: [], overall: 0 }
  next.overall = overallOf(next)
  // Value follows the new rating and age
  const base = 0.25 * Math.pow(1.21, next.overall - 60)
  const ageF = age <= 21 ? 1.3 : age <= 26 ? 1.15 : age <= 29 ? 1 : age <= 31 ? 0.72 : age <= 33 ? 0.45 : 0.25
  next.value = Math.round(base * ageF * 10) / 10
  next.wage = Math.round(5 * Math.pow(Math.max(0.1, next.value), 0.85))
  return next
}

export interface OffseasonReport {
  retired: string[]
  expired: string[]
  /** Loan players who went back to their clubs. */
  returned: string[]
  improved: Array<{ name: string; from: number; to: number }>
  declined: Array<{ name: string; from: number; to: number }>
}

/** Move the game into the next season: ageing, contracts, retirements, summer window, new league environment. */
export function advanceToNextSeason(game: Game, u: LoadedUniverse): OffseasonReport {
  const report: OffseasonReport = { retired: [], expired: [], returned: [], improved: [], declined: [] }
  // Only a finished season moves on; a second call (double tap, late league load) must not age the squad twice
  if (game.phase !== 'summary') return report
  const rng = Rng.fromState(game.rngState)
  const get = playerLookup(game, u)
  game.year += 1
  const targetLeague = game.pendingMove?.leagueId ?? game.settings.leagueId
  const leagueSeasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === targetLeague).map((cs) => cs.season))].sort()
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
      continue
    }
    const aged = ageOneYear(p, rng, game.year)
    // Retirement
    if (aged.age >= 34 && rng.chance(aged.age >= 37 ? 0.9 : aged.age >= 36 ? 0.6 : 0.3)) {
      report.retired.push(p.name)
      continue
    }
    if (contract.renewed) {
      newContracts[aged.id] = { years: aged.age >= 32 ? 1 : 3, status: contract.status }
    } else if (contract.years - 1 <= 0) {
      // Contract up: a declined renewal, poor morale or plain bad luck means he walks
      if (contract.declined || s.morale < 50 || rng.chance(0.25)) {
        report.expired.push(p.name)
        continue
      }
      newContracts[aged.id] = { years: aged.age >= 32 ? 1 : rng.int(2, 3), status: contract.status }
    } else {
      newContracts[aged.id] = { years: contract.years - 1, listed: contract.listed, status: contract.status }
    }
    // Ageing recomputes the wage from the new value; the status premium he signed on stays
    if (contract.status) aged.wage = Math.round(aged.wage * WAGE_MULT[contract.status])
    game.customPlayers[aged.id] = aged
    if (aged.overall > p.overall + 1) report.improved.push({ name: p.name, from: p.overall, to: aged.overall })
    if (aged.overall < p.overall - 1) report.declined.push({ name: p.name, from: p.overall, to: aged.overall })
    idMap[id] = aged.id
    newSquad[aged.id] = { ...s, playerSeasonId: aged.id, condition: 95, sharpness: 60, morale: Math.max(50, s.morale), familiarity: Math.min(100, s.familiarity + 10), recentRatings: [], recentMinutes: [], injury: null, suspension: 0, yellowCards: 0, seasonStats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, cleanSheets: 0, motm: 0 } }
  }
  game.squad = newSquad
  game.contracts = newContracts
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
  game.lastMatch = null
  game.lastMatchContext = null
  game.lastCupMatch = null
  game.lastCupContext = null
  game.pendingEvent = null
  game.window = null
  game.development = {}
  // Summer: bonus wheel spins scale with how many left, plus a summer market
  const lost = report.retired.length + report.expired.length + report.returned.length
  game.bonusSpins += Math.min(6, 2 + lost)
  const formation = getFormation(game.tactics.formationId)
  const d = newDraft(formation, { ...game.settings.rules, squadSize: Object.keys(game.squad).length + game.bonusSpins, respins: 1 })
  // Seed the draft with the existing squad: best eleven on the pitch, the rest on the bench,
  // so the bonus spins add squad depth wherever the wheel lands.
  for (const x of squadPlayers(game, u)) d.takenPlayers.push(x.p.playerId)
  const pool = squadPlayers(game, u).map((x) => x.p)
  const picked = autoPickLineup(formation, pool, game.tactics)
  d.lineup = picked.lineup
  const inXI = new Set(Object.values(picked.lineup))
  d.bench = pool.filter((p) => !inXI.has(p.id)).map((p) => p.id)
  game.draft = d
  game.phase = 'draft'
  game.window = openWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: nextSeason, priceLevel: 1, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues, onlyNation: game.settings.rules.onlyNation }, 'summer', 40)
  game.rngState = rng.getState()
  void releasePlayer
  return report
}
