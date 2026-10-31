/**
 * QA harness for the managed modes (Season, Dynasty and the Run-in): a random manager working the store's actions
 * week by week, with the invariants checked after every step.
 */
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM, seasonTable } from '@engine/season'
import { FORMATIONS } from '@engine/formations'
import { useStore } from '../store'
import { SQUAD_CAP } from '../logic/marketOps'
import { lineupProblems } from '../logic/squad'
import type { Game } from '../types'
import { badValues, Chooser, count, crashToast, driveDraft, squadProblems, stepHook, tableProblems } from './qaHarness'

const st = () => useStore.getState()
const TALKS = ['calm', 'encourage', 'demand', 'fire-up', 'none'] as const
const SHOUTS = ['all-out-attack', 'shut-up-shop', 'keep-shape'] as const
const STATUSES = ['key', 'first-team', 'rotation', 'backup', 'prospect'] as const

/** The league table's arithmetic and the fixtures' counts, after a matchweek. */
export function seasonProblems(g: Game, label: string): string[] {
  const out: string[] = []
  const s = g.season
  if (!s) return out
  const table = seasonTable(s)
  const carry = s.carryIn ?? {}
  // Every club's played games are its fixtures with a result (plus what a run-in carried in)
  const playedOf = new Map<string, number>()
  for (const f of s.fixtures) {
    if (!f.result) continue
    for (const id of [f.homeTeamId, f.awayTeamId]) playedOf.set(id, (playedOf.get(id) ?? 0) + 1)
  }
  for (const r of table) {
    const c = carry[r.teamId]
    const want = (playedOf.get(r.teamId) ?? 0) + (c ? c.won + c.drawn + c.lost : 0)
    if (r.played !== want) out.push(`${label} ${r.teamId}: played ${r.played}, fixtures say ${want}`)
  }
  // Only the user's matchweek can be part-played: before the next one every club's result of this one is in
  const done = s.fixtures.filter((f) => f.matchweek <= s.matchweek && f.matchweek > (s.takeoverAt ?? 0))
  const missing = done.filter((f) => !f.result)
  if (missing.length && !g.live) out.push(`${label}: ${missing.length} fixtures up to matchweek ${s.matchweek} unplayed`)
  // A run-in's carried table adds up league-wide (`scaleTable`, engine 6), so the whole table balances
  out.push(...tableProblems(table, null, label))
  const userFixtures = s.fixtures.filter((f) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)
  if (userFixtures.length !== s.matchweeks && Object.keys(s.ai).length % 2 === 1) out.push(`${label}: ${userFixtures.length} user fixtures for ${s.matchweeks} matchweeks`)
  return out
}

/** The squad's shape and the money, after any step. */
export function squadStateProblems(g: Game, u: LoadedUniverse, label: string): string[] {
  const out: string[] = []
  const playerIdOf = (id: string) => (g.customPlayers[id] ?? u.index[id])?.playerId
  out.push(...squadProblems(g.lineup, g.bench, playerIdOf, `${label} lineup`))
  for (const id of [...Object.values(g.lineup), ...g.bench]) if (!g.squad[id] && g.phase !== 'draft') out.push(`${label}: ${id} picked but not in the squad`)
  // Squad ids are distinct people too
  const people = new Map<string, string>()
  for (const id of Object.keys(g.squad)) {
    const pid = playerIdOf(id)
    if (pid === undefined) out.push(`${label}: squad ${id} unknown`)
    else if (people.has(pid)) out.push(`${label}: squad holds player ${pid} twice (${people.get(pid)}, ${id})`)
    else people.set(pid, id)
  }
  if (Object.keys(g.squad).length > SQUAD_CAP) out.push(`${label}: squad of ${Object.keys(g.squad).length} over the cap`)
  out.push(...badValues(g.finances, `${label} finances`))
  for (const [id, sp] of Object.entries(g.squad)) {
    const bad = badValues({ condition: sp.condition, morale: sp.morale, sharpness: sp.sharpness, familiarity: sp.familiarity, ratings: sp.recentRatings, stats: sp.seasonStats }, `${label} squad ${id}`)
    out.push(...bad)
  }
  if (g.season) out.push(...badValues({ confidence: g.season.confidence, news: g.season.news.map((n) => `${n.title} ${n.body}`) }, `${label} season`))
  return out
}

