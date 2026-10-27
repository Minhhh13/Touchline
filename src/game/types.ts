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
import type { Lineup, PlayerSeason, Position, SeasonTier, SquadPlayer, Tactics } from '@engine/types'
import type { DraftRules } from '@engine/draft'
import type { ArenaClaim, ChallengeClaim } from '@engine/challenge'
import type { SquadStatus } from '@engine/status'
import type { AiClub } from '@engine/season'
import type { ArenaField, ArenaTier } from '@engine/knockout'
import type { GauntletLadder } from '@engine/gauntlet'
import type { CupBracket } from '@engine/cup'
import type { WeeklyThemeId } from './logic/weeklyThemes'
import type { RunInTemplate } from '@engine/scenario'
import type { CaseDrop } from '@engine/endCase'
import type { PowerUp } from '@engine/powerups'
import type { Tier } from './logic/rarity'

export type Mode = 'quick' | 'daily' | 'season' | 'dynasty' | 'arena' | 'weekly' | 'runin'
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
  /** The arena format of a mode `arena` game (absent for every other mode). */
  arena?: ArenaSettings
  /** The Weekly Challenge's theme, on a mode `weekly` game (absent for every other mode). */
  weekly?: { theme: WeeklyThemeId }
  /** The Run-in's brief, on a mode `runin` game (absent for every other mode); the job is `leagueId`, `leagueSeason` and `hostClubId`. */
  runIn?: { template: RunInTemplate }
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

/** One finished run-in on the Record page's Run-ins table. */
export interface RunInEntry {
  id: string
  date: string
  template: RunInTemplate
  teamName: string
  leagueId: string
  leagueSeason: number
  hostClubId: string
  seed: string
  /** The brief met (a sacking misses it). */
  met: boolean
  sacked: boolean
  position: number
  points: number
  /** The projected table at the takeover. */
  from: { matchweek: number; position: number; points: number }
  /** How the real club finished. */
  real?: { position: number; points: number }
}

/** The challenger's draft and result, carried on a game played from a challenge link. */
export interface ChallengeSettings {
  name: string
  /** One row per spin of the challenger's draft: the full player-season id drafted (null for a re-spin or a discarded spin) and its slot. Empty when the draft could not be replayed. */
  picks: Array<{ id: string | null; slotId: string | null; clubId: string; season: number }>
  claim: ChallengeClaim
  /** 'yes' when the replay reproduced the claim, 'no' when it did not, 'unverified' when the data or the engine differ, 'hand' for an arena run managed by hand (its draft and ladder replay, its matches are the challenger's word). */
  verified: 'yes' | 'no' | 'unverified' | 'hand'
  /** Why verification fell short, when it did. */
  reason?: string
  /** Data stamp and engine version the challenge was built on. */
  data: string
  engine: string
  /** An arena challenge: the challenger's run step by step, and whether the assistant played every match of it. `claim` then mirrors it (`pts` is the rounds won). */
  arena?: { claim: ArenaClaim; auto: boolean }
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
  /** Terms agreed in contract talks (`src/game/logic/contracts.ts`); absent on every contract nobody has negotiated. */
  clauses?: ContractClauses
  /** A sell-on clause agreed when he was signed: the selling club takes `pct` of the fee when he is sold on. */
  sellOn?: { pct: number; clubId: string }
  /** His agent is shopping him round the clubs: offers come as for a listed player, and the agent takes 5% of the fee. */
  shopped?: boolean
}

/** Clauses written into a contract in contract talks. */
export interface ContractClauses {
  /** Release clause, GBP millions: an AI club paying it in a window takes him, no say. */
  release?: number
  /** Appearance bonus, GBP thousands a match he plays. */
  appearance?: number
  /** Goal bonus, GBP thousands a goal. */
  goal?: number
}

/** What the recruitment team looks for: each part is optional, and an empty focus is no focus. */
export interface RecruitFocus {
  position?: Position
  age?: 'u21' | 'u24' | 'prime' | 'veteran'
  /** Highest asking price, GBP millions. */
  maxFee?: number
  deal?: 'loan' | 'permanent'
}

/** A scout's report on a player who fits the recruitment focus, graded on what the scout can see. */
export interface ScoutReport {
  playerSeasonId: string
  /** Matchweek it was filed (0 in pre-season). */
  mw: number
  grade: 'A' | 'B' | 'C' | 'D'
  /** One line: how he compares with the man he would replace. */
  note: string
}

