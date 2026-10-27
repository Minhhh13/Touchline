/**
 * Pure helpers behind the manager's controls on the match-day dashboard: what
 * an instructions change actually changes, the top bar's clock, where a change
 * lands (now, at the stop, queued for the next stop, too late, a replay), the
 * pending changes a stop collects, the drawers' open and close, the refusal
 * texts, the squad strip's card model and the phone tab strip. No React, no DOM.
 */
import { INSTRUCTION_KEYS, MAX_SUBS, type InPlayCheck, type InPlayOutcome, type Instructions, type LiveChanges, type Shout, type TeamTalk } from '@engine/match'
import type { MatchFeed } from '@engine/matchFeed'
import type { Formation, Tactics } from '@engine/types'
import { minuteLabel } from '../format'
import { positionCode, surname } from '../match/shirts'
import { slotViews } from './model'
import type { ChoiceStorage, WidgetId } from './widgetIds'

// ------------------------------------------------------------------ tactics diff

/** The instructions that differ between two tactics, in the engine's order. */
export function instructionDiff(before: Tactics, after: Tactics): Array<keyof Instructions> {
  return INSTRUCTION_KEYS.filter((k) => before[k] !== after[k])
}

/** Whether the set-piece takers differ (a missing taker and an empty one are the same: the best on the pitch). */
export function setPiecesDiffer(a: Tactics['setPieces'], b: Tactics['setPieces']): boolean {
  return (['penalties', 'freeKicks', 'corners'] as const).some((k) => (a?.[k] || undefined) !== (b?.[k] || undefined))
}

/** Something the manager can change in play differs: an instruction or a set-piece taker. */
export function tacticsChanged(before: Tactics, after: Tactics): boolean {
  return instructionDiff(before, after).length > 0 || setPiecesDiffer(before.setPieces, after.setPieces)
}

// ------------------------------------------------------------------ the clock

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The running clock as mm:ss. The clock store's minute t is the t-th minute in
 * play, so t plus a fraction f reads (t - 1):(f x 60): 45.12 is "44:07". Once
 * the board is up (from the 90th minute) the added time follows: "90:00 (+4)".
 */
export function clockLabel(fractional: number, addedTime = 0): string {
  const elapsed = Math.max(0, fractional - 1)
  const mm = Math.floor(elapsed + 1e-9)
  const ss = Math.min(59, Math.floor((elapsed - mm) * 60 + 1e-6))
  const text = `${pad(mm)}:${pad(Math.max(0, ss))}`
  return fractional >= 90 && addedTime > 0 ? `${text} (+${addedTime})` : text
}

/** The top bar's clock: HALF TIME or 70 MINUTES at a stop, FULL TIME at the whistle, otherwise the running clock. */
export function barClock(fractional: number, s: { atStop: boolean; stopAt: number; finished: boolean; final: boolean; addedTime: number }): string {
  if (s.atStop) return s.stopAt === 45 ? 'HALF TIME' : `${s.stopAt} MINUTES`
  if (s.finished && s.final) return 'FULL TIME'
  return clockLabel(fractional, s.addedTime)
}

// ------------------------------------------------------------------ where a change lands

export type LandingKind = 'now' | 'stop' | 'queue' | 'closed' | 'replay'

export interface Landing {
  kind: LandingKind
  /** The chip in the top bar. */
  text: string
  /** The stop a change is collected for (at a stop, or queued for one). */
  stop?: 45 | 70
}

/**
 * Where a change made now lands. A replay takes none; at a stop the change
 * joins the stop's pending changes; in play it applies at once when the engine
 * can cut the match, waits for the next stop when it cannot (a save from
 * before changes in play), and is too late in stoppage time.
 */
export function landing(s: { replay: boolean; atStop: boolean; stopAt: number; check: InPlayCheck | null }): Landing {
  if (s.replay || !s.check) return { kind: 'replay', text: 'Replay' }
  if (s.atStop) return s.stopAt === 45 ? { kind: 'stop', stop: 45, text: 'At the break: changes apply when you play on' } : { kind: 'stop', stop: 70, text: 'At 70 minutes: changes apply when you play on' }
  if (s.check.ok) return { kind: 'now', text: 'Changes apply now' }
  if (s.check.refusal === 'too-late') return { kind: 'closed', text: 'Too late for changes' }
  if (s.check.nextStop === 45) return { kind: 'queue', stop: 45, text: 'Changes wait for half time' }
  if (s.check.nextStop === 70) return { kind: 'queue', stop: 70, text: 'Changes wait for the 70th minute' }
  if (s.check.refusal === 'in-the-past') return { kind: 'closed', text: 'Catching up with your last change' }
  return { kind: 'closed', text: 'Too late for changes' }
}

