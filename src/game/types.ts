import type { DraftState } from '@engine/draft'
import type { FullMatchResult, MatchInProgress, TeamTalk } from '@engine/match'
import type { Finances, Window } from '@engine/market'
import type { StaffState } from '@engine/staff'
import type { RngState } from '@engine/rng'
import type { SeasonState, Competition } from '@engine/season'
import type { GameEvent } from '@engine/events'
import type { TrainingFocus } from '@engine/training'
import type { SeasonAwards } from '@engine/awards'
import type { Lineup, PlayerSeason, SeasonTier, SquadPlayer, Tactics } from '@engine/types'
import type { DraftRules } from '@engine/draft'
import type { ChallengeClaim } from '@engine/challenge'
import type { SquadStatus } from '@engine/status'
import type { AiClub } from '@engine/season'
import type { ArenaField, ArenaTier } from '@engine/knockout'
import type { GauntletLadder } from '@engine/gauntlet'
import type { CupBracket } from '@engine/cup'

export type Mode = 'quick' | 'daily' | 'season' | 'dynasty' | 'arena'
export type Phase = 'draft' | 'preseason' | 'week' | 'match' | 'summary'

export interface GameSettings {
  mode: Mode
  seed: string
  formationId: string
  teamName: string
  shortName: string
  /** League the user's side plays in. */
  leagueId: string
  /** Leagues the wheel and the market draw from. */
  wheelLeagues: string[]
  /** Real club whose place in the league the user takes. */
  hostClubId: string
  /** Real league season providing the opponents. */
  leagueSeason: number
  rules: DraftRules
  /** Can the board sack you? */
  jobSecurity: boolean
  /** 'calibrated' handicaps AI clubs so an average draft competes; 'realistic' does not. */
  difficulty: 'calibrated' | 'realistic'
  /** Enter the Continental Cup in the first season (later seasons qualify by finishing top four). */
  continental?: boolean
  /** A ghost draft this game is played against (opened from a challenge link or "Run it back"). */
  challenge?: ChallengeSettings
  /** The arena format of a mode `arena` game (absent for every other mode). */
  arena?: ArenaSettings
}

/** Which arena format a game plays, and the field its opponents come from. */
export interface ArenaSettings {
  format: 'cup' | 'gauntlet'
  /** Clubs in a cup, the user included: 2 is the one-off final. */
  size?: 2 | 8 | 16 | 32
  field?: ArenaField
  decade?: number
  daily?: boolean
}

/** One user match of an arena run. */
export interface ArenaStep {
  label: string
  /** The opponent's club-season key (`clubId@season`). */
  opponent: string
  neutral: boolean
  home: boolean
  gf: number
  ga: number
  /** The shoot-out, when the match was level at 90: the user's kicks are `us: true`. */
  pens?: { us: number; them: number; kicks: Array<{ us: boolean; takerId: string; scored: boolean }>; keeperSwap?: { off: string; on: string } }
  motmId?: string
  training: TrainingFocus
  /** Managed live (the two stops) rather than played by the assistant. */
  live: boolean
  /** The opponent's real team strength and the rating points the calibration took off it. */
  realStrength: number
  offset: number
}

/** A live arena match that ended level, waiting on the manager's penalty order and keeper. */
export interface PendingShootout {
  /** The men on the pitch at 90 in the default order. */
  defaultOrder: string[]
  /** Who may go in goal: the man in goal first, the rest of the men on the pitch, then a bench keeper while a change is left. */
  keepers: string[]
  /** The opponent's order and keeper, fixed at the whistle. */
  theirOrder: string[]
  theirKeeper: string | null
}

