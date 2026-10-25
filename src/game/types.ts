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

export type Mode = 'quick' | 'daily' | 'season' | 'dynasty'
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
  /** How the main play button plays a match (Season and Dynasty): stops for your calls, auto-play with the assistant at the stops, or straight to the result. Unset reads as 'watch'. */
  matchPlay?: 'watch' | 'auto' | 'sim'
  /** A ghost draft this game is played against (opened from a challenge link or "Run it back"). */
  challenge?: ChallengeSettings
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
  competition: 'league' | Competition
  roundLabel?: string
  opponentClubId: string
  home: boolean
  importanceLabel?: string
}

export interface LiveMatch {
  kind: 'league' | 'cup' | 'friendly'
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
  /** Inbox items ever posted this season (the feed itself is capped), kept by `postNews`; absent on older saves. */
  newsTotal?: number
  /** `newsTotal` when the Inbox was last opened: items above it are unread. Absent on older saves, which counts as everything read. */
  newsSeen?: number
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
  /** Trophy cabinet across every game played in this browser. */
  trophies?: { league: number; cup: number; continental: number; doubles: number; trebles: number }
  /** Coach marks dismissed, tip id to the ISO date it was dismissed; missing on older saves (every tip unseen). */
  seenTips?: Record<string, string>
}
