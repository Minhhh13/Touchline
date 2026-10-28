/**
 * QA harness: drives games through the store's own actions (the calls the screens make) with choices drawn from a
 * test-side stream, and checks the invariants every mode must keep. The choices never touch a game's stream: they
 * come from `Chooser`, seeded with a literal string per run.
 *
 * Test files that use it stub `localStorage` with `vi.hoisted` before importing the store (see `qaQuick.test.ts`).
 */
import { expect } from 'vitest'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { canBench, canCloseBench, canSpin, eligibleSlots, isComplete, picksMade, positionFirst, spinClubSeason, spinnableSlots, targetSlot } from '@engine/draft'
import { encodeSave, parseSave } from '../saveStorage'
import { compactGame } from '../logic/compact'
import { persistedState, useStore } from '../store'
import { kickoffStep, caseIconChoices } from '../logic/endCase'
import { quickManagerOptions } from '../logic/managers'
import { openSpinChoices, playbackResults, quickChangeProblem, quickSquadAt } from '../logic/quick'
import { januaryGambleOn } from '../logic/januaryGamble'
import type { Game } from '../types'

/** How often each driven action ran, so a harness that stops exercising something fails rather than passing quietly. */
export const coverage: Record<string, number> = {}
export function count(key: string): void {
  coverage[key] = (coverage[key] ?? 0) + 1
}
/** The store, counting the action about to be called on it. */
function act(key: string): ReturnType<typeof useStore.getState> {
  count(key)
  return useStore.getState()
}

/** The test's own choices: a stream of its own, never a game's. */
export class Chooser {
  private rng: Rng
  constructor(seed: string) {
    this.rng = new Rng(`qa-chooser:${seed}`)
  }
  chance(p: number): boolean {
    return this.rng.chance(p)
  }
  int(min: number, max: number): number {
    return this.rng.int(min, max)
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.rng.int(0, arr.length - 1)]
  }
}

/** Every number that is not finite and every string reading NaN, undefined or [object Object], with its path. */
export function badValues(x: unknown, path = '$', out: string[] = [], depth = 0): string[] {
  if (out.length > 20 || depth > 40) return out
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) out.push(`${path} = ${x}`)
  } else if (typeof x === 'string') {
    if (/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b/.test(x)) out.push(`${path} = ${JSON.stringify(x.slice(0, 120))}`)
  } else if (Array.isArray(x)) {
    x.forEach((v, i) => badValues(v, `${path}[${i}]`, out, depth + 1))
  } else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) badValues(v, `${path}.${k}`, out, depth + 1)
  }
  return out
}

/** Row shape every table in the game shares. */
export interface TableRowLike {
  teamId?: string
  clubId?: string
  played?: number
  won: number
  drawn: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
}

/**
 * A league table's arithmetic: points are 3W + D (less any carried deduction, which no generated table has), every
 * club plays `games`, wins equal losses across the table, goals for equal goals against.
 */
export function tableProblems(rows: TableRowLike[], games: number | null, label = 'table'): string[] {
  const out: string[] = []
  let w = 0
  let l = 0
  let gf = 0
  let ga = 0
  let d = 0
  for (const r of rows) {
    const id = r.teamId ?? r.clubId
    const played = r.won + r.drawn + r.lost
    if (r.points !== 3 * r.won + r.drawn) out.push(`${label} ${id}: ${r.points} pts from ${r.won}W ${r.drawn}D`)
    if (games !== null && played !== games) out.push(`${label} ${id}: played ${played}, not ${games}`)
    if (r.played !== undefined && r.played !== played) out.push(`${label} ${id}: played column ${r.played} vs ${played}`)
    w += r.won
    l += r.lost
    d += r.drawn
    gf += r.goalsFor
    ga += r.goalsAgainst
  }
  if (w !== l) out.push(`${label}: ${w} wins vs ${l} losses`)
  if (d % 2) out.push(`${label}: odd number of draws ${d}`)
  if (gf !== ga) out.push(`${label}: ${gf} goals for vs ${ga} against`)
  return out
}

/** A lineup and bench with no player twice (by player-season id and by real player id). */
export function squadProblems(lineup: Record<string, string>, bench: string[], playerIdOf: (psId: string) => string | undefined, label = 'squad'): string[] {
  const out: string[] = []
  const ids = [...Object.values(lineup), ...bench]
  const seen = new Set<string>()
  const people = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) out.push(`${label}: ${id} twice`)
    seen.add(id)
    const person = playerIdOf(id)
    if (person === undefined) out.push(`${label}: ${id} unknown`)
    else if (people.has(person)) out.push(`${label}: player ${person} twice (${id})`)
    else people.add(person)
  }
  return out
}

