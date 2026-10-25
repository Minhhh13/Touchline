import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { produce } from 'immer'
import type { ChallengeSettings, Game, GameSettings, LeaderboardEntry, Mode, Profile } from './types'
import type { LoadedUniverse } from '@engine/universe'
import { loadUniverse, DEFAULT_LEAGUE, fetchLeague } from '@engine/universe'
import { Rng, dailySeed, previousDailySeed, type RngState } from '@engine/rng'
import { canCloseBench, canSpin, chooseSlot as draftChooseSlot, closeBench, isComplete, picksMade, pick as draftPick, positionFirst, respin as draftRespin, spin as draftSpin, autoDraft, targetSlot } from '@engine/draft'
import type { Tactics } from '@engine/types'
import type { InPlayChange, InPlayOutcome, LiveChanges, TeamTalk } from '@engine/match'
import type { TrainingFocus } from '@engine/training'
import { createGame, beginSeason } from './logic/setup'
import { normaliseGame } from './logic/save'
import { compactGame } from './logic/compact'
import { createSaveStorage, encodeSave, isQuotaError, parseSave } from './saveStorage'
import { pickManager } from './logic/managers'
import { closeJanuary, closeQuickSeason, kickOff, makeQuickChange, playbackResults, quickChangeProblem, reopenJanuary, toKickoff } from './logic/quick'
import { advanceLiveMatch, applyEventChoice, changeLiveMatch, closeLiveMatch, completeLiveMatch, playFriendly, playMatchweek, startSeasonProper } from './logic/week'
import { assignPlayer, autoPick, setFormation, setSquadStatus } from './logic/squad'
import { assignmentNote } from './logic/slotSheet'
import type { SquadStatus } from '@engine/status'
import { acceptOffer, advanceDay, bidFor, enquireFor, loanFor, rejectOffer, releasePlayer, type BidOptions } from './logic/marketOps'
import { talkTo, type TalkKind } from './logic/talks'
import { signYouth } from './logic/youth'
import type { StaffRole } from '@engine/staff'
import { advanceToNextSeason, type OffseasonReport } from './logic/dynasty'
import { ACHIEVEMENTS } from '@engine/awards'
import { h2hAutoPick, h2hComplete, h2hPick, h2hSpin, newH2HDraft, type H2HDraft } from '@engine/h2h'
import { runH2HSeason, type H2HManager, type H2HResult } from './logic/h2h'
import { getFormation } from '@engine/formations'
import { QUICK_RULES } from '@engine/draft'
import { decodeChallenge, type ChallengePayload } from '@engine/challenge'
import { challengeSettings, replayChallenge } from './logic/challenge'
import { buildDigest, digestSnapshot, type SimDigest } from './logic/digest'
import { newsTotal } from './logic/news'
import { withTipSeen, type TipId } from './logic/tips'
import { addCupTrophies, playQuickCup, quickCupProblem, skipQuickCup, type QuickCupComp } from './logic/quickCups'

/** localStorage key the whole game is persisted under. */
export const SAVE_KEY = 'touchline-save-v1'
/** Persist version of the saved state (a change needs a `migrate`). */
export const SAVE_VERSION = 1
/** Delay from a change to the write: a burst of changes inside it is written once, with the latest state. */
const SAVE_DELAY_MS = 250
/** Shown when the browser refuses to store the save. */
export const SAVE_FULL_TOAST = "Could not save: this browser's storage is full. Your game carries on; export your save from Your record, or discard a parked game, to free space."

