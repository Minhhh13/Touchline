/**
 * The game rules the store runs once a game is under way, in one chunk of their own (docs/PERFORMANCE.md, round 9):
 * the season loop (`week.ts` and the assistant), the quick season and its worker, the cups, challenges, the Dynasty,
 * the Run-in and head-to-head. Home never needs them, so the first download leaves them out; `rulesHook.ts` loads this
 * module (every lazy screen waits for it, Home's actions that need it load it first) and the store reads it through
 * `rules()`. Re-exports only: the code and its order of draws are the modules' own.
 */
export { isPerfectDraft } from './logic/perfectDraft'
export { runQuickInWorker, stopQuickWorker, warmQuickWorker } from './quickWorkerClient'
export { pickManager } from './logic/managers'
export { januaryGambleMade } from './logic/januaryGamble'
export { CHANGES_CLOSED_NOTE, JANUARY_REDRAWN_NOTE, januaryStale, markQuickSeasonFresh, quickSeasonStale } from './logic/quickSeam'
export { closeJanuary, closeJanuarySpin, closeQuickSeason, kickOff, makeQuickChange, openSpinChoices, playbackResults, quickChangeProblem, reopenJanuary, rollJanuarySpin, rollJanuaryUpgrade, toKickoff } from './logic/quick'
export { availableStopChanges } from './logic/stopChanges'
export { advanceLiveMatch, applyEventChoice, changeLiveMatch, closeLiveMatch, completeLiveMatch, playFriendly, runSteps, simWeeksSteps, startSeasonProper, WEEK_END } from './logic/week'
export { restTired, startPromised } from './logic/seasonPlay'
export { proposeContract, setShopped } from './logic/contracts'
export { makeRequest, shiftWages } from './logic/board'
export { withTick } from './logic/officeSteps'
export { advanceToNextSeason, letContractGo, postRenewals } from './logic/dynasty'
export { noteSeasonEnd, summerSnapshot, summerStories } from './logic/dynastyHistory'
export { h2hAutoPick, h2hComplete, h2hPick, h2hSpin, newH2HDraft } from '@engine/h2h'
export { runH2HSeason } from './logic/h2h'
export { h2hRulesFor } from './logic/h2hClassic'
export { decodeChallenge, isArenaPayload } from '@engine/challenge'
export { challengeSettings, replayChallenge } from './logic/challenge'
export { storyForGame } from './logic/story'
export { simToNextStopSteps } from './logic/seasonHighlights'
export { beginRunIn, RUN_IN_LOG_CAP, runInEntry, seedRunInDraft } from './logic/runin'
export { creditCupRun, playQuickCup, quickCupProblem, quickCupStatus, skipQuickCup } from './logic/quickCups'
export { passQuickCup } from './logic/summaryCall'
export { leaguesBeforeSkip } from './logic/cupSkip'
export { lifelineChanges, LIFELINE_SAME_NOTE } from './logic/lifeline'
export { advanceWithAssistant, finishWithAssistant, playMatchweekAs, playMatchweekAsSteps } from './logic/assistant'