/** Load a universe into the store with a clean slate (no game, default profile kept from `fresh`). */
export function loadStore(u: LoadedUniverse, leagues: string[], fresh = true): void {
  const s = useStore.getState()
  useStore.setState({ universe: u, loadedLeagues: leagues, toast: null, digest: null, playback: null, pendingChallenge: null, ...(fresh ? { game: null, parked: {}, h2h: null, profile: { ...s.profile, leaderboard: [], cabinet: undefined, arenaRuns: [], runIns: [], dailyResults: {}, dailyStreak: 0, lastDailyDate: null, gamesPlayed: 0, seasonsSimulated: 0, achievements: {}, weekly: undefined, arenaDaily: undefined, quickBests: undefined, inventory: {} } } : {}) })
}

/** The toast the store's `mutate` shows when an action threw: always a bug (the screens never expect it). */
export function crashToast(): string | null {
  const t = useStore.getState().toast
  return t && t.startsWith('Something went wrong') ? t : null
}

/**
 * The save as a reload reads it: persisted, compacted, compressed, decompressed and merged by the store's own `merge`.
 * Returns the merged state's game, parked games and profile.
 */
export function reloadState(): { game: Game | null; parked: Record<string, Game>; profile: ReturnType<typeof useStore.getState>['profile'] } {
  const s = useStore.getState()
  const raw = encodeSave(JSON.stringify({ state: persistedState(s), version: 1 }))
  const value = parseSave<Record<string, unknown>>(raw)
  const merge = useStore.persist.getOptions().merge!
  const merged = merge(value.state, s) as ReturnType<typeof useStore.getState>
  return { game: merged.game, parked: merged.parked, profile: merged.profile }
}

/** The store's game after a reload equals the compacted game, field for field. */
export function expectReloadSame(label: string): void {
  const g = useStore.getState().game
  const { game } = reloadState()
  if (!g) {
    expect(game, label).toBeNull()
    return
  }
  expect(JSON.parse(JSON.stringify(game)), `${label}: reloaded game`).toEqual(JSON.parse(JSON.stringify(compactGame(g))))
}

/** What happened in one driven draft, for the assertions. */
export interface DraftLog {
  actions: string[]
  problems: string[]
}

/**
 * Drive the store's draft to its end with random but legal choices: Position First slots, spins, re-spins, picks into a
 * slot or the bench, the assistant's pick, the power-ups when the draft has them, and at some point maybe Auto-complete.
 * Every step checks the draft (no player twice, nothing thrown) and stops on a draft that does not move.
 */
