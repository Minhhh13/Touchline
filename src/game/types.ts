import type { Manager } from '@engine/managers'
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
/**
 * Where a game stands. `kickoff` (Quick Draft and the Daily) is the tactics step between the draft and the season;
 * `january` is a quick season paused after the halfway matchweek with its January window open.
 */
export type Phase = 'draft' | 'kickoff' | 'january' | 'preseason' | 'week' | 'match' | 'summary'

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
  /**
   * Season and Dynasty: enter the Continental Cup in the first season (later seasons qualify by finishing top four).
   * Quick Draft: no longer used (it once ran a Continental Cup inside the season); the cups are offered after the league instead.
   */
  continental?: boolean
  /** How the main play button plays a match (Season and Dynasty): stops for your calls, auto-play with the assistant at the stops, or straight to the result. Unset reads as 'watch'. */
  matchPlay?: 'watch' | 'auto' | 'sim'
  /** Quick Draft and the Daily: the season stops after the halfway matchweek for a January window. Absent (older saves) is off. */
  january?: boolean
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
  /** A quick season's January window: open while the phase is `january`, kept with the move once the season is done. Absent on older saves. */
  quickJanuary?: QuickJanuary | null
  /** A Quick Draft bench's voluntary changes, in the order made (at most `QUICK_CHANGES`). Absent when none were made. */
  quickChanges?: QuickChange[]
  /**
   * A quick season with a bench, played but still open to changes while the game-by-game playback runs: the result is
   * recorded (leaderboard, achievements) when the playback closes. Absent otherwise.
   */
  quickOpen?: boolean
  /** The RNG state a quick season with a bench kicked off from, so a change replays the same season up to it. */
  quickStartRng?: RngState
  /**
   * The Quick Draft manager picked once the draft was done (`src/game/logic/managers.ts`), kept with his name and style
   * as picked. Absent when the rules have no managers, and on older saves: the season then plays as it always has.
   */
  manager?: Manager
}

/**
 * One voluntary change of a quick season's bench: from matchweek `from` on, the bench player `inId` takes slot
 * `slotId` and the starter there goes to the bench in his place. It sticks until another change moves him.
 */
export interface QuickChange {
  from: number
  slotId: string
  inId: string
}

/** An injured starter covered for one game by the best fit on the bench (a forced change: it uses none of the three). */
export interface QuickCover {
  slotId: string
  outId: string
  inId: string
}

/** How a January deal is paid for: a fee out of the window budget, or a straight player-for-player swap. */
export type JanuaryDealKind = 'sign' | 'swap'

/** One player offered in a quick season's January window, for one slot of the XI. */
export interface JanuaryListing {
  /** The player-season coming in. */
  playerSeasonId: string
  /** The slot he would take. */
  slotId: string
  /** The drafted player who leaves to make room (sold, or sent the other way in a swap). */
  outId: string
  kind: JanuaryDealKind
  /** GBP millions out of the window budget; 0 for a swap. */
  fee: number
}

/** The January window of a quick season: what the halfway pause offered and what the manager did with it. */
export interface QuickJanuary {
  /** The window opens after this matchweek: half the league season. */
  afterMatchweek: number
  /** League position at the pause, which (with the XI's value) set the budget. */
  position: number
  /** GBP millions the board will spend. */
  budget: number
  listings: JanuaryListing[]
  /** The user's first-half games, shown while the window is open (the full list lands in `QuickResult.results`). */
  firstHalf: QuickGameResult[]
  /** Every club's first-half results, for the live table while the window is open. Absent on older saves. */
  firstHalfRounds?: QuickRounds
  /** The tactics and captain the first half was played with; the second half uses `Game.tactics` and `Game.captainId`. */
  firstHalfTactics: Tactics
  firstHalfCaptainId?: string
  /** The deal taken, null for a pass; absent while the window is still open. */
  move?: JanuaryListing | null
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
  /** Quick bench: the user's players injured in this game and the matchweeks each misses after it. */
  injuries?: Array<{ id: string; out: number }>
  /** Quick bench: injured starters covered from the bench in this game. */
  covers?: QuickCover[]
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
  /** The January deal, when one was made: names kept so the summary reads without the window. */
  january?: { kind: JanuaryDealKind; inId: string; inName: string; outId: string; outName: string; fee: number; slotId: string }
  /** The Continental Cup run a top-four finish earned, when the option was on and a field could be drawn (saves before the post-season cups; new seasons leave it out). */
  europe?: QuickEuropeRun
  /** The post-season domestic cup, once played; null when the manager skipped it. Absent while it is still on offer (and on older saves). */
  cup?: QuickCupRun | null
  /** The post-season Continental Cup a top-seven finish offers, once played; null when skipped. Absent while on offer or not earned. */
  continentalCup?: QuickCupRun | null
  /** Quick bench: the voluntary changes the season was played with, with the starter each sent to the bench. */
  changes?: Array<QuickChange & { outId: string }>
  /** The RNG state the season kicked off from, so the highlights of any game can be played again. Absent on older saves. */
  startRng?: RngState
  /** Every club's league results by matchweek, for the playback's live table and position chart. Absent on older saves. */
  rounds?: QuickRounds
}

/** A season's league results packed small: `weeks[mw - 1]` holds `[home, away, homeGoals, awayGoals]` per fixture, by index into `ids`. */
export interface QuickRounds {
  ids: string[]
  weeks: number[][]
}

/** One Continental Cup tie of a quick season's European run, from the user's side. */
export interface QuickEuropeTie {
  round: 'R16' | 'QF' | 'SF' | 'F'
  opponentId: string
  home: boolean
  gf: number
  ga: number
  /** Shoot-out score from the user's side, after a draw. */
  pens?: { for: number; against: number }
  won: boolean
}

/** A knockout round of the post-season cups: round of 16, quarter-final, semi-final, final. */
export type QuickCupRound = 'R16' | 'QF' | 'SF' | 'F'
/** How far a cup run went: the round it ended in, W for winners. */
export type QuickCupReach = QuickCupRound | 'W'

/** One tie of a post-season cup run, from the user's side. */
export interface QuickCupTie {
  round: QuickCupRound
  opponentId: string
  home: boolean
  /** The final is played at a neutral ground. */
  neutral?: boolean
  /** Goals over the whole tie, extra time included. */
  gf: number
  ga: number
  /** Goals in extra time alone, after a draw over ninety minutes. */
  et?: { for: number; against: number }
  /** Shoot-out score from the user's side, after a draw over 120 minutes. */
  pens?: { for: number; against: number }
  /** The user's goalscorers, ordered by minute (91 to 120 in extra time). */
  scorers: QuickScorer[]
  won: boolean
}

/** A post-season cup run: the user's ties in order, and how far it went. */
export interface QuickCupRun {
  ties: QuickCupTie[]
  reached: QuickCupReach
}

export interface QuickEuropeRun {
  ties: QuickEuropeTie[]
  /** Furthest round reached; W for winners. */
  reached: 'R16' | 'QF' | 'SF' | 'F' | 'W'
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
  /** A Quick Draft played in the Super League; absent for every other season. */
  superLeague?: true
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
  /** The 38-0 chase across every Quick Draft and Daily season in this browser; missing on older saves (filled by `normaliseProfile`). */
  quickBests?: QuickBests
}

/** Quick Draft bests: the best record (more wins, then fewer defeats, then points), the longest perfect run from the first game, and perfect seasons. */
export interface QuickBests {
  bestRecord?: { won: number; drawn: number; lost: number; points: number; games: number }
  longestPerfectRun?: number
  perfectSeasons?: number
}
