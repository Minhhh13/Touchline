import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDraft, current, finishDraft, freeze, isDraft, produce, type Draft } from 'immer'
import type { ChallengeSettings, Game, GameSettings, LeaderboardEntry, Mode, Profile, RecruitFocus } from './types'
import type { LoadedUniverse } from '@engine/universe'
import { DEFAULT_LEAGUE } from '@engine/universe'
import { loadLeague, loadPacks as loadRawPacks, warmClassicPacks, yieldToMain } from './packs'
import { tidyUniverseNames } from './logic/playerNames'
import { Rng, arenaDailySeed, dailySeed, previousArenaDailySeed, previousDailySeed, previousWeeklySeed, weeklySeed, type RngState } from '@engine/rng'
import { assistantTurn, canCloseBench, canSpin, chooseSlot as draftChooseSlot, closeBench, fillingXI, isComplete, pick as draftPick, positionFirst, respin as draftRespin, spin as draftSpin, autoDraft, targetSlot } from '@engine/draft'
import type { Tactics } from '@engine/types'
import type { InPlayChange, InPlayOutcome, LiveChanges, TeamTalk } from '@engine/match'
import type { TrainingFocus } from '@engine/training'
import { needsClassic } from './logic/era'
import { nextFailed, nextSeasonLeagues } from './logic/leagueLoad'
import { createGame, beginSeason } from './logic/setup'
import { normaliseGame, normaliseProfile } from './logic/save'
import { isQuickLike } from './logic/modes'
import { capOfGame } from './logic/cap'
import { advanceStreak, fileStreakResult, streakDay } from './logic/streaks'
import { dailyArenaResult } from './logic/arenaDaily'
import { weeklyGameSettings, weeklyPlan } from './logic/weekly'
import { alreadyCredited, creditArena, creditGame, creditH2H, creditH2HOnline, creditRunIn, emptyCabinet, finishedRecord, normaliseCabinet, rebuildCabinet, reconcileTrophies, resultId, trophiesOf } from './logic/cabinet'
import { cabinetWithFeats, creditCupFeats, creditGameFeats, creditRunInFeatsOn, withFeats } from './logic/feats'
import { withQuickBests } from './logic/perfect'
import { compactGame } from './logic/compact'
import { createSaveStorage, encodeSave, isQuotaError, parseSave } from './saveStorage'
import { workerSaveEncoder } from './saveEncoder'
import { afterNextPaint, nextTask } from './yieldToPage'
import type { JanuaryJob } from './quickJob'
import { addToLocker, canUnpackFromLocker, caseIconIn, finishEndCase, kickoffStep, openEndCase, subCaseIcon, takeFromLocker, unpackFromLocker } from './logic/endCase'
import type { PowerUp } from '@engine/powerups'
import { isSuperLeague } from './logic/superLeague'
import type { GameBox, WeekStep } from './logic/week'
import { assignPlayer, autoPick, setFormation, setSquadStatus } from './logic/squad'
import { playerLookup } from './logic/players'
import { assignmentNote } from './logic/slotSheet'
import type { SquadStatus } from '@engine/status'
import { acceptOffer, advanceDay, bidFor, enquireFor, loanFor, rejectOffer, releasePlayer, type BidOptions } from './logic/marketOps'
import { fullScout, setAssignment, setRecruitFocus } from './logic/scouting'
import type { ContractOffer } from './logic/contracts'
import type { RequestKind } from './logic/board'
import { talkTo, type TalkKind } from './logic/talks'
import type { OfficeTick } from './logic/officeSteps'
import { signYouth } from './logic/youth'
import type { StaffRole } from '@engine/staff'
import type { OffseasonReport } from './logic/dynasty'
import type { SummerStories } from './logic/dynastyHistory'
import { ACHIEVEMENTS } from '@engine/awards'
import { upgradePlayer as draftUpgrade } from '@engine/upgrader'
import { giveArmband as draftArmband, lockPlayer as draftLock, rerollSeason as draftReroll, swapSlots as draftSwap, usePeek as draftPeek } from '@engine/powerups'
import type { H2HDraft } from '@engine/h2h'
import type { H2HManager, H2HResult } from './logic/h2h'
import { getFormation } from '@engine/formations'
import type { ChallengePayload } from '@engine/challenge'
import type { StopReason } from './logic/seasonHighlights'
import { advanceArenaMatch, arenaNeedsAllLeagues, arenaRunEntry, beginArena, changeArenaMatch, changeTheDraw, closeArenaMatch, completeArenaMatch, playArenaStep, simArenaToEnd, sortArenaRuns, takePenalties } from './logic/arena'
import { buildDigest, digestSnapshot, type SimDigest } from './logic/digest'
import { newsTotal } from './logic/news'
import { withAllTipsSeen, withTipSeen, type TipId } from './logic/tips'
import type { QuickCupComp } from './logic/quickCups'
import { assistantTakesStops, matchPlayOf, type MatchPlayMode } from './logic/matchPlay'
import { h2hNeedsClassic } from './logic/h2hNeedsClassic'
import { late, loadRules, rules, rulesReady } from './rulesHook'

// The game rules once a game is under way live in the rules chunk (`rules.ts`, out of the first download): the store
// calls them by these names, as if imported, and every path to them waits for `loadRules()` first (rulesHook.ts)
const isPerfectDraft = late('isPerfectDraft')
const runQuickInWorker = late('runQuickInWorker')
const stopQuickWorker = late('stopQuickWorker')
const warmQuickWorker = late('warmQuickWorker')
const pickManager = late('pickManager')
const januaryGambleMade = late('januaryGambleMade')
const januaryStale = late('januaryStale')
const markQuickSeasonFresh = late('markQuickSeasonFresh')
const quickSeasonStale = late('quickSeasonStale')
const quickSeasonKnownFresh = late('quickSeasonKnownFresh')
const closeJanuary = late('closeJanuary')
const closeJanuarySpin = late('closeJanuarySpin')
const closeQuickSeason = late('closeQuickSeason')
const kickOff = late('kickOff')
const makeQuickChange = late('makeQuickChange')
const openSpinChoices = late('openSpinChoices')
const playbackResults = late('playbackResults')
const quickChangeProblem = late('quickChangeProblem')
const reopenJanuary = late('reopenJanuary')
const rollJanuarySpin = late('rollJanuarySpin')
const rollJanuaryUpgrade = late('rollJanuaryUpgrade')
const toKickoff = late('toKickoff')
const availableStopChanges = late('availableStopChanges')
const advanceLiveMatch = late('advanceLiveMatch')
const applyEventChoice = late('applyEventChoice')
const changeLiveMatch = late('changeLiveMatch')
const closeLiveMatch = late('closeLiveMatch')
const completeLiveMatch = late('completeLiveMatch')
const playFriendly = late('playFriendly')
const runSteps = late('runSteps')
const simWeeksSteps = late('simWeeksSteps')
const startSeasonProper = late('startSeasonProper')
const restTiredStarters = late('restTired')
const startPromisedMan = late('startPromised')
const proposeContract = late('proposeContract')
const setShopped = late('setShopped')
const makeRequest = late('makeRequest')
const shiftWages = late('shiftWages')
const withTick = late('withTick')
const advanceToNextSeason = late('advanceToNextSeason')
const letContractGo = late('letContractGo')
const postRenewals = late('postRenewals')
const noteSeasonEnd = late('noteSeasonEnd')
const summerSnapshot = late('summerSnapshot')
const summerStories = late('summerStories')
const h2hAutoPick = late('h2hAutoPick')
const h2hAutoComplete = late('h2hAutoComplete')
const h2hComplete = late('h2hComplete')
const h2hPick = late('h2hPick')
const h2hSpin = late('h2hSpin')
const newH2HDraft = late('newH2HDraft')
const runH2HSeason = late('runH2HSeason')
const h2hRulesFor = late('h2hRulesFor')
const decodeChallenge = late('decodeChallenge')
const isArenaPayload = late('isArenaPayload')
const challengeSettings = late('challengeSettings')
const replayChallenge = late('replayChallenge')
const storyForGame = late('storyForGame')
const simToNextStopSteps = late('simToNextStopSteps')
const beginRunIn = late('beginRunIn')
const runInEntry = late('runInEntry')
const seedRunInDraft = late('seedRunInDraft')
const creditCupRun = late('creditCupRun')
const playQuickCup = late('playQuickCup')
const quickCupProblem = late('quickCupProblem')
const quickCupStatus = late('quickCupStatus')
const skipQuickCup = late('skipQuickCup')
const passQuickCup = late('passQuickCup')
const leaguesBeforeSkip = late('leaguesBeforeSkip')
const lifelineChanges = late('lifelineChanges')
const advanceWithAssistant = late('advanceWithAssistant')
const finishWithAssistant = late('finishWithAssistant')
const playMatchweekAs = late('playMatchweekAs')
const playMatchweekAsSteps = late('playMatchweekAsSteps')

/** The loaded universe as the game shows it: the packs' stray ",NN" name suffixes cleaned at load (`playerNames.ts`, display text only). */
async function loadPacks(ids: string[], classic: boolean): Promise<LoadedUniverse> {
  const raw = await loadRawPacks(ids, classic)
  await yieldToMain()
  const u = tidyUniverseNames(raw).universe
  // The screens' render of the new universe in a task of its own: build, merge, tidy and render were one long task (r13)
  await yieldToMain()
  return u
}

/** A plain, unfrozen copy of part of a game being produced (JSON data), for an engine loop that reads it many times. */
function plainCopy<T extends object>(x: T): T {
  return structuredClone(isDraft(x) ? (current(x as Draft<T>) as T) : x)
}

/** playWeek's recipe in steps: the season started if it is pre-season, then the matchweek as the Dugout plays it. */
function* playWeekSteps(g: Game, u: LoadedUniverse, mode: MatchPlayMode): Generator<void, void, undefined> {
  if (g.phase === 'preseason') startSeasonProper(g, u)
  yield* playMatchweekAsSteps(g, u, mode)
}

/** localStorage key the whole game is persisted under. */
/** The match view an arena step opens on: managed live, the dashboard; simmed by the assistant, the report (playtest P4). */
export const arenaStepView = (live: boolean): 'ticker' | 'report' => (live ? 'ticker' : 'report')

export const SAVE_KEY = 'touchline-save-v1'
/** Persist version of the saved state (a change needs a `migrate`). */
export const SAVE_VERSION = 1
/** Delay from a change to the write: a burst of changes inside it is written once, with the latest state. */
const SAVE_DELAY_MS = 250
/** How long `playWeekSoon` plays the week before it gives the page a task (about a frame). */
const WEEK_SLICE_MS = 16
/** The banner that stays up while the browser refuses every save write. */
export const SAVE_FAILING_LINE = 'Not saving: storage full'
/** Shown when the browser refuses to store the save. */
export const SAVE_FULL_TOAST = "Could not save: this browser's storage is full. Your game carries on; export your save from Your record, or discard a parked game, to free space."

export type Screen = 'home' | 'setup' | 'game' | 'explore' | 'profile' | 'howto' | 'h2h' | 'world' | 'privacy' | 'account' | 'room'

export interface H2HGame {
  managers: [H2HManager, H2HManager]
  leagueId: string
  wheelLeagues: string[]
  leagueSeason: number
  difficulty: 'calibrated' | 'realistic'
  seed: string
  rngState: RngState
  draft: H2HDraft
  result: H2HResult | null
  hardMode: boolean
}

export interface SetupDraft {
  mode: Mode
}