/** A change can be made (now, at the stop or queued for it). */
export function canEdit(l: Landing): boolean {
  return l.kind === 'now' || l.kind === 'stop' || l.kind === 'queue'
}

/** Shouts are a last-twenty-minutes call: at the 70th-minute stop or in play after it. */
export function shoutsOpen(minute: number, l: Landing): boolean {
  if (l.kind === 'stop' || l.kind === 'queue') return l.stop === 70
  return l.kind === 'now' && minute >= 70
}

export const SHOUTS_CLOSED = 'Touchline shouts open at 70 minutes'

// ------------------------------------------------------------------ a stop's pending changes

export interface Sub {
  off: string
  on: string
}

/** What a stop collects before the manager plays on: the stop panel and the top bar's drawers edit the same one. */
export interface StopDraft {
  talk: TeamTalk
  shout: Shout
  tactics: Tactics | null
  subs: Sub[]
}

export function emptyDraft(): StopDraft {
  return { talk: 'encourage', shout: 'keep-shape', tactics: null, subs: [] }
}

/** How many changes a stop can still take: three at the break, the rest of the five at 70. */
export function stopSubCap(stop: 45 | 70, made: number): number {
  const left = Math.max(0, MAX_SUBS - made)
  return stop === 45 ? Math.min(3, left) : left
}

/**
 * Fold a change into a stop's pending changes: tactics and the shout replace
 * what was pending; substitutions join the queue while the stop has room, never
 * taking a man off twice, bringing a man on twice or taking off a man who is
 * only coming on. The ones that do not fit come back in `dropped`.
 */
export function queueIntoDraft(draft: StopDraft, change: { tactics?: Tactics; substitutions?: Sub[]; shout?: Shout }, cap: number): { draft: StopDraft; dropped: Sub[] } {
  const subs = [...draft.subs]
  const dropped: Sub[] = []
  for (const s of change.substitutions ?? []) {
    const clash = subs.some((x) => x.off === s.off || x.on === s.on || x.on === s.off)
    if (clash || subs.length >= cap || s.off === s.on) dropped.push(s)
    else subs.push(s)
  }
  return { draft: { ...draft, tactics: change.tactics ?? draft.tactics, shout: change.shout ?? draft.shout, subs }, dropped }
}

/** The changes a stop sends when the manager plays on. */
export function draftChanges(draft: StopDraft, stop: 45 | 70): LiveChanges {
  const tactics = draft.tactics ?? undefined
  return stop === 45 ? { talk: draft.talk, tactics, substitutions: draft.subs } : { shout: draft.shout, tactics, substitutions: draft.subs }
}

// ------------------------------------------------------------------ drawers

export type DrawerId = 'tactics' | 'instructions' | 'shouts' | 'tweaks' | 'subs'

export interface DrawerState {
  open: DrawerId | null
  /** The clock was running when the first drawer opened: closing resumes it. */
  resume: boolean
}

export const CLOSED_DRAWER: DrawerState = { open: null, resume: false }

/** Open a drawer: the clock pauses. Switching from one drawer to another keeps the first one's resume. */
export function openDrawer(s: DrawerState, id: DrawerId, running: boolean): DrawerState {
  return { open: id, resume: s.open ? s.resume : running }
}

/** Close the drawer: resume the clock if opening it paused it. */
export function closeDrawer(s: DrawerState): { state: DrawerState; resume: boolean } {
  return { state: CLOSED_DRAWER, resume: s.open !== null && s.resume }
}

// ------------------------------------------------------------------ outcomes

const WHY: Record<InPlayOutcome['refused'][number]['why'], string> = {
  'no-window': 'No stoppages left: you have used all three',
  'no-subs-left': 'All five substitutions are made',
  'not-on-pitch': 'is not on the pitch',
  unavailable: 'is not available',
  'already-played': 'has already played: nobody comes back on',
  'before-kick-off': 'Substitutions wait until the ball is rolling',
}