export type Screen = 'home' | 'setup' | 'game' | 'explore' | 'profile' | 'howto' | 'h2h'

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
  screen: Screen
  setupMode: Mode
  game: Game | null
  /** Saved games of other kinds, parked while another game is active (one per slot). */
  parked: Record<string, Game>
  /** Player-season ids starred in Explore; shown on the market for quick enquiries. */
  shortlist: string[]
  h2h: H2HGame | null
  profile: Profile
  toast: string | null
  offseason: OffseasonReport | null
  /** What happened over the matchweeks just simulated (Sim 5, Sim to end); transient, never saved. */
  digest: SimDigest | null
  /** Transient UI: 'ticker' shows the live match, 'report' the summary. */
  matchView: 'ticker' | 'report'
  /** A challenge link opened and verified, waiting on the Setup screen for a team name (transient, never saved). */
  pendingChallenge: { payload: ChallengePayload; challenge: ChallengeSettings } | null
  /** The quick season being revealed game by game from game `from` (transient, never saved): a reload goes straight to the result. */
  playback: { from: number } | null

  loadData: () => Promise<void>
  /** Make sure these league packs are loaded and merged into the universe. */
  /** Load any of the given leagues not loaded yet. Resolves true when all of them are available. */
  ensureLeagues: (ids: string[]) => Promise<boolean>
  go: (screen: Screen, mode?: Mode) => void
  showToast: (text: string | null) => void
  /** Open a challenge link (`#c=...`): decode it, load its leagues, replay it and go to Setup. Resolves false with a toast when it cannot be opened. */
  openChallenge: (encoded: string) => Promise<boolean>

  startGame: (settings: GameSettings) => void
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
  finishDraft: () => void
  /** Quick Draft with managers: pick the manager by id once the draft is done, up to kick-off (`src/game/logic/managers.ts`). */
  pickManager: (id: string) => void
  /** Quick Draft and the Daily: leave the tactics step and play the season (to the January window when it is on); `skip` restores the default tactics first. */
  kickOff: (skip?: boolean) => void
  /** Close the January window with listing `index`, or pass with null, and play the second half. No undo. */
  closeJanuary: (index: number | null) => void
  /** The game-by-game playback is over or skipped: show the summary (a season with a bench is recorded now). */
  endPlayback: () => void
  /** Quick bench: before game `revealed + 1` of the playback, put bench player `inId` into slot `slotId` (one of the three changes). */
  benchChange: (revealed: number, slotId: string, inId: string) => void
  /** Quick Draft after the league: play the domestic cup or the Continental Cup through (loading every league first for the Continental Cup). Resolves true when it was played. */
  playCup: (comp: QuickCupComp) => Promise<boolean>
  /** Quick Draft after the league: pass on a cup. */
  skipCup: (comp: QuickCupComp) => void

  playFriendly: () => void
  startSeason: () => void
  playWeek: () => void
  /** Play the paused match on from its stop (half time to the 70th minute, or 70 to the whistle) with the manager's changes at that stop; `hold` keeps the last twenty minutes live until `completeLive`. */
  advanceLive: (opts: LiveChanges, hold?: boolean) => void
  /** A change with the ball in play at a minute (instructions, set pieces, substitutions, a shout from 70); null without a live match. */
  interveneLive: (change: Omit<InPlayChange, 'side'>) => InPlayOutcome | null
  /** Close a match held to the whistle: the report and the rest of the week. */
  completeLive: () => void
  simToEnd: () => void
  simWeeks: (n: number) => void
  closeMatch: () => void
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
  advanceDay: () => void

  nextSeason: () => void
  acceptJob: (index: number | null) => void
  dismissOffseason: () => void

  startH2H: (managers: [H2HManager, H2HManager], leagueId: string, wheelLeagues: string[], leagueSeason: number, difficulty: 'calibrated' | 'realistic', hardMode: boolean, seed: string) => void
  h2hSpin: () => void
  h2hPick: (playerSeasonId: string, slotId: string | 'bench') => void
  h2hAuto: () => void
  h2hFinish: () => void
  abandonH2H: () => void
  recordResult: () => void
  setManagerName: (name: string) => void
  setTheme: (t: Profile['theme']) => void
  /** A coach mark's 'Got it': it never shows again on this profile. */
  dismissTip: (id: TipId) => void
  /** 'Show tips again' on the Profile screen: every coach mark shows once more. */
  resetTips: () => void
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
}

/** Consecutive refused writes; the toast shows on the first and then every twentieth. */
let failedWrites = 0

