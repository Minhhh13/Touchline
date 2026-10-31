/**
 * The setup screen remembers this viewer's last choices per mode (`touchline-setup-<mode>`), so a returning player starts
 * the draft they like in two taps: Home's card, then Start. A per-viewer convenience only: nothing here reaches a seed,
 * the save or the verifier; a stored value that does not read as a choice falls back to the default. Pure but for the
 * storage, which is read and written inside try/catch (a private window or blocked storage starts from the defaults).
 */
import type { DraftDifficulty, DraftMode, QuickMode, RatingsMode } from '@engine/draft'
import type { EraPreset } from '@engine/era'
import { FORMATIONS } from '@engine/formations'
import { DEFAULT_CAP_CHOICE, type CapChoice, type CapPreset } from '@game/logic/cap'

export type MemoryMode = 'quick' | 'season' | 'dynasty'

/** What the setup cards, toggles and selects say; never the seed, the team name (`teamName.ts` keeps that) or one club or nation. */
export interface SetupChoices {
  formationId: string
  leagueId: string
  superOn: boolean
  europe: boolean
  difficulty: DraftDifficulty
  showRatings: boolean
  draftMode: DraftMode
  ratingsMode: RatingsMode
  eraPreset: EraPreset
  customEra: [number, number] | null
  classicOn: boolean
  benchPicks: number
  modes: Array<QuickMode | 'upgrader'>
  powerUps: boolean
  managerChoice: 'spin' | 'pick' | 'off'
  endCase: boolean
  twistsChoice: boolean | null
  cap: CapChoice
  chain: boolean
  january: boolean
  opposition: 'calibrated' | 'realistic'
  squadSize: number
  jobSecurity: boolean
  playerPower: boolean
  continental: boolean
}

/** The screen's defaults: what a first visit shows, and what Reset goes back to. */
export function defaultChoices(mode: MemoryMode | string): SetupChoices {
  return {
    formationId: '4-3-3',
    leagueId: 'england',
    superOn: false,
    europe: false,
    // Season and Dynasty draft at Easy (SEASON_RULES), a Quick Draft at Normal
    difficulty: mode === 'quick' ? 'normal' : 'easy',
    showRatings: true,
    draftMode: 'squad',
    ratingsMode: 'prime',
    eraPreset: 'all',
    customEra: null,
    classicOn: false,
    benchPicks: mode === 'quick' ? 1 : 0,
    modes: [],
    powerUps: false,
    managerChoice: 'spin',
    endCase: true,
    twistsChoice: null,
    cap: { ...DEFAULT_CAP_CHOICE },
    chain: false,
    january: true,
    opposition: 'calibrated',
    squadSize: 18,
    jobSecurity: true,
    playerPower: false,
    continental: false,
  }
}

export const setupKey = (mode: MemoryMode) => `touchline-setup-${mode}`
export const rememberedModes = (mode: string): mode is MemoryMode => mode === 'quick' || mode === 'season' || mode === 'dynasty'

const QUICK_MODE_IDS: ReadonlyArray<QuickMode | 'upgrader'> = ['crazy', 'underdog', 'legends', 'speedrun', 'gamble', 'upgrader']
const CAP_PRESET_IDS: readonly CapPreset[] = ['off', 'shoestring', 'moneyball', 'big-spender', 'custom']

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const intIn = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback)
const id = (v: unknown, fallback: string) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : fallback)

/** Reads a stored value as choices, field by field: anything missing or malformed takes the default. */
export function readChoices(raw: unknown, mode: MemoryMode | string): SetupChoices {
  const d = defaultChoices(mode)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d
  const r = raw as Record<string, unknown>
  const era = Array.isArray(r.customEra) && r.customEra.length === 2 && r.customEra.every((n) => Number.isInteger(n)) ? ([Math.min(r.customEra[0], r.customEra[1]), Math.max(r.customEra[0], r.customEra[1])] as [number, number]) : null
  const eraPreset = oneOf<EraPreset>(r.eraPreset, ['all', '2000s', '2010s', 'modern', 'custom'], d.eraPreset)
  const capRaw = r.cap && typeof r.cap === 'object' ? (r.cap as Record<string, unknown>) : {}
  const modes = Array.isArray(r.modes) ? [...new Set(r.modes.filter((m): m is QuickMode | 'upgrader' => (QUICK_MODE_IDS as readonly unknown[]).includes(m)))] : d.modes
  return {
    formationId: FORMATIONS.some((f) => f.id === r.formationId) ? (r.formationId as string) : d.formationId,
    leagueId: id(r.leagueId, d.leagueId),
    superOn: bool(r.superOn, d.superOn),
    europe: bool(r.europe, d.europe),
    difficulty: oneOf<DraftDifficulty>(r.difficulty, ['easy', 'normal', 'hard'], d.difficulty),
    showRatings: bool(r.showRatings, d.showRatings),
    draftMode: oneOf<DraftMode>(r.draftMode, ['squad', 'position'], d.draftMode),
    ratingsMode: oneOf<RatingsMode>(r.ratingsMode, ['season', 'prime'], d.ratingsMode),
    // A custom era needs its two seasons; without them it is All-time
    eraPreset: eraPreset === 'custom' && !era ? 'all' : eraPreset,
    customEra: eraPreset === 'custom' ? era : null,
    classicOn: bool(r.classicOn, d.classicOn),
    benchPicks: intIn(r.benchPicks, 0, 5, d.benchPicks),
    modes,
    powerUps: bool(r.powerUps, d.powerUps),
    managerChoice: oneOf(r.managerChoice, ['spin', 'pick', 'off'] as const, d.managerChoice),
    endCase: bool(r.endCase, d.endCase),
    twistsChoice: typeof r.twistsChoice === 'boolean' ? r.twistsChoice : null,
    cap: { preset: oneOf(capRaw.preset, CAP_PRESET_IDS, d.cap.preset), custom: intIn(capRaw.custom, 0, 10000, d.cap.custom) },
    chain: bool(r.chain, d.chain),
    january: bool(r.january, d.january),
    opposition: oneOf(r.opposition, ['calibrated', 'realistic'] as const, d.opposition),
    squadSize: intIn(r.squadSize, 16, 22, d.squadSize),
    jobSecurity: bool(r.jobSecurity, d.jobSecurity),
    playerPower: bool(r.playerPower, d.playerPower),
    continental: bool(r.continental, d.continental),
  }
}

/** Whether the choices are the screen's defaults (Reset to defaults shows only when they are not). */
export function isDefault(c: SetupChoices, mode: MemoryMode | string): boolean {
  return JSON.stringify(readChoices(c, mode)) === JSON.stringify(defaultChoices(mode))
}

/** This viewer's last choices for the mode, or null for a first visit (or a storage that cannot be read). */
export function loadChoices(mode: MemoryMode): SetupChoices | null {
  try {
    const raw = localStorage.getItem(setupKey(mode))
    return raw ? readChoices(JSON.parse(raw), mode) : null
  } catch {
    return null
  }
}

/** Keeps the choices Start was pressed with; defaults clear the key, so Reset leaves nothing behind. */
export function saveChoices(mode: MemoryMode, c: SetupChoices): void {
  try {
    if (isDefault(c, mode)) localStorage.removeItem(setupKey(mode))
    else localStorage.setItem(setupKey(mode), JSON.stringify(readChoices(c, mode)))
  } catch {
    // Storage blocked: the setup still starts, it only forgets
  }
}