export function driveDraft(u: LoadedUniverse, ch: Chooser, opts: { autoAt?: number; respin?: number; powerUps?: boolean } = {}): DraftLog {
  const log: DraftLog = { actions: [], problems: [] }
  const push = log.actions.push.bind(log.actions)
  log.actions.push = (...a: string[]) => {
    for (const x of a) count(`draft:${x.split(' ')[0]}`)
    return push(...a)
  }
  const st = () => useStore.getState()
  let stuck = 0
  for (let step = 0; step < 400; step++) {
    const g = st().game
    if (!g || g.phase !== 'draft' || !g.draft) return log
    const d = g.draft
    const sig = JSON.stringify([d.history.length, d.current, d.target, picksMade(d), d.respinsLeft, d.powerUps?.length ?? 0, d.upgrade ? 1 : 0, g.phase])
    const crash = crashToast()
    if (crash) {
      log.problems.push(`crash after ${log.actions.at(-1)}: ${crash}`)
      return log
    }
    log.problems.push(...squadProblems(d.lineup, d.bench, (id) => (g.customPlayers[id] ?? u.index[id])?.playerId, `draft step ${step}`))
    if (isComplete(d) || (canCloseBench(d) && ch.chance(0.25)) || (picksMade(d) >= 11 && !canSpin(u, d) && !d.current)) {
      log.actions.push('finishDraft')
      st().finishDraft()
      if (st().game?.phase === 'draft') {
        log.problems.push(`finishDraft did not leave the draft (picks ${picksMade(d)}, complete ${isComplete(d)})`)
        return log
      }
      return log
    }
    if (opts.autoAt !== undefined && picksMade(d) >= opts.autoAt) {
      log.actions.push('autoDraftRest')
      st().autoDraftRest()
    } else if (!d.current) {
      if (positionFirst(d) && !targetSlot(d)) {
        const slots = spinnableSlots(u, d)
        if (!slots.length) {
          log.problems.push('Position First: no spinnable slot')
          return log
        }
        const s = ch.pick(slots)
        log.actions.push(`chooseSlot ${s.id}`)
        st().chooseSlot(s.id)
      } else if (!canSpin(u, d)) {
        log.problems.push(`wheel dry at ${picksMade(d)} picks`)
        return log
      } else {
        log.actions.push('spin')
        st().spin()
      }
    } else {
      const cs = spinClubSeason(u, d)
      const powerUps = opts.powerUps && d.rules.powerUps
      if (d.respinsLeft > 0 && ch.chance(opts.respin ?? 0.15)) {
        log.actions.push('respin')
        st().respin()
      } else if (powerUps && ch.chance(0.12)) {
        const which = ch.int(0, 5)
        const filled = Object.keys(d.lineup)
        const xi = Object.values(d.lineup)
        if (which === 0) {
          log.actions.push('rerollSeason')
          st().rerollSeason()
        } else if (which === 1) {
          log.actions.push('peekSpin')
          st().peekSpin()
        } else if (which === 2 && filled.length >= 2) {
          const a = ch.pick(filled)
          const b = ch.pick(d.formation.slots.map((s) => s.id))
          log.actions.push(`swapSlots ${a} ${b}`)
          st().swapSlots(a, b)
        } else if (which === 3 && xi.length) {
          log.actions.push('giveArmband')
          st().giveArmband(ch.pick(xi))
        } else if (which === 4 && xi.length) {
          log.actions.push('lockPlayer')
          st().lockPlayer(ch.pick(xi))
        } else if (which === 5 && xi.length) {
          log.actions.push('upgradePlayer')
          st().upgradePlayer(ch.pick(xi), ch.pick([2, 5, 10]))
        }
        // A refused power-up is a toast, not a crash
        if (st().toast && !crashToast()) useStore.setState({ toast: null })
      } else {
        const options: Array<{ id: string; slot: string }> = []
        for (const p of cs?.squad ?? []) {
          for (const s of eligibleSlots(d, p)) options.push({ id: p.id, slot: s.id })
          if (canBench(d, p)) options.push({ id: p.id, slot: 'bench' })
        }
        if (!options.length || ch.chance(0.15)) {
          log.actions.push(options.length ? 'speedrunPick' : 'speedrunPick (nobody usable)')
          st().speedrunPick()
          if (!options.length && st().game?.draft?.current && d.respinsLeft <= 0) {
            // Nobody on the spin can be used and no re-spin: the assistant could not pick either
            const after = st().game!.draft!
            if (after.current && after.history.length === d.history.length) {
              log.problems.push(`spin with nobody usable at ${picksMade(d)} picks (${d.current.clubId} ${d.current.season})`)
              return log
            }
          }
        } else {
          const o = ch.pick(options)
          log.actions.push(`pick ${o.id} ${o.slot}`)
          st().pickPlayer(o.id, o.slot)
          if (st().toast && !crashToast()) {
            log.problems.push(`legal pick refused: ${o.id} ${o.slot}: ${st().toast}`)
            useStore.setState({ toast: null })
          }
        }
      }
    }
    const g2 = st().game
    const d2 = g2?.draft
    const sig2 = d2 ? JSON.stringify([d2.history.length, d2.current, d2.target, picksMade(d2), d2.respinsLeft, d2.powerUps?.length ?? 0, d2.upgrade ? 1 : 0, g2?.phase]) : 'gone'
    if (sig2 === sig) {
      stuck++
      if (st().toast && !crashToast()) useStore.setState({ toast: null })
      if (stuck > 12) {
        log.problems.push(`draft does not move after ${log.actions.slice(-3).join(', ')}`)
        return log
      }
    } else stuck = 0
  }
  log.problems.push('draft did not finish in 400 steps')
  return log
}

/**
 * Drive a quick-like game from the kick-off step to the summary: the manager spin's pick, the case (the Icon in or not),
 * tactics, kick-off, the January window (a listing, a pass, the spin or the Upgrader), the bench changes during the
 * playback and the end of the playback.
 */