/** A one-sitting knockout run: it lives beside `SeasonState`, never inside it. */
export interface ArenaState {
  format: 'cup' | 'gauntlet'
  size?: number
  /** Seeded in `createGame` from the game seed, so everyone on a seed meets the same opponents whatever they drafted. */
  streams: { field: RngState; ties: RngState; draw: RngState }
  /** Keyed `clubId@season`: only clubs about to play or still alive. */
  clubs: Record<string, AiClub>
  /** The key of the next opponent, null when none is drawn yet or the run is over. */
  next: string | null
  /** The user's next match, 0-based. */
  step: number
  /** One row per user match. */
  log: ArenaStep[]
  pending?: { shootout: PendingShootout }
  /** Bookings across the run: every second one is a one-match ban. */
  yellows: Record<string, number>
  over: boolean
  won: boolean
  /** The manager touched the team, the tactics, a live match or the penalty order while the run was under way. */
  handManaged: boolean
  /** The Gauntlet: the rung (1-based) whose main was swapped for its alternate; absent until the lifeline is used. */
  lifelineUsed?: number
  /** The Gauntlet's ladder, built once from the field stream; absent for the other formats. */
  ladder?: GauntletLadder
  /** The Cup of 8, 16 or 32 clubs: the field's seeds, the rounds drawn and the AI sides' carried state; absent for a one-off final and the Gauntlet. */
  bracket?: CupBracket
}

/** One finished arena run on the Record page's Best runs. */
export interface ArenaRunEntry {
  id: string
  date: string
  format: 'cup' | 'gauntlet'
  size?: number
  field?: ArenaField
  teamName: string
  hostClubId?: string
  seed: string
  daily?: boolean
  /** Rounds won (a final: 1 for the trophy, 0 for the runners-up). */
  score: number
  tier: ArenaTier
  goalsFor: number
  goalsAgainst: number
  xi: string[]
  nation?: string
  budget?: number
  /** The club-season key of the side that knocked the run out. */
  fellTo?: string
  /** The club-season key of the last opponent (the final's). */
  last?: string
  challenge?: { name: string; score: number }
}

/** The challenger's draft and result, carried on a game played from a challenge link. */
export interface ChallengeSettings {
  name: string
  /** One row per spin of the challenger's draft: the full player-season id drafted (null for a re-spin or a discarded spin) and its slot. Empty when the draft could not be replayed. */
  picks: Array<{ id: string | null; slotId: string | null; clubId: string; season: number }>
  claim: ChallengeClaim
  /** 'yes' when the replay reproduced the claim, 'no' when it did not, 'unverified' when the data or the engine differ. */
  verified: 'yes' | 'no' | 'unverified'
  /** Why verification fell short, when it did. */
  reason?: string
  /** Data stamp and engine version the challenge was built on. */
  data: string
  engine: string
}

export interface Contract {
  /** Seasons remaining including the current one. */
  years: number
  /** Renewed in-season: extends at the summer regardless of expiry. */
  renewed?: boolean
  /** The player will leave when the contract ends. */
  declined?: boolean
  /** Transfer-listed: offers come in more often. */
  listed?: boolean
  /** On loan for this season only: he goes back to his club in the summer. */
  loan?: boolean
  /** Squad status: how much football he expects (section 10 of the design doc); rotation when absent. */
  status?: SquadStatus
}

export interface SeasonRecord {
  year: number
  leagueId: string
  leagueSeason: number
  teamName: string
  hostClubId: string
  position: number
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  tier: SeasonTier
  cupWon: boolean
  continentalWon?: boolean
  /** Furthest Continental Cup round reached: R16, QF, SF, F or W (winners). */
  continentalRun?: string
  potsName?: string
  bootName?: string
  bootGoals?: number
}

export interface MatchContext {
  matchweek: number
  competition: 'league' | Competition | 'arena'
  roundLabel?: string
  opponentClubId: string
  home: boolean
  importanceLabel?: string
}

export interface LiveMatch {
  kind: 'league' | 'cup' | 'friendly' | 'arena'
  mp: MatchInProgress
  ctx: MatchContext
  userIsHome: boolean
  opponentId: string
  /** Index into the competition's ties when kind is 'cup'. */
  cupTieIndex?: number
  /** Which knockout the tie belongs to (domestic cup when missing). */
  comp?: Competition
}

