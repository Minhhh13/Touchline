import type { Game, GameSettings } from '../types'
import { DEFAULT_LEAGUE } from '@engine/universe'

/** Fill in fields added since the save was written; null for anything that is not a game. */
export function normaliseGame(g: Game | null | undefined): Game | null {
  if (!g || typeof g !== 'object' || !g.settings || typeof g.settings !== 'object') return null
  const settings: GameSettings = { ...g.settings }
  settings.leagueId ??= DEFAULT_LEAGUE
  settings.wheelLeagues ??= [settings.leagueId]
  return {
    ...g,
    settings,
    squad: g.squad ?? {},
    contracts: g.contracts ?? {},
    customPlayers: g.customPlayers ?? {},
    lineup: g.lineup ?? {},
    bench: g.bench ?? [],
    weekPlayed: g.weekPlayed ?? [],
    live: g.live ?? null,
    lastMatch: g.lastMatch ?? null,
    lastMatchContext: g.lastMatchContext ?? null,
    lastCupMatch: g.lastCupMatch ?? null,
    lastCupContext: g.lastCupContext ?? null,
    consecutiveMissed: g.consecutiveMissed ?? {},
    history: g.history ?? [],
    bonusSpins: g.bonusSpins ?? 0,
    friendliesPlayed: g.friendliesPlayed ?? 0,
    unlocked: g.unlocked ?? [],
    jobOffers: g.jobOffers ?? [],
    pendingMove: g.pendingMove ?? null,
    quickResult: g.quickResult ?? null,
  }
}
