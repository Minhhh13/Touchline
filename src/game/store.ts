import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { produce } from 'immer'
import type { Game, GameSettings, LeaderboardEntry, Mode, Profile } from './types'
import type { LoadedUniverse } from '@engine/universe'
import { loadUniverse, DEFAULT_LEAGUE } from '@engine/universe'
import { Rng, dailySeed, type RngState } from '@engine/rng'
import { isComplete, pick as draftPick, respin as draftRespin, spin as draftSpin, autoDraft } from '@engine/draft'
import type { Tactics } from '@engine/types'
import type { TeamTalk } from '@engine/match'
import type { TrainingFocus } from '@engine/training'
import { createGame, beginSeason } from './logic/setup'
import { runQuickSeason } from './logic/quick'
import { applyEventChoice, finishLiveMatch, playFriendly, playMatchweek, startSeasonProper } from './logic/week'
import { assignPlayer, autoPick, setFormation } from './logic/squad'
import { acceptOffer, advanceDay, bidFor, rejectOffer, releasePlayer } from './logic/marketOps'
import { advanceToNextSeason, type OffseasonReport } from './logic/dynasty'
import { ACHIEVEMENTS } from '@engine/awards'
import { h2hAutoPick, h2hComplete, h2hPick, h2hSpin, newH2HDraft, type H2HDraft } from '@engine/h2h'
import { runH2HSeason, type H2HManager, type H2HResult } from './logic/h2h'
import { getFormation } from '@engine/formations'
import { QUICK_RULES } from '@engine/draft'

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
  h2h: H2HGame | null
  profile: Profile
  toast: string | null
  offseason: OffseasonReport | null
  /** Transient UI: 'ticker' shows the live match, 'report' the summary. */
  matchView: 'ticker' | 'report'

  loadData: () => Promise<void>
  /** Make sure these league packs are loaded and merged into the universe. */
  ensureLeagues: (ids: string[]) => Promise<void>
  go: (screen: Screen, mode?: Mode) => void
  showToast: (text: string | null) => void

  startGame: (settings: GameSettings) => void
  abandonGame: () => void

  spin: () => void
  respin: () => void
  pickPlayer: (playerSeasonId: string, slotId: string | 'bench') => void
  autoDraftRest: () => void
  finishDraft: () => void

  playFriendly: () => void
  startSeason: () => void
  playWeek: () => void
  /** Second half of the paused match, with the manager's half-time changes. */
  finishLive: (opts: { talk?: TeamTalk; tactics?: Tactics; substitutions?: Array<{ off: string; on: string }> }) => void
  simToEnd: () => void
  simWeeks: (n: number) => void
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

  resolveEvent: (choiceId: string) => void
  bid: (listingId: string, amount: number) => { accepted: boolean; message: string }
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
          set({ game: produce(game, (g) => fn(g, universe)) })
        } catch (e) {
          console.error(e)
          set({ toast: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` })
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
        screen: 'home',
        setupMode: 'quick',
        game: null,
        h2h: null,
        profile: defaultProfile,
        toast: null,
        offseason: null,
        matchView: 'ticker',

        loadData: async () => {
          if (get().universe || get().loading) return
          set({ loading: true, loadError: null })
          try {
            // Load whatever the saved game or head-to-head needs, plus the default league.
            const { game, h2h } = get()
            const needed = new Set<string>([DEFAULT_LEAGUE])
            if (game) {
              needed.add(game.settings.leagueId ?? DEFAULT_LEAGUE)
              for (const l of game.settings.wheelLeagues ?? []) needed.add(l)
            }
            if (h2h) {
              needed.add(h2h.leagueId ?? DEFAULT_LEAGUE)
              for (const l of h2h.wheelLeagues ?? []) needed.add(l)
            }
            const ids = [...needed]
            const u = await loadUniverse(ids)
            set({ universe: u, loading: false, loadedLeagues: ids })
          } catch (e) {
            set({ loading: false, loadError: e instanceof Error ? e.message : String(e) })
          }
        },
        ensureLeagues: async (ids) => {
          const { loadedLeagues } = get()
          const missing = ids.filter((id) => !loadedLeagues.includes(id))
          if (!missing.length) return
          set({ loadingLeagues: true })
          try {
            const all = [...new Set([...loadedLeagues, ...missing])]
            const u = await loadUniverse(all)
            set({ universe: u, loadedLeagues: all, loadingLeagues: false })
          } catch (e) {
            set({ loadingLeagues: false, toast: `Could not load league data: ${e instanceof Error ? e.message : String(e)}` })
          }
        },
        go: (screen, mode) => set({ screen, ...(mode ? { setupMode: mode } : {}) }),
        showToast: (text) => set({ toast: text }),

        startGame: (settings) => {
          const game = createGame(settings)
          set({ game, screen: 'game', profile: { ...get().profile, gamesPlayed: get().profile.gamesPlayed + 1 } })
        },
        abandonGame: () => set({ game: null, screen: 'home', offseason: null }),

        spin: () =>
          mutate((g, u) => {
            if (!g.draft || g.draft.current) return
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
            g.draft.current = null
            autoDraft(u, g.draft, rng)
            g.rngState = rng.getState()
          }),
        finishDraft: () => {
          mutate((g, u) => {
            if (!g.draft || !isComplete(g.draft)) return
            if (g.settings.mode === 'quick' || g.settings.mode === 'daily') runQuickSeason(g, u)
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
        finishLive: (opts) => {
          mutate((g, u) => finishLiveMatch(g, u, opts))
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
        closeMatch: () =>
          mutate((g) => {
            if (g.phase === 'match') g.phase = g.season && g.season.matchweek === 0 ? 'preseason' : 'week'
          }),
        setMatchView: (v) => set({ matchView: v }),

        setTactics: (t) => mutate((g) => Object.assign(g.tactics, t)),
        setRole: (slotId, roleId) => mutate((g) => void (g.tactics.roles[slotId] = roleId)),
        setFormation: (id) => mutate((g, u) => setFormation(g, u, id)),
        assign: (id, slot) => mutate((g, u) => assignPlayer(g, u, id, slot)),
        autoPick: () => mutate((g, u) => autoPick(g, u, false)),
        setTeamTalk: (t) => mutate((g) => void (g.teamTalk = t)),
        setTraining: (t) => mutate((g) => void (g.training = t)),
        setCaptain: (id) => mutate((g) => void (g.captainId = id)),

        resolveEvent: (choiceId) => mutate((g, u) => applyEventChoice(g, u, choiceId)),
        bid: (listingId, amount) => {
          let out = { accepted: false, message: 'No game' }
          mutate((g, u) => {
            out = bidFor(g, u, listingId, amount)
          })
          unlockFromGame()
          return out
        },
        acceptOffer: (i) => mutate((g, u) => acceptOffer(g, u, i)),
        rejectOffer: (i) => mutate((g) => rejectOffer(g, i)),
        release: (id) => mutate((g, u) => releasePlayer(g, u, id)),
        advanceDay: () => mutate((g, u) => advanceDay(g, u)),

        nextSeason: () => {
          const { game } = get()
          const run = () => {
            let report: OffseasonReport | null = null
            mutate((g, u) => {
              report = advanceToNextSeason(g, u)
            })
            set({ offseason: report })
          }
          // Moving to a league that is not loaded yet: load it first.
          const target = game?.pendingMove?.leagueId
          if (target && !get().loadedLeagues.includes(target)) {
            void get().ensureLeagues([target]).then(run)
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
          }
          if (profile.leaderboard.some((e) => e.id === entry.id)) return
          const leaderboard = [...profile.leaderboard, entry].sort((a, b) => b.points - a.points || a.lost - b.lost).slice(0, 50)
          let { dailyStreak, lastDailyDate } = profile
          const dailyResults = { ...profile.dailyResults }
          if (game.settings.mode === 'daily') {
            const today = dailySeed()
            if (!dailyResults[today]) {
              const yesterday = dailySeed(new Date(Date.now() - 86400000))
              dailyStreak = lastDailyDate === yesterday ? dailyStreak + 1 : 1
              lastDailyDate = today
              dailyResults[today] = { points: rec.points, tier: rec.tier }
            }
          }
          const achievements = { ...profile.achievements }
          if (dailyStreak >= 7 && !achievements['daily-streak-7']) achievements['daily-streak-7'] = new Date().toISOString().slice(0, 10)
          set({ profile: { ...profile, leaderboard, dailyStreak, lastDailyDate, dailyResults, achievements, seasonsSimulated: profile.seasonsSimulated + 1 } })
        },
        startH2H: (managers, leagueId, wheelLeagues, leagueSeason, difficulty, hardMode, seed) => {
          const rng = new Rng(seed)
          const draft = newH2HDraft([getFormation(managers[0].formationId), getFormation(managers[1].formationId)], { ...QUICK_RULES, respins: 0, hardMode, leagues: wheelLeagues })
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
      name: 'touchline-save-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ game: s.game, h2h: s.h2h, profile: s.profile, screen: s.screen === 'game' || s.screen === 'h2h' ? s.screen : 'home' }) as unknown as Store,
      version: 1,
    },
  ),
)

export function todaysDailySeed(): string {
  return dailySeed()
}