export interface Game {
  id: string
  createdAt: string
  settings: GameSettings
  phase: Phase
  rngState: RngState
  draft: DraftState | null
  /** The user's squad: live state per player-season id. */
  squad: Record<string, SquadPlayer>
  contracts: Record<string, Contract>
  /** Player-seasons created in this game (dynasty progression, free agents). */
  customPlayers: Record<string, PlayerSeason>
  tactics: Tactics
  lineup: Lineup
  bench: string[]
  captainId?: string
  teamTalk: TeamTalk
  training: TrainingFocus
  season: SeasonState | null
  finances: Finances
  window: Window | null
  pendingEvent: GameEvent | null
  promisedStart?: string
  /** Opposition player to man-mark in the next match (set from the opposition report). */
  markTarget?: string
  /** Matchweek each player was last spoken to, one conversation per week. */
  talks?: Record<string, number>
  /** Backroom staff tier per role (0-2). */
  staff?: StaffState
  /** Earned a Continental Cup place for next season (dynasty). */
  qualifiedContinental?: boolean
  /** In-season development bookkeeping: minutes at the last tick and the rating at the start of the season. */
  development?: Record<string, { minutes: number; base: number }>
  /** All-time records for this side, keyed by real player id (dynasty legends). */
  careerStats?: Record<string, CareerRecord>
  /** This pre-season's academy candidates (dynasty); chosen is null when passed. */
  youthIntake?: { year: number; candidates: string[]; chosen?: string | null }
  nextMatchBoost?: { attack?: number; defence?: number }
  /** A match paused at half time, waiting for the manager. */
  live: LiveMatch | null
  /** The final match was played live: the season closes when the manager leaves the match screen. */
  seasonEnding?: boolean
  /** Player-season ids who played this week (league and cup), for recovery. */
  weekPlayed: string[]
  lastMatch: FullMatchResult | null
  lastMatchContext: MatchContext | null
  /** Cup result played this week, if any, shown with the league match. */
  lastCupMatch: FullMatchResult | null
  lastCupContext: MatchContext | null
  consecutiveMissed: Record<string, number>
  awards: SeasonAwards | null
  tier: SeasonTier | null
  year: number
  history: SeasonRecord[]
  /** Bonus wheel spins available (agent meetings, summer window). */
  bonusSpins: number
  /** Friendlies played in preseason (max 3). */
  friendliesPlayed: number
  /** Achievement ids unlocked during this game. */
  unlocked: string[]
  /** Clubs that want you after the season (dynasty). */
  jobOffers: JobOffer[]
  /** Accepted move for next season. */
  pendingMove: { leagueId: string; clubId: string } | null
  /** Quick-mode final table snapshot for the summary. */
  quickResult: QuickResult | null
  /** The arena run of a mode `arena` game; null (or absent, in an older save) otherwise. */
  arena?: ArenaState | null
  /** £M the first draft spent under a salary cap, kept when a managed season drops the draft; absent without a cap. */
  capSpent?: number
  /** The Teammate Chain the first draft made, kept when a managed season drops the draft; absent without a chain. */
  teammateChain?: TeammateChainRecord
}

/** A drafted Teammate Chain: the club of every pick in order, and the picks that restarted it after a break. */
export interface TeammateChainRecord {
  clubs: string[]
  /** Indexes into `clubs` of the picks made on a free spin after the chain broke. */
  broken: number[]
}

export interface CareerRecord {
  name: string
  seasons: number
  apps: number
  goals: number
  assists: number
  motm: number
  /** League titles won while in the squad. */
  titles: number
  /** Last season played, for the display. */
  lastYear: number
}

export interface JobOffer {
  leagueId: string
  clubId: string
  /** Why they want you, for the UI. */
  pitch: string
  /** Transfer budget bonus on arrival, GBP millions. */
  budgetBonus: number
}

/** One goal the user's side scored in a quick-season game. An opponent's own goal carries the name "OG" and no player id. */
export interface QuickScorer {
  name: string
  minute: number
  playerSeasonId?: string
}

/** One of the user's games in a quick season, in the order they were played. */
export interface QuickGameResult {
  matchweek: number
  opponentId: string
  home: boolean
  gf: number
  ga: number
  /** The user's goalscorers, ordered by minute. */
  scorers: QuickScorer[]
  /** The user's league position after this matchweek. */
  position: number
}