interface Store {
  universe: LoadedUniverse | null
  loading: boolean
  loadError: string | null
  /** League packs currently merged into `universe`. */
  loadedLeagues: string[]
  loadingLeagues: boolean
  /** Leagues whose last load failed (offline, a pack that never came): the start buttons say so and offer a retry (leagueLoad.ts). Transient. */
  failedLeagues: string[]
  /** The classic seasons' last load failed. Transient. */
  classicFailed: boolean
  /** The browser refused the last save write (its storage is full): a banner stays up until a write goes through (O-14). Transient. */
  saveFailing: boolean
  /** Whether `universe` holds the classic seasons: they load on demand (a classic game, the Classic toggle, Explore), never at start. */
  classicLoaded: boolean
  screen: Screen
  setupMode: Mode
  /** The format the arena's setup opens on (Home's Cup Final or Gauntlet card); not persisted. */
  arenaSetupFormat: 'cup' | 'gauntlet'
  game: Game | null
  /** Saved games of other kinds, parked while another game is active (one per slot). */
  parked: Record<string, Game>
  /** Player-season ids starred in Explore; shown on the market for quick enquiries. */
  shortlist: string[]
  h2h: H2HGame | null
  profile: Profile
  toast: string | null
  /**
   * Why this page has stopped saving (transient, never saved): `elsewhere` once another tab or window has saved over
   * this page's save (this page then stops writing until it is reloaded, so it never overwrites that progress with its
   * older game). A full storage is `saveFailing`, which goes with the next write that lands.
   */
  saveIssue: 'elsewhere' | null
  /** The summer's report, with the player stories the club's history tells (round 9; transient). */
  offseason: (OffseasonReport & { stories?: SummerStories }) | null
  /** What happened over the matchweeks just simulated (Sim 5, Sim to end); transient, never saved. */
  digest: SimDigest | null
  /** Transient UI: 'ticker' shows the live match, 'report' the summary. */
  matchView: 'ticker' | 'report'
  /** Why the last Sim to the next big match stopped, for the game, year and matchweek it stopped at (transient, never saved). */
  simStop: { stop: StopReason; gameId: string; year: number; matchweek: number } | null
  /** Transient: the live match plays on through its stops with the assistant making the calls (Auto-play, "Finish the match", "Auto from here"). Never saved. */
  liveAuto: boolean
  /** A challenge link opened and verified, waiting on the Setup screen for a team name (transient, never saved). */
  pendingChallenge: { payload: ChallengePayload; challenge: ChallengeSettings } | null
  /** The quick season being revealed game by game from game `from` (transient, never saved): a reload goes straight to the result. */
  playback: { from: number } | null

  loadData: () => Promise<void>
  /** Load any of the given leagues not loaded yet, with every loaded league's classic seasons when `classic`. Resolves true when all of them are available. */
  ensureLeagues: (ids: string[], classic?: boolean) => Promise<boolean>
  /** Load the classic seasons of the loaded leagues; `quiet` drops the toast when they cannot load (a screen that only shows them). */
  ensureClassic: (quiet?: boolean) => Promise<boolean>
  go: (screen: Screen, mode?: Mode) => void
  /** Open the arena's setup on a format. */
  openArenaSetup: (format: 'cup' | 'gauntlet') => void
  showToast: (text: string | null) => void
  /** Open a challenge link (`#c=...`): decode it, load its leagues, replay it and go to Setup. Resolves false with a toast when it cannot be opened. */
  openChallenge: (encoded: string) => Promise<boolean>

  startGame: (settings: GameSettings) => void
  /** The week's challenge: load its packs, then start it with this team name. Resolves false when the packs could not load. */
  startWeekly: (seed: string, teamName?: string) => Promise<boolean>
  /** The Run-in of the week (`runin-YYYY-Www`): its league loaded, then the week's job; false when it cannot start. */
  startRunInWeek: (seed: string) => Promise<boolean>
  abandonGame: () => void
  /** Swap a parked game back in, parking the current one. */
  resumeGame: (slot: string) => void
  discardParked: (slot: string) => void

  spin: () => void
  respin: () => void
  /** Position First: choose the open slot the next spin fills. */
  chooseSlot: (slotId: string) => void
  pickPlayer: (playerSeasonId: string, slotId: string | 'bench') => void
  autoDraftRest: () => void
  /** Speedrun: the pick clock ran out, so the assistant spins if need be and makes this one pick (`assistantTurn`). */
  speedrunPick: () => void
  /** The Player Upgrader: gamble a drafted player's rating up by `boost` (2, 5 or 10) at the odds shown; once per draft. */
  upgradePlayer: (playerSeasonId: string, boost: number) => void
  /** Power-ups (`src/engine/powerups.ts`), each once per draft: re-roll the showing spin's season, peek at the next spin, swap two slots, the armband, the lock. */
  rerollSeason: () => void
  peekSpin: () => void
  swapSlots: (from: string, to: string) => void
  giveArmband: (playerSeasonId: string) => void
  lockPlayer: (playerSeasonId: string) => void
  finishDraft: () => void
  /** Quick Draft with managers: pick the manager by id once the draft is done, up to kick-off (`src/game/logic/managers.ts`). */
  pickManager: (id: string) => void
  /** The locker: unpack one banked power-up into this Quick Draft (one without the tray); the profile loses it (`src/game/logic/endCase.ts`). */
  unpackPowerUp: (kind: PowerUp) => void
  /** The end-of-draft case: open it; a power-up drop goes into the locker on the profile, once. */
  openCase: () => void
  /** The case's Icon: bring him in at a drafted starter's slot, or keep the XI (null); then on to the tactics. */
  subCaseIcon: (slotId: string | null) => void
  /** Done with an opened case that dropped a power-up: on to the tactics. */
  finishCase: () => void
  /** Quick Draft and the Daily: leave the tactics step and play the season (to the January window when it is on); `skip` restores the default tactics first. */
  kickOff: (skip?: boolean) => void
  /**
   * The kick-off as the tactics step plays it: `kickOff` with the season played in a worker (`quickWorker.ts`), so a
   * slow phone stays responsive; the page plays it itself where there is no worker or the worker cannot. The same
   * game as `kickOff` from the same state.
   */
  kickOffSoon: (skip?: boolean) => Promise<void>
  /** Transient: a `kickOffSoon` is under way. Never saved. */
  kickingOff: boolean
  /** Have the quick-season worker load the packs now (the tactics step is up); the function returned lets it go. */
  warmKickOff: () => () => void
  /** Close the January window with listing `index`, or pass with null, and play the second half. No undo. */
  closeJanuary: (index: number | null) => void
  /** Quick Draft's January spin: open the case (the window's one deal from then on); the reel then lands on the player drawn. */
  januarySpin: () => void
  /** After the January spin: bring its player into `slotId`, or keep the XI with null, and play the second half. No undo. */
  closeJanuarySpin: (slotId: string | null) => void
  /**
   * `closeJanuary` and `closeJanuarySpin` as the January panel plays them: the busy state painted, then the second half
   * played in the quick-season worker (the whole season replays, about the kick-off's work); the page plays it itself
   * where the worker cannot, or the game moved meanwhile. The same game as the plain action.
   */
  closeJanuarySoon: (index: number | null) => Promise<void>
  closeJanuarySpinSoon: (slotId: string | null) => Promise<void>
  /** Transient: a January close is under way in the worker. Never saved. */
  closingJanuary: boolean
  /** Quick Draft's January Upgrader: one roll on one of the XI for the second half; `closeJanuary(null)` then plays it. */
  januaryUpgrade: (playerSeasonId: string, boost: number) => void
  /** The game-by-game playback is over or skipped: show the summary (a season with a bench is recorded now). */
  endPlayback: () => void
  /** Quick bench: before game `revealed + 1` of the playback, put bench player `inId` into slot `slotId` (one of the three changes). */
  benchChange: (revealed: number, slotId: string, inId: string) => void
  /**
   * `benchChange` as the playback's bench panel makes it: the busy state painted, then the season played again in the
   * quick-season worker (the staleness check too, the first time this page sees the season); the page plays it where
   * the worker cannot, the season is stale, or the game moved meanwhile. The same game as the plain action.
   */
  benchChangeSoon: (revealed: number, slotId: string, inId: string) => Promise<void>
  /** Transient: a `benchChangeSoon` is under way. Never saved. */
  changingBench: boolean
  /** Quick Draft after the league: play the domestic cup or the Continental Cup through (loading every league first for the Continental Cup). Resolves true when it was played. */
  playCup: (comp: QuickCupComp) => Promise<boolean>
  /** Quick Draft after the league: pass on a cup. */
  skipCup: (comp: QuickCupComp) => Promise<void>

  playFriendly: () => void
  startSeason: () => void
  playWeek: () => void
  /**
   * Play matchweek as the Dugout plays it: `playWeek` in three parts with a break for the page between them (the busy
   * state painted, the matchweek played, then the screen that shows it), so a slow phone stays responsive. The same
   * game as `playWeek` from the same state; a tap while one runs is ignored. `prepare` (the screen's, presentation
   * only) runs on the played game before it is shown, in tasks of its own, to build what the next screen's first
   * render would (the match day's ball path); it must not change the game, and an error in it is ignored. The week
   * itself runs in slices of about `WEEK_SLICE_MS` (`opts.sliceMs`, tests), a task for the page between them.
   */
  playWeekSoon: (prepare?: (next: Game) => Promise<void>, opts?: { sliceMs?: number }) => Promise<void>
  /** Transient: a `playWeekSoon` (or the arena's `playArenaStepSoon`) is under way (the button shows it). Never saved. */
  playingWeek: boolean
  /** Play the paused match on from its stop (half time to the 70th minute, or 70 to the whistle) with the manager's changes at that stop; `hold` keeps the last twenty minutes live until `completeLive`. */
  advanceLive: (opts: LiveChanges, hold?: boolean) => void
  /** A change with the ball in play at a minute (instructions, set pieces, substitutions, a shout from 70); null without a live match. */
  interveneLive: (change: Omit<InPlayChange, 'side'>) => InPlayOutcome | null
  /** Close a match held to the whistle: the report and the rest of the week. */
  completeLive: () => void
  /** Play on from the stop with the assistant's calls (`assistantCall`); `hold` as for `advanceLive`. */
  assistantAdvance: (hold?: boolean) => void
  /** Play the live match to the whistle now (with `changes` at this stop when given), the assistant taking every remaining call; the report is shown. */
  finishLiveNow: (changes?: LiveChanges) => void
  /** Turn the assistant on or off for the stops still to come in this match. */
  setLiveAuto: (on: boolean) => void
  /** On to the live match that follows (a cup tie after the league match): the assistant is back to the saved preference, whatever was asked for the last match. */
  nextLiveMatch: () => void
  /** The remembered way to play a match (Season and Dynasty). */
  setMatchPlay: (mode: MatchPlayMode) => void
  simToEnd: () => void
  simWeeks: (n: number) => void
  /** Sim 5's weeks until the next derby, title decider, cup semi-final or final, open run-in, January window or board alarm; that week is not played. */
  simToNextBigMatch: () => void
  /**
   * `simWeeks` and `simToNextBigMatch` as the Dugout runs them: the same weeks on a draft held across tasks, the page
   * given a task whenever a slice passes `WEEK_SLICE_MS` (`opts.sliceMs`, tests), then one update. A game that moves
   * meanwhile is simmed as it is now by the plain action. The caller paints its busy state first.
   */
  simWeeksSoon: (n: number, opts?: { sliceMs?: number }) => Promise<void>
  simToNextBigMatchSoon: (opts?: { sliceMs?: number }) => Promise<void>
  closeMatch: () => void
  /** Arena: kick off the next match, managed live (the two stops) or played by the assistant. */
  playArenaStep: (live: boolean) => void
  /**
   * `playArenaStep` as the arena's hub plays it: the busy state painted, the step played, `prepare` (the screen's, as
   * for `playWeekSoon`) in tasks of its own, then the match screen (`playingWeek` while it runs). The same game.
   */
  playArenaStepSoon: (live: boolean, prepare?: (next: Game) => Promise<void>) => Promise<void>
  /** Arena: the shoot-out of a level live match, in the manager's order with his keeper. */
  takePenalties: (order: string[], keeperId: string) => { ok: boolean; message: string }
  /** The Gauntlet's lifeline: once a run, swap the next rung's club for its alternate. */
  changeTheDraw: () => void
  /** Arena: the assistant plays every match left and drafts every bonus spin, to the summary. */
  simArenaToEnd: () => void
  setMatchView: (v: 'ticker' | 'report') => void
  dismissDigest: () => void
  /** The Inbox was opened: everything posted so far counts as read. */
  markNewsSeen: () => void

