import { afterEach, describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { wheelSeasons } from '@engine/era'
import type { SquadStatus } from '@engine/status'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { compactGame } from '../logic/compact'
import { encodeSave, parseSave } from '../saveStorage'
import { canonicalJson } from '../../online/core/canonical'
import { persistedState, useStore } from '../store'
import { officeActions } from '../officeActions'
import { officeItems } from '../logic/office'
import { MAX_OPEN_PROMISES, PROMISE_LIST_CAP, promiseProgress } from '../logic/promises'
import { openRequests, restlessPlayers } from '../logic/transferRequests'
import { TOPIC_TONES, type ConversationTopic } from '../logic/conversations'
import { PRESS_ANSWERS, pressQuestions } from '../logic/pressConference'
import { feeTalkOf, openingStatus, termsDemand } from '../logic/transferTalks'
import { MORALE_LOG_CAP } from '../logic/happiness'
import type { Game, GameSettings, Mode } from '../types'
import { badValues, breathe, Chooser, count, crashToast, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

/**
 * QA round 4 (r9): the manager's Office through the store. A random manager plays a Season or a Dynasty and, beside
 * the Dugout's own decisions, works the office at random every step: promises of every kind, answers to transfer
 * requests (player power on and off), conversations on every topic and tone (some that are not), the week's press
 * conference, fee talks with counters, personal terms, walking away, counter-bids on AI offers and the transfer
 * list. After every step the office's state is checked whole; each run is played twice, once with the page reloaded
 * at random steps, and must end on the same game.
 */
const u = loadTestUniverse(['england'])
const st = () => useStore.getState()
type Store = ReturnType<typeof useStore.getState>
const STATUSES: SquadStatus[] = ['key', 'first-team', 'rotation', 'backup', 'prospect']

function reloadNow(): void {
  const s = st()
  const raw = encodeSave(JSON.stringify({ state: persistedState(s), version: 1 }))
  const value = parseSave<Record<string, unknown>>(raw)
  const merge = useStore.persist.getOptions().merge!
  const fresh: Store = { ...useStore.getInitialState(), universe: s.universe, loadedLeagues: s.loadedLeagues }
  useStore.setState(merge(value.state, fresh) as Store, true)
}

function comparable(g: Game | null): string {
  if (!g) return 'null'
  return canonicalJson(compactGame(g)).split(g.id).join('ID').replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"T"')
}

/** Everything that must hold of the office at any step. */
export function officeProblems(g: Game): string[] {
  const out: string[] = []
  const o = g.office
  out.push(...badValues(g.finances, 'finances'))
  if (!o) return out
  out.push(...badValues(o, 'office'))
  const get = (id: string) => g.customPlayers[id] ?? u.index[id]
  const squadByPerson = new Map(Object.keys(g.squad).map((id) => [get(id)?.playerId, id]))
  const promises = o.promises ?? []
  if (promises.length > PROMISE_LIST_CAP) out.push(`${promises.length} promises kept`)
  const open = promises.filter((p) => p.state === 'open' && p.year === g.year)
  if (open.length > MAX_OPEN_PROMISES) out.push(`${open.length} open promises`)
  const s = g.season
  for (const p of open) {
    if (!squadByPerson.has(p.playerId)) out.push(`open promise to ${p.name}, who is not in the squad`)
    if (s && p.due > s.matchweeks) out.push(`promise to ${p.name} due at ${p.due} of ${s.matchweeks}`)
    if (p.due < p.madeAt) out.push(`promise to ${p.name} due before it was made`)
    // The tick settles a due promise at once: one still open past its week is stuck
    if (s && p.kind !== 'signing' && s.matchweek > p.due && !g.live) out.push(`${p.kind} promise to ${p.name} due ${p.due} still open at ${s.matchweek}`)
  }
  for (const p of promises) if (p.state !== 'open' && p.settledAt === undefined) out.push(`settled promise to ${p.name} without a week`)
  for (const [pid, r] of Object.entries(o.requests ?? {})) {
    if (r.playerId !== pid) out.push(`request keyed ${pid} for ${r.playerId}`)
    if (r.stage === 'open' && r.year === g.year && !squadByPerson.has(pid)) out.push(`open request from ${r.name}, who has gone`)
    const id = squadByPerson.get(pid)
    if (r.stage === 'listed' && id && !g.contracts[id]?.listed) out.push(`${r.name} listed on request but not on the list`)
    if (r.stage !== 'open' && r.settledAt === undefined) out.push(`settled request of ${r.name} without a week`)
  }
  for (const [listingId, t] of Object.entries(o.feeTalks ?? {})) {
    if (t.window !== (g.window ? `${g.year}:${g.window.kind}` : null)) out.push(`fee talks for ${listingId} outlived window ${t.window}`)
    if (t.agreed && t.closed) out.push(`fee talks for ${listingId} agreed and closed`)
    if (!g.window?.listings.some((l) => l.playerSeasonId === listingId)) out.push(`fee talks for ${listingId}, not listed`)
  }
  for (const [k, t] of Object.entries(o.sellTalks ?? {})) if (t.window !== (g.window ? `${g.year}:${g.window.kind}` : null)) out.push(`sell talks ${k} outlived window ${t.window}`)
  for (const inst of o.instalments ?? []) {
    if (!(inst.left > 0) || !(inst.amount >= 0)) out.push(`instalment ${JSON.stringify(inst)}`)
    if (s && g.settings.mode === 'season' && s.matchweek >= s.matchweeks) out.push(`instalment to ${inst.name} left at the season's end`)
  }
  for (const [id, sp] of Object.entries(g.squad)) {
    if (sp.morale < 10 || sp.morale > 100) out.push(`${id} morale ${sp.morale}`)
    if ((sp.moraleLog?.length ?? 0) > MORALE_LOG_CAP) out.push(`${id} morale log ${sp.moraleLog?.length}`)
  }
  for (const [id, c] of Object.entries(g.contracts)) if (c.listed && c.loan) out.push(`${id} listed while on loan`)
  // The views the Office tab reads hold up
  try {
    const words = [...officeItems(g, u).map((x) => `${x.kind} ${x.name ?? ''} ${x.weeks ?? ''}`), ...promiseProgress(g, u).map((p) => `${p.line} ${p.progress}`), ...restlessPlayers(g, u).map((r) => `${r.id} ${r.pressure.score} ${r.pressure.reason}`)]
    out.push(...badValues(words, 'office views'))
    for (const w of words) if (/\b(undefined|NaN)\b/.test(w)) out.push(`office words: ${w}`)
  } catch (e) {
    out.push(`office views threw: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}

/** One office decision at random. Refusals are fine; a throw is the store's crash toast. */
function workOffice(g: Game, ch: Chooser, problems: string[]): void {
  if (g.phase !== 'week' && g.phase !== 'preseason') return
  if (g.live) return
  const ids = Object.keys(g.squad).sort()
  if (!ids.length) return
  const r = g.window && ch.chance(0.6) ? ch.int(4, 8) : ch.int(0, 11)
  const line = (x: { ok: boolean; message: string }, what: string) => {
    if (typeof x.message !== 'string' || !x.message || /\b(undefined|NaN)\b/.test(x.message)) problems.push(`${what}: "${x.message}"`)
  }
  if (r === 0) {
    count('office:promise')
    line(officeActions.makePromise(ch.pick(ids), ch.pick(['minutes', 'contract', 'signing'] as const), ch.pick(['regular', 'more'] as const)), 'makePromise')
  } else if (r === 1) {
    const reqs = openRequests(g)
    if (!reqs.length) return
    const req = ch.pick(reqs)
    const id = ids.find((x) => (g.customPlayers[x] ?? u.index[x])?.playerId === req.playerId)
    if (!id) return problems.push(`open request from ${req.name}, not in the squad`), undefined
    count('office:answer')
    line(officeActions.answerRequest(id, ch.pick(['talk', 'promise-minutes', 'promise-contract', 'list', 'refuse'] as const)), 'answerRequest')
  } else if (r === 2) {
    const topic = ch.pick(Object.keys(TOPIC_TONES) as ConversationTopic[])
    // Now and then a tone the topic does not take: refused, never applied
    const tone = ch.chance(0.1) ? ch.pick(['encourage', 'demand', 'explain', 'promise', 'promote', 'project'] as const) : ch.pick(TOPIC_TONES[topic])
    count('office:converse')
    line(officeActions.converse(ch.pick(ids), topic, tone), 'converse')
  } else if (r === 3) {
    const qs = pressQuestions(g, u)
    if (!qs.length) return
    const q = ch.pick(qs)
    count('office:press')
    line(officeActions.answerPress(q, ch.chance(0.05) ? 'shrug' : ch.pick(Object.keys(PRESS_ANSWERS[q]))), 'answerPress')
  } else if (r >= 4 && r <= 7 && g.window) {
    const open = g.window.listings.filter((l) => l.status === 'available' || l.status === 'bidding')
    if (!open.length) return
    const talking = open.filter((l) => feeTalkOf(g, l.playerSeasonId))
    const l = talking.length && ch.chance(0.6) ? ch.pick(talking) : ch.pick(open)
    const t = feeTalkOf(g, l.playerSeasonId)
    if (t?.agreed) {
      const status = ch.chance(0.5) ? openingStatus(g, u, l.playerSeasonId) : ch.pick(STATUSES)
      const d = termsDemand(g, u, l.playerSeasonId, status)
      if (!d) return problems.push(`agreed fee for ${l.playerSeasonId} with no demand`), undefined
      count('office:terms')
      const out = officeActions.offerTerms(l.playerSeasonId, { wage: Math.round(d.wage * ch.pick([0.7, 1, 1.1])), years: ch.int(1, 5), status, signingFee: ch.pick([0, d.agentFee, d.agentFee * 2]) })
      line(out, 'offerTerms')
      if (out.signed && !st().game!.squad[l.playerSeasonId]) problems.push(`signed ${l.playerSeasonId} but he is not in the squad`)
    } else if (ch.chance(0.1)) {
      count('office:walkAway')
      officeActions.walkAway(l.playerSeasonId)
    } else {
      count('office:fee')
      const fee = t?.counter && ch.chance(0.6) ? t.counter : Math.round(l.asking * ch.pick([0.5, 0.8, 0.9, 1, 1.1]) * 10) / 10
      const out = officeActions.proposeFee(l.playerSeasonId, { fee, sellOn: ch.pick([0, 0.1, 0.2]), instalments: ch.pick([1, 2, 3] as const) })
      line(out, 'proposeFee')
      if (out.outcome === 'counter' && !(out.counter! > 0)) problems.push(`counter ${out.counter}`)
    }
  } else if (r === 8 && g.window) {
    const i = g.window.offers.findIndex((o) => o.status === 'open')
    if (i < 0) return
    count('office:counterBid')
    const out = officeActions.counterBid(i, Math.round(g.window.offers[i].amount * ch.pick([0.9, 1.1, 1.25, 1.5, 3]) * 10) / 10)
    line(out, 'counterBid')
  } else if (r === 9) {
    const id = ch.pick(ids)
    count('office:list')
    line(officeActions.setListed(id, !g.contracts[id]?.listed), 'setListed')
  } else if (r === 10 && ch.chance(0.2)) {
    count('office:playerPower')
    st().setPlayerPower(!g.settings.playerPower)
  }
}

function settings(mode: Mode, seed: string, ch: Chooser, playerPower: boolean): GameSettings {
  const leagueId = 'england'
  const stops = wheelSeasons(u, [leagueId], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: 18 }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: false, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.complete && !cs.classic).map((cs) => cs.season))].sort()
  const leagueSeason = mode === 'dynasty' ? seasons[Math.max(0, seasons.length - 4)] : ch.pick(seasons)
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode, seed, formationId: '4-3-3', teamName: 'R9 Office', shortName: shortNameFor('R9 Office'), leagueId, wheelLeagues: [leagueId], hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: false, difficulty: 'calibrated', ...(playerPower ? { playerPower: true } : {}) }
}

interface Played {
  problems: string[]
  game: string
  reloads: number
  office: boolean
}

function play(mode: Mode, seed: string, power: boolean, p: number, workRate: number): Played {
  const ch = new Chooser(seed)
  // The office's own choices draw from a stream of their own, so a reload (which draws nothing) keeps both runs aligned
  const officeCh = new Chooser(`${seed}:office`)
  const reloads = new Rng(`reload:${seed}`)
  let n = 0
  let office = false
  const problems: string[] = []
  stepHook.run = () => {
    const g = st().game
    if (!g) return
    if (g.office) office = true
    if (problems.length < 6) problems.push(...officeProblems(g).map((x) => `y${g.year} mw ${g.season?.matchweek} ${g.phase}: ${x}`))
    if (officeCh.chance(workRate)) for (let k = officeCh.int(1, 4); k > 0; k--) workOffice(st().game ?? g, officeCh, problems)
    const crash = crashToast()
    if (crash) problems.push(`office crash: ${crash}`)
    if (p > 0 && reloads.chance(p) && !st().digest) {
      reloadNow()
      n++
    }
  }
  loadStore(u, ['england'])
  const draft = (label: string) => driveDraft(u, ch, { autoAt: 0 }).problems.map((x) => `${label}: ${x}`)
  st().startGame(settings(mode, seed, ch, power))
  problems.push(...draft('draft'))
  if (!problems.length) problems.push(...driveSeason(u, ch, { years: mode === 'dynasty' ? 1 : 0, draft, simBias: 3 }).problems)
  const crash = crashToast()
  if (crash) problems.push(crash)
  stepHook.run = undefined
  return { problems, game: comparable(st().game), reloads: n, office }
}

afterEach(() => {
  stepHook.run = undefined
})

describe('QA r9: the Office worked at random through a managed season, checked at every step and across reloads', () => {
  const runs: Array<[Mode, boolean, number]> = [['season', false, 0.5], ['season', true, 0.5], ['dynasty', true, 0.4], ['season', true, 0.9], ['dynasty', false, 0.6], ['season', false, 0.35]]
  for (const [i, [mode, power, rate]] of runs.entries()) {
    if (i >= seeds(runs.length)) continue
    it(`${mode}, player power ${power ? 'on' : 'off'}, ${Math.round(rate * 100)}% of steps`, async () => {
      const seed = `r9-office-${i}-${mode}-${power}`
      await breathe()
      const a = play(mode, seed, power, 0, rate)
      await breathe()
      const b = play(mode, seed, power, 0.1, rate)
      expect(a.office, 'the office was used').toBe(true)
      expect([...a.problems, ...b.problems.map((x) => `reloaded: ${x}`)]).toEqual([])
      if (a.game !== b.game) {
        const ga = JSON.parse(a.game) as Record<string, unknown>
        const gb = JSON.parse(b.game) as Record<string, unknown>
        const diff = Object.keys({ ...ga, ...gb }).filter((k) => JSON.stringify(ga[k]) !== JSON.stringify(gb[k]))
        expect(diff, `${b.reloads} reloads`).toEqual([])
      }
      expect(b.reloads).toBeGreaterThan(0)
    }, 400_000)
  }
})

describe('QA r9: the transfer talks worked hard inside one window', () => {
  /** A Season through the store to its first open window: pre-season's, or January's. */
  function toWindow(seed: string, january: boolean): Game {
    loadStore(u, ['england'])
    const ch = new Chooser(seed)
    st().startGame(settings('season', seed, ch, false))
    driveDraft(u, ch, { autoAt: 0 })
    if (st().game?.phase === 'draft') st().finishDraft()
    for (let i = 0; i < 60 && st().game && (january ? st().game!.season!.matchweek < 19 || !st().game!.window : !st().game!.window); i++) {
      if (st().game!.phase === 'match') st().closeMatch()
      else st().simWeeks(1)
      if (st().digest) st().dismissDigest()
    }
    return st().game!
  }

  for (const [i, january] of [[0, false], [1, true], [2, false], [3, true], [4, false], [5, true]] as const) {
    if (i >= seeds(6)) continue
    it(`${january ? 'January' : 'pre-season'} window ${i}`, () => {
      const seed = `r9-talks-${i}`
      const g0 = toWindow(seed, january)
      expect(g0.window, 'a window opened').toBeTruthy()
      const ch = new Chooser(`${seed}:talks`)
      const problems: string[] = []
      let signed = 0
      for (let step = 0; step < 400 && st().game?.window; step++) {
        const g = st().game!
        const before = g.finances.budget
        const open = g.window!.listings.filter((l) => l.status === 'available' || l.status === 'bidding')
        const r = ch.int(0, 9)
        if (r === 0) {
          st().advanceDay()
          continue
        }
        if (r === 1 && g.window!.offers.some((o) => o.status === 'open')) {
          const k = g.window!.offers.findIndex((o) => o.status === 'open')
          const out = officeActions.counterBid(k, Math.round(g.window!.offers[k].amount * ch.pick([1.05, 1.15, 1.3, 2]) * 10) / 10)
          if (out.sold && st().game!.squad[g.window!.offers[k].playerSeasonId]) problems.push('sold but still in the squad')
          continue
        }
        if (r === 2) {
          const id = ch.pick(Object.keys(g.squad))
          officeActions.setListed(id, !g.contracts[id]?.listed)
          continue
        }
        if (!open.length) continue
        const talking = open.filter((l) => feeTalkOf(g, l.playerSeasonId))
        const l = talking.length && ch.chance(0.7) ? ch.pick(talking) : ch.pick(open)
        const t = feeTalkOf(g, l.playerSeasonId)
        const askingBefore = l.asking
        if (t?.agreed) {
          const status = ch.chance(0.6) ? openingStatus(g, u, l.playerSeasonId) : ch.pick(STATUSES)
          const d = termsDemand(g, u, l.playerSeasonId, status)!
          const signingFee = ch.pick([0, d.agentFee, d.agentFee * 3])
          const out = officeActions.offerTerms(l.playerSeasonId, { wage: Math.round(d.wage * ch.pick([0.5, 0.9, 1, 1.05])), years: ch.int(1, 5), status, signingFee })
          const after = st().game!
          const listing = after.window?.listings.find((x) => x.playerSeasonId === l.playerSeasonId)
          if (out.signed) {
            signed++
            const plan = Math.round((t.agreed.fee * { 1: 1, 2: 0.5, 3: 0.4 }[t.agreed.instalments]) * 10) / 10
            const paid = Math.round((before - after.finances.budget) * 10) / 10
            if (Math.abs(paid - Math.round((plan + Math.round(signingFee * 10) / 10) * 10) / 10) > 0.11) problems.push(`signed ${l.playerSeasonId}: paid ${paid}, due ${plan} + ${signingFee}`)
            if (!after.squad[l.playerSeasonId]) problems.push(`signed ${l.playerSeasonId}, not in the squad`)
          } else if (!out.ok && listing && listing.asking !== askingBefore) problems.push(`refused terms (${out.message}) moved the asking price ${askingBefore} -> ${listing.asking}`)
        } else {
          const fee = t?.counter && ch.chance(0.7) ? t.counter : Math.round(l.asking * ch.pick([0.6, 0.85, 0.92, 1, 1.05]) * 10) / 10
          officeActions.proposeFee(l.playerSeasonId, { fee, sellOn: ch.pick([0, 0.1, 0.2]), instalments: ch.pick([1, 2, 3] as const) })
        }
        const crash = crashToast()
        if (crash) problems.push(crash)
        problems.push(...officeProblems(st().game!))
        if (problems.length) break
      }
      expect(problems).toEqual([])
      // The deals in instalments are paid off by the season's end
      expect(signed).toBeGreaterThan(0)
      st().simToEnd()
      for (let k = 0; k < 50 && st().game?.phase !== 'summary'; k++) {
        if (st().game?.phase === 'match') st().closeMatch()
        else st().simToEnd()
      }
      expect(st().game?.phase).toBe('summary')
      expect(st().game?.office?.instalments ?? []).toEqual([])
      expect(officeProblems(st().game!)).toEqual([])
    }, 200_000)
  }
})