/** One request to the board this season. */
export interface BoardRequest {
  kind: 'budget' | 'staff' | 'youth'
  mw: number
  accepted: boolean
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
  /**
   * Squad men who missed a match this week injured or suspended (engine 6, item 4): the week's housekeeping records no
   * zero minutes for them and their run of missed matches does not grow, so a key man back from injury does not knock on
   * the door about minutes. Cleared with `weekPlayed`; absent in older saves (read as nobody).
   */
  weekUnavailable?: string[]
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
  /** Real player ids of the men who retired from the squad (Dynasty): never offered again, younger, by the summer wheel or the market. Absent until the first retirement. */
  retiredPlayers?: string[]
  /** Quick-mode final table snapshot for the summary. */
  quickResult: QuickResult | null
  /** The arena run of a mode `arena` game; null (or absent, in an older save) otherwise. */
  arena?: ArenaState | null
  /** £M the first draft spent under a salary cap, kept when a managed season drops the draft; absent without a cap. */
  capSpent?: number
  /** The Teammate Chain the first draft made, kept when a managed season drops the draft; absent without a chain. */
  teammateChain?: TeammateChainRecord
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
  /**
   * The manager spin of a Quick Draft with `managerSpin` on (`src/game/logic/managerSpin.ts`): the three managers the
   * reels land on, rolled at the step from the draft to the season, and whether the user has picked one of them yet.
   * Absent without the rule, and on older saves.
   */
  managerSpin?: { options: Manager[]; picked?: boolean }
  /**
   * The end-of-draft case of a Quick Draft with `endCase` on (`src/game/logic/endCase.ts`), rolled at the step from the
   * draft to the season: what it holds, whether it has been opened (a power-up then went to the locker), whether the user
   * is done with it, and the starter an Icon replaced. Absent without the rule, and on older saves.
   */
  endCase?: { drop: CaseDrop; opened?: boolean; done?: boolean; sub?: { slotId: string; outId: string } }
  /**
   * Recruitment (`src/game/logic/scouting.ts`), Season and Dynasty. Every field is absent until the manager uses it, and
   * reads as the defaults: knowledge at its starting level, no assignments, nobody scouted, no focus, no reports.
   * `knowledge` holds a league's level once assignments have moved it; `scouted` holds fully scouted player-season ids
   * (capped); `scoutSlot` names the market day or matchweek of the last full scout (one each).
   */
  knowledge?: Record<string, number>
  assignments?: string[]
  scouted?: string[]
  scoutSlot?: string
  recruitFocus?: RecruitFocus
  scoutReports?: ScoutReport[]
  /** Contract talks by real player id: offers turned down this run, and the matchweek talks reopen after three. Cleared each summer. */
  negotiations?: Record<string, { fails: number; closedUntil?: number }>
  /** Appearance and goal bonuses earned since the last weekly wage run, GBP thousands. */
  bonusDue?: number
  /** Requests granted by the board for youth facilities (Dynasty): each adds one academy candidate a summer, at most 2. */
  youthFacilities?: number
  /** The data hub: expected goals, expected assists and attempts for the user's players this season, from full-detail matches. */
  dataHub?: Record<string, { xg: number; xa: number; shots: number }>
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
  /**
   * The January spin (`src/game/logic/januaryGamble.ts`), once its case is opened: the player it landed on and, once
   * the window closes, the slot he took (null: the XI was kept). Opening it is the window's one deal. Absent otherwise
   * (and on older saves).
   */
  spin?: JanuarySpinResult
  /** The January Upgrader, once rolled: the one gamble on one of the XI for the second half. Absent otherwise (and on older saves). */
  upgrade?: JanuaryUpgradeResult
}

/** What the January spin landed on, and where he went. */
export interface JanuarySpinResult {
  /** The player-season the case landed on. */
  playerSeasonId: string
  /** The rarity tier he was drawn from (`januarySpinOdds`). */
  tier: Tier
  /** The slot he took when the window closed, null when the XI was kept; absent while the window is open. */
  slotId?: string | null
  /** The starter who made way. */
  outId?: string
}

/** The January Upgrader's gamble as rolled: as the draft's Player Upgrader records it (`DraftUpgrade`), for the second half only. */
export interface JanuaryUpgradeResult {
  /** The XI player gambled on. */
  id: string
  boost: number
  /** Whole per cent shown and used: `roll < chance` wins. */
  chance: number
  /** 0 to 99. */
  roll: number
  won: boolean
  /** The change to his overall and every attribute from the second half on. */
  delta: number
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
  /** Season Story: the matchweek the title was sealed (null: never), absent on older saves. */
  clinchedAt?: number | null
  /** Season Story: the matchweek relegation became certain (null: never), absent on older saves. */
  doomedAt?: number | null
  /** Season Story: the one line that tells the season, absent on older saves (retold from `results`). */
  moment?: string
  /** The January deal, when one was made: names kept so the summary reads without the window. */
  january?: { kind: JanuaryDealKind; inId: string; inName: string; outId: string; outName: string; fee: number; slotId: string }
  /** The January spin or Upgrader, when one was used: names kept so the summary reads without the window. Absent otherwise (and on older saves). */
  januaryGamble?: { kind: 'spin'; inId: string; inName: string; tier: Tier; outId?: string; outName?: string; slotId?: string } | { kind: 'upgrade'; id: string; name: string; boost: number; chance: number; won: boolean; delta: number }
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
  /**
   * Every tie of every round, first round to final, in the order drawn: the whole bracket for the summary. The rounds
   * after the user went out are played on from the same fork, after every draw the run itself took, so no result moves.
   * Absent on runs played before the bracket (the summary then shows the user's path alone).
   */
  bracket?: QuickBracketTie[][]
}