const PERSONAL = new Set(['not-on-pitch', 'unavailable', 'already-played'])

/** The toast for what the engine turned down, or null when it took everything. */
export function refusalText(out: InPlayOutcome, name: (id: string) => string | undefined = () => undefined): string | null {
  const parts: string[] = []
  if (!out.applied) {
    if (out.refusal === 'too-late') parts.push('Too late for changes')
    else if (out.refusal === 'no-segment' || out.refusal === 'summary-match') parts.push('This match takes changes only at its stops')
    else if (out.refusal === 'in-the-past') parts.push('That minute is before your last change')
    else if (out.refusal === 'outside-segment') parts.push('Make this change at the stop')
  }
  for (const r of out.refused) {
    const who = r.why === 'not-on-pitch' ? name(r.off) : name(r.on)
    const text = PERSONAL.has(r.why) ? `${surname(who) || 'That player'} ${WHY[r.why]}` : WHY[r.why]
    if (!parts.includes(text)) parts.push(text)
  }
  if (out.shoutRefused) parts.push(SHOUTS_CLOSED)
  return parts.length ? `${parts.join('. ')}.` : null
}

/** The toast for a change the engine made. */
export function appliedText(out: InPlayOutcome, minute: number, name: (id: string) => string | undefined = () => undefined): string {
  const from = minuteLabel(minute + 1)
  if (out.made.length) return `${out.made.map((s) => `${surname(name(s.on)) || 'Sub'} on for ${surname(name(s.off)) || 'a team-mate'}`).join(', ')} (${minuteLabel(minute)}).`
  return `Change made: it applies from ${from}.`
}

// ------------------------------------------------------------------ squad strip cards

export type ConditionBand = 'fresh' | 'ok' | 'tired' | 'spent'
export type MoraleBand = 'superb' | 'good' | 'okay' | 'poor' | 'very-poor'

/** The same thresholds as the condition colours elsewhere. */
export function conditionBand(v: number): ConditionBand {
  return v >= 85 ? 'fresh' : v >= 70 ? 'ok' : v >= 55 ? 'tired' : 'spent'
}

/** The same thresholds as the morale words elsewhere. */
export function moraleBand(v: number): MoraleBand {
  return v >= 85 ? 'superb' : v >= 70 ? 'good' : v >= 55 ? 'okay' : v >= 40 ? 'poor' : 'very-poor'
}

export interface StripCard {
  slotId: string
  /** Football Manager position code: GK, DC, WBR, DM, AMC, STC... */
  pos: string
  keeper: boolean
  psId: string | null
  number?: number
  name: string
  rating?: number
  condition: number | null
  conditionBand: ConditionBand | null
  morale: number | null
  moraleBand: MoraleBand | null
  yellow: boolean
  red: boolean
  /** Sent off, or injured with nobody to replace him. */
  out: boolean
  /** The minute the man in the slot came on, or null for a starter. */
  subMinute: number | null
}

/** One card per formation slot at a minute, in slot order. */
export function stripCards(
  feed: Pick<MatchFeed, 'events' | 'home' | 'away'>,
  side: 'home' | 'away',
  minute: number,
  formation: Formation,
  o: { ratings: Record<string, number>; numbers: Record<string, number>; name: (id: string) => string | undefined; condition: (psId: string) => number | null; morale: (psId: string) => number | undefined },
): StripCard[] {
  const fs = side === 'home' ? feed.home : feed.away
  const at = Math.max(0, minute)
  return slotViews(formation, fs.appearances, feed.events, at).map((s) => {
    const cond = s.psId ? o.condition(s.psId) : null
    const mor = s.psId ? o.morale(s.psId) : undefined
    return {
      slotId: s.slotId,
      pos: positionCode(formation, s.slotId),
      keeper: s.position === 'GK',
      psId: s.psId,
      number: s.psId ? o.numbers[s.psId] : undefined,
      name: surname(s.psId ? o.name(s.psId) : undefined),
      rating: s.psId ? o.ratings[s.psId] : undefined,
      condition: cond,
      conditionBand: cond === null ? null : conditionBand(cond),
      morale: mor ?? null,
      moraleBand: mor === undefined ? null : moraleBand(mor),
      yellow: s.yellow,
      red: s.red,
      out: s.out,
      subMinute: s.subbedOn ? s.onAt : null,
    }
  })
}