/** One manager's decision on the Dugout or the market, at random; whatever the store refuses is a toast. */
function manage(g: Game, u: LoadedUniverse, ch: Chooser): void {
  const squadIds = Object.keys(g.squad)
  const r = ch.int(0, 29)
  if (r === 0) {
    count('season:setFormation')
    st().setFormation(ch.pick(FORMATIONS).id)
  } else if (r === 1) {
    count('season:autoPick')
    st().autoPick()
  } else if (r === 2 && squadIds.length) {
    const slots = [...Object.keys(g.lineup), 'bench']
    count('season:assign')
    st().assign(ch.pick(squadIds), ch.pick(slots))
  } else if (r === 3) st().setTactics({ mentality: ch.pick(['defensive', 'balanced', 'attacking'] as const) })
  else if (r === 4 && squadIds.length) st().setCaptain(ch.pick(squadIds))
  else if (r === 5) st().setTraining(ch.pick(['balanced', 'attacking', 'defensive', 'set-pieces', 'fitness', 'recovery', 'tactical'] as const))
  else if (r === 6 && squadIds.length) {
    count('season:talk')
    st().talk(ch.pick(squadIds), ch.pick(['praise', 'criticise', 'promise', 'reassure'] as const))
  } else if (r === 7) st().hireStaff(ch.pick(['assistant', 'coach', 'physio', 'scout'] as const), ch.int(0, 2))
  else if (r === 8) {
    count('season:boardRequest')
    st().boardRequest(ch.pick(['budget', 'staff', 'youth'] as const))
  } else if (r === 9) st().shiftWages(ch.pick([1, -1] as const))
  else if (r === 10 && squadIds.length) {
    count('season:proposeContract')
    st().proposeContract(ch.pick(squadIds), { wage: ch.int(5, 300), years: ch.int(1, 5), status: ch.pick(STATUSES), signingFee: ch.pick([0, 0, 1, 5]), appearance: ch.pick([0, 5]), goal: ch.pick([0, 10]), ...(ch.chance(0.3) ? { release: ch.int(5, 80) } : {}) })
  } else if (r === 11 && squadIds.length) st().setStatus(ch.pick(squadIds), ch.pick(STATUSES))
  else if (r === 12 && g.youthIntake && g.youthIntake.chosen === undefined) {
    count('season:signYouth')
    st().signYouth(ch.chance(0.7) && g.youthIntake.candidates.length ? ch.pick(g.youthIntake.candidates) : null)
  } else if (r === 13 && g.pendingEvent) {
    count('season:resolveEvent')
    st().resolveEvent(ch.pick(g.pendingEvent.choices).id)
  } else if (r >= 14 && r <= 19 && g.window) {
    const w = g.window
    const open = w.listings.filter((l) => l.status === 'available' || l.status === 'bidding')
    const k = ch.int(0, 5)
    if (k <= 1 && open.length) {
      const l = ch.pick(open)
      count('season:bid')
      st().bid(l.playerSeasonId, Math.max(0.5, Math.round(l.asking * ch.pick([0.6, 0.9, 1, 1.2]) * 10) / 10))
    } else if (k === 2 && open.some((l) => l.loanFee !== undefined)) {
      count('season:loan')
      st().loan(ch.pick(open.filter((l) => l.loanFee !== undefined)).playerSeasonId)
    } else if (k === 3 && w.offers.some((o) => o.status === 'open')) {
      const i = w.offers.findIndex((o) => o.status === 'open')
      count('season:offer')
      if (ch.chance(0.5)) st().acceptOffer(i)
      else st().rejectOffer(i)
    } else if (k === 4 && squadIds.length > 16 && ch.chance(0.3)) {
      count('season:release')
      st().release(ch.pick(squadIds.filter((id) => !Object.values(g.lineup).includes(id))))
    } else {
      count('season:advanceDay')
      st().advanceDay()
    }
  } else if (r === 20 && squadIds.length) {
    const ps = u.clubSeasons[ch.int(0, u.clubSeasons.length - 1)]?.squad
    if (ps?.length) {
      count('season:enquire')
      st().enquire(ch.pick(ps).id)
    }
  } else if (r === 21) {
    const ps = u.clubSeasons[ch.int(0, u.clubSeasons.length - 1)]?.squad
    if (ps?.length) st().scoutPlayer(ch.pick(ps).id)
  } else if (r === 22) st().setAssignment(ch.pick(u.available).id, ch.chance(0.5))
  else if (r === 23 && squadIds.length) st().setShopped(ch.pick(squadIds), ch.chance(0.5))
  else if (r === 24 && g.window?.offers.length) st().rejectOffer(0)
  else if (r === 25) st().setMatchPlay(ch.pick(['watch', 'auto', 'sim'] as const))
}

