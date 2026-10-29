/**
 * QA round 4 (r9): round 8's screens server-rendered from states the store reaches. The share text of every summary
 * (Quick Draft, Daily, Season, Dynasty, the arena's three formats, the Run-in) with plain and emoji team names; the
 * Office tab and its Inbox box while a manager works the office at random, in English and the pseudo-locale; and
 * Explore's player card tabs (Career, Best seasons, Roles, Similar) and Records in all seven leagues.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { useStore } from '@game/store'
import { officeActions } from '@game/officeActions'
import { dailyGameSettings, setupRules } from '@game/logic/setup'
import { cupGameSettings, finalGameSettings, gauntletGameSettings } from '@game/logic/arena'
import { runInGameSettings } from '@game/logic/runin'
import { pressQuestions, PRESS_ANSWERS } from '@game/logic/pressConference'
import { openRequests } from '@game/logic/transferRequests'
import { feeTalkOf, openingStatus, termsDemand } from '@game/logic/transferTalks'
import { careerRows, bestSeasons, careerSummary, roleSuitability, similarPlayers, SIMILAR_RANGE } from '@game/logic/playerProfile'
import { playerIndex } from '@game/logic/exploreIndex'
import { leagueTrivia } from '@game/logic/exploreRecords'
import type { GameSettings, Mode } from '@game/types'
import { setLocaleMessages } from '../i18n'
import { PSEUDO_LOCALE } from '../i18n/pseudo'
import { Summary } from '../screens/Summary'
import { ArenaSummary } from '../screens/ArenaSummary'
import { RunInSummary } from '../screens/RunInSummary'
import { CounterBidControl, FeeTalkPanel, OfficeInbox, OfficeTab } from '../screens/OfficeTab'
import { BestSeasons, CareerTable, RoleList, SimilarList } from '../components/PlayerProfile'
import { RecordsView } from '../screens/ExploreRecords'
import { Chooser, badValues } from '../../game/__tests__/qaHarness'
import { openFiltered, show } from './qaSsr'

const st = () => useStore.getState()
const noop = () => {}

/** Render in English and the pseudo-locale: throws, missing keys and the markup checks. Returns the English markup. */
function renderBoth(label: string, C: ComponentType<never>, props: Record<string, unknown>, fails: string[]): string {
  let en = ''
  try {
    setLocaleMessages({ id: 'en', messages: {} })
    en = renderToString(createElement(C, props as never))
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    const pseudo = renderToString(createElement(C, props as never))
    if (en.includes('⟦') || pseudo.includes('⟦')) fails.push(`${label}: a missing key ${(en + pseudo).match(/⟦[^⟧]*⟧/)?.[0]}`)
    for (const p of openFiltered(pseudo)) fails.push(`${label} (pseudo): ${p}`)
  } catch (e) {
    fails.push(`${label} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
  for (const p of openFiltered(en)) fails.push(`${label}: ${p}`)
  // Money printed twice over: a message adding £ and M around a figure `money()` already wrote (R9-8)
  const twice = en.replace(/<[^>]+>/g, ' ').match(/.{0,30}(££|£[\d.,]+[Mk]M\b|£[\d.,]+M\s?M\b).{0,20}/)
  if (twice) fails.push(`${label}: money twice: ${twice[0]}`)
  return en
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const INVITES = /^((Beat my draft|Beat today's Daily|Beat this week's draft|Beat my final|Beat my cup run|Beat my climb|Take the same job|Draft against a friend):|Can you top this\?) \S+$/

/** Everything that must hold of a share text as it is sent. */
export function shareProblems(text: string): string[] {
  const out: string[] = []
  const lines = text.split('\n')
  if (lines.length < 3) out.push(`only ${lines.length} lines`)
  if (!INVITES.test(lines.at(-1) ?? '')) out.push(`last line is not an invitation: ${lines.at(-1)}`)
  if (/[‍\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]/u.test(text)) out.push(`invisible emoji parts: ${JSON.stringify(text.match(/.{0,12}[‍\u{E0020}-\u{E007F}].{0,12}/u)?.[0])}`)
  if (/[\u{1F1E6}-\u{1F1FF}]/u.test(text)) out.push('a flag in the share text')
  for (const l of lines) {
    if (!l.trim()) out.push('an empty line')
    if (/\b(undefined|NaN|null|Infinity)\b|\[object/.test(l)) out.push(`bad value: ${l}`)
    if (/ {2}|^\s|\s$/.test(l)) out.push(`stray spaces: ${JSON.stringify(l)}`)
    if (/:\s*$|^:|[?!]:/.test(l)) out.push(`a label with nothing after it: ${l}`)
  }
  return out
}

const NAMES = ['R9 Rovers', '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Lions', 'Família ⚽ Unida', '👨‍👩‍👧 Family FC']

/** Play the store's game to its summary the way the screens would, checking each share text the summary shows. */
function playToSummary(label: string, u: ReturnType<typeof loadTestUniverse>, settings: GameSettings, fails: string[], shares: string[]): void {
  const ch = new Chooser(label)
  show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, screen: 'game', offseason: null })
  st().startGame(settings)
  for (let i = 0; i < 2500; i++) {
    const g = st().game
    if (!g) return void fails.push(`${label}: game gone`)
    if (st().toast?.startsWith('Something went wrong')) return void fails.push(`${label}: ${st().toast}`)
    if (g.phase === 'draft') {
      st().autoDraftRest()
      st().finishDraft()
    } else if (g.phase === 'kickoff') {
      if (g.managerSpin && !g.managerSpin.picked && g.managerSpin.options.length) st().pickManager(g.managerSpin.options[0].id)
      else if (g.endCase && !g.endCase.done) {
        if (!g.endCase.opened) st().openCase()
        else if (g.endCase.drop.kind === 'icon') st().subCaseIcon(null)
        else st().finishCase()
      } else st().kickOff()
    } else if (g.phase === 'january') st().closeJanuary(null)
    else if (g.phase === 'summary') {
      if (st().playback || g.quickOpen) {
        st().endPlayback()
        continue
      }
      show({})
      const screen = g.arena ? ArenaSummary : g.settings.mode === 'runin' ? RunInSummary : Summary
      const html = renderBoth(`${label} summary`, screen as ComponentType<never>, {}, fails)
      const pre = /<pre[^>]*(?:share-text|data-testid="(?:arena|runin)-share-text")[^>]*>([\s\S]*?)<\/pre>/.exec(html)
      if (!pre) fails.push(`${label}: no share text on the summary`)
      else {
        const text = decode(pre[1].replace(/<!-- -->/g, ''))
        shares.push(text)
        fails.push(...shareProblems(text).map((p) => `${label} share: ${p}`))
      }
      if (g.settings.mode === 'dynasty' && g.year < 2) {
        st().nextSeason()
        if (st().offseason) st().dismissOffseason()
        const g2 = st().game!
        // The summer waits on league packs for Europe or a move abroad (async; this universe holds England only)
        if (g2.phase === 'summary' && !g2.qualifiedContinental && !(g2.pendingMove?.leagueId && g2.pendingMove.leagueId !== 'england')) return void fails.push(`${label}: the summer stayed on the summary (${st().toast})`)
        if (g2.phase === 'summary') return
        continue
      }
      return
    } else if (g.phase === 'match') {
      if (g.live) st().finishLiveNow()
      else if (g.arena?.pending) st().takePenalties(g.arena.pending.shootout.defaultOrder, g.arena.pending.shootout.keepers[0])
      else st().closeMatch()
    } else if (g.arena) st().playArenaStep(false)
    else {
      if (st().offseason) st().dismissOffseason()
      if (st().digest) st().dismissDigest()
      if (ch.chance(0.5)) st().simToEnd()
      else st().simWeeks(5)
    }
  }
  fails.push(`${label}: never reached the summary`)
}

describe('QA r9: the share text of every summary', () => {
  const u = loadTestUniverse(['england'])
  it('Quick Draft, Daily, Season, Dynasty, the arena and the Run-in, plain and emoji names', () => {
    const fails: string[] = []
    const shares: string[] = []
    const quick = (seed: string, name: string, ch: Chooser): GameSettings => ({ mode: 'quick', seed, formationId: '4-3-3', teamName: name, shortName: 'R9Q', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'prime', eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: ch.chance(0.5), leagues: ['england'], benchPicks: ch.pick([0, 3]), modes: [], powerUps: ch.chance(0.5), managers: true, managerSpin: ch.chance(0.5), endCase: ch.chance(0.5) }), jobSecurity: false, difficulty: 'calibrated', continental: false, january: true })
    const managed = (mode: Mode, seed: string, name: string): GameSettings => ({ mode, seed, formationId: '4-3-3', teamName: name, shortName: 'R9M', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false })
    for (const [i, name] of NAMES.entries()) {
      const seed = `r9-share-quick-${i}`
      playToSummary(seed, u, quick(seed, name, new Chooser(seed)), fails, shares)
      const c = { teamName: name, formationId: '4-3-3', field: 'giants' as const, wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed: `r9-share-arena-${i}`, hardMode: false, twists: false }
      const arena = [finalGameSettings(u, c, 'R9A'), cupGameSettings(u, { ...c, size: 8 }, 'R9A'), gauntletGameSettings(u, c, 'R9A')][i % 3]
      playToSummary(`r9-share-arena-${i}`, u, arena, fails, shares)
    }
    playToSummary('daily', u, dailyGameSettings(u, 'daily-2026-10-29', '🏴󠁧󠁢󠁷󠁬󠁳󠁿 Dragons'), fails, shares)
    playToSummary('r9-share-season', u, managed('season', 'r9-share-season', NAMES[1]), fails, shares)
    playToSummary('r9-share-dynasty', u, managed('dynasty', 'r9-share-dynasty', NAMES[3]), fails, shares)
    const job = suggestRunIns(runInCatalogue(u, 'survival').filter((j) => j.leagueId === 'england'), 'r9-share-runin')[0]
    playToSummary('r9-share-runin', u, runInGameSettings(u, job, { seed: 'r9-share-runin' }), fails, shares)
    expect([...new Set(fails)]).toEqual([])
    // Every kind of summary was read: the quick ones, the three arena formats, the Run-in, Season and Dynasty
    expect(shares.length).toBeGreaterThanOrEqual(12)
    expect(shares.some((s) => s.includes('Lions'))).toBe(true)
  }, 600_000)
})

describe('QA r9: the Office tab while the office is worked', () => {
  const u = loadTestUniverse(['england'])
  for (const [i, power] of [[0, true], [1, false], [2, true]] as const) {
    it(`a Season with player power ${power ? 'on' : 'off'} (${i})`, () => {
      const fails: string[] = []
      const seed = `r9-office-render-${i}`
      const ch = new Chooser(seed)
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, screen: 'game', offseason: null })
      st().startGame({ mode: i === 2 ? 'dynasty' : 'season', seed, formationId: '4-3-3', teamName: 'R9 Office', shortName: 'R9O', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false, ...(power ? { playerPower: true } : {}) })
      st().autoDraftRest()
      st().finishDraft()
      let renders = 0
      let talksRendered = 0
      for (let step = 0; step < 400; step++) {
        const g = st().game!
        if (g.phase === 'summary') break
        if (g.phase === 'match') {
          if (g.live) st().finishLiveNow()
          else st().closeMatch()
          continue
        }
        if (st().digest) st().dismissDigest()
        // A few office decisions, then the tab and the Inbox box rendered
        for (let k = ch.int(0, 4); k > 0; k--) {
          const g2 = st().game!
          const ids = Object.keys(g2.squad).sort()
          const r = ch.int(0, 6)
          if (r === 0) officeActions.makePromise(ch.pick(ids), ch.pick(['minutes', 'contract', 'signing'] as const))
          else if (r === 1) {
            const qs = pressQuestions(g2, u)
            if (qs.length) {
              const q = ch.pick(qs)
              officeActions.answerPress(q, ch.pick(Object.keys(PRESS_ANSWERS[q])))
            }
          } else if (r === 2) officeActions.converse(ch.pick(ids), ch.pick(['form', 'minutes', 'role', 'future'] as const), ch.pick(['encourage', 'demand', 'explain', 'promise', 'promote', 'project'] as const))
          else if (r === 3) {
            const req = openRequests(g2)[0]
            const id = req && ids.find((x) => (g2.customPlayers[x] ?? u.index[x])?.playerId === req.playerId)
            if (id) officeActions.answerRequest(id, ch.pick(['talk', 'list', 'refuse', 'promise-minutes'] as const))
          } else if (r === 4 && g2.window) {
            const l = g2.window.listings.find((x) => x.status === 'available' && x.asking < g2.finances.budget)
            if (l) {
              if (feeTalkOf(g2, l.playerSeasonId)?.agreed) {
                const status = openingStatus(g2, u, l.playerSeasonId)
                const d = termsDemand(g2, u, l.playerSeasonId, status)!
                officeActions.offerTerms(l.playerSeasonId, { wage: d.wage, years: 2, status, signingFee: d.agentFee })
              } else officeActions.proposeFee(l.playerSeasonId, { fee: l.asking, sellOn: ch.pick([0, 0.1]), instalments: ch.pick([1, 2, 3] as const) })
            }
          } else if (r === 5 && g2.window?.offers.some((o) => o.status === 'open')) {
            const n = g2.window.offers.findIndex((o) => o.status === 'open')
            officeActions.counterBid(n, Math.round(g2.window.offers[n].amount * 1.2 * 10) / 10)
          } else officeActions.setListed(ch.pick(ids), ch.chance(0.5))
        }
        if (st().toast?.startsWith('Something went wrong')) fails.push(`step ${step}: ${st().toast}`)
        useStore.setState({ toast: null })
        if (step % 3 === 0 || st().game!.window) {
          show({})
          renderBoth(`mw ${st().game!.season?.matchweek} OfficeTab`, OfficeTab as ComponentType<never>, { onPlayer: noop }, fails)
          renderBoth(`mw ${st().game!.season?.matchweek} OfficeInbox`, OfficeInbox as ComponentType<never>, { onOpen: noop }, fails)
          // The market's Negotiate dialog and counter-bid box, for a listing in talks (or the first) and an open bid
          const w = st().game!.window
          if (w) {
            const l = w.listings.find((x) => feeTalkOf(st().game!, x.playerSeasonId)) ?? w.listings[0]
            if (l) renderBoth(`mw ${st().game!.season?.matchweek} FeeTalkPanel`, FeeTalkPanel as ComponentType<never>, { listingId: l.playerSeasonId }, fails)
            const n = w.offers.findIndex((o) => o.status === 'open')
            if (n >= 0) renderBoth(`mw ${st().game!.season?.matchweek} CounterBidControl`, CounterBidControl as ComponentType<never>, { index: n, name: 'him' }, fails)
            talksRendered++
          }
          renders++
        }
        if (ch.chance(0.6)) st().playWeek()
        else st().simWeeks(ch.pick([1, 2]))
      }
      expect(st().game!.office, 'the office was used').toBeTruthy()
      expect(renders).toBeGreaterThan(10)
      expect(talksRendered).toBeGreaterThan(0)
      expect([...new Set(fails)].slice(0, 12)).toEqual([])
    }, 300_000)
  }
})

describe("QA r9: Explore's player card tabs and Records in every league", () => {
  const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
  const u = loadTestUniverse(ALL)
  it('Career, Best seasons, Roles and Similar for a spread of players, and the profile numbers hold', () => {
    show({ universe: u, loadedLeagues: ALL, classicLoaded: true, game: null, screen: 'explore', shortlist: [] })
    const fails: string[] = []
    const index = playerIndex(u)
    const sample = index.filter((_, i) => i % Math.ceil(index.length / 400) === 0)
    for (const e of sample) {
      const seasons = e.seasons
      const label = `${e.playerId}`
      const rows = careerRows(u, seasons)
      if (rows.length !== seasons.length) fails.push(`${label}: ${rows.length} rows for ${seasons.length} seasons`)
      fails.push(...badValues(rows.map((r) => [r.finish, r.delta]), `${label} career`))
      const best = bestSeasons(seasons)
      if (new Set(best.map((p) => p.season)).size !== best.length) fails.push(`${label}: a season twice in best seasons`)
      for (let k = 1; k < best.length; k++) if (best[k].overall > best[k - 1].overall) fails.push(`${label}: best seasons out of order`)
      const sum = careerSummary(seasons)
      fails.push(...badValues(sum, `${label} summary`))
      if (sum && sum.peak !== Math.max(...seasons.map((p) => p.overall))) fails.push(`${label}: peak ${sum.peak}`)
      const peak = best[0]
      const roles = roleSuitability(peak)
      if (!roles.length) fails.push(`${label}: no role`)
      fails.push(...badValues(roles.map((r) => r.rating), `${label} roles`))
      const similar = similarPlayers(u, peak, { classic: true })
      for (const h of similar) {
        if (h.p.playerId === peak.playerId) fails.push(`${label}: similar to himself`)
        if (h.p.positions[0] !== peak.positions[0]) fails.push(`${label}: similar at ${h.p.positions[0]}`)
        if (Math.abs(h.p.overall - peak.overall) > SIMILAR_RANGE) fails.push(`${label}: similar ${h.p.overall} v ${peak.overall}`)
        if (!(h.match >= 0 && h.match <= 100)) fails.push(`${label}: match ${h.match}`)
      }
      if (new Set(similar.map((h) => h.p.playerId)).size !== similar.length) fails.push(`${label}: a similar player twice`)
      for (let k = 1; k < similar.length; k++) if (similar[k].match > similar[k - 1].match) fails.push(`${label}: similar out of order`)
      // Without the classic seasons none is offered
      for (const h of similarPlayers(u, peak)) if (u.clubSeasonByKey[`${h.p.clubId}@${h.p.season}`]?.classic) fails.push(`${label}: a classic similar without the opt-in`)
      const at = (C: ComponentType<never>, props: Record<string, unknown>, what: string) => renderBoth(`${label} ${what}`, C, props, fails)
      at(CareerTable as ComponentType<never>, { u, seasons, current: peak.id, peakId: peak.id, shortlist: [], onStar: noop }, 'career')
      at(BestSeasons as ComponentType<never>, { u, seasons }, 'best')
      at(RoleList as ComponentType<never>, { p: peak }, 'roles')
      at(SimilarList as ComponentType<never>, { u, p: peak, onPlayer: noop }, 'similar')
    }
    expect([...new Set(fails)].slice(0, 12)).toEqual([])
  }, 600_000)

  it('Records for every league, with sound numbers', () => {
    show({ universe: u, loadedLeagues: ALL, classicLoaded: true, game: null, screen: 'explore' })
    const fails: string[] = []
    for (const l of u.available) {
      fails.push(...badValues(leagueTrivia(u, l.id), `${l.id} trivia`))
      renderBoth(`records ${l.id}`, RecordsView as ComponentType<never>, { leagueId: l.id, onClub: noop, onPlayer: noop }, fails)
    }
    expect([...new Set(fails)]).toEqual([])
  }, 300_000)
})

describe('QA r9: a damaged Trophy Room loads and renders', () => {
  const u = loadTestUniverse(['england'])
  /** A value a hand-edited, imported or older save might hold where a number or a list belongs. */
  const junk = (ch: Chooser): unknown => ch.pick([undefined, null, -3, 0, 1e9, 2.5, '7', 'x', [], {}, [1, 'a', null], true, Number.NaN])
  it('profiles with feats, counts and lists bent at random merge into sound cabinets that Profile and Home render', async () => {
    const { persistedState } = await import('@game/store')
    const { encodeSave, parseSave } = await import('@game/saveStorage')
    const { ProfileScreen } = await import('../screens/ProfileScreen')
    const { Home } = await import('../screens/Home')
    const { emptyFeats } = await import('@game/logic/feats')
    const fails: string[] = []
    for (let i = 0; i < 40; i++) {
      const ch = new Chooser(`r9-cabinet-${i}`)
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, h2h: null, screen: 'profile' })
      const base = persistedState(st()) as unknown as { profile: Record<string, unknown> }
      const profile = JSON.parse(JSON.stringify(base.profile)) as Record<string, unknown>
      const cab = (profile.cabinet ?? {}) as Record<string, unknown>
      const feats = { ...emptyFeats(), seasonsTitled: [2010, 2019], perfectDrafts: ['a', 'b'], runInWeeks: ['2026-W40'] } as unknown as Record<string, unknown>
      for (const k of Object.keys(feats)) if (ch.chance(0.4)) feats[k] = junk(ch)
      if (ch.chance(0.15)) cab.feats = junk(ch)
      else cab.feats = feats
      for (const k of ['league', 'cup', 'perfect', 'centurions', 'hostsTitled', 'nationsTitled', 'byMode', 'gauntlet', 'honours']) if (ch.chance(0.3)) cab[k] = junk(ch)
      profile.cabinet = ch.chance(0.1) ? junk(ch) : cab
      for (const k of ['leaderboard', 'runIns', 'arenaRuns', 'quickBests', 'achievements', 'weekly', 'arenaDaily']) if (ch.chance(0.15)) profile[k] = junk(ch)
      const raw = encodeSave(JSON.stringify({ state: { ...base, profile }, version: 1 }))
      const value = parseSave<Record<string, unknown>>(raw)
      const merge = useStore.persist.getOptions().merge!
      let merged: ReturnType<typeof st>
      try {
        merged = merge(value.state, { ...useStore.getInitialState(), universe: u, loadedLeagues: ['england'] }) as ReturnType<typeof st>
      } catch (e) {
        fails.push(`${i} merge threw: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      fails.push(...badValues(merged.profile.cabinet, `${i} cabinet`))
      const negatives = JSON.stringify(merged.profile.cabinet).match(/"[a-zA-Z0-9]+":-\d/g)
      if (negatives) fails.push(`${i} cabinet: negative counts ${negatives.join(' ')}`)
      show({ ...merged, screen: 'profile' })
      renderBoth(`${i} profile`, ProfileScreen as ComponentType<never>, {}, fails)
      show({ screen: 'home' })
      renderBoth(`${i} home`, Home as ComponentType<never>, {}, fails)
    }
    expect([...new Set(fails)].slice(0, 12)).toEqual([])
  }, 300_000)
})