/** One tie of a post-season cup's bracket. Sides are club ids, or `USER_TEAM` for the user. */
export interface QuickBracketTie {
  home: string
  away: string
  /** Goals over the whole tie, extra time included. */
  hg: number
  ag: number
  /** The tie went to extra time after a draw over ninety minutes. */
  et?: true
  /** The shoot-out, after a draw over 120 minutes. */
  pens?: { home: number; away: number }
  /** The side that went through. */
  winner: string
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
  /** Season Story's moment line ("🏆 Title sealed at MW 34 with 4 to play"), absent on older entries. */
  moment?: string
  /** League the season was played in, absent on entries filed before the Trophy Room. */
  leagueId?: string
  /** Drafted under a salary cap: the cap and what the draft spent, £M; absent without one. */
  budget?: number
  spent?: number
  /** A Quick Draft played in the Super League; absent for every other season. */
  superLeague?: true
  /** The XI had an Icon from the end-of-draft case: a non-standard season, marked on the board and kept out of the records. */
  caseIcon?: true
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
  /** The Daily Arena's streak and one result per day (keyed by `arena-YYYY-MM-DD`); absent until the first one. */
  arenaDaily?: StreakResults<{ format: 'cup' | 'gauntlet'; score: number; label: string }>
  /** The Weekly Challenge's streak and one result per week (keyed by `weekly-YYYY-Www`); absent until the first one. */
  weekly?: StreakResults<{ points: number; tier: SeasonTier }>
  /** Finished run-ins, newest first (at most 50); absent before the first. */
  runIns?: RunInEntry[]
  /** Coach marks dismissed, tip id to the ISO date it was dismissed; missing on older saves (every tip unseen). */
  seenTips?: Record<string, string>
  /** The manager's favourite club (a club id), chosen on the account's profile step or the Profile screen; absent when none. Display only. */
  favouriteClub?: string
  /** The 38-0 chase across every Quick Draft and Daily season in this browser; missing on older saves (filled by `normaliseProfile`). */
  quickBests?: QuickBests
  /**
   * The locker: power-ups dropped by end-of-draft cases, by kind, waiting to be unpacked into a later Quick Draft
   * (`src/game/logic/endCase.ts`). Missing on older saves (an empty locker); `normaliseProfile` drops anything malformed.
   */
  inventory?: Partial<Record<PowerUp, number>>
}

/** Quick Draft bests: the best record (more wins, then fewer defeats, then points), the longest perfect run from the first game, and perfect seasons. */
export interface QuickBests {
  bestRecord?: { won: number; drawn: number; lost: number; points: number; games: number }
  longestPerfectRun?: number
  perfectSeasons?: number
}

/** A streak (`advanceStreak`) with the first result filed for each day or week it counted. */
export interface StreakResults<R> {
  streak: number
  /** The last day or week (its seed) that counted. */
  last: string | null
  results: Record<string, R>
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
  /** Online head-to-head rooms (Phase 2), a shelf of their own apart from the hot-seat's `h2h`: rooms this device held
   * a seat in that finished, and those its manager won. Optional (absent on cabinets before the rooms); read with
   * `??`, filled by `normaliseCabinet`. */
  h2hOnline?: { played: number; won: number }
  runIns: { played: number; met: number }
  /** Set when the counts beyond `trophies` were rebuilt from the 50-entry leaderboard of an older save. */
  rebuilt?: boolean
  /** Ids of the last results credited (`resultId`), newest last, so a result that missed a full top 50 is not credited again. */
  recent?: string[]
  /**
   * The honours board: every Treble and Double season, newest first (at most `HONOURS_CAP`), one entry per season with
   * its best honour. Optional (absent on cabinets before the bracket); read with `??`, filled by `normaliseCabinet`.
   */
  honours?: HonourEntry[]
}

/** A Treble (league, Cup and Continental Cup) or a Double (the league and one cup), on the Trophy Room's honours board. */
export interface HonourEntry {
  /** The season's result id (`resultId`): a Double that becomes a Treble replaces its own entry. */
  id: string
  kind: 'treble' | 'double'
  /** The cups won beside the league. */
  cups: Array<'cup' | 'continental'>
  teamName: string
  mode: Mode
  leagueId: string
  leagueSeason: number
  /** A Quick Draft season in the Super League (its league is no real one). */
  superLeague?: true
  /** The day it was won, YYYY-MM-DD. */
  date?: string
}
