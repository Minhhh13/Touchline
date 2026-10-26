/**
 * What each cloud-save slot holds right now, and the small facts the sync planner and the cloud rows carry about
 * it: an identity (which game it is), a progress key (how far along it is) and a summary shown without
 * downloading (`meta`, under 2 KB). Pure: reads the store's persisted shape, writes nothing.
 */
import type { Game, Phase } from '@game/types'
import type { H2HGame } from '@game/store'
import { picksMade } from '@engine/draft'
import { isQuickLike } from '@game/logic/modes'
import { fingerprint } from './canonical'

export type GameSlotId = 'quick' | 'season' | 'dynasty'
export type SlotId = GameSlotId | 'h2h'
export const SLOT_IDS: readonly SlotId[] = ['quick', 'season', 'dynasty', 'h2h']

export interface SyncSource {
  game: Game | null
  parked: Record<string, Game>
  h2h: H2HGame | null
}

export type SlotValue = { slot: GameSlotId; kind: 'game'; game: Game; active: boolean } | { slot: 'h2h'; kind: 'h2h'; h2h: H2HGame }

/**
 * The cloud slot a game lives in: Quick Drafts, Dailies and Weeklies share one (the same rule as `slotOf` in
 * `store.ts`, `isQuickLike`). Null for a game whose store slot has no cloud slot (an arena run, a Run-in): the
 * database takes only `quick`, `season`, `dynasty` and `h2h`, so those stay on the device until a migration adds them.
 */
export function gameSlot(game: Game): GameSlotId | null {
  const mode = game.settings.mode
  if (isQuickLike(mode)) return 'quick'
  return mode === 'season' || mode === 'dynasty' ? mode : null
}

/** Every slot that holds something: the active game in its slot, parked games in theirs, the hot-seat game. */
export function slotContents(s: SyncSource): Partial<Record<SlotId, SlotValue>> {
  const out: Partial<Record<SlotId, SlotValue>> = {}
  for (const g of Object.values(s.parked)) {
    const slot = gameSlot(g)
    if (!slot) continue
    out[slot] = { slot, kind: 'game', game: g, active: false }
  }
  // The active game wins its slot (the store never parks a game in the active game's slot, but a hand-edited save might)
  const slot = s.game ? gameSlot(s.game) : null
  if (s.game && slot) {
    out[slot] = { slot, kind: 'game', game: s.game, active: true }
  }
  if (s.h2h) out.h2h = { slot: 'h2h', kind: 'h2h', h2h: s.h2h }
  return out
}

/** Which game a slot holds: the game's id, or for the hot-seat game a fingerprint of its seed, hosts and shapes. */
export function slotIdentity(v: SlotValue): string {
  if (v.kind === 'game') return v.game.id
  const m = v.h2h.managers
  return `h2h-${fingerprint({ seed: v.h2h.seed, hosts: [m[0].hostClubId, m[1].hostClubId], formations: [m[0].formationId, m[1].formationId] })}`
}

// One scale for both flows: a quick game goes draft, kickoff, january, summary; a managed one draft, preseason, week, match, summary
const PHASE_RANK: Record<Phase, number> = { draft: 0, kickoff: 1, preseason: 1, january: 2, week: 2, match: 3, summary: 4 }

/**
 * How far along a slot's game is, compared element by element: `[year, phase, matchweek, draft spins, seasons in
 * the history]` for a game, `[spins, picks made, finished]` for the hot-seat game.
 */
export function progressKey(v: SlotValue): number[] {
  if (v.kind === 'h2h') {
    const d = v.h2h.draft
    return [d.spins, picksMade(d.drafts[0]) + picksMade(d.drafts[1]), v.h2h.result ? 1 : 0]
  }
  const g = v.game
  return [g.year, PHASE_RANK[g.phase] ?? 0, g.season?.matchweek ?? 0, g.draft?.spins ?? 0, g.history.length]
}

/** Negative when `a` is behind `b`, positive when ahead, 0 when level (a shorter key is padded with zeros). */
export function compareProgress(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface SaveMeta {
  mode: string
  teamName: string
  hostClubId: string
  leagueId: string
  leagueSeason: number
  phase: string
  year: number
  matchweek: number
  points: number | null
  spins: number
  progress: number[]
  dataVersion: string
  engineVersion: string
  appBuild: string
  deviceLabel: string
}

export interface MetaContext {
  dataVersion: string
  engineVersion: string
  appBuild: string
  deviceLabel: string
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** The summary a cloud row carries, so another device can show the slot without downloading it. */
export function saveMeta(v: SlotValue, ctx: MetaContext): SaveMeta {
  const base = { progress: progressKey(v), dataVersion: clip(ctx.dataVersion, 40), engineVersion: clip(ctx.engineVersion, 16), appBuild: clip(ctx.appBuild, 40), deviceLabel: clip(ctx.deviceLabel, 40) }
  if (v.kind === 'h2h') {
    const h = v.h2h
    return { mode: 'h2h', teamName: clip(`${h.managers[0].name} v ${h.managers[1].name}`, 60), hostClubId: clip(h.managers[0].hostClubId, 64), leagueId: h.leagueId, leagueSeason: h.leagueSeason, phase: h.result ? 'summary' : 'draft', year: 1, matchweek: 0, points: null, spins: h.draft.spins, ...base }
  }
  const g = v.game
  const s = g.settings
  return { mode: s.mode, teamName: clip(s.teamName, 28), hostClubId: clip(s.hostClubId, 64), leagueId: clip(s.leagueId, 32), leagueSeason: s.leagueSeason, phase: g.phase, year: g.year, matchweek: g.season?.matchweek ?? 0, points: g.quickResult?.points ?? g.history.at(-1)?.points ?? null, spins: g.draft?.spins ?? 0, ...base }
}

/** A coarse browser and system name for a user agent ("Safari · iPhone"), never an identifier. */
export function deviceLabel(ua: string): string {
  const browser = /SamsungBrowser\//.test(ua)
    ? 'Samsung Internet'
    : /Edg(e|A|iOS)?\//.test(ua)
      ? 'Edge'
      : /(Firefox|FxiOS)\//.test(ua)
        ? 'Firefox'
        : /(Chrome|CriOS|Chromium)\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'device'
  return `${browser} · ${system}`
}
