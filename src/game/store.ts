import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { produce } from 'immer'
import type { ChallengeSettings, Game, GameSettings, LeaderboardEntry, Mode, Profile } from './types'
import type { LoadedUniverse } from '@engine/universe'
import { loadUniverse, DEFAULT_LEAGUE, fetchLeague } from '@engine/universe'
import { Rng, dailySeed, previousDailySeed, type RngState } from '@engine/rng'
import { canSpin, isComplete, picksMade, pick as draftPick, respin as draftRespin, spin as draftSpin, autoDraft } from '@engine/draft'
import type { Tactics } from '@engine/types'
import type { LiveChanges, TeamTalk } from '@engine/match'
import type { TrainingFocus } from '@engine/training'
import { createGame, beginSeason } from './logic/setup'
import { normaliseGame } from './logic/save'
import { runQuickSeason } from './logic/quick'
import { isQuickLike } from './logic/modes'
import { advanceStreak, streakDay } from './logic/streaks'
import { advanceLiveMatch, applyEventChoice, closeLiveMatch, playFriendly, playMatchweek, startSeasonProper } from './logic/week'
import { assignPlayer, autoPick, setFormation, setSquadStatus } from './logic/squad'
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
import { storyForGame } from './logic/story'
import { simToNextStop, type StopReason } from './logic/highlights'