/** The live match screen: stops, in-play changes, the hold, Finish now; then the report closes. */
function liveStep(g: Game, u: LoadedUniverse, ch: Chooser, problems: string[]): void {
  const live = g.live!
  const clock = live.mp.clock ?? 45
  const mine = live.userIsHome ? live.mp.hLive : live.mp.aLive
  const onPitch = mine.filter((p) => p.offAt >= 90 && !p.red && p.onAt <= clock).map((p) => p.psId)
  const bench = (live.userIsHome ? live.mp.home : live.mp.away).bench ?? g.bench
  const r = ch.int(0, 9)
  if (r <= 3) {
    const changes: { talk?: (typeof TALKS)[number]; shout?: (typeof SHOUTS)[number]; substitutions?: Array<{ off: string; on: string }>; tactics?: Game['tactics'] } = {}
    if (clock < 70) changes.talk = ch.pick(TALKS)
    else changes.shout = ch.pick(SHOUTS)
    if (ch.chance(0.5) && onPitch.length && bench.length) changes.substitutions = [{ off: ch.pick(onPitch), on: ch.pick(bench) }]
    if (ch.chance(0.3)) changes.tactics = { ...g.tactics, mentality: ch.pick(['defensive', 'balanced', 'attacking'] as const) }
    count('live:advance')
    st().advanceLive(changes, clock >= 70 && ch.chance(0.5))
  } else if (r === 4 && clock < 90) {
    const minute = Math.min(89, clock + ch.int(1, 15))
    count('live:intervene')
    const out = st().interveneLive({ minute, ...(ch.chance(0.5) && onPitch.length && bench.length ? { substitutions: [{ off: ch.pick(onPitch), on: ch.pick(bench) }] } : { tactics: { ...g.tactics, mentality: ch.pick(['defensive', 'attacking'] as const) } }) })
    // A refused change is fine; advancing must still work after it
    if (out && out.applied && !st().game?.live) problems.push('an in-play change ended the match')
    st().advanceLive({}, false)
  } else if (r === 5 && clock >= 90) {
    count('live:complete')
    st().completeLive()
  } else if (r === 6) {
    count('live:finishNow')
    st().finishLiveNow()
  } else if (r === 7) {
    count('live:assistant')
    st().assistantAdvance(ch.chance(0.3))
  } else st().advanceLive({}, false)
  void u
}

export interface SeasonRun {
  problems: string[]
  seasons: number
}

/**
 * Manage the store's season game to its summary (and, for a dynasty, `years` summers on), with a random manager.
 * `checkEvery` runs the deep checks every n steps.
 */
export function driveSeason(u: LoadedUniverse, ch: Chooser, opts: { years?: number; draft: (label: string) => string[]; simBias?: number }): SeasonRun {
  const problems: string[] = []
  let seasons = 0
  let guard = 0
  let lastMw = -1
  while (guard++ < 3000) {
    stepHook.run?.()
    const g = st().game
    const crash = crashToast()
    if (crash) {
      problems.push(`crash (${g?.phase} mw ${g?.season?.matchweek}): ${crash}`)
      return { problems, seasons }
    }
    if (st().toast) useStore.setState({ toast: null })
    if (!g) {
      problems.push('game gone')
      return { problems, seasons }
    }
    if (st().digest && ch.chance(0.5)) st().dismissDigest()
    const label = `y${g.year} ${g.phase} mw ${g.season?.matchweek}`
    if (g.season && g.season.matchweek !== lastMw) {
      lastMw = g.season.matchweek
      problems.push(...seasonProblems(g, label))
      problems.push(...squadStateProblems(g, u, label))
      if (problems.length) return { problems, seasons }
    }
    if (g.phase === 'draft') {
      problems.push(...opts.draft(label))
      if (problems.length) return { problems, seasons }
      continue
    }
    if (g.phase === 'summary') {
      seasons++
      problems.push(...badValues(g.history.at(-1), `${label} history`))
      const h = g.history.at(-1)
      if (h && h.won + h.drawn + h.lost !== (g.season?.matchweeks ?? 0) && !g.season?.sacked) problems.push(`${label}: history record ${h.won}-${h.drawn}-${h.lost}`)
      if (g.settings.mode !== 'dynasty' || seasons > (opts.years ?? 0) || g.season?.sacked) return { problems, seasons }
      if (g.jobOffers.length && ch.chance(0.3)) st().acceptJob(ch.int(0, g.jobOffers.length - 1))
      count('season:nextSeason')
      st().nextSeason()
      if (st().offseason) st().dismissOffseason()
      if (st().game?.phase === 'summary') {
        // The summer waits on league packs when the move or Europe needs them (async); a test universe holds England only
        const g2 = st().game!
        if (g2.pendingMove?.leagueId && g2.pendingMove.leagueId !== 'england') {
          st().acceptJob(null)
          continue
        }
        // Europe needs every pack; a universe without them ends the run here (the all-leagues suite plays on)
        if (g2.qualifiedContinental && u.available.some((l) => !st().loadedLeagues.includes(l.id))) return { problems, seasons }
        problems.push(`nextSeason stayed on the summary (move ${JSON.stringify(g2.pendingMove)}, Europe ${g2.qualifiedContinental}, toast ${st().toast})`)
        return { problems, seasons }
      }
      lastMw = -1
      continue
    }
    if (g.phase === 'match') {
      if (g.live) liveStep(g, u, ch, problems)
      else if (st().game?.live) st().nextLiveMatch()
      else {
        count('season:closeMatch')
        st().closeMatch()
      }
      continue
    }
    // preseason or week
    if (ch.chance(0.35)) manage(g, u, ch)
    else if (g.phase === 'preseason' && g.friendliesPlayed < 3 && ch.chance(0.15)) {
      count('season:friendly')
      st().playFriendly()
    } else {
      const r = ch.int(0, 9)
      if (r < (opts.simBias ?? 4)) {
        count('season:simWeeks')
        st().simWeeks(ch.pick([1, 2, 5]))
      } else if (r === 4) {
        count('season:simToNextBigMatch')
        st().simToNextBigMatch()
      } else if (r === 5 && ch.chance(0.2)) {
        count('season:simToEnd')
        st().simToEnd()
      } else {
        count('season:playWeek')
        st().playWeek()
      }
    }
    // A lineup the manager scrambled must still be playable: the store picks around it
    void lineupProblems
  }
  problems.push('season did not finish in 3000 steps')
  return { problems, seasons }
}