export interface QuickResult {
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  position: number
  tier: SeasonTier
  table: Array<{ teamId: string; points: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number }>
  topScorer?: { playerSeasonId: string; goals: number }
  pots?: { playerSeasonId: string; rating: number }
  strength: { overall: number; goalkeeping: number; defence: number; midfield: number; attack: number; balance: number; chemistry: number }
  /** Every game of the season, game by game (absent on saves written before it was recorded). */
  results?: QuickGameResult[]
  /** Season Story: the matchweek the title was sealed (null: never), absent on older saves. */
  clinchedAt?: number | null
  /** Season Story: the matchweek relegation became certain (null: never), absent on older saves. */
  doomedAt?: number | null
  /** Season Story: the one line that tells the season, absent on older saves (retold from `results`). */
  moment?: string
}

export interface LeaderboardEntry {
  id: string
  date: string
  mode: Mode
  teamName: string
  points: number
  won: number
  drawn: number
  lost: number
  position: number
  tier: SeasonTier
  seed: string
  leagueSeason: number
  hostClubId: string
  xi: string[]
  /** One-nation draft: the nationality the whole squad shared. */
  nation?: string
  /** Played against a ghost draft: who set it and what they scored. */
  challenge?: { name: string; points: number }
  /** Season Story's moment line ("🏆 Title sealed at MW 34 with 4 to play"), absent on older entries. */
  moment?: string
  /** League the season was played in, absent on entries filed before the Trophy Room. */
  leagueId?: string
  /** Drafted under a salary cap: the cap and what the draft spent, £M; absent without one. */
  budget?: number
  spent?: number
}

export interface Profile {
  achievements: Record<string, string>
  leaderboard: LeaderboardEntry[]
  dailyStreak: number
  lastDailyDate: string | null
  dailyResults: Record<string, { points: number; tier: SeasonTier }>
  gamesPlayed: number
  seasonsSimulated: number
  theme: 'auto' | 'dark' | 'light'
  managerName: string
  /** Trophy cabinet across every game played in this browser. Still written beside `cabinet`, so an older build reads the same five counts. */
  trophies?: { league: number; cup: number; continental: number; doubles: number; trebles: number }
  /** The Trophy Room's cabinet: built from `trophies` and the leaderboard on first load (`rebuildCabinet`), credited by `recordResult` since. */
  cabinet?: Cabinet
  /** Finished arena runs, best first within each format (at most 50); absent before the arena. */
  arenaRuns?: ArenaRunEntry[]
}

/**
 * Everything the Trophy Room counts, across every mode. Season trophies and
 * the arena's and run-in's live on separate shelves: a one-tie, nine-game or
 * projected trophy never counts as a league title or a cup.
 */
export interface Cabinet {
  v: 1
  /** The five counts of `profile.trophies`, migrated exactly. */
  league: number
  cup: number
  continental: number
  doubles: number
  trebles: number
  /** Perfect seasons (every league match won). */
  perfect: number
  /** Unbeaten champions, perfect seasons included. */
  invincible: number
  /** Seasons of 100 points or more. */
  centurions: number
  /** Club ids whose place you took when you won a league, each once. Leagues won in are derived from these at render. */
  hostsTitled: string[]
  /** Nations of one-nation drafts that won a league, each once. */
  nationsTitled: string[]
  /** Results recorded per mode. */
  byMode: Partial<Record<Mode, number>>
  /** Days with a daily challenge result. */
  dailies: number
  weeklies: number
  arenaDailies: number
  gauntlet: { runs: number; best: number; complete: number }
  /** Arena cups, keyed by bracket size '2' | '8' | '16' | '32'. */
  cups: { runs: number; won: number; bySize: Record<string, number> }
  giantKills: number
  h2h: { played: number }
  runIns: { played: number; met: number }
  /** Set when the counts beyond `trophies` were rebuilt from the 50-entry leaderboard of an older save. */
  rebuilt?: boolean
  /** Ids of the last results credited (`resultId`), newest last, so a result that missed a full top 50 is not credited again. */
  recent?: string[]
}
