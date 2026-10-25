import type { Game, GameSettings } from '../types'
import type { PlayerSeason } from '@engine/types'
import type { NewsItem } from '@engine/season'
import { DEFAULT_LEAGUE } from '@engine/universe'
import { DEPTH_KEYS, withDepth } from '@engine/depth'

/** Fill in fields added since the save was written; null for anything that is not a game. */
export function normaliseGame(g: Game | null | undefined): Game | null {
  if (!g || typeof g !== 'object' || !g.settings || typeof g.settings !== 'object') return null
  const settings: GameSettings = { ...g.settings }
  settings.leagueId ??= DEFAULT_LEAGUE
  settings.wheelLeagues ??= [settings.leagueId]
  return {
    ...g,
    settings,
    season: g.season?.news ? { ...g.season, news: g.season.news.map(renameOldNews) } : g.season,
    squad: g.squad ?? {},
    contracts: g.contracts ?? {},
    customPlayers: withDepthAttributes(g.customPlayers ?? {}),
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

/**
 * Inbox text an older build wrote under the continental cup's old name ("Continental Cup draw", "Continental round of
 * 16: through", "Champions of the continent!") reads as European Nights. News is display text only: nothing parses it.
 */
function renameOldNews(n: NewsItem): NewsItem {
  const fix = (t: string) => t.replace(/\bContinental Cup\b/g, 'European Nights').replace(/\bContinental (round of 16|quarter-final|semi-final|final)\b/g, 'European Nights $1').replace('Champions of the continent!', 'European Nights champions!')
  const title = fix(n.title)
  const body = fix(n.body)
  return title === n.title && body === n.body ? n : { ...n, title, body }
}

/**
 * Players the game created (dynasty ageing, development, wage changes) travel in
 * the save with their attributes. A save written before the depth attributes
 * existed carries them without stamina, strength, aggression, jumping and work
 * rate, so they are derived from the eight core attributes exactly as the
 * engine derives them for an older data pack; a player who has them is untouched.
 */
function withDepthAttributes(players: Record<string, PlayerSeason>): Record<string, PlayerSeason> {
  let changed = false
  const out: Record<string, PlayerSeason> = {}
  for (const [id, p] of Object.entries(players)) {
    const a = p?.attributes
    if (!a || DEPTH_KEYS.every((k) => Number.isFinite(a[k]))) {
      out[id] = p
      continue
    }
    out[id] = { ...p, attributes: withDepth(a, p.age, p.height) }
    changed = true
  }
  return changed ? out : players
}