/** localStorage key the whole game is persisted under. */
export const SAVE_KEY = 'touchline-save-v1'

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
  /** Transient UI: 'ticker' shows the live match, 'report' the summary. */
  matchView: 'ticker' | 'report'
  /** Why the last Sim to the next big match stopped, for the game, year and matchweek it stopped at (transient, never saved). */
  simStop: { stop: StopReason; gameId: string; year: number; matchweek: number } | null
  /** A challenge link opened and verified, waiting on the Setup screen for a team name (transient, never saved). */
  pendingChallenge: { payload: ChallengePayload; challenge: ChallengeSettings } | null

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
  pickPlayer: (playerSeasonId: string, slotId: string | 'bench') => void
  autoDraftRest: () => void
  finishDraft: () => void

  playFriendly: () => void
  startSeason: () => void
  playWeek: () => void
  /** Play the paused match on from its stop (half time to the 70th minute, or 70 to the whistle) with the manager's changes at that stop. */
  advanceLive: (opts: LiveChanges) => void
  simToEnd: () => void
  simWeeks: (n: number) => void
  /** Sim 5's weeks until the next derby, title decider, cup semi-final or final, open run-in, January window or board alarm; that week is not played. */
  simToNextBigMatch: () => void
  closeMatch: () => void
  setMatchView: (v: 'ticker' | 'report') => void

  setTactics: (t: Partial<Tactics>) => void
  setRole: (slotId: string, roleId: string) => void
  setFormation: (id: string) => void
  assign: (playerSeasonId: string, slotId: string | 'bench') => void
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
        matchView: 'ticker',
        simStop: null,
        pendingChallenge: null,

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
          const needs = [...new Set([payload.s.l, ...payload.s.wl])]
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
          const game = createGame(settings)
          const { game: current, parked } = get()
          const next = { ...parked }
          // Park a game of a different kind rather than losing it; a finished one is dropped.
          if (current && slotOf(current) !== slotOf(game) && current.phase !== 'summary') next[slotOf(current)] = current
          delete next[slotOf(game)]
          set({ game, parked: next, screen: 'game', pendingChallenge: null, profile: { ...get().profile, gamesPlayed: get().profile.gamesPlayed + 1 } })
        },
        abandonGame: () => set({ game: null, screen: 'home', offseason: null }),
        resumeGame: (slot) => {
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
              if (ok) set({ game: target, parked: next, screen: 'game' })
            })
        },
        discardParked: (slot) => {
          const next = { ...get().parked }
          delete next[slot]
          set({ parked: next })
        },

        spin: () =>
          mutate((g, u) => {
            if (!g.draft || g.draft.current) return
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
            if (g.draft.current) g.draft.history.push({ ...g.draft.current, pickedId: null, slotId: null, skipped: true, ...(g.draft.twist ? { twist: g.draft.twist } : {}) })
            g.draft.current = null
            g.draft.twist = null
            autoDraft(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        finishDraft: () => {
          mutate((g, u) => {
            if (!g.draft) return
            // A one-nation wheel that has run dry may close with a full XI short of the squad size
            if (!isComplete(g.draft) && !(picksMade(g.draft) >= 11 && !canSpin(u, g.draft))) return
            if (isQuickLike(g.settings.mode)) runQuickSeason(g, u)
            else beginSeason(g, u)
          })
          const { game } = get()
          if (game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },

        playFriendly: () => {
          mutate((g, u) => playFriendly(g, u))
          set({ matchView: 'ticker' })
        },
        advanceLive: (opts) => {
          mutate((g, u) => advanceLiveMatch(g, u, opts))
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
          mutate((g, u) => {
            if (g.phase === 'preseason') startSeasonProper(g)
            for (let i = 0; i < n; i++) {
              if (g.phase === 'summary' || !g.season || g.season.sacked) break
              playMatchweek(g, u, true)
              if (g.phase === 'match') g.phase = 'week'
            }
          })
          set({ matchView: 'report' })
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        simToEnd: () => get().simWeeks(40),
        simToNextBigMatch: () => {
          const out: { stop: StopReason | null } = { stop: null }
          mutate((g, u) => {
            out.stop = simToNextStop(g, u)
          })
          const after = get().game
          const stop = out.stop
          set({ matchView: 'report', simStop: stop && after?.season ? { stop, gameId: after.id, year: after.year, matchweek: after.season.matchweek } : null })
          if (after?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        closeMatch: () => {
          mutate((g, u) => closeLiveMatch(g, u))
          // Leaving the final match of the season closes the season
          if (get().game?.phase === 'summary') {
            unlockFromGame()
            get().recordResult()
          }
        },
        setMatchView: (v) => set({ matchView: v }),

        setTactics: (t) => mutate((g) => void Object.assign(g.tactics, t)),
        setRole: (slotId, roleId) => mutate((g) => void (g.tactics.roles[slotId] = roleId)),
        setFormation: (id) => mutate((g, u) => setFormation(g, u, id)),
        assign: (id, slot) => mutate((g, u) => assignPlayer(g, u, id, slot)),
        autoPick: () => mutate((g, u) => autoPick(g, u, false)),
        setTeamTalk: (t) => mutate((g) => void (g.teamTalk = t)),
        setTraining: (t) => mutate((g) => void (g.training = t)),
        setCaptain: (id) => mutate((g) => void (g.captainId = id)),
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
          const moment = storyForGame(game, universe)?.moment
          if (moment) entry.moment = moment
          if (profile.leaderboard.some((e) => e.id === entry.id)) return
          const leaderboard = [...profile.leaderboard, entry].sort((a, b) => b.points - a.points || a.lost - b.lost).slice(0, 50)
          let { dailyStreak, lastDailyDate } = profile
          const dailyResults = { ...profile.dailyResults }
          if (game.settings.mode === 'daily') {
            // The result belongs to the day the puzzle was set, not the day it was finished
            const today = streakDay(game.settings.seed, previousDailySeed, dailySeed())
            if (!dailyResults[today]) {
              const book = advanceStreak({ streak: dailyStreak, last: lastDailyDate }, today, previousDailySeed, dailySeed(new Date(Date.now() - 86400000)))
              dailyStreak = book.streak
              lastDailyDate = book.last
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
          const euro = !!last?.continentalWon
          if (league) trophies.league++
          if (cup) trophies.cup++
          if (euro) trophies.continental++
          if (league && cup) trophies.doubles++
          if (league && cup && euro) trophies.trebles++
          set({ profile: { ...profile, leaderboard, dailyStreak, lastDailyDate, dailyResults, achievements, trophies, seasonsSimulated: profile.seasonsSimulated + 1 } })
        },
        startH2H: (managers, leagueId, wheelLeagues, leagueSeason, difficulty, hardMode, seed) => {
          const rng = new Rng(seed)
          const draft = newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], { ...QUICK_RULES, respins: 0, hardMode, leagues: wheelLeagues, twists: false })
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
      }
    },
    {
      name: SAVE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ game: s.game, parked: s.parked, shortlist: s.shortlist, h2h: s.h2h, profile: s.profile, screen: s.screen === 'game' || s.screen === 'h2h' ? s.screen : 'home' }) as unknown as Store,
      version: 1,
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

/** Every league a saved game needs loaded: its own, its wheel's, and all of them for a Continental Cup. */
function leaguesFor(game: Game, allLeagues: string[]): string[] {
  const wantsAll = game.settings.continental || game.qualifiedContinental || game.season?.continental
  return [...new Set([game.settings.leagueId ?? DEFAULT_LEAGUE, ...(game.settings.wheelLeagues ?? []), ...(wantsAll ? allLeagues : [])])]
}


export function todaysDailySeed(): string {
  return dailySeed()
}

/** Save slot of a game: quick drafts and dailies share one, season and dynasty have their own. */
export function slotOf(game: Game): string {
  return game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'quick' : game.settings.mode
}