export function driveQuickSeason(u: LoadedUniverse, ch: Chooser): string[] {
  const problems: string[] = []
  const st = () => useStore.getState()
  for (let step = 0; step < 60; step++) {
    const g = st().game
    const crash = crashToast()
    if (crash) {
      problems.push(`crash in the season: ${crash}`)
      return problems
    }
    if (!g) {
      problems.push('game gone')
      return problems
    }
    if (g.phase === 'kickoff') {
      const k = kickoffStep(g)
      if (k === 'managers') {
        const opts = quickManagerOptions(g)
        act('season:pickManager').pickManager(ch.pick(opts).id)
      } else if (k === 'case') {
        if (!g.endCase?.opened) act('season:openCase').openCase()
        else if (g.endCase.drop.kind === 'icon') {
          const choices = caseIconChoices(g, u)
          act('season:subCaseIcon').subCaseIcon(choices.length && ch.chance(0.7) ? ch.pick(choices).slotId : null)
        } else act('season:finishCase').finishCase()
      } else {
        if (ch.chance(0.3)) st().setTactics({ mentality: ch.pick(['defensive', 'balanced', 'attacking'] as const) })
        if (ch.chance(0.3)) st().setCaptain(ch.pick(Object.values(g.lineup)))
        act('season:kickOff').kickOff(ch.chance(0.2))
      }
    } else if (g.phase === 'january') {
      const j = g.quickJanuary!
      // A bench change in the first half, sometimes, before the window
      maybeBenchChange(u, ch, problems)
      const g1 = st().game!
      if (g1.phase !== 'january') continue
      const gamble = januaryGambleOn(g1)
      const r = ch.int(0, 9)
      if (gamble && r === 0 && !j.spin && !j.upgrade) {
        act('season:januarySpin').januarySpin()
        const after = st().game!
        if (after.quickJanuary?.spin) {
          const choices = openSpinChoices(after, u)
          act('season:closeJanuarySpin').closeJanuarySpin(choices.length && ch.chance(0.6) ? ch.pick(choices).slotId : null)
        } else if (st().toast && !crashToast()) {
          useStore.setState({ toast: null })
          st().closeJanuary(null)
        }
      } else if (gamble && r === 1 && !j.spin && !j.upgrade) {
        act('season:januaryUpgrade').januaryUpgrade(ch.pick(Object.values(g1.lineup)), ch.pick([2, 5, 10]))
        if (st().toast && !crashToast()) useStore.setState({ toast: null })
        st().closeJanuary(null)
      } else if (j.listings.length && r < 6) act('season:closeJanuary listing').closeJanuary(ch.int(0, j.listings.length - 1))
      else act('season:closeJanuary pass').closeJanuary(null)
      const t = st().toast
      if (t && !crashToast() && !t.startsWith('The league data')) useStore.setState({ toast: null })
      if (t?.startsWith('The league data')) problems.push(`January redrawn: ${t}`)
    } else if (g.phase === 'summary') {
      if (g.quickOpen) {
        maybeBenchChange(u, ch, problems)
        if (ch.chance(0.5)) {
          act('season:endPlayback').endPlayback()
          return problems
        }
      } else {
        act('season:endPlayback').endPlayback()
        return problems
      }
    } else {
      problems.push(`unexpected phase ${g.phase}`)
      return problems
    }
  }
  problems.push('quick season did not reach its summary in 60 steps')
  return problems
}

function maybeBenchChange(u: LoadedUniverse, ch: Chooser, problems: string[]): void {
  const st = () => useStore.getState()
  const g = st().game!
  const results = playbackResults(g)
  if (!results.length || !ch.chance(0.5)) return
  const revealed = ch.int(0, results.length - 1)
  if (quickChangeProblem(g, u, results, revealed)) return
  const view = quickSquadAt(g, u, results, revealed)
  const slot = ch.pick(Object.keys(view.lineup))
  const inId = ch.pick(view.bench)
  const problem = quickChangeProblem(g, u, results, revealed, { slotId: slot, inId })
  act('season:benchChange').benchChange(revealed, slot, inId)
  const crash = crashToast()
  if (crash) problems.push(`bench change ${slot} <- ${inId} at ${revealed}: ${crash}`)
  if (problem) useStore.setState({ toast: null })
  else if (st().toast) {
    problems.push(`allowed bench change refused: ${st().toast}`)
    useStore.setState({ toast: null })
  }
}

/** Hand the worker its event loop between two long seeded runs, so Vitest's heartbeat to the main process gets through. */
export const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * How many seeds a QA sweep plays: a share of the full count by default, so the suite stays quick in CI, and every
 * one with `QA_FULL=1` (the counts docs/QA.md reports). At least one.
 */
export const QA_FULL = !!process.env.QA_FULL
export function seeds(full: number): number {
  return QA_FULL ? full : Math.max(1, Math.round(full * 0.35))
}
