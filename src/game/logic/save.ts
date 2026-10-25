import type { Game, GameSettings } from '../types'
import type { PlayerSeason } from '@engine/types'
import { DEFAULT_LEAGUE } from '@engine/universe'
import { DEPTH_KEYS, withDepth } from '@engine/depth'
import { DIFFICULTY_RESPINS, type DraftRules } from '@engine/draft'

/**
 * Draft rules written before the 38-0 options: the difficulty is read from hard mode (hard) or the
 * re-spin budget (3 or more is easy, anything else normal), ratings are shown unless hard, the draft
 * is Squad First and players are rated by season. The re-spin budget itself is left as it was saved.
 */
export function normaliseRules(r: DraftRules): DraftRules {
  const difficulty = r.difficulty ?? (r.hardMode ? 'hard' : r.respins >= DIFFICULTY_RESPINS.easy ? 'easy' : 'normal')
  const hard = difficulty === 'hard'
  return { ...r, difficulty, hardMode: !!r.hardMode || hard, showRatings: hard ? false : r.showRatings ?? true, draftMode: r.draftMode ?? 'squad', ratings: r.ratings ?? 'season' }
}

/** Fill in fields added since the save was written; null for anything that is not a game. */
export function normaliseGame(g: Game | null | undefined): Game | null {
  if (!g || typeof g !== 'object' || !g.settings || typeof g.settings !== 'object') return null
  const settings: GameSettings = { ...g.settings }
  settings.leagueId ??= DEFAULT_LEAGUE
  settings.wheelLeagues ??= [settings.leagueId]
  if (settings.rules && typeof settings.rules === 'object') settings.rules = normaliseRules(settings.rules)
  const draft = g.draft && typeof g.draft === 'object' && g.draft.rules ? { ...g.draft, rules: normaliseRules(g.draft.rules), target: g.draft.target ?? null } : g.draft
  return {
    ...g,
    settings,
    draft,
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
    // A season paused for a January window that is not there cannot go on: back to the tactics step, which replays it
    phase: g.phase === 'january' && !g.quickJanuary ? 'kickoff' : g.phase,
  }
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