/** The save's storage: compressed, coalesced writes; a full storage shows a toast and the game carries on. */
export const saveStorage = createSaveStorage<Store>({
  storage: () => (typeof localStorage === 'undefined' ? undefined : localStorage),
  delayMs: SAVE_DELAY_MS,
  onWrite: () => {
    failedWrites = 0
  },
  onError: (e, quota) => {
    if (!quota) {
      console.warn('Could not save', e)
      return
    }
    failedWrites++
    if (failedWrites === 1 || failedWrites % 20 === 0) useStore.setState({ toast: SAVE_FULL_TOAST })
  },
})

/** What is saved: the games (compacted), the head-to-head, the shortlist, the profile and the screen. */
export function persistedState(s: Pick<Store, 'game' | 'parked' | 'shortlist' | 'h2h' | 'profile' | 'screen'>) {
  const parked: Record<string, Game> = {}
  for (const [slot, g] of Object.entries(s.parked)) parked[slot] = compactGame(g)
  return { game: s.game ? compactGame(s.game) : null, parked, shortlist: s.shortlist, h2h: s.h2h, profile: s.profile, screen: s.screen === 'game' || s.screen === 'h2h' ? s.screen : 'home' }
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** Run a mutation on the current game with the loaded universe. */
      const mutate = (fn: (game: Game, u: LoadedUniverse) => void) => {
        const { game, universe } = get()
        if (!game || !universe) return
        try {
          set({
            game: produce(game, (g) => {
              fn(g, universe)
            }),
          })
        } catch (e) {
          console.error(e)
          set({ toast: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` })
        }
      }
      /** League loads run one after another so two callers never overwrite each other's universe. */
      let pendingLoad: Promise<unknown> = Promise.resolve()
      /**
       * A quick season with a bench is held open while its playback runs; leaving it for another game (or abandoning it)
       * closes it and records it first, so a season that was played never goes missing from the record.
       */
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
        screen: 'home',
        setupMode: 'quick',
        game: null,
        parked: {},
        shortlist: [],
        h2h: null,
        profile: defaultProfile,
        toast: null,
        offseason: null,
        digest: null,
        matchView: 'ticker',
        pendingChallenge: null,
        playback: null,

        loadData: async () => {
          if (get().universe || get().loading) return
          set({ loading: true, loadError: null })
          try {
            // The default league must load; whatever the saved game or head-to-head needs on top is best effort.
            const { game, h2h } = get()
            const base = await loadUniverse([DEFAULT_LEAGUE])
            const gameNeeds = game ? leaguesFor(game, base.available.map((l) => l.id)) : []
            const h2hNeeds = h2h ? [h2h.leagueId ?? DEFAULT_LEAGUE, ...(h2h.wheelLeagues ?? [])] : []
            const extra = [...new Set([...gameNeeds, ...h2hNeeds])].filter((id) => id !== DEFAULT_LEAGUE)
            const results = await Promise.allSettled(extra.map((id) => fetchLeague(id)))
            const failed = extra.filter((_, i) => results[i].status === 'rejected')
            const ids = [DEFAULT_LEAGUE, ...extra.filter((id) => !failed.includes(id))]
            const u = ids.length > 1 ? await loadUniverse(ids) : base
            const next: Partial<Store> = { universe: u, loading: false, loadedLeagues: ids }
            if (failed.length) {
              const names = failed.map((id) => base.available.find((l) => l.id === id)?.name ?? id).join(', ')
              next.toast = `Could not load ${names}. Check your connection and reload to get it back.`
              // Never render a game against a half-loaded universe: park it until its leagues load
              if (game && gameNeeds.some((id) => failed.includes(id))) {
                next.game = null
                next.parked = { ...get().parked, [slotOf(game)]: game }
                if (get().screen === 'game') next.screen = 'home'
              }
              if (h2h && h2hNeeds.some((id) => failed.includes(id))) {
                next.h2h = null
                if (get().screen === 'h2h') next.screen = 'home'
              }
            }
            set(next)
          } catch (e) {
            set({ loading: false, loadError: e instanceof Error ? e.message : String(e) })
          }
        },
        ensureLeagues: (ids) => {
          const run = async (): Promise<boolean> => {
            const missing = ids.filter((id) => !get().loadedLeagues.includes(id))
            if (!missing.length) return true
            set({ loadingLeagues: true })
            try {
              const all = [...new Set([...get().loadedLeagues, ...missing])]
              const u = await loadUniverse(all)
              set({ universe: u, loadedLeagues: all, loadingLeagues: false })
              return true
            } catch (e) {
              set({ loadingLeagues: false, toast: `Could not load league data: ${e instanceof Error ? e.message : String(e)}` })
              return false
            }
          }
          const result = pendingLoad.then(run, run)
          pendingLoad = result.catch(() => undefined)
          return result
        },
        // Any navigation drops a challenge waiting on the Setup screen, so a later Quick Draft starts clean
        go: (screen, mode) => set({ screen, pendingChallenge: null, ...(mode ? { setupMode: mode } : {}) }),
        showToast: (text) => set({ toast: text }),
        openChallenge: async (encoded) => {
          let payload: ChallengePayload
          try {
            payload = decodeChallenge(encoded)
          } catch (e) {
            set({ toast: e instanceof Error ? e.message : String(e) })
            return false
          }
          // A challenger who played the Continental Cup needs every league loaded for the replay to check it
          const needs = [...new Set([payload.s.l, ...payload.s.wl, ...(payload.c.eu ? (get().universe?.available ?? []).map((l) => l.id) : [])])]
          const known = (get().universe?.available ?? []).map((l) => l.id)
          const unknown = needs.filter((id) => !known.includes(id))
          if (unknown.length) {
            set({ toast: `This challenge needs a league this build does not have (${unknown.join(', ')}).` })
            return false
          }
          if (!(await get().ensureLeagues(needs))) return false
          const u = get().universe
          if (!u) return false
          // The host must have played that league season, or the quick season would run against the wrong clubs
          const host = u.clubSeasonByKey[`${payload.s.h}@${payload.s.ls}`]
          if (!host || host.leagueId !== payload.s.l) {
            set({ toast: `This challenge names a club season this build does not have (${payload.s.h} ${payload.s.ls}).` })
            return false
          }
          const outcome = replayChallenge(u, payload)
          set({ pendingChallenge: { payload, challenge: challengeSettings(payload, outcome) }, screen: 'setup', setupMode: 'quick' })
          return true
        },

        startGame: (settings) => {
          settleQuickSeason()
          const game = createGame(settings)
          const { game: current, parked } = get()
          const next = { ...parked }
          // Park a game of a different kind rather than losing it; a finished one is dropped.
          if (current && slotOf(current) !== slotOf(game) && current.phase !== 'summary') next[slotOf(current)] = current
          delete next[slotOf(game)]
          set({ game, parked: next, screen: 'game', pendingChallenge: null, digest: null, playback: null, profile: { ...get().profile, gamesPlayed: get().profile.gamesPlayed + 1 } })
        },
        abandonGame: () => {
          settleQuickSeason()
          set({ game: null, screen: 'home', offseason: null, digest: null, playback: null })
        },
        resumeGame: (slot) => {
          settleQuickSeason()
          const { game: current, parked } = get()
          const target = parked[slot]
          if (!target) return
          const next = { ...parked }
          delete next[slot]
          if (current && current.phase !== 'summary') next[slotOf(current)] = current
          const ids = leaguesFor(target, (get().universe?.available ?? []).map((l) => l.id))
          // Load what the game needs before showing it, so the squad is never rendered against a half-loaded universe
          void get()
            .ensureLeagues(ids)
            .then((ok) => {
              if (ok) set({ game: target, parked: next, screen: 'game', digest: null, playback: null })
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
            if (g.draft.current) g.draft.history.push({ ...g.draft.current, pickedId: null, slotId: null, skipped: true, ...(g.draft.twist ? { twist: g.draft.twist } : {}), ...(targetSlot(g.draft) ? { target: g.draft.target! } : {}) })
            g.draft.current = null
            g.draft.twist = null
            autoDraft(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        finishDraft: () => {
          mutate((g, u) => {
            if (!g.draft) return
            // A Quick Draft with a bench may close once the XI is full, bench places to spare
            if (canCloseBench(g.draft)) closeBench(g.draft)
            // A one-nation wheel that has run dry may close with a full XI short of the squad size
            if (!isComplete(g.draft) && !(picksMade(g.draft) >= 11 && !canSpin(u, g.draft))) return
            // Quick Draft and the Daily stop at the tactics step before the season
            if (g.settings.mode === 'quick' || g.settings.mode === 'daily') toKickoff(g, u)
            else beginSeason(g, u)
          })
          const { game } = get()
          if (game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        pickManager: (id) => mutate((g, u) => pickManager(g, u, id)),
        kickOff: (skip) => {
          if (get().game?.phase !== 'kickoff') return
          mutate((g, u) => kickOff(g, u, skip))
          const { game } = get()
          if (game?.phase === 'january' || game?.phase === 'summary') set({ playback: { from: 0 } })
          // A season with a bench stays open to changes until the playback closes, and is recorded then
          if (game?.phase === 'summary' && !game.quickOpen) {
            unlockFromGame()
            get().recordResult()
          }
        },
        closeJanuary: (index) => {
          const before = get().game
          if (before?.phase !== 'january' || !before.quickJanuary) return
          const from = before.quickJanuary.firstHalf.length
          mutate((g, u) => closeJanuary(g, u, index))
          if (get().game?.phase === 'january') {
            // The deal did not replay (the league data changed since the window opened): draw the window again rather than stay stuck
            mutate((g, u) => reopenJanuary(g, u))
            set({ toast: 'The league data changed since the window opened, so the first half and the window were drawn again.' })
            return
          }
          if (get().game?.phase === 'summary') {
            set({ playback: { from } })
            if (get().game?.quickOpen) return
            unlockFromGame()
            get().recordResult()
          }
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
          mutate((g, u) => makeQuickChange(g, u, results, revealed, slotId, inId))
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
          const trophies = addCupTrophies(profile.trophies ?? { league: 0, cup: 0, continental: 0, doubles: 0, trebles: 0 }, before.quickResult, after, comp)
          set({ profile: { ...profile, trophies } })
          unlockFromGame()
          return true
        },
        skipCup: (comp) => {
          const { game, universe } = get()
          if (!game || !universe) return
          const problem = quickCupProblem(game, universe, comp)
          if (problem) {
            set({ toast: problem })
            return
          }
          mutate((g, u) => skipQuickCup(g, u, comp))
        },

        playFriendly: () => {
          mutate((g, u) => playFriendly(g, u))
          set({ matchView: 'ticker' })
        },
        advanceLive: (opts, hold = false) => {
          mutate((g, u) => advanceLiveMatch(g, u, opts, false, hold))
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        interveneLive: (change) => {
          let out: InPlayOutcome | null = null
          mutate((g, u) => {
            out = changeLiveMatch(g, u, change)
          })
          return out
        },
        completeLive: () => {
          mutate((g, u) => completeLiveMatch(g, u))
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        startSeason: () => mutate((g) => startSeasonProper(g)),
        playWeek: () => {
          mutate((g, u) => {
            if (g.phase === 'preseason') startSeasonProper(g)
            playMatchweek(g, u, false)
          })
          set({ matchView: 'ticker' })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        simWeeks: (n) => {
          // Plain numbers from the saved game, read before the mutation so the digest compares before with after
          const before = digestSnapshot(get().game)
          mutate((g, u) => {
            if (g.phase === 'preseason') startSeasonProper(g)
            for (let i = 0; i < n; i++) {
              if (g.phase === 'summary' || !g.season || g.season.sacked) break
              playMatchweek(g, u, true)
              if (g.phase === 'match') g.phase = 'week'
            }
          })
          const after = get().game
          // The season summary covers a run that ended the season, so no digest then
          const digest = before && after && after.phase !== 'summary' ? buildDigest(before, after) : null
          set({ matchView: 'report', digest })
          if (after?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        simToEnd: () => get().simWeeks(40),
        closeMatch: () => {
          mutate((g, u) => closeLiveMatch(g, u))
          // Leaving the final match of the season closes the season
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

        setTactics: (t) => mutate((g) => void Object.assign(g.tactics, t)),
        setRole: (slotId, roleId) => mutate((g) => void (g.tactics.roles[slotId] = roleId)),
        setFormation: (id) => mutate((g, u) => setFormation(g, u, id)),
        assign: (id, slot) => mutate((g, u) => assignPlayer(g, u, id, slot)),
        playInSlot: (id, slot) => {
          const { game, universe } = get()
          if (!game || !universe) return
          // Worded from the lineup as it stands, before the swap runs
          const note = assignmentNote(game, universe, id, slot)
          mutate((g, u) => assignPlayer(g, u, id, slot))
          if (note) set({ toast: note })
        },
        autoPick: () => mutate((g, u) => autoPick(g, u, false)),
        setTeamTalk: (t) => mutate((g) => void (g.teamTalk = t)),
        setTraining: (t) => mutate((g) => void (g.training = t)),
        setCaptain: (id) =>
          mutate((g) => {
            // An empty id takes the armband off
            if (id) g.captainId = id
            else delete g.captainId
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
        setMarkTarget: (id) => mutate((g) => void (g.markTarget = id)),
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
        advanceDay: () => mutate((g, u) => advanceDay(g, u)),

        nextSeason: () => {
          const { game } = get()
          const run = () => {
            // Only a finished season moves on (a second tap while leagues load must not run the summer twice)
            if (get().game?.phase !== 'summary') return
            let report: OffseasonReport | null = null
            mutate((g, u) => {
              report = advanceToNextSeason(g, u)
            })
            set({ offseason: report })
          }
          // Moving to a league that is not loaded yet, or into Europe: load first.
          const want = [game?.pendingMove?.leagueId, ...(game?.qualifiedContinental ? (get().universe?.available ?? []).map((l) => l.id) : [])].filter((x): x is string => !!x)
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
          const { game, profile, universe } = get()
          if (!game || !universe || game.phase !== 'summary') return
          const rec = game.quickResult ?? (game.history.at(-1) ? { points: game.history.at(-1)!.points, won: game.history.at(-1)!.won, drawn: game.history.at(-1)!.drawn, lost: game.history.at(-1)!.lost, position: game.history.at(-1)!.position, tier: game.history.at(-1)!.tier } : null)
          if (!rec) return
          const entry: LeaderboardEntry = {
            id: `${game.id}-${game.year}`,
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
            hostClubId: game.settings.hostClubId,
            xi: Object.values(game.lineup),
            nation: game.settings.rules.onlyNation,
            ...(game.settings.challenge ? { challenge: { name: game.settings.challenge.name, points: game.settings.challenge.claim.pts } } : {}),
          }
          if (profile.leaderboard.some((e) => e.id === entry.id)) return
          const leaderboard = [...profile.leaderboard, entry].sort((a, b) => b.points - a.points || a.lost - b.lost).slice(0, 50)
          let { dailyStreak, lastDailyDate } = profile
          const dailyResults = { ...profile.dailyResults }
          if (game.settings.mode === 'daily') {
            // The result belongs to the day the puzzle was set, not the day it was finished
            const today = previousDailySeed(game.settings.seed) ? game.settings.seed : dailySeed()
            if (!dailyResults[today]) {
              const yesterday = previousDailySeed(today) ?? dailySeed(new Date(Date.now() - 86400000))
              dailyStreak = lastDailyDate === yesterday ? dailyStreak + 1 : 1
              lastDailyDate = today
              dailyResults[today] = { points: rec.points, tier: rec.tier }
            }
          }
          const achievements = { ...profile.achievements }
          if (dailyStreak >= 7 && !achievements['daily-streak-7']) achievements['daily-streak-7'] = new Date().toISOString().slice(0, 10)
          // Trophy cabinet
          const trophies = { ...(profile.trophies ?? { league: 0, cup: 0, continental: 0, doubles: 0, trebles: 0 }) }
          const last = game.history.at(-1)
          const league = rec.position === 1
          const cup = !!last?.cupWon
          // A quick season's Continental Cup run counts as the managed modes' trophy does
          const euro = !!last?.continentalWon || game.quickResult?.europe?.reached === 'W'
          if (league) trophies.league++
          if (cup) trophies.cup++
          if (euro) trophies.continental++
          if (league && cup) trophies.doubles++
          if (league && cup && euro) trophies.trebles++
          set({ profile: { ...profile, leaderboard, dailyStreak, lastDailyDate, dailyResults, achievements, trophies, seasonsSimulated: profile.seasonsSimulated + 1 } })
        },
        startH2H: (managers, leagueId, wheelLeagues, leagueSeason, difficulty, hardMode, seed) => {
          const rng = new Rng(seed)
          const draft = newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], { ...QUICK_RULES, respins: 0, hardMode, difficulty: hardMode ? 'hard' : 'normal', showRatings: !hardMode, leagues: wheelLeagues, twists: false })
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
        h2hFinish: () => {
          const { h2h, universe } = get()
          if (!h2h || !universe || !h2hComplete(h2h.draft)) return
          set({
            h2h: produce(h2h, (h) => {
              const rng = Rng.fromState(h.rngState)
              h.result = runH2HSeason(universe, rng, h.managers, h.draft.drafts, h.leagueId, h.leagueSeason, h.difficulty)
              h.rngState = rng.getState()
            }),
          })
        },
        abandonH2H: () => set({ h2h: null, screen: 'home' }),
        setManagerName: (name) => set({ profile: { ...get().profile, managerName: name } }),
        setTheme: (theme) => set({ profile: { ...get().profile, theme } }),
        dismissTip: (id) => {
          const { profile } = get()
          const next = withTipSeen(profile, id, new Date().toISOString().slice(0, 10))
          if (next !== profile) set({ profile: next })
        },
        resetTips: () => set({ profile: { ...get().profile, seenTips: {} } }),
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
        return { ...current, ...p, game, parked, shortlist: Array.isArray(p.shortlist) ? p.shortlist : [], screen: game || p.h2h ? (p.screen ?? 'home') : 'home' }
      },
    },
  ),
)

if (typeof window !== 'undefined') {
  // A write still waiting goes out before the page is hidden or closed
  window.addEventListener('pagehide', () => saveStorage.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveStorage.flush()
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
  const state = { ...value.state }
  const compact = (g: unknown) => {
    const n = normaliseGame(g as Game)
    return n ? compactGame(n) : g
  }
  if (state.game) state.game = compact(state.game)
  if (state.parked && typeof state.parked === 'object') state.parked = Object.fromEntries(Object.entries(state.parked as Record<string, unknown>).map(([k, g]) => [k, compact(g)]))
  return encodeSave(JSON.stringify({ ...value, state }))
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

/** Every league a saved game needs loaded: its own, its wheel's, and all of them for a Continental Cup. */
function leaguesFor(game: Game, allLeagues: string[]): string[] {
  const wantsAll = game.settings.continental || game.qualifiedContinental || game.season?.continental || game.quickResult?.continentalCup
  return [...new Set([game.settings.leagueId ?? DEFAULT_LEAGUE, ...(game.settings.wheelLeagues ?? []), ...(wantsAll ? allLeagues : [])])]
}


export function todaysDailySeed(): string {
  return dailySeed()
}

/** Save slot of a game: quick drafts and dailies share one, season and dynasty have their own. */
export function slotOf(game: Game): string {
  return game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'quick' : game.settings.mode
}
