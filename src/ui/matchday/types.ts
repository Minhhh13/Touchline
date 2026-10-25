/**
 * The match-day dashboard's contracts: what the shell hands the top bar, the
 * squad strip and every panel. The top bar and the squad strip are completed
 * against these props; the panels all read one `MatchdayData`.
 */
import type { InPlayCheck, InPlayOutcome, Shout } from '@engine/match'
import type { MatchFeed } from '@engine/matchFeed'
import type { StatsSeries, XgStep } from '@engine/matchStats'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, SquadPlayer, Tactics } from '@engine/types'
import type { LatestScore, LiveTableRow, RoundRef } from '@game/logic/matchday'
import type { Game, LiveMatch, MatchContext } from '@game/types'
import type { CommentaryLine } from '../match/commentary'
import type { MatchPath } from '../match/epochs'
import type { PlayerSample } from '../match/heat'
import type { ManagerHand } from './useManagerHand'
import type { SlotId, WidgetId } from './widgetIds'

export type Speed = 1 | 2 | 4

export interface MatchClockApi {
  clock: number
  speed: Speed
  running: boolean
  /** The clock has reached `stopAt`. */
  finished: boolean
  /** Finished at a stop short of the whistle (half time, 70 minutes). */
  atStop: boolean
  stopAt: number
  /** This stretch ends at the whistle. */
  final: boolean
  toggle(): void
  pause(): void
  resume(): void
  setSpeed(s: Speed): void
  skip(): void
}

export interface SideView {
  /** Three or four letters for the scoreboard. */
  code: string
  name: string
  colour: string
  /** The goalkeeper's shirt. */
  keeper: string
  numbers: Record<string, number>
}

export interface LiveControl {
  minute: number
  stop: 45 | 70 | null
  can: InPlayCheck
  userSide: 'home' | 'away'
  tactics: Tactics
  shout?: Shout
  subsLeft: number
  windowsLeft: number
  apply(change: { tactics?: Tactics; substitutions?: Array<{ off: string; on: string }>; shout?: Shout }): InPlayOutcome | null
}

export interface TopBarProps {
  feed: MatchFeed
  clock: MatchClockApi
  home: SideView
  away: SideView
  label: string
  control: LiveControl | null
}

export interface SquadStripProps {
  feed: MatchFeed
  minute: number
  side: 'home' | 'away'
  view: SideView
  ratings: Record<string, number>
  squad: Record<string, SquadPlayer>
  selected: string | null
  onSelect(psId: string): void
  control: LiveControl | null
}

/** Everything a panel reads, built once per minute by the dashboard shell. */
export interface MatchdayData {
  mode: 'live' | 'replay'
  feed: MatchFeed
  mpath: MatchPath
  series: StatsSeries
  /** Every man's sampled positions over the decided minutes (filter by `t` for the clock). */
  samples: PlayerSample[]
  story: { home: XgStep[]; away: XgStep[]; perMinute: { home: number[]; away: number[] } }
  /** Every commentary line over the decided minutes (filter by minute for the clock). */
  commentary: CommentaryLine[]
  /** The clock. */
  minute: number
  /** The user's match has reached its whistle. */
  final: boolean
  home: SideView
  away: SideView
  ratings: Record<string, number>
  userSide: 'home' | 'away' | null
  selected: string | null
  select(psId: string): void
  /** Put a widget into a slot (the flanks' "View stats"). */
  show(slot: SlotId, id: WidgetId): void
  scores: LatestScore[]
  /** Null in a friendly. */
  table: LiveTableRow[] | null
  ref: RoundRef | null
  ctx: MatchContext
  /** The match in play (the dugout reads its bench); null on a replay. */
  live: LiveMatch | null
  game: Game
  u: LoadedUniverse
  getPlayer: (id: string) => PlayerSeason | undefined
  getName: (id: string) => string | undefined
  /** The manager's controls (the dugout's "Make a change" opens the substitutions drawer). */
  hand?: ManagerHand
}

export interface PanelProps {
  d: MatchdayData
  /** Rendered in the stacked (tablet and phone) layout. */
  compact?: boolean
}
