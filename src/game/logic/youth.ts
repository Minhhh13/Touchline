/**
 * Youth intake. Every dynasty pre-season the academy presents a few real
 * youngsters, preferably ones who actually came through at the club you
 * replaced. Sign one for nothing, on a three-year deal, or pass.
 */
import type { Game } from '../types'
import { poolClubSeasons, type LoadedUniverse } from '@engine/universe'
import type { Rng } from '@engine/rng'
import type { PlayerSeason } from '@engine/types'
import { newSquadPlayer } from '@engine/season'
import { squadPlayers } from './players'
import { postNews } from './news'
import { SQUAD_CAP } from './marketOps'
import { ageFloors, barredByAge } from './departures'

export const INTAKE_SIZE = 3

export function buildYouthIntake(game: Game, u: LoadedUniverse, rng: Rng): string[] {
  const owned = new Set(squadPlayers(game, u).map((x) => x.p.playerId))
  // Anyone on the summer market is not also in the academy
  for (const l of game.window?.listings ?? []) {
    const pid = u.index[l.playerSeasonId]?.playerId
    if (pid) owned.add(pid)
  }
  const { fromSeason, toSeason, onlyNation } = game.settings.rules
  const inEra = (p: PlayerSeason) => (fromSeason === undefined || p.season >= fromSeason) && (toSeason === undefined || p.season <= toSeason)
  // A one-nation academy only brings through that nation's youngsters
  // A man who left the club never comes back through the academy as his younger self (Dynasty)
  const floors = ageFloors(game)
  const young = (p: PlayerSeason) => p.age <= 20 && p.overall >= 58 && p.overall <= 76 && !owned.has(p.playerId) && inEra(p) && (!onlyNation || p.nationality === onlyNation) && !barredByAge(floors, p)
  const seen = new Set<string>()
  const pickFrom = (pool: PlayerSeason[], n: number): PlayerSeason[] => {
    const out: PlayerSeason[] = []
    const shuffled = rng.shuffle([...pool])
    for (const p of shuffled) {
      if (out.length >= n) break
      if (seen.has(p.playerId)) continue
      seen.add(p.playerId)
      out.push(p)
    }
    return out
  }
  // The club's own graduates first: youngsters from any of the host club's real seasons
  const host = game.settings.hostClubId
  const pool = poolClubSeasons(u, game.settings.rules.classic)
  const homegrown = pool.filter((cs) => cs.clubId === host).flatMap((cs) => cs.squad).filter(young)
  const picks = pickFrom(homegrown, 2)
  // Youth facilities granted by the board (`src/game/logic/board.ts`) bring one more prospect each
  const size = INTAKE_SIZE + Math.max(0, Math.min(2, game.youthFacilities ?? 0))
  if (picks.length < size) {
    const leagueWide = pool.filter((cs) => game.settings.wheelLeagues.includes(cs.leagueId)).flatMap((cs) => cs.squad).filter(young)
    picks.push(...pickFrom(leagueWide, size - picks.length))
  }
  return picks.map((p) => p.id)
}

export function signYouth(game: Game, u: LoadedUniverse, playerSeasonId: string | null): { ok: boolean; message: string } {
  const intake = game.youthIntake
  if (!intake || intake.chosen !== undefined) return { ok: false, message: 'The intake has already been decided.' }
  if (playerSeasonId === null) {
    intake.chosen = null
    return { ok: true, message: 'You pass on this year\'s intake.' }
  }
  if (!intake.candidates.includes(playerSeasonId)) return { ok: false, message: 'He is not in the intake.' }
  const p = u.index[playerSeasonId]
  if (!p) return { ok: false, message: 'Player not found.' }
  if (squadPlayers(game, u).some((x) => x.p.playerId === p.playerId)) return { ok: false, message: `${p.name} is already in your squad.` }
  if (Object.keys(game.squad).length >= SQUAD_CAP) return { ok: false, message: `Squad is full (${SQUAD_CAP}). Make room first.` }
  game.squad[p.id] = newSquadPlayer(p.id, { familiarity: 30, sharpness: 60 })
  game.contracts[p.id] = { years: 3, status: 'prospect' }
  if (!game.bench.includes(p.id)) game.bench.push(p.id)
  intake.chosen = p.id
  if (game.season) postNews(game, { matchweek: 0, kind: 'transfer', title: `${p.name} promoted from the academy`, body: `${p.age}-year-old ${p.positions[0]} joins the first-team squad on a three-year deal.` })
  return { ok: true, message: `${p.name} joins the first-team squad.` }
}
