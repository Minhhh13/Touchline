import type { Game, GameSettings, Profile, QuickBests, QuickJanuary } from '../types'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { DEFAULT_LEAGUE } from '@engine/universe'
import { DEPTH_KEYS, withDepth } from '@engine/depth'
import { DIFFICULTY_RESPINS, type DraftRules } from '@engine/draft'
import { MORALE_LOG_CAP } from './happiness'
import { cleanLocker } from './endCase'
import { REPORTS_CAP, SCOUTED_CAP } from './scouting'
import { TIERS } from './rarity'
import { isUpgradeBoost } from '@engine/upgrader'

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
    squad: withMoraleLogs(g.squad ?? {}),
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
    arena: g.arena ?? null,
    // A season paused for a January window that is not there cannot go on: back to the tactics step, which replays it
    phase: g.phase === 'january' && !g.quickJanuary ? 'kickoff' : g.phase,
    ...recruitmentFields(g),
    ...januaryGambleFields(g),
  }
}

/**
 * The January spin and Upgrader (`QuickJanuary.spin`, `.upgrade`) are optional: a save from before them has neither and
 * every reader checks for them. One of the wrong shape is dropped (the season then replays as the window left it
 * without it); a window that needs nothing comes back untouched.
 */
function januaryGambleFields(g: Game): Partial<Game> {
  const j = g.quickJanuary
  if (!j) return {}
  const spinOk = j.spin === undefined || (typeof j.spin === 'object' && j.spin !== null && typeof j.spin.playerSeasonId === 'string' && TIERS.includes(j.spin.tier))
  const up = j.upgrade
  const upOk = up === undefined || (typeof up === 'object' && up !== null && typeof up.id === 'string' && isUpgradeBoost(up.boost) && [up.chance, up.roll, up.delta].every(Number.isInteger) && typeof up.won === 'boolean')
  // One deal per window: a gamble beside a listing taken is not a window this build made
  const both = (j.spin !== undefined || up !== undefined) && !!j.move
  if (spinOk && upOk && !both && !(j.spin && up)) return {}
  const fixed: QuickJanuary = { ...j }
  if (!spinOk || both || (j.spin && up)) delete fixed.spin
  if (!upOk || both || (j.spin && up)) delete fixed.upgrade
  return { quickJanuary: fixed }
}

/**
 * Recruitment (FM-depth Batch 2) is optional throughout: a save from before it has none of these fields and every
 * reader uses `??`. A list longer than its cap keeps its newest entries; a value of the wrong shape is dropped. A save
 * that needs neither gets nothing back, so its fields stay exactly as they were.
 */
function recruitmentFields(g: Game): Partial<Game> {
  const out: Partial<Game> = {}
  if (g.scouted !== undefined && !(Array.isArray(g.scouted) && g.scouted.length <= SCOUTED_CAP)) out.scouted = Array.isArray(g.scouted) ? g.scouted.slice(-SCOUTED_CAP) : []
  if (g.scoutReports !== undefined && !(Array.isArray(g.scoutReports) && g.scoutReports.length <= REPORTS_CAP)) out.scoutReports = Array.isArray(g.scoutReports) ? g.scoutReports.slice(0, REPORTS_CAP) : []
  if (g.assignments !== undefined && !Array.isArray(g.assignments)) out.assignments = []
  if (g.knowledge !== undefined && (typeof g.knowledge !== 'object' || g.knowledge === null)) out.knowledge = {}
  return out
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

/**
 * The happiness log (`SquadPlayer.moraleLog`) is optional: a save from before it simply has none, and every reader
 * uses `?? []`. A log that is not a list is dropped and one longer than the cap is trimmed to its newest entries; a
 * squad that needs neither is returned as it was.
 */
function withMoraleLogs(squad: Record<string, SquadPlayer>): Record<string, SquadPlayer> {
  let changed = false
  const out: Record<string, SquadPlayer> = {}
  for (const [id, s] of Object.entries(squad)) {
    const log = s?.moraleLog
    if (log === undefined || (Array.isArray(log) && log.length <= MORALE_LOG_CAP)) {
      out[id] = s
      continue
    }
    changed = true
    const rest = { ...s }
    delete rest.moraleLog
    out[id] = Array.isArray(log) ? { ...rest, moraleLog: log.slice(-MORALE_LOG_CAP) } : rest
  }
  return changed ? out : squad
}

/**
 * A profile from any build: the defaults under whatever was saved, and the Quick Draft bests (added with the 38-0
 * chase) filled in, so a profile written before them reads as no perfect seasons and no run yet.
 */
export function normaliseProfile(p: Partial<Profile> | null | undefined, defaults: Profile): Profile {
  const saved = p && typeof p === 'object' ? p : {}
  const b: QuickBests = saved.quickBests && typeof saved.quickBests === 'object' ? saved.quickBests : {}
  const quickBests: QuickBests = { perfectSeasons: b.perfectSeasons ?? 0, longestPerfectRun: b.longestPerfectRun ?? 0, ...(b.bestRecord ? { bestRecord: b.bestRecord } : {}) }
  // The locker (end-of-draft case drops): known power-ups with whole counts only; empty on a profile from before it
  const inventory = cleanLocker(saved.inventory)
  return { ...defaults, ...saved, quickBests, inventory }
}