// ------------------------------------------------------------------ the phone tab strip

export interface PhoneTab {
  id: string
  label: string
  widget: WidgetId
}

/** Every panel on a phone, in the order of the tab strip. The xG graph story is not a tab: it is always on, in the pulse row. */
export const PHONE_TABS: PhoneTab[] = [
  { id: 'events', label: 'Events', widget: 'match-events' },
  { id: 'stats', label: 'Stats', widget: 'match-stats' },
  { id: 'lineups', label: 'Line-ups', widget: 'formations' },
  { id: 'table', label: 'Table', widget: 'live-table' },
  { id: 'scores', label: 'Scores', widget: 'latest-scores' },
  { id: 'heat', label: 'Heat map', widget: 'heat-map' },
  { id: 'positions', label: 'Avg positions', widget: 'average-positions' },
  { id: 'passes', label: 'Pass map', widget: 'pass-maps' },
  { id: 'shots', label: 'Shot map', widget: 'shot-map' },
  { id: 'zones', label: 'Zones', widget: 'action-zones' },
  { id: 'momentum', label: 'Momentum', widget: 'match-momentum' },
  { id: 'dugout', label: 'Dugout', widget: 'dugout' },
  { id: 'info', label: 'Info', widget: 'matchday-info' },
  { id: 'commentary', label: 'Commentary', widget: 'commentary' },
]

/** The tabs for a match: a friendly has no table and no other scores. */
export function phoneTabs(friendly: boolean): PhoneTab[] {
  return friendly ? PHONE_TABS.filter((t) => t.widget !== 'live-table' && t.widget !== 'latest-scores') : PHONE_TABS
}

export const TAB_KEY = 'touchline-matchday-tab'

function browserStorage(): ChoiceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The remembered tab when it is one of `tabs`, else the first. */
export function readTab(tabs: PhoneTab[], storage: ChoiceStorage | null = browserStorage()): string {
  let raw: string | null = null
  try {
    raw = storage?.getItem(TAB_KEY) ?? null
  } catch {
    raw = null
  }
  return tabs.some((t) => t.id === raw) ? raw! : tabs[0].id
}

export function writeTab(id: string, storage: ChoiceStorage | null = browserStorage()): void {
  if (!PHONE_TABS.some((t) => t.id === id)) return
  try {
    storage?.setItem(TAB_KEY, id)
  } catch {
    // Not remembered: the strip still works
  }
}

/** The tab after `id` (wrapping round): the tablet shows two panels side by side. */
export function tabAfter(tabs: PhoneTab[], id: string): PhoneTab {
  const i = tabs.findIndex((t) => t.id === id)
  return tabs[(i + 1) % tabs.length]
}

/** Arrow-key movement along a tablist: Left and Right step (wrapping), Home and End jump. */
export function tabKey(tabs: PhoneTab[], id: string, key: string): string | null {
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0) return null
  if (key === 'ArrowRight') return tabs[(i + 1) % tabs.length].id
  if (key === 'ArrowLeft') return tabs[(i - 1 + tabs.length) % tabs.length].id
  if (key === 'Home') return tabs[0].id
  if (key === 'End') return tabs[tabs.length - 1].id
  return null
}

// ------------------------------------------------------------------ the man picked out

/** A tap on a man (a squad strip card, a formation panel's shirt): picks him, or lets him go when he is already picked. */
export function nextSelection(current: string | null, psId: string): string | null {
  return current === psId ? null : psId
}

/**
 * The man picked out on the live pitch and the formation panels: the one a keyboard has focused on the strip (a
 * preview, gone on blur), else the one selected, else nobody. Display only.
 */
export function highlightedMan(selected: string | null, focused: string | null): string | null {
  return focused ?? selected
}

/**
 * Whether the keyboard's preview has lost its card: the man focused on the strip is no longer on any card (a
 * substitute took his slot, the strip re-rendered without him). A card that unmounts never blurs, so the strip clears
 * the preview itself. Pure.
 */
export function staleFocus(focused: string | null, onCards: Array<string | null | undefined>): boolean {
  return focused !== null && !onCards.includes(focused)
}