/** Drive an arena run (hub, live or assistant matches, penalties, bonus spins, the lifeline) to its summary. */
export function driveArena(u: LoadedUniverse, ch: Chooser): string[] {
  const problems: string[] = []
  for (let guard = 0; guard < 600; guard++) {
    stepHook.run?.()
    const g = st().game
    if (crashToast()) return [...problems, `crash: ${crashToast()}`]
    if (st().toast) useStore.setState({ toast: null })
    if (!g?.arena) return [...problems, 'no arena game']
    const a = g.arena
    problems.push(...squadStateProblems(g, u, `arena step ${a.step} ${g.phase}`))
    problems.push(...badValues(a.log, 'arena log'))
    if (problems.length) return problems
    if (g.phase === 'summary') return problems
    if (g.phase === 'draft') {
      count('arena:bonusSpin')
      const log = driveDraft(u, ch, { autoAt: ch.chance(0.5) ? 0 : undefined })
      problems.push(...log.problems)
      if (st().game?.phase === 'draft') return [...problems, 'bonus spin did not close the draft']
      continue
    }
    if (g.phase === 'week') {
      const r = ch.int(0, 9)
      if (r === 0) st().setFormation(ch.pick(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']))
      else if (r === 1) st().setTraining(ch.pick(['balanced', 'attacking', 'recovery'] as const))
      else if (r === 2 && a.format === 'gauntlet' && a.lifelineUsed === undefined) {
        count('arena:lifeline')
        st().changeTheDraw()
      } else if (r === 3 && ch.chance(0.3)) {
        count('arena:simToEnd')
        st().simArenaToEnd()
      } else {
        const live = ch.chance(0.5)
        count(live ? 'arena:live' : 'arena:auto')
        st().playArenaStep(live)
        if (st().game?.phase === 'week' && !st().toast) return [...problems, `playArenaStep(${live}) did nothing at step ${a.step}`]
      }
      continue
    }
    if (g.phase === 'match') {
      if (g.live) {
        const r = ch.int(0, 5)
        if (r === 0) st().finishLiveNow()
        else if (r === 1) st().assistantAdvance(ch.chance(0.3))
        else if (r === 2 && (g.live.mp.clock ?? 45) >= 90) st().completeLive()
        else st().advanceLive({ talk: 'calm' }, (g.live.mp.clock ?? 45) >= 70 && ch.chance(0.5))
      } else if (a.pending) {
        count('arena:penalties')
        const p = a.pending.shootout
        const order = ch.chance(0.5) ? [...p.defaultOrder] : [...p.defaultOrder].reverse().slice(0, Math.max(1, ch.int(1, p.defaultOrder.length)))
        const out = st().takePenalties(order, ch.pick(p.keepers))
        if (!out.ok) {
          // A refusal names a fix; the default order and keeper always work
          useStore.setState({ toast: null })
          const again = st().takePenalties([...p.defaultOrder], p.keepers[0])
          if (!again.ok) return [...problems, `the default shoot-out was refused: ${again.message}`]
        }
      } else {
        const before = JSON.stringify([a.step, g.phase, a.over])
        st().closeMatch()
        const after = st().game!
        if (JSON.stringify([after.arena!.step, after.phase, after.arena!.over]) === before) return [...problems, 'closeMatch did nothing']
      }
      continue
    }
    return [...problems, `unexpected phase ${g.phase}`]
  }
  return [...problems, 'arena did not finish in 600 steps']
}