  setTactics: (t: Partial<Tactics>) => void
  setRole: (slotId: string, roleId: string) => void
  setFormation: (id: string) => void
  assign: (playerSeasonId: string, slotId: string | 'bench') => void
  /** The slot picker's tap: assign, then toast what moved ('Saka in at RW, Bowen to the bench'). */
  playInSlot: (playerSeasonId: string, slotId: string | 'bench') => void
  autoPick: () => void
  /** Rest the tired starters a fresher man would beat in their slot (only `playerSeasonId` when given); returns the swaps made. */
  restTired: (playerSeasonId?: string) => number
  /** Put the man promised a start into the XI, in the slot where he costs it least. */
  startPromised: () => void
  setTeamTalk: (t: TeamTalk) => void
  setTraining: (t: TrainingFocus) => void
  setCaptain: (id: string) => void
  setStatus: (playerSeasonId: string, status: SquadStatus) => void

  resolveEvent: (choiceId: string) => void
  bid: (listingId: string, amount: number, opts?: BidOptions) => { accepted: boolean; message: string }
  loan: (listingId: string) => { accepted: boolean; message: string }
  talk: (playerSeasonId: string, kind: TalkKind) => { message: string }
  hireStaff: (role: StaffRole, tier: number) => void
  setMarkTarget: (playerSeasonId: string | undefined) => void
  signYouth: (playerSeasonId: string | null) => { ok: boolean; message: string }
  toggleShortlist: (playerSeasonId: string) => void
  enquire: (playerSeasonId: string) => { ok: boolean; message: string }
  acceptOffer: (index: number) => void
  rejectOffer: (index: number) => void
  release: (playerSeasonId: string) => void
  /** Dynasty pre-season: let an out-of-contract man leave on a free now. */
  letContractGo: (playerSeasonId: string) => { ok: boolean; message: string }
  advanceDay: () => void
  /** Recruitment: a full scout of one player (one a market day, or a week), a league assignment on or off, the focus. */
  scoutPlayer: (playerSeasonId: string) => { ok: boolean; message: string }
  setAssignment: (leagueId: string, on: boolean) => { ok: boolean; message: string }
  setRecruitFocus: (focus: RecruitFocus | null) => { ok: boolean; message: string }
  dismissReport: (playerSeasonId: string) => void
  /** Contract talks: put an offer to a squad player. */
  proposeContract: (playerSeasonId: string, offer: ContractOffer) => { accepted: boolean; message: string }
  /** Have his agent find a buyer, or stop. */
  setShopped: (playerSeasonId: string, on: boolean) => { ok: boolean; message: string }
  /**
   * One office action (Football Manager depth, round 8): `fn` is a function of `src/game/logic/office.ts` and its
   * modules, run on the game like any action and its result returned. The office's code is not in the first download:
   * the screens reach it through `src/game/officeActions.ts`, in the Dugout's chunk.
   */
  runOffice: <T>(fn: (game: Game, u: LoadedUniverse) => T, fallback: T, opts?: { unlock?: boolean }) => T
  setPlayerPower: (on: boolean) => void
  boardRequest: (kind: RequestKind) => { ok: boolean; accepted: boolean; message: string }
  /** The wage-to-transfer slider: +1 turns £10k a week of wages into £2M of budget, −1 the other way. */
  shiftWages: (dir: 1 | -1) => { ok: boolean; message: string }

  nextSeason: () => void
  acceptJob: (index: number | null) => void
  dismissOffseason: () => void

  startH2H: (managers: [H2HManager, H2HManager], leagueId: string, wheelLeagues: string[], leagueSeason: number, difficulty: 'calibrated' | 'realistic', hardMode: boolean, seed: string, classic?: boolean) => void
  h2hSpin: () => void
  h2hPick: (playerSeasonId: string, slotId: string | 'bench') => void
  h2hAuto: () => void
  /** Auto-complete the hot-seat draft: Spin and the assistant's pick in turn until both squads are full, the same draws as the buttons (`h2hAutoDraft.ts`). */
  h2hAutoDraft: () => void
  h2hFinish: () => void
  abandonH2H: () => void
  /** A finished online head-to-head room this device held a seat in: one mark on the Trophy Room's online shelf (`won`: this device's manager finished higher). */
  creditH2HRoom: (won: boolean) => void
  recordResult: () => void
  setManagerName: (name: string) => void
  /** The favourite club on the profile (a club id), or null to clear it. Display only; synced with the profile. */
  setFavouriteClub: (clubId: string | null) => void
  setTheme: (t: Profile['theme']) => void
  /** A coach mark's 'Got it': it never shows again on this profile. */
  dismissTip: (id: TipId) => void
  /** A tip's 'No more tips': every coach mark dismissed at once. */
  dismissAllTips: () => void
  /** 'Show tips again' on the Profile screen: every coach mark shows once more. */
  resetTips: () => void

  /**
   * Cloud sync (src/online/sync.ts): a game downloaded from the account's cloud saves, put in its slot through
   * `normaliseGame`. 'park' files it in the parked slot and never touches the active game; 'replace' swaps the
   * slot's game (the active one only after its leagues load, and never during a live match). Resolves false when
   * nothing was applied.
   */
  importCloudGame: (slot: string, game: Game, mode: 'park' | 'replace') => Promise<boolean>
  /** Cloud sync: the hot-seat head-to-head from the cloud ('park' only fills an empty slot). */
  importCloudH2H: (h2h: H2HGame, mode: 'park' | 'replace') => boolean
  /** Cloud sync: the merged profile and shortlist. */
  applyCloudProfile: (profile: Profile, shortlist: string[]) => void
}

const defaultProfile: Profile = {
  achievements: {},
  leaderboard: [],
  dailyStreak: 0,
  lastDailyDate: null,
  dailyResults: {},
  gamesPlayed: 0,
  seasonsSimulated: 0,
  theme: 'auto',
  managerName: '',
  cabinet: emptyCabinet(),
}

/** Consecutive refused writes; the toast shows on the first and then every twentieth. */
let failedWrites = 0

/** The save's storage: compressed, coalesced writes; a full storage shows a toast and the game carries on. */
export const saveStorage = createSaveStorage<Store>({
  storage: () => (typeof localStorage === 'undefined' ? undefined : localStorage),
  delayMs: SAVE_DELAY_MS,
  // The coalesced writes compress in a worker, off the tap that changed the game (none in the tests: on the page)
  encoder: workerSaveEncoder(),
  onWrite: () => {
    failedWrites = 0
    if (useStore.getState().saveFailing) useStore.setState({ saveFailing: false })
  },
  onError: (e, quota) => {
    if (!quota) {
      console.warn('Could not save', e)
      return
    }
    failedWrites++
    // The banner stays while writes fail; the toast says why, on the first refusal and every twentieth
    if (!useStore.getState().saveFailing) useStore.setState({ saveFailing: true })
    if (failedWrites === 1 || failedWrites % 20 === 0) useStore.setState({ toast: SAVE_FULL_TOAST })
  },
})

type Persisted = ReturnType<typeof persistedOf>
let lastPersisted: { from: unknown[]; out: Persisted } | null = null

/**
 * What is saved: the games (compacted), the head-to-head, the shortlist, the profile and the screen. The same object
 * while none of those has changed, so an update to the transient state (a toast, the match view) is not written
 * again (the storage skips a state it was just given).
 */
export function persistedState(s: Pick<Store, 'game' | 'parked' | 'shortlist' | 'h2h' | 'profile' | 'screen'>): Persisted {
  const from = [s.game, s.parked, s.shortlist, s.h2h, s.profile, s.screen === 'game' || s.screen === 'h2h' ? s.screen : 'home']
  if (lastPersisted && lastPersisted.from.every((x, i) => x === from[i])) return lastPersisted.out
  const out = persistedOf(s)
  lastPersisted = { from, out }
  return out
}

/** A parked game's compacted form, by the (frozen) game: a parked game is compacted once, not on every write. */
const compactedParked = new WeakMap<Game, Game>()

function persistedOf(s: Pick<Store, 'game' | 'parked' | 'shortlist' | 'h2h' | 'profile' | 'screen'>) {
  const parked: Record<string, Game> = {}
  for (const [slot, g] of Object.entries(s.parked)) {
    let c = compactedParked.get(g)
    if (!c) compactedParked.set(g, (c = compactGame(g)))
    parked[slot] = c
  }
  return { game: s.game ? compactGame(s.game) : null, parked, shortlist: s.shortlist, h2h: s.h2h, profile: s.profile, screen: s.screen === 'game' || s.screen === 'h2h' ? s.screen : 'home' }
}

/**
 * The office's tick (`officeTick` in `src/game/logic/office.ts`), registered when its module loads (the Dugout's chunk,
 * or on demand the first time a game with office state is changed), so the office stays out of the first download.
 * Until then nothing ticks, and the first tick after it loads catches up: every part of it is idempotent.
 */
let officeHook: OfficeTick | null = null
let officeLoading = false
export function registerOfficeTick(fn: OfficeTick): void {
  officeHook = fn
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** Run a mutation on the current game with the loaded universe. */
      /** The office's tick when it is loaded; a game that uses the office loads it and catches up once it has. */
      const tickOffice: OfficeTick = (g, u, sim) => {
        if (officeHook) return officeHook(g, u, sim)
        if ((g.office || g.settings.playerPower) && !officeLoading) {
          officeLoading = true
          void import('./logic/office').then((m) => {
            officeHook = m.officeTick
            mutate(() => {})
          })
        }
      }
      const mutate = (fn: (game: Game, u: LoadedUniverse) => void) => {
        const { game, universe } = get()
        if (!game || !universe) return
        try {
          set({
            game: produce(game, (g) => {
              fn(g, universe)
              // The office catches up after every action (a no-op for a game that never used it)
              tickOffice(g, universe)
            }),
          })
        } catch (e) {
          console.error(e)
          set({ toast: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` })
        }
      }
      /**
       * A stepped game action (`fn`'s generator) run on a draft of `g0` held across tasks: the page gets a task whenever a
       * slice passes `sliceMs`. The same steps in the same order as running them in one produce, so the same game.
       * 'moved' when the game or the universe changed meanwhile (the draft is let go), 'failed' on an error (toasted).
       */
      const sliced = async <T,>(g0: Game, u0: LoadedUniverse, fn: (box: GameBox) => Generator<WeekStep, T, undefined>, sliceMs: number): Promise<{ next: Game; value: T } | 'moved' | 'failed'> => {
        try {
          const box: GameBox = { g: createDraft(g0) }
          const steps = fn(box)
          let slice = performance.now()
          for (;;) {
            const r = steps.next()
            if (r.done) {
              tickOffice(box.g, u0)
              return { next: finishDraft(box.g), value: r.value }
            }
            // A week's end: its changes are finished (frozen) now, in this slice, not a whole season's at the end
            if (r.value === rules().WEEK_END) {
              tickOffice(box.g, u0, true)
              box.g = createDraft(finishDraft(box.g))
            }
            if (performance.now() - slice < sliceMs) continue
            await nextTask()
            if (get().game !== g0 || get().universe !== u0) return 'moved'
            slice = performance.now()
          }
        } catch (e) {
          console.error(e)
          set({ toast: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` })
          return 'failed'
        }
      }
      /** After Sim 5 or Sim to end: the "while you were away" digest (none when the run ended the season), the season closed if it did. */
      const afterSimWeeks = (before: ReturnType<typeof digestSnapshot>, extra: Partial<Store> = {}) => {
        // The game simmed in slices comes in `extra` and is set with the rest
        const after = extra.game ?? get().game
        // The season summary covers a run that ended the season, so no digest then
        const digest = before && after && after.phase !== 'summary' ? buildDigest(before, after) : null
        set({ matchView: 'report', digest, ...extra })
        if (after?.phase === 'summary') {
          unlockFromGame()
          get().recordResult()
        }
      }
      /** After Sim to the next big match: where it stopped, the season closed if it ended. */
      const afterSimToStop = (stop: StopReason | null, extra: Partial<Store> = {}) => {
        const after = extra.game ?? get().game
        set({ matchView: 'report', simStop: stop && after?.season ? { stop, gameId: after.id, year: after.year, matchweek: after.season.matchweek } : null, ...extra })
        if (after?.phase === 'summary') {
          unlockFromGame()
          get().recordResult()
        }
      }
      /** A power-up on the draft: only while drafting; a refusal (used, not possible now) is a toast and changes nothing. */
      const powerUp = (fn: (game: Game, u: LoadedUniverse) => void) =>
        mutate((g, u) => {
          if (!g.draft || g.phase !== 'draft') return
          try {
            fn(g, u)
          } catch (e) {
            set({ toast: e instanceof Error ? e.message : String(e) })
          }
        })
      /**
       * A window drawn by an earlier engine (a season kicked off before a release): draw it again on this one, with the
       * reason, before anything plays the season again. True when it did.
       */
      const redrawStaleJanuary = (): boolean => {
        const { game, universe } = get()
        if (!game || !universe || !januaryStale(game, universe)) return false
        mutate((g, u) => reopenJanuary(g, u))
        set({ toast: rules().JANUARY_REDRAWN_NOTE })
        return true
      }
      /** Close the January window with `fn` and carry on as the store always has: the playback from the second half, the result recorded. */
      const closeWindow = (fn: (game: Game, u: LoadedUniverse) => void) => {
        const before = get().game
        if (before?.phase !== 'january' || !before.quickJanuary) return
        if (redrawStaleJanuary()) return
        const from = before.quickJanuary.firstHalf.length
        mutate(fn)
        afterWindow(from)
      }
      /** The same close with the season replayed in the quick-season worker; `plain` plays it on the page instead. */
      const closeWindowSoon = async (job: (game: Game) => JanuaryJob, plain: () => void) => {
        const { game: before, universe: u0 } = get()
        if (before?.phase !== 'january' || !before.quickJanuary || !u0 || get().closingJanuary) return
        const from = before.quickJanuary.firstHalf.length
        set({ closingJanuary: true })
        try {
          await afterNextPaint()
          const same = () => get().game === before && get().universe === u0
          const played = same() ? await runQuickInWorker(job(before), get().loadedLeagues, get().classicLoaded, u0) : null
          // No worker, an error (a refused deal), or the game moved meanwhile: the page closes it, on the game as it is now
          if (!played || !same()) return plain()
          set({ game: freeze(played, true) })
          afterWindow(from)
        } finally {
          set({ closingJanuary: false })
          if (!warmHeld) stopQuickWorker()
        }
      }
      const afterWindow = (from: number) => {
        if (get().game?.phase === 'january') {
          // The deal did not replay (the league data changed since the window opened): draw the window again rather than stay stuck
          mutate((g, u) => reopenJanuary(g, u))
          set({ toast: 'The league data changed since the window opened, so the first half and the window were drawn again.' })
          return
        }
        if (get().game?.phase === 'summary') {
          markQuickSeasonFresh(get().game!)
          set({ playback: { from } })
          if (get().game?.quickOpen) return
          unlockFromGame()
          get().recordResult()
        }
      }
      /** How many screens hold the quick-season worker warm (`warmKickOff`): while any does, a finished job keeps it. */
      let warmHeld = 0
      /** A `simWeeksSoon` or `simToNextBigMatchSoon` is under way (the Dugout's own busy flag resets if it remounts). */
      let simRunning = false
      /** League loads run one after another so two callers never overwrite each other's universe. */
      let pendingLoad: Promise<unknown> = Promise.resolve()
      /**
       * A quick season with a bench is held open while its playback runs; leaving it for another game (or abandoning it)
       * closes it and records it first, so a season that was played never goes missing from the record.
       */
      /** A failed load of the rules chunk (offline before it was cached): said once, nothing changed. */
      const rulesFailed = () => set({ toast: 'Could not load the game: check your connection and try again.' })
      /**
       * An action Home can reach before the rules chunk is in (start, abandon, resume) and that needs it now: true when
       * it had to wait, the action then run again once the chunk has loaded (`again`). Settling a finished quick season
       * needs it; nothing else these actions do does.
       */
      const waitForRules = (again: () => void, need = false): boolean => {
        if (rulesReady()) return false
        const { game } = get()
        if (!need && !(game?.quickOpen && game.phase === 'summary')) return false
        loadRules().then(again, rulesFailed)
        return true
      }
      const settleQuickSeason = () => {
        const { game } = get()
        if (!game?.quickOpen || game.phase !== 'summary') return
        set({
          game: produce(game, (g) => {
            closeQuickSeason(g)
          }),
        })
        unlockFromGame()
        get().recordResult()
      }
      /** After a kick-off: the playback from the first game, and a season with no bench recorded at once. */
      const afterKickOff = () => {
        const { game } = get()
        if (game) markQuickSeasonFresh(game)
        if (game?.phase === 'january' || game?.phase === 'summary') set({ playback: { from: 0 } })
        // A season with a bench stays open to changes until the playback closes, and is recorded then
        if (game?.phase === 'summary' && !game.quickOpen) {
          unlockFromGame()
          get().recordResult()
        }
      }
      const unlockFromGame = () => {
        const { game, profile } = get()
        if (!game) return
        const achievements = { ...profile.achievements }
        let changed = false
        for (const id of game.unlocked) {
          if (ACHIEVEMENTS.some((a) => a.id === id) && !achievements[id]) {
            achievements[id] = new Date().toISOString().slice(0, 10)
            changed = true
          }
        }
        if (changed) set({ profile: { ...profile, achievements } })
      }
      return {
        universe: null,
        loading: false,
        loadError: null,
        loadedLeagues: [],
        loadingLeagues: false,
        failedLeagues: [],
        classicFailed: false,
        saveFailing: false,
        classicLoaded: false,
        screen: 'home',
        setupMode: 'quick',
        arenaSetupFormat: 'cup',
        game: null,
        parked: {},
        shortlist: [],
        h2h: null,
        profile: defaultProfile,
        toast: null,
        saveIssue: null,
        offseason: null,
        digest: null,
        // Every action that opens a match sets its view; a page that loads on a finished match (a reload) opens on its report, the replay a tab away (QA r16, R16-1)
        matchView: 'report',
        simStop: null,
        liveAuto: false,
        pendingChallenge: null,
        playback: null,
        playingWeek: false,
        kickingOff: false,
        closingJanuary: false,
        changingBench: false,

        loadData: async () => {
          if (get().universe || get().loading) return
          set({ loading: true, loadError: null })
          try {
            // The default league must load; whatever the saved game or head-to-head needs on top is best effort.
            // The classic seasons load only when the saved game opted into them (packs.ts): never on a plain start
            const { game, h2h } = get()
            const base = await loadPacks([DEFAULT_LEAGUE], false)
            const gameNeeds = game ? leaguesFor(game, base.available.map((l) => l.id)) : []
            const h2hNeeds = h2h ? [h2h.leagueId ?? DEFAULT_LEAGUE, ...(h2h.wheelLeagues ?? [])] : []
            const extra = [...new Set([...gameNeeds, ...h2hNeeds])].filter((id) => id !== DEFAULT_LEAGUE)
            const results = await Promise.allSettled(extra.map((id) => loadLeague(id, false)))
            const failed = extra.filter((_, i) => results[i].status === 'rejected')
            const ids = [DEFAULT_LEAGUE, ...extra.filter((id) => !failed.includes(id))]
            const wantClassic = (!!game && needsClassic(game)) || h2hNeedsClassic(h2h)
            let u = base
            let classic = false
            if (wantClassic) {
              try {
                u = await loadPacks(ids, true)
                classic = true
              } catch {
                // Parked below, like a game whose league did not load
              }
            }
            if (!classic && ids.length > 1) u = await loadPacks(ids, false)
            const classicFailed = wantClassic && !classic
            const next: Partial<Store> = { universe: u, loading: false, loadedLeagues: ids, classicLoaded: classic, failedLeagues: nextFailed(get().failedLeagues, failed, false), classicFailed }
            if (failed.length || classicFailed) {
              const names = [...failed.map((id) => base.available.find((l) => l.id === id)?.name ?? id), ...(classicFailed ? ['the classic seasons'] : [])].join(', ')
              next.toast = `Could not load ${names}. Check your connection and reload to get it back.`
              // Never render a game against a half-loaded universe: park it until its leagues load
              if (game && ((classicFailed && needsClassic(game)) || gameNeeds.some((id) => failed.includes(id)))) {
                next.game = null
                next.parked = { ...get().parked, [slotOf(game)]: game }
                if (get().screen === 'game') next.screen = 'home'
              }
              // A classic head-to-head whose classic pack did not load is kept: its screen waits for the pack with a Retry
              if (h2h && h2hNeeds.some((id) => failed.includes(id))) {
                next.h2h = null
                if (get().screen === 'h2h') next.screen = 'home'
              }
            }
            set(next)
            // Fetch the classic packs (no parsing) once the start is over, so the service worker has them for an offline Classic draft
            if (!classic && typeof window !== 'undefined') window.setTimeout(() => warmClassicPacks(ids, u.available), 8000)
          } catch (e) {
            set({ loading: false, loadError: e instanceof Error ? e.message : String(e) })
          }
        },
        ensureLeagues: (ids, classic) => {
          const run = async (): Promise<boolean> => {
            const withClassic = get().classicLoaded || !!classic
            const missing = ids.filter((id) => !get().loadedLeagues.includes(id))
            if (!missing.length && withClassic === get().classicLoaded) return true
            set({ loadingLeagues: true })
            try {
              const all = [...new Set([...get().loadedLeagues, ...missing])]
              const u = await loadPacks(all, withClassic)
              set({ universe: u, loadedLeagues: all, loadingLeagues: false, classicLoaded: withClassic, failedLeagues: nextFailed(get().failedLeagues, all, true), ...(withClassic ? { classicFailed: false } : {}) })
              return true
            } catch (e) {
              set({ loadingLeagues: false, failedLeagues: nextFailed(get().failedLeagues, missing, false), ...(withClassic && !get().classicLoaded ? { classicFailed: true } : {}), toast: `Could not load league data: ${e instanceof Error ? e.message : String(e)}` })
              return false
            }
          }
          const result = pendingLoad.then(run, run)
          pendingLoad = result.catch(() => undefined)
          return result
        },
        ensureClassic: (quiet) => {
          if (get().classicLoaded) return Promise.resolve(true)
          if (!quiet) return get().ensureLeagues(get().loadedLeagues, true)
          // A screen that only shows them: no toast, and the other screens' Start buttons do not wait on it
          const run = async (): Promise<boolean> => {
            if (get().classicLoaded) return true
            const all = get().loadedLeagues
            try {
              const u = await loadPacks(all, true)
              // A league added meanwhile keeps its place: merge again over what is loaded now
              if (get().loadedLeagues.join() !== all.join()) return false
              set({ universe: u, classicLoaded: true, classicFailed: false })
              return true
            } catch {
              set({ classicFailed: true })
              return false
            }
          }
          const result = pendingLoad.then(run, run)
          pendingLoad = result.catch(() => undefined)
          return result
        },
        // Any navigation drops a challenge waiting on the Setup screen, so a later Quick Draft starts clean
        go: (screen, mode) => set({ screen, pendingChallenge: null, ...(mode ? { setupMode: mode } : {}) }),
        openArenaSetup: (format) => set({ screen: 'setup', setupMode: 'arena', arenaSetupFormat: format, pendingChallenge: null }),
        showToast: (text) => set({ toast: text }),
        openChallenge: async (encoded) => {
          // Reading and replaying a challenge is the rules chunk's work (a link can open before it has loaded)
          try {
            await loadRules()
          } catch {
            rulesFailed()
            return false
          }
          let payload: ChallengePayload
          try {
            payload = decodeChallenge(encoded)
          } catch (e) {
            set({ toast: e instanceof Error ? e.message : String(e) })
            return false
          }

          const known = (get().universe?.available ?? []).map((l) => l.id)
          // An arena field drawn from every league (the champions, the giants, Europe) needs every pack, as its setup does
          const arena = isArenaPayload(payload) ? payload : null
          // So does a quick challenger who played the Continental Cup or the Super League, for the replay to check it
          const everyLeague = arena ? arena.arena.f === 'cup' && arenaNeedsAllLeagues({ arena: { format: 'cup', field: arena.arena.fd } }) : !!(payload.c?.eu || payload.s.r.superLeague)
          const needs = [...new Set([payload.s.l, ...payload.s.wl, ...(everyLeague ? known : [])])]
          const unknown = needs.filter((id) => !known.includes(id))
          if (unknown.length) {
            set({ toast: `This challenge needs a league this build does not have (${unknown.join(', ')}).` })
            return false
          }
          if (!(await get().ensureLeagues(needs, !arena && !!payload.s.r.classic))) return false
          const u = get().universe
          if (!u) return false
          // The host must have played that league season, or the quick season would run against the wrong clubs
          const host = u.clubSeasonByKey[`${payload.s.h}@${payload.s.ls}`]
          if (!host || host.leagueId !== payload.s.l) {
            set({ toast: `This challenge names a club season this build does not have (${payload.s.h} ${payload.s.ls}).` })
            return false
          }
          const outcome = replayChallenge(u, payload)
          set({ pendingChallenge: { payload, challenge: challengeSettings(payload, outcome) }, screen: 'setup', setupMode: arena ? 'arena' : 'quick' })
          return true
        },

        startGame: (settings) => {
          if (waitForRules(() => get().startGame(settings), settings.mode === 'runin')) return
          settleQuickSeason()
          const game = createGame(settings)
          // The Run-in inherits a real squad: the draft opens seeded with it and four spins to make
          const u = get().universe
          if (settings.mode === 'runin' && u) seedRunInDraft(game, u)
          const { game: current, parked } = get()
          const next = { ...parked }
          // Park a game of a different kind rather than losing it; a finished one is dropped.
          if (current && slotOf(current) !== slotOf(game) && current.phase !== 'summary') next[slotOf(current)] = current
          delete next[slotOf(game)]
          set({ game, parked: next, screen: 'game', liveAuto: false, pendingChallenge: null, digest: null, playback: null, profile: { ...get().profile, gamesPlayed: get().profile.gamesPlayed + 1 } })
        },
        abandonGame: () => {
          if (waitForRules(() => get().abandonGame())) return
          settleQuickSeason()
          set({ game: null, screen: 'home', offseason: null, digest: null, playback: null })
        },
        startWeekly: async (seed, teamName) => {
          const u0 = get().universe
          if (!u0) return false
          const plan = weeklyPlan(u0, seed)
          if (!(await get().ensureLeagues([...new Set([plan.leagueId, ...plan.wheelLeagues])]))) return false
          const u = get().universe
          const settings = u ? weeklyGameSettings(u, seed, teamName) : null
          if (!settings) return false
          get().startGame(settings)
          return true
        },
        startRunInWeek: async (seed) => {
          // The Run-in of the week's mapping loads on demand, out of the first download (only this action needs it here)
          const [{ weeklyRunInPlan, weeklyRunInSettings }] = await Promise.all([import('./logic/runinWeekly'), loadRules()])
          const plan = weeklyRunInPlan(seed)
          if (!plan || !(await get().ensureLeagues([plan.leagueId]))) return false
          const u = get().universe
          const settings = u ? weeklyRunInSettings(u, seed) : null
          if (!settings) return false
          get().startGame(settings)
          return true
        },
        resumeGame: (slot) => {
          if (waitForRules(() => get().resumeGame(slot))) return
          settleQuickSeason()
          const target = get().parked[slot]
          if (!target) return
          const ids = leaguesFor(target, (get().universe?.available ?? []).map((l) => l.id))
          // Load what the game needs before showing it, so the squad is never rendered against a half-loaded universe
          void get()
            .ensureLeagues(ids, needsClassic(target))
            .then((ok) => {
              // The games as they are now: one started (or resumed) while the leagues loaded is parked, never dropped
              const { game: current, parked } = get()
              if (!ok || parked[slot] !== target) return
              const next = { ...parked }
              delete next[slot]
              if (current && current.phase !== 'summary') next[slotOf(current)] = current
              // The assistant takes a resumed match's stops only under its own Auto-play, never because the last game had him on
              set({ game: target, parked: next, screen: 'game', digest: null, playback: null, liveAuto: assistantTakesStops(target) })
            })
        },
        discardParked: (slot) => {
          const next = { ...get().parked }
          delete next[slot]
          set({ parked: next })
        },

        chooseSlot: (slotId) =>
          mutate((g, u) => {
            if (!g.draft) return
            try {
              draftChooseSlot(u, g.draft, slotId)
            } catch (e) {
              set({ toast: e instanceof Error ? e.message : String(e) })
            }
          }),
        spin: () =>
          mutate((g, u) => {
            if (!g.draft || g.draft.current) return
            if (positionFirst(g.draft) && !targetSlot(g.draft)) {
              set({ toast: 'Choose a slot on the pitch first.' })
              return
            }
            if (!canSpin(u, g.draft)) {
              set({ toast: `The wheel has run dry for ${u.nations[g.draft.rules.onlyNation ?? '']?.name ?? 'this draft'}.` })
              return
            }
            const rng = Rng.fromState(g.rngState)
            draftSpin(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        respin: () =>
          mutate((g, u) => {
            if (!g.draft || g.draft.respinsLeft <= 0) return
            const rng = Rng.fromState(g.rngState)
            draftRespin(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        pickPlayer: (id, slot) =>
          mutate((g, u) => {
            if (!g.draft) return
            try {
              draftPick(u, g.draft, id, slot)
            } catch (e) {
              set({ toast: e instanceof Error ? e.message : String(e) })
            }
          }),
        autoDraftRest: () =>
          mutate((g, u) => {
            if (!g.draft) return
            const rng = Rng.fromState(g.rngState)
            // A pending spin is discarded with its twist, but it consumed the RNG, so it stays in the history
            // as a skipped row (a challenge replay needs every spin) and the assistant's first `canSpin` sees the plain wheel
            // Position First keeps the slot being filled, so the assistant fills it next and a replay can set it again
            if (g.draft.current) g.draft.history.push({ ...g.draft.current, pickedId: null, slotId: null, skipped: true, ...(g.draft.twist ? { twist: g.draft.twist } : {}), ...(targetSlot(g.draft) ? { target: targetSlot(g.draft)!.id } : {}) })
            g.draft.current = null
            g.draft.twist = null
            // The lookup sees a Dynasty summer's own players (their keepers count towards the squad's limits). The engine
            // runs on a plain copy of the draft, put back after: its pool scans read the draft thousands of times, and
            // through Immer's proxies Auto-complete took about 2 s on a 4x-throttled phone (the same functions on the same
            // data, so the same draft)
            const d = plainCopy(g.draft)
            autoDraft(u, d, rng, playerLookup(g, u))
            g.draft = d
            g.rngState = rng.getState()
          }),
        upgradePlayer: (id, boost) =>
          mutate((g, u) => {
            if (!g.draft || g.phase !== 'draft') return
            try {
              draftUpgrade(u, g.draft, id, boost)
            } catch (e) {
              set({ toast: e instanceof Error ? e.message : String(e) })
            }
          }),
        rerollSeason: () => powerUp((g, u) => void draftReroll(u, g.draft!)),
        peekSpin: () => powerUp((g, u) => void draftPeek(u, g.draft!, g.rngState)),
        swapSlots: (from, to) => powerUp((g, u) => draftSwap(u, g.draft!, from, to)),
        giveArmband: (id) => powerUp((g) => draftArmband(g.draft!, id)),
        lockPlayer: (id) => powerUp((g) => draftLock(g.draft!, id)),
        speedrunPick: () =>
          mutate((g, u) => {
            if (!g.draft) return
            const rng = Rng.fromState(g.rngState)
            assistantTurn(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        finishDraft: () => {
          mutate((g, u) => {
            if (!g.draft) return
            // A Quick Draft with a bench may close once the XI is full, bench places to spare
            if (canCloseBench(g.draft)) closeBench(g.draft)
            // A one-nation wheel that has run dry may close with a full XI short of the squad size (never with an XI
            // slot open: bench picks once counted towards eleven, and a quick season kicked off with a striker in goal)
            if (!isComplete(g.draft) && !(!fillingXI(g.draft) && !canSpin(u, g.draft))) return
            if (g.settings.mode === 'arena') beginArena(g, u)
            else if (g.settings.mode === 'runin') beginRunIn(g, u)
            // Quick Draft, the Daily and the Weekly stop at the tactics step before the season
            else if (isQuickLike(g.settings.mode)) toKickoff(g, u)
            else {
              beginSeason(g, u)
              // A Dynasty summer's Inbox opens with the contracts that ran out
              if (g.settings.mode === 'dynasty') postRenewals(g, u)
            }
          })
          const { game } = get()
          if (game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        pickManager: (id) => mutate((g, u) => pickManager(g, u, id)),
        unpackPowerUp: (kind) => {
          const { game, profile } = get()
          if (!game || !canUnpackFromLocker(game, profile, kind)) return
          mutate((g) => unpackFromLocker(g, kind))
          set({ profile: takeFromLocker(get().profile, kind) })
        },
        openCase: () => {
          const out: { drop: PowerUp | null } = { drop: null }
          mutate((g) => {
            out.drop = openEndCase(g)
          })
          if (out.drop) set({ profile: addToLocker(get().profile, out.drop) })
        },
        subCaseIcon: (slotId) => mutate((g, u) => subCaseIcon(g, u, slotId)),
        finishCase: () => mutate((g) => finishEndCase(g)),
        kickOff: (skip) => {
          const before = get().game
          // The manager spin and the case come first: the season waits for both
          if (before?.phase !== 'kickoff' || kickoffStep(before) !== 'tactics') return
          mutate((g, u) => kickOff(g, u, skip))
          afterKickOff()
        },
        kickOffSoon: async (skip) => {
          const { game: before, universe: u0, kickingOff } = get()
          if (before?.phase !== 'kickoff' || kickoffStep(before) !== 'tactics' || !u0 || kickingOff) return
          set({ kickingOff: true })
          try {
            await afterNextPaint()
            const same = () => get().game === before && get().universe === u0
            const played = same() ? await runQuickInWorker({ op: 'kickOff', game: before, skip: !!skip }, get().loadedLeagues, get().classicLoaded, u0) : null
            // No worker, or the game moved meanwhile: the page plays it, on the game as it is now
            if (!played || !same()) return get().kickOff(skip)
            set({ game: freeze(played, true) })
            afterKickOff()
          } finally {
            set({ kickingOff: false })
            if (!warmHeld) stopQuickWorker()
          }
        },
        warmKickOff: () => {
          warmQuickWorker(get().loadedLeagues, get().classicLoaded)
          warmHeld++
          let held = true
          return () => {
            if (held) warmHeld--
            held = false
            if (!warmHeld && !get().kickingOff && !get().closingJanuary && !get().changingBench) stopQuickWorker()
          }
        },
        januarySpin: () => {
          if (redrawStaleJanuary()) return
          mutate((g, u) => {
            try {
              rollJanuarySpin(g, u)
            } catch (e) {
              set({ toast: e instanceof Error ? e.message : String(e) })
            }
          })
        },
        januaryUpgrade: (id, boost) => {
          if (redrawStaleJanuary()) return
          mutate((g, u) => {
            try {
              rollJanuaryUpgrade(g, u, id, boost)
            } catch (e) {
              set({ toast: e instanceof Error ? e.message : String(e) })
            }
          })
        },
        closeJanuarySpin: (slotId) => {
          const { game, universe } = get()
          if (!game || !universe) return
          // A slot he cannot take is a toast, never a failed close (which would draw the window again)
          if (slotId !== null && !openSpinChoices(game, universe).some((c) => c.slotId === slotId)) {
            set({ toast: 'He cannot play there' })
            return
          }
          closeWindow((g, u) => closeJanuarySpin(g, u, slotId))
        },
        closeJanuary: (index) => {
          if (index !== null && januaryGambleMade(get().game?.quickJanuary)) {
            set({ toast: "The window's deal is made" })
            return
          }
          closeWindow((g, u) => closeJanuary(g, u, index))
        },
        closeJanuarySoon: async (index) => {
          if (index !== null && januaryGambleMade(get().game?.quickJanuary)) {
            set({ toast: "The window's deal is made" })
            return
          }
          await closeWindowSoon((game) => ({ op: 'closeJanuary', game, index }), () => get().closeJanuary(index))
        },
        closeJanuarySpinSoon: async (slotId) => {
          const { game, universe } = get()
          if (!game || !universe) return
          if (slotId !== null && !openSpinChoices(game, universe).some((c) => c.slotId === slotId)) {
            set({ toast: 'He cannot play there' })
            return
          }
          await closeWindowSoon((g) => ({ op: 'closeJanuarySpin', game: g, slotId }), () => get().closeJanuarySpin(slotId))
        },
        endPlayback: () => {
          settleQuickSeason()
          set({ playback: null })
        },
        benchChange: (revealed, slotId, inId) => {
          const { game, universe } = get()
          if (!game || !universe) return
          const results = playbackResults(game)
          const problem = quickChangeProblem(game, universe, results, revealed, { slotId, inId })
          if (problem) {
            set({ toast: problem })
            return
          }
          // A change plays the season again: on one an earlier engine played, that would rewrite the games already shown
          if (game.phase === 'january' ? redrawStaleJanuary() : quickSeasonStale(game, universe)) {
            if (game.phase !== 'january') set({ toast: rules().CHANGES_CLOSED_NOTE })
            return
          }
          mutate((g, u) => makeQuickChange(g, u, results, revealed, slotId, inId))
          // Just played by this engine: the next change's staleness check need not play it again
          const after = get().game
          if (after && after !== game) markQuickSeasonFresh(after)
        },
        benchChangeSoon: async (revealed, slotId, inId) => {
          const { game: before, universe: u0 } = get()
          if (!before || !u0 || get().changingBench) return
          // A refused change is the plain action's toast; nothing to play
          if (quickChangeProblem(before, u0, playbackResults(before), revealed, { slotId, inId })) return get().benchChange(revealed, slotId, inId)
          set({ changingBench: true })
          try {
            await afterNextPaint()
            const same = () => get().game === before && get().universe === u0
            const job = { op: 'quickChange' as const, game: before, revealed, slotId, inId, check: !quickSeasonKnownFresh(before) }
            const played = same() ? await runQuickInWorker(job, get().loadedLeagues, get().classicLoaded, u0) : null
            // No worker, a stale season (the plain action says so), or the game moved meanwhile: the page makes the change
            if (!played || !same()) return get().benchChange(revealed, slotId, inId)
            set({ game: freeze(played, true) })
            markQuickSeasonFresh(get().game!)
          } finally {
            set({ changingBench: false })
            if (!warmHeld) stopQuickWorker()
          }
        },

        playCup: async (comp) => {
          const { game, universe } = get()
          if (!game || !universe) return false
          // The Continental Cup's field comes from every other league that season
          if (comp === 'continental' && !(await get().ensureLeagues(universe.available.map((l) => l.id)))) return false
          const u = get().universe
          const before = get().game
          if (!u || !before?.quickResult) return false
          const problem = quickCupProblem(before, u, comp)
          if (problem) {
            set({ toast: problem })
            return false
          }
          mutate((g, uu) => playQuickCup(g, uu, comp))
          const after = get().game?.quickResult
          if (!after || after === before.quickResult) return false
          const profile = get().profile
          // The Trophy Room's cabinet takes the cup (and a Treble or Double on the honours board), `trophies` mirrors its five counts for older builds
          const cab = normaliseCabinet(profile.cabinet ?? rebuildCabinet(profile))
          const credited = withFeats(creditCupRun(cab, before.quickResult, get().game!, comp, new Date().toISOString().slice(0, 10)), profile)
          // The r8 feats: the cup's group stage and two-legged comebacks, once per season and cup
          const cabinet = { ...credited, feats: creditCupFeats(credited.feats, get().game!, comp) }
          set({ profile: { ...profile, cabinet, trophies: trophiesOf(cabinet) } })
          unlockFromGame()
          return true
        },
        skipCup: async (comp) => {
          const first = get()
          if (!first.game || !first.universe) return
          // The Continental Cup is offered before the other leagues are in (Play loads them): Skip loads them too, or it only toasts
          const load = leaguesBeforeSkip(first.game, first.universe, comp)
          if (load.length && !(await get().ensureLeagues(load))) return
          const { game, universe } = get()
          if (!game || !universe) return
          // A cup on offer can be passed even when its field is not loaded yet (passQuickCup); otherwise say why not
          if (quickCupStatus(game, universe, comp).state === 'open') {
            mutate((g, u) => void passQuickCup(g, u, comp))
            return
          }
          const problem = quickCupProblem(game, universe, comp)
          if (problem) {
            set({ toast: problem })
            return
          }
          mutate((g, u) => skipQuickCup(g, u, comp))
        },

        playFriendly: () => {
          mutate((g, u) => playFriendly(g, u))
          set({ matchView: 'ticker', liveAuto: false })
        },
        advanceLive: (opts, hold = false) => {
          mutate((g, u) => {
            const fit = availableStopChanges(g, opts)
            if (g.arena) advanceArenaMatch(g, u, fit, hold)
            else advanceLiveMatch(g, u, fit, false, hold)
          })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        interveneLive: (change) => {
          let out: InPlayOutcome | null = null
          mutate((g, u) => {
            out = g.arena ? changeArenaMatch(g, u, change) : changeLiveMatch(g, u, change)
          })
          return out
        },
        completeLive: () => {
          mutate((g, u) => (g.arena ? completeArenaMatch(g, u) : completeLiveMatch(g, u)))
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        startSeason: () => mutate((g, u) => startSeasonProper(g, u)),
        assistantAdvance: (hold = false) => {
          mutate((g, u) => advanceWithAssistant(g, u, hold))
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        finishLiveNow: (changes) => {
          mutate((g, u) => finishWithAssistant(g, u, availableStopChanges(g, changes)))
          set({ matchView: 'report' })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        setLiveAuto: (on) => set({ liveAuto: on }),
        nextLiveMatch: () => set({ liveAuto: assistantTakesStops(get().game), matchView: 'ticker' }),
        setMatchPlay: (mode) => mutate((g) => void (g.settings.matchPlay = mode)),
        playWeek: () => {
          const g0 = get().game
          const mode = g0 ? matchPlayOf(g0) : 'watch'
          mutate((g, u) => {
            if (g.phase === 'preseason') startSeasonProper(g, u)
            playMatchweekAs(g, u, mode)
          })
          set({ matchView: mode === 'sim' ? 'report' : 'ticker', liveAuto: mode === 'auto' })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        playWeekSoon: async (prepare, opts) => {
          const { game: g0, universe: u0, playingWeek } = get()
          if (!g0 || !u0 || playingWeek) return
          const mode = matchPlayOf(g0)
          set({ playingWeek: true })
          try {
            await afterNextPaint()
            // Anything that moved the game meanwhile makes this an ordinary tap on the game as it is now
            const moved = () => get().game !== g0 || get().universe !== u0
            if (moved()) return get().playWeek()
            // The same recipe as playWeek's produce, on a draft held across tasks: a step at a time (the week's set-up,
            // each fixture, each stop of a Sim result); the draft is let go for playWeek on the game as it is now
            // if anything moved it meanwhile
            const out = await sliced(g0, u0, (box) => playWeekSteps(box.g, u0, mode), opts?.sliceMs ?? WEEK_SLICE_MS)
            if (out === 'moved') return get().playWeek()
            if (out === 'failed') return
            const next = out.next
            await nextTask()
            if (prepare) {
              try {
                await prepare(next)
              } catch (e) {
                console.error(e)
              }
              await nextTask()
            }
            if (moved()) return get().playWeek()
            // One update for the game and the view: the screen that shows the week renders once
            set({ game: next, matchView: mode === 'sim' ? 'report' : 'ticker', liveAuto: mode === 'auto', playingWeek: false })
            if (get().game?.phase === 'summary') {
              unlockFromGame()
              get().recordResult()
            }
          } finally {
            if (get().playingWeek) set({ playingWeek: false })
          }
        },
        simWeeks: (n) => {
          // Plain numbers from the saved game, read before the mutation so the digest compares before with after
          const before = digestSnapshot(get().game)
          mutate((g, u) => {
            const box = { g }
            runSteps(withTick(box, u, simWeeksSteps(box, u, n), tickOffice))
          })
          afterSimWeeks(before)
        },
        simWeeksSoon: async (n, opts) => {
          const { game: g0, universe: u0 } = get()
          // One run at a time: a second tap would see the first's game as 'moved' and sim n weeks more
          if (!g0 || !u0 || simRunning) return
          simRunning = true
          try {
            const out = await sliced(g0, u0, (box) => simWeeksSteps(box, u0, n), opts?.sliceMs ?? WEEK_SLICE_MS)
            if (out === 'moved') return get().simWeeks(n)
            if (out === 'failed') return
            afterSimWeeks(digestSnapshot(g0), { game: out.next })
          } finally {
            simRunning = false
          }
        },
        simToEnd: () => get().simWeeks(40),
        simToNextBigMatch: () => {
          const out: { stop: StopReason | null } = { stop: null }
          mutate((g, u) => {
            const box = { g }
            out.stop = runSteps(withTick(box, u, simToNextStopSteps(box, u), tickOffice))
          })
          afterSimToStop(out.stop)
        },
        simToNextBigMatchSoon: async (opts) => {
          const { game: g0, universe: u0 } = get()
          if (!g0 || !u0 || simRunning) return
          simRunning = true
          try {
            const out = await sliced(g0, u0, (box) => simToNextStopSteps(box, u0), opts?.sliceMs ?? WEEK_SLICE_MS)
            if (out === 'moved') return get().simToNextBigMatch()
            if (out === 'failed') return
            afterSimToStop(out.value, { game: out.next })
          } finally {
            simRunning = false
          }
        },
        closeMatch: () => {
          mutate((g, u) => (g.arena ? closeArenaMatch(g) : closeLiveMatch(g, u)))
          // Leaving the final match of the season closes the season
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        playArenaStep: (live) => {
          mutate((g, u) => {
            playArenaStep(g, u, live)
            if (live && g.live) byHand(g)
          })
          // Managed live, the match opens on its dashboard; simmed, on its report (the result, as Sim result does in a Season), the replay a tab away
          set({ matchView: arenaStepView(live) })
        },
        playArenaStepSoon: async (live, prepare) => {
          const { game: g0, universe: u0, playingWeek } = get()
          if (!g0 || !u0 || playingWeek) return
          set({ playingWeek: true })
          try {
            await afterNextPaint()
            const moved = () => get().game !== g0 || get().universe !== u0
            if (moved()) return get().playArenaStep(live)
            let next: Game
            try {
              next = produce(g0, (g) => {
                playArenaStep(g, u0, live)
                if (live && g.live) byHand(g)
              })
            } catch (e) {
              console.error(e)
              set({ toast: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` })
              return
            }
            // The match screen's first render in a task of its own, after what it would build first
            await nextTask()
            if (prepare) {
              try {
                await prepare(next)
              } catch (e) {
                console.error(e)
              }
              await nextTask()
            }
            if (moved()) return get().playArenaStep(live)
            set({ game: next, matchView: arenaStepView(live), playingWeek: false })
          } finally {
            if (get().playingWeek) set({ playingWeek: false })
          }
        },
        takePenalties: (order, keeperId) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = takePenalties(g, u, order, keeperId)
          })
          if (!out.ok) set({ toast: out.message })
          return out
        },
        changeTheDraw: () => {
          let out = { ok: false, message: 'No game' }
          // A lifeline that would bring the same side back is refused before it is spent (`lifeline.ts`)
          const a = get().game?.arena
          if (a?.format === 'gauntlet' && a.lifelineUsed === undefined && !lifelineChanges(a)) {
            set({ toast: rules().LIFELINE_SAME_NOTE })
            return
          }
          mutate((g, u) => {
            out = changeTheDraw(g, u)
          })
          if (!out.ok) set({ toast: out.message })
        },
        simArenaToEnd: () => {
          mutate((g, u) => simArenaToEnd(g, u))
          set({ matchView: 'report' })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        setMatchView: (v) => set({ matchView: v }),
        dismissDigest: () => set({ digest: null }),
        markNewsSeen: () => {
          const { game } = get()
          // Only when something is unread or the field is missing, so a visit to a read inbox never rewrites the save
          if (!game?.season || (game.newsSeen !== undefined && game.newsSeen >= newsTotal(game))) return
          mutate((g) => void (g.newsSeen = newsTotal(g)))
        },

        setTactics: (t) =>
          mutate((g) => {
            Object.assign(g.tactics, t)
            byHand(g)
          }),
        setRole: (slotId, roleId) =>
          mutate((g) => {
            g.tactics.roles[slotId] = roleId
            byHand(g)
          }),
        setFormation: (id) =>
          mutate((g, u) => {
            setFormation(g, u, id)
            byHand(g)
          }),
        assign: (id, slot) =>
          mutate((g, u) => {
            assignPlayer(g, u, id, slot)
            byHand(g)
          }),
        playInSlot: (id, slot) => {
          const { game, universe } = get()
          if (!game || !universe) return
          // Worded from the lineup as it stands, before the swap runs
          const note = assignmentNote(game, universe, id, slot)
          mutate((g, u) => {
            assignPlayer(g, u, id, slot)
            byHand(g)
          })
          if (note) set({ toast: note })
        },
        autoPick: () => mutate((g, u) => autoPick(g, u, false)),
        restTired: (id) => {
          const out = { n: 0 }
          mutate((g, u) => {
            out.n = restTiredStarters(g, u, id ? [id] : undefined).length
            if (out.n) byHand(g)
          })
          return out.n
        },
        startPromised: () =>
          mutate((g, u) => {
            if (startPromisedMan(g, u)) byHand(g)
          }),
        setTeamTalk: (t) =>
          mutate((g) => {
            g.teamTalk = t
            byHand(g)
          }),
        setTraining: (t) =>
          mutate((g) => {
            // The arena's hub offers the focus too: a change shapes the next match and the recovery, so it is the manager's
            if (g.training !== t) byHand(g)
            g.training = t
          }),
        setCaptain: (id) =>
          mutate((g) => {
            // An empty id takes the armband off
            if (id) g.captainId = id
            else delete g.captainId
            byHand(g)
          }),
        setStatus: (id, status) => mutate((g, u) => setSquadStatus(g, u, id, status)),

        resolveEvent: (choiceId) => mutate((g, u) => applyEventChoice(g, u, choiceId)),
        bid: (listingId, amount, opts) => {
          let out = { accepted: false, message: 'No game' }
          mutate((g, u) => {
            out = bidFor(g, u, listingId, amount, opts)
          })
          unlockFromGame()
          return out
        },
        setMarkTarget: (id) =>
          mutate((g) => {
            g.markTarget = id
            byHand(g)
          }),
        signYouth: (id) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = signYouth(g, u, id)
          })
          return out
        },
        hireStaff: (role, tier) => mutate((g) => void ((g.staff ??= {})[role] = Math.max(0, Math.min(2, Math.round(tier))))),
        toggleShortlist: (id) => {
          const { shortlist } = get()
          set({ shortlist: shortlist.includes(id) ? shortlist.filter((x) => x !== id) : [...shortlist, id].slice(-60) })
        },
        talk: (id, kind) => {
          let out = { message: 'No game' }
          mutate((g, u) => {
            out = talkTo(g, u, id, kind)
          })
          return out
        },
        loan: (listingId) => {
          let out = { accepted: false, message: 'No game' }
          mutate((g, u) => {
            out = loanFor(g, u, listingId)
          })
          return out
        },
        enquire: (playerSeasonId) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = enquireFor(g, u, playerSeasonId)
          })
          return out
        },
        acceptOffer: (i) => mutate((g, u) => acceptOffer(g, u, i)),
        rejectOffer: (i) => mutate((g) => rejectOffer(g, i)),
        release: (id) => mutate((g, u) => releasePlayer(g, u, id)),
        letContractGo: (id) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = letContractGo(g, u, id)
          })
          return out
        },
        advanceDay: () => mutate((g, u) => advanceDay(g, u)),
        scoutPlayer: (id) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = fullScout(g, u, id)
          })
          return out
        },
        setAssignment: (leagueId, on) => {
          let out = { ok: false, message: 'No game' }
          mutate((g) => {
            out = setAssignment(g, leagueId, on)
          })
          return out
        },
        setRecruitFocus: (focus) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = setRecruitFocus(g, u, focus)
          })
          return out
        },
        dismissReport: (id) =>
          mutate((g) => {
            if (g.scoutReports) g.scoutReports = g.scoutReports.filter((r) => r.playerSeasonId !== id)
          }),
        proposeContract: (id, offer) => {
          let out = { accepted: false, message: 'No game' }
          mutate((g, u) => {
            out = proposeContract(g, u, id, offer)
          })
          return out
        },
        setShopped: (id, on) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = setShopped(g, u, id, on)
          })
          return out
        },
        runOffice: (fn, fallback, opts) => {
          let out = fallback
          mutate((g, u) => {
            out = fn(g, u)
          })
          if (opts?.unlock) unlockFromGame()
          return out
        },
        setPlayerPower: (on) =>
          mutate((g) => {
            if (on) g.settings.playerPower = true
            else delete g.settings.playerPower
          }),
        boardRequest: (kind) => {
          let out = { ok: false, accepted: false, message: 'No game' }
          mutate((g, u) => {
            out = makeRequest(g, u, kind)
          })
          return out
        },
        shiftWages: (dir) => {
          let out = { ok: false, message: 'No game' }
          mutate((g, u) => {
            out = shiftWages(g, u, dir)
          })
          return out
        },

        nextSeason: () => {
          const { game } = get()
          const run = () => {
            // Only a finished season moves on (a second tap while leagues load must not run the summer twice)
            if (get().game?.phase !== 'summary') return
            let report: (OffseasonReport & { stories?: SummerStories }) | null = null
            mutate((g, u) => {
              // The stories read the squad before the summer drops last season's men; neither draws
              const snap = summerSnapshot(g, u)
              const r = advanceToNextSeason(g, u)
              report = { ...r, stories: summerStories(snap, r.retired, g, u) }
            })
            set({ offseason: report })
          }
          // Moving to a league that is not loaded yet, or into Europe: load first.
          const want = nextSeasonLeagues(game, (get().universe?.available ?? []).map((l) => l.id))
          if (want.some((id) => !get().loadedLeagues.includes(id))) {
            void get()
              .ensureLeagues(want)
              .then((ok) => {
                if (ok) run()
              })
          } else run()
        },
        acceptJob: (index) => mutate((g) => void (g.pendingMove = index === null ? null : { leagueId: g.jobOffers[index].leagueId, clubId: g.jobOffers[index].clubId })),
        dismissOffseason: () => set({ offseason: null }),

        recordResult: () => {
          const ended = get().game
          if (ended && rulesReady() && (ended.settings.mode === 'dynasty' || ended.settings.mode === 'season') && ended.phase === 'summary' && ended.season && ended.history.at(-1)?.year === ended.year && !ended.history.at(-1)?.notes) {
            // The club's history notes the season once (display only, no draw; the rules chunk holds it, in since the season ended)
            mutate((g, u) => void noteSeasonEnd(g, u))
          }
          const { game, profile, universe } = get()
          if (!game || !universe || game.phase !== 'summary') return
          // The arena files a run on its own table and shelves: no leaderboard row, no daily streak, no season counted
          if (game.arena) {
            const run = arenaRunEntry(game, new Date().toISOString().slice(0, 10))
            if (!run || alreadyCredited(profile, run.id) || profile.arenaRuns?.some((e) => e.id === run.id)) return
            // The Daily Arena: the first run filed for its day counts towards its own streak, never the Daily's
            let arenaDaily = profile.arenaDaily
            let newArenaDaily = false
            const arenaAchievements = { ...profile.achievements }
            if (game.settings.arena?.daily && game.arena) {
              const filed = fileStreakResult(profile.arenaDaily, game.settings.seed, dailyArenaResult(game.arena), previousArenaDailySeed, arenaDailySeed(), arenaDailySeed(new Date(Date.now() - 86400000)))
              arenaDaily = filed.book
              newArenaDaily = filed.filed
              if (arenaDaily.streak >= 7 && !arenaAchievements['arena-regular']) arenaAchievements['arena-regular'] = new Date().toISOString().slice(0, 10)
            }
            set({ profile: { ...profile, arenaRuns: sortArenaRuns([...(profile.arenaRuns ?? []), run]), cabinet: creditArena(profile.cabinet ?? rebuildCabinet(profile), game, { newArenaDaily }), achievements: arenaAchievements, ...(arenaDaily ? { arenaDaily } : {}) } })
            return
          }
          // A run-in files on its own table and shelf, against the real club: no leaderboard row, no season counted
          if (game.settings.mode === 'runin') {
            const row = runInEntry(game, universe, new Date().toISOString().slice(0, 10))
            if (!row || alreadyCredited(profile, row.id) || profile.runIns?.some((e) => e.id === row.id)) return
            set({ profile: { ...profile, runIns: [row, ...(profile.runIns ?? [])].slice(0, rules().RUN_IN_LOG_CAP), cabinet: creditRunInFeatsOn(creditRunIn(cabinetWithFeats(profile), game, row.met), game, row.met) } })
            return
          }
          const rec = finishedRecord(game)
          if (!rec) return
          const entry: LeaderboardEntry = {
            id: resultId(game),
            date: new Date().toISOString().slice(0, 10),
            mode: game.settings.mode,
            teamName: game.settings.teamName,
            points: rec.points,
            won: rec.won,
            drawn: rec.drawn,
            lost: rec.lost,
            position: rec.position,
            tier: rec.tier,
            seed: game.settings.seed,
            leagueSeason: game.settings.leagueSeason,
            leagueId: game.history.at(-1)?.leagueId ?? game.settings.leagueId,
            hostClubId: game.settings.hostClubId,
            xi: Object.values(game.lineup),
            nation: game.settings.rules.onlyNation,
            ...(game.settings.challenge ? { challenge: { name: game.settings.challenge.name, points: game.settings.challenge.claim.pts } } : {}),
            ...(isSuperLeague(game.settings) ? { superLeague: true as const } : {}),
            ...(caseIconIn(game) ? { caseIcon: true as const } : {}),
          }
          const cap = capOfGame(game)
          if (cap) Object.assign(entry, cap)
          const moment = storyForGame(game, universe)?.moment
          if (moment) entry.moment = moment
          // Once per result: the leaderboard holds the best 50, the cabinet remembers the last few credited beyond them
          if (alreadyCredited(profile, entry.id)) return
          const leaderboard = [...profile.leaderboard, entry].sort((a, b) => b.points - a.points || a.lost - b.lost).slice(0, 50)
          let { dailyStreak, lastDailyDate } = profile
          const dailyResults = { ...profile.dailyResults }
          let newDaily = false
          if (game.settings.mode === 'daily') {
            // The result belongs to the day the puzzle was set, not the day it was finished
            const today = streakDay(game.settings.seed, previousDailySeed, dailySeed())
            if (!dailyResults[today]) {
              const book = advanceStreak({ streak: dailyStreak, last: lastDailyDate }, today, previousDailySeed, dailySeed(new Date(Date.now() - 86400000)))
              dailyStreak = book.streak
              lastDailyDate = book.last
              dailyResults[today] = { points: rec.points, tier: rec.tier }
              newDaily = true
            }
          }
          // The Weekly Challenge: its own book, filed under the seed's week; it never touches the Daily's results
          let weekly = profile.weekly
          let newWeekly = false
          if (game.settings.mode === 'weekly') {
            const filed = fileStreakResult(profile.weekly, game.settings.seed, { points: rec.points, tier: rec.tier }, previousWeeklySeed, weeklySeed(), weeklySeed(new Date(Date.now() - 7 * 86400000)))
            weekly = filed.book
            newWeekly = filed.filed
          }
          const achievements = { ...profile.achievements }
          if (dailyStreak >= 7 && !achievements['daily-streak-7']) achievements['daily-streak-7'] = new Date().toISOString().slice(0, 10)
          if (weekly && weekly.streak >= 4 && !achievements['weekly-streak-4']) achievements['weekly-streak-4'] = new Date().toISOString().slice(0, 10)
          // Trophy Room: the cabinet takes the credit, `trophies` mirrors its five counts for older builds
          // A perfect draft (every pick an A) is read here, where the universe is; the cabinet keeps its seed once
          const perfectDraft = isPerfectDraft(game, universe, playerLookup(game, universe))
          const cabinet = creditGameFeats(creditGame(cabinetWithFeats(profile), game, { newDaily, newWeekly, date: entry.date }), game, { perfectDraft })
          // The 38-0 chase: best record, longest perfect run and perfect seasons of every quick season (Quick Draft, the Daily, the Weekly)
          const q = game.quickResult
          const quickBests = q ? withQuickBests(profile.quickBests, q, q.results?.length ?? Math.max(0, (q.table.length - 1) * 2)) : profile.quickBests
          set({ profile: { ...profile, leaderboard, dailyStreak, lastDailyDate, dailyResults, achievements, trophies: trophiesOf(cabinet), cabinet, seasonsSimulated: profile.seasonsSimulated + 1, ...(weekly ? { weekly } : {}), ...(quickBests ? { quickBests } : {}) } })
        },
        startH2H: (managers, leagueId, wheelLeagues, leagueSeason, difficulty, hardMode, seed, classic) => {
          const rng = new Rng(seed)
          const draft = newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], h2hRulesFor(wheelLeagues, hardMode, !!classic))
          set({ h2h: { managers, leagueId, wheelLeagues, leagueSeason, difficulty, seed, rngState: rng.getState(), draft, result: null, hardMode }, screen: 'h2h' })
        },
        h2hSpin: () => {
          const { h2h, universe } = get()
          if (!h2h || !universe || h2h.draft.picking !== null) return
          set({
            h2h: produce(h2h, (h) => {
              const rng = Rng.fromState(h.rngState)
              h2hSpin(universe, h.draft, rng)
              h.rngState = rng.getState()
            }),
          })
        },
        h2hPick: (id, slot) => {
          const { h2h, universe } = get()
          if (!h2h || !universe) return
          try {
            set({ h2h: produce(h2h, (h) => void h2hPick(universe, h.draft, id, slot)) })
          } catch (e) {
            set({ toast: e instanceof Error ? e.message : String(e) })
          }
        },
        h2hAuto: () => {
          const { h2h, universe } = get()
          if (!h2h || !universe) return
          set({ h2h: produce(h2h, (h) => void h2hAutoPick(universe, h.draft)) })
        },
        h2hAutoDraft: () => {
          const { h2h, universe } = get()
          if (!h2h || !universe || h2h.result || h2hComplete(h2h.draft)) return
          set({ h2h: produce(h2h, (h) => void h2hAutoComplete(universe, h)) })
        },
        h2hFinish: () => {
          const { h2h, universe, profile } = get()
          // Played once: a second tap (a double-click before the summary shows) must not replay the season on the moved stream
          if (!h2h || !universe || !h2hComplete(h2h.draft) || h2h.result) return
          set({
            h2h: produce(h2h, (h) => {
              const rng = Rng.fromState(h.rngState)
              h.result = runH2HSeason(universe, rng, h.managers, h.draft.drafts, h.leagueId, h.leagueSeason, h.difficulty)
              h.rngState = rng.getState()
            }),
          })
          // A hot-seat season leaves one mark in the cabinet
          set({ profile: { ...profile, cabinet: creditH2H(profile.cabinet ?? rebuildCabinet(profile)) } })
        },
        abandonH2H: () => set({ h2h: null, screen: 'home' }),
        creditH2HRoom: (won) => {
          const { profile } = get()
          set({ profile: { ...profile, cabinet: creditH2HOnline(profile.cabinet ?? rebuildCabinet(profile), won) } })
        },
        setManagerName: (name) => set({ profile: { ...get().profile, managerName: name } }),
        setFavouriteClub: (clubId) => {
          const { favouriteClub: _old, ...rest } = get().profile
          void _old
          set({ profile: clubId ? { ...rest, favouriteClub: clubId } : rest })
        },
        setTheme: (theme) => set({ profile: { ...get().profile, theme } }),
        dismissTip: (id) => {
          const { profile } = get()
          const next = withTipSeen(profile, id, new Date().toISOString().slice(0, 10))
          if (next !== profile) set({ profile: next })
        },
        dismissAllTips: () => {
          const { profile } = get()
          const next = withAllTipsSeen(profile, new Date().toISOString().slice(0, 10))
          if (next !== profile) set({ profile: next })
        },
        resetTips: () => set({ profile: { ...get().profile, seenTips: {} } }),

        importCloudGame: async (slot, raw, mode) => {
          const game = normaliseGame(raw)
          if (!game || slotOf(game) !== slot) return false
          const current = get().game
          const activeHere = !!current && slotOf(current) === slot
          if (!activeHere) {
            set({ parked: { ...get().parked, [slot]: game } })
            return true
          }
          if (mode === 'park' || (current.phase === 'match' && current.live)) return false
          // Load what the game needs before it becomes active, as resumeGame does
          if (!(await get().ensureLeagues(leaguesFor(game, (get().universe?.available ?? []).map((l) => l.id)), needsClassic(game)))) return false
          const now = get().game
          if (now && slotOf(now) === slot) {
            if (now.phase === 'match' && now.live) return false
            set({ game, digest: null, offseason: null })
          } else set({ parked: { ...get().parked, [slot]: game } })
          return true
        },
        importCloudH2H: (h2h, mode) => {
          if (!h2h || typeof h2h !== 'object' || !Array.isArray(h2h.managers) || !h2h.draft) return false
          if (mode === 'park' && get().h2h) return false
          set({ h2h })
          return true
        },
        applyCloudProfile: (profile, shortlist) => {
          if (!profile || typeof profile !== 'object') return
          set({ profile: { ...defaultProfile, ...profile }, shortlist: Array.isArray(shortlist) ? shortlist.slice(-60) : get().shortlist })
        },
      }
    },
    {
      name: SAVE_KEY,
      storage: saveStorage,
      partialize: (s) => persistedState(s) as unknown as Store,
      version: SAVE_VERSION,
      merge: (persisted, current) => {
        // Saves from older builds (and imported files) get every later field filled in
        const p = (persisted ?? {}) as Partial<Store>
        const parked: Record<string, Game> = {}
        for (const [slot, g] of Object.entries(p.parked ?? {})) {
          const n = normaliseGame(g)
          if (n) parked[slot] = n
        }
        const game = normaliseGame(p.game)
        // A match reloaded mid-way under Auto-play carries on with the assistant at the stops
        const liveAuto = assistantTakesStops(game)
        const saved = p.profile ? normaliseProfile(p.profile, defaultProfile) : null
        // A profile from before the Trophy Room gets its cabinet rebuilt once, from the trophies and the leaderboard
        // (read from the persisted profile itself: the defaults `normaliseProfile` spreads under it carry an empty cabinet)
        const profile = saved ? { ...saved, cabinet: withFeats(p.profile?.cabinet ? reconcileTrophies(normaliseCabinet(p.profile.cabinet), saved.trophies) : rebuildCabinet(saved), saved) } : current.profile
        return { ...current, ...p, profile, game, parked, liveAuto, shortlist: Array.isArray(p.shortlist) ? p.shortlist : [], screen: game || p.h2h ? (p.screen ?? 'home') : 'home' }
      },
    },
  ),
)

/**
 * Another tab or window wrote the save (it played on, imported a file or wiped the browser): this page's game is now
 * older than the stored one, and its next write would put that older game back over the newer progress. It stops
 * writing at once and asks to be reloaded. The browser fires the event only in the other pages, never in the writer.
 * Chromium also hands a reloaded page the events of the page it replaced (that page's last write on `pagehide`, a
 * clear made before the reload): a save that still reads as the one this page loaded or wrote changed nothing (QA r11).
 */
export function saveChangedElsewhere(key: string | null): void {
  // A null key is localStorage.clear(), which takes the save with it
  if (key !== null && key !== SAVE_KEY) return
  if (!saveStorage.changedElsewhere(SAVE_KEY)) return
  saveStorage.freeze()
  useStore.setState({ saveIssue: 'elsewhere' })
}

if (typeof window !== 'undefined') {
  // A write still waiting goes out before the page is hidden or closed
  window.addEventListener('pagehide', () => saveStorage.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveStorage.flush()
    // Back from the background (a frozen tab may not have heard): the save is still this page's, or it stops
    else if (saveStorage.changedElsewhere(SAVE_KEY)) saveChangedElsewhere(SAVE_KEY)
  })
  // Back or Forward to this page out of the back-forward cache: other pages may have saved while it slept, unheard
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && saveStorage.changedElsewhere(SAVE_KEY)) saveChangedElsewhere(SAVE_KEY)
  })
  window.addEventListener('storage', (e) => {
    if (e.storageArea === window.localStorage) saveChangedElsewhere(e.key)
  })
}

/** The save as a plain JSON file: the persisted value, readable and importable by any build. */
export function exportSaveJson(): string {
  return JSON.stringify({ state: persistedState(useStore.getState()), version: SAVE_VERSION })
}

/**
 * Read an imported file: plain JSON from any build, or the compressed text of a
 * stored save. Returns the text to store (compacted and compressed); throws
 * when the file is not a save.
 */
export function readSaveFile(text: string): string {
  const value = parseSave<Record<string, unknown>>(text)
  // A save written under another persist version would be thrown away on load (there is no migrate): refuse it here
  if (typeof value.version === 'number' && value.version !== SAVE_VERSION) throw new Error(value.version > SAVE_VERSION ? 'the save was made by a newer version of TouchLine' : 'the save is from a version of TouchLine this one cannot read')
  const state = { ...value.state }
  if (!state.game && !state.profile && !state.h2h && !state.parked) throw new Error('not a Touchline save')
  // A game, parked game or profile that cannot be read would load as nothing and take this browser's own with it
  const compact = (g: unknown) => {
    const n = normaliseGame(g as Game)
    if (!n) throw new Error('the saved game is damaged')
    return compactGame(n)
  }
  if (state.game) state.game = compact(state.game)
  if (state.parked !== undefined && state.parked !== null) {
    if (typeof state.parked !== 'object' || Array.isArray(state.parked)) throw new Error('the saved games are damaged')
    state.parked = Object.fromEntries(Object.entries(state.parked as Record<string, unknown>).map(([k, g]) => [k, compact(g)]))
  }
  if (state.profile !== undefined && state.profile !== null && (typeof state.profile !== 'object' || Array.isArray(state.profile))) throw new Error('the saved record is damaged')
  const h2h = state.h2h as Partial<H2HGame> | null | undefined
  if (h2h !== undefined && h2h !== null && (typeof h2h !== 'object' || !Array.isArray(h2h.managers) || h2h.managers.length !== 2 || !h2h.draft || typeof h2h.draft !== 'object' || typeof h2h.seed !== 'string')) throw new Error('the saved head-to-head is damaged')
  // A file with games but no record keeps this browser's record rather than starting it again
  if (!state.profile) state.profile = useStore.getState().profile
  return encodeSave(JSON.stringify({ ...value, version: SAVE_VERSION, state }))
}

/**
 * Replace the stored save with one read by `readSaveFile`. Throws, leaving the
 * current save untouched, when the browser cannot store it; on success no
 * further write goes out, so the page can reload into the imported save.
 */
export function storeImportedSave(encoded: string): void {
  try {
    localStorage.setItem(SAVE_KEY, encoded)
  } catch (e) {
    throw isQuotaError(e) ? new Error("the save does not fit in this browser's storage") : e
  }
  saveStorage.freeze()
}

/** Delete the save from this browser; nothing is written again before the page reloads. */
export function wipeSave(): void {
  saveStorage.freeze()
  localStorage.removeItem(SAVE_KEY)
}

/** Every league a saved game needs loaded: its own, its wheel's, and all of them for a Continental Cup, the Super League or an arena field drawn from every league. */
function leaguesFor(game: Game, allLeagues: string[]): string[] {
  const wantsAll = game.settings.continental || game.qualifiedContinental || game.season?.continental || game.quickResult?.continentalCup || game.settings.rules?.superLeague || arenaNeedsAllLeagues(game.settings)
  return [...new Set([game.settings.leagueId ?? DEFAULT_LEAGUE, ...(game.settings.wheelLeagues ?? []), ...(wantsAll ? allLeagues : [])])]
}


export function todaysDailySeed(): string {
  return dailySeed()
}

/** Save slot of a game: quick drafts, dailies and weeklies share one, season, dynasty and the arena (every format, the Daily Arena too) have their own. */
export function slotOf(game: Game): string {
  return isQuickLike(game.settings.mode) ? 'quick' : game.settings.mode
}

/** A manager's own decision while an arena run is under way: the run no longer counts as the assistant's (challenge verification reads it). */
function byHand(g: Game): void {
  if (g.arena && !g.arena.over) g.arena.handManaged = true
}
