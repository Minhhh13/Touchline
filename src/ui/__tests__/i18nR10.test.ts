/**
 * The pseudo-locale over what rounds 8 and 9 added (r10): the Office worked through a Season with player power, every
 * Dugout tab, the storylines, a Dynasty's summary, summer and club history, the casual modes' summaries (the Daily
 * Arena, the Weekly, the Cup, the Gauntlet, the Run-in) and a newcomer's first draft with its tips. Each is
 * server-rendered in English and in `en-XA`, as `i18nScreens.test.ts` does: no missing key, sound markup, and the
 * English left over (`I18N_REPORT=1` prints it) may only go down (`CEILING`).
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { runInCatalogue, suggestRunIns } from '@engine/scenario'
import { useStore } from '@game/store'
import { officeActions } from '@game/officeActions'
import { cupGameSettings, gauntletGameSettings } from '@game/logic/arena'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings } from '@game/logic/weekly'
import { runInGameSettings } from '@game/logic/runin'
import { firstDraftSettings } from '@game/logic/onboarding'
import { pressQuestions, PRESS_ANSWERS } from '@game/logic/pressConference'
import { openRequests } from '@game/logic/transferRequests'
import type { DugoutTab } from '@game/logic/briefing'
import type { GameSettings, Mode } from '@game/types'
import { setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { openFiltered, show } from './qaSsr'
import { dataNames, leftover } from './i18nLeftover'
import { App } from '../App'
import { Home } from '../screens/Home'
import { Draft } from '../screens/Draft'
import { Dugout } from '../screens/Dugout'
import { Summary } from '../screens/Summary'
import { Arena } from '../screens/Arena'
import { ArenaSummary } from '../screens/ArenaSummary'
import { RunInSummary } from '../screens/RunInSummary'
import { OfficeInbox, OfficeTab } from '../screens/OfficeTab'
import { InboxStorylines, MatchPreviewPanel, StoryChip, SummerHeadline } from '../components/Storylines'
import { ClubHistory } from '../components/ClubHistory'
import { Chooser } from '../../game/__tests__/qaHarness'

const u = loadTestUniverse(['england'])
const DATA = dataNames(u, ['R10 Office', 'R10O', 'R10 Dynasty', 'R10D', 'Ten FC', 'TEN'])
const st = () => useStore.getState()
const noop = () => {}
const base = { universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, offseason: null, h2h: null }

const report: Record<string, string[]> = {}
const fails: string[] = []

/** One component in English and in the pseudo-locale, its leftover English filed under `name`. */
function check(name: string, C: ComponentType<never>, props: Record<string, unknown> = {}): void {
  show({})
  let en = ''
  let pseudo = ''
  try {
    setLocaleMessages({ id: 'en', messages: {} })
    en = renderToString(createElement(C, props as never))
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    pseudo = renderToString(createElement(C, props as never))
  } catch (e) {
    fails.push(`${name} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
    return
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
  if (en.includes('⟦') || pseudo.includes('⟦')) fails.push(`${name}: a missing key ${(en + pseudo).match(/⟦[^⟧]*⟧/)?.[0]}`)
  if (pseudo && !isPseudo(pseudo)) fails.push(`${name}: no pseudo text at all`)
  for (const p of openFiltered(pseudo)) fails.push(`${name} (pseudo): ${p}`)
  const left = leftover(pseudo, DATA)
  report[name] = [...new Set([...(report[name] ?? []), ...left])]
  // I18N_CONTEXT=1 prints where each leftover sits in the markup, to find the component that prints it
  if (process.env.I18N_CONTEXT === '1') for (const l of left) {
    const at = pseudo.replace(/&#x27;/g, "'").indexOf(l.slice(0, 20))
    if (at >= 0) console.log(`[${name}] ${l.slice(0, 40)} <<< ${pseudo.replace(/&#x27;/g, "'").slice(Math.max(0, at - 260), at).replace(/\s+/g, ' ')}`)
  }
}

const TABS: DugoutTab[] = ['squad', 'next', 'tactics', 'fixtures', 'table', 'stats', 'market', 'inbox', 'club', 'dressing', 'planner', 'office']

/** Every Dugout tab and the storylines' boxes as the game stands. */
function dugoutTabs(prefix: string): void {
  for (const tab of TABS) check(`${prefix} ${tab}`, Dugout as ComponentType<never>, { startTab: tab })
  const g = st().game!
  check(`${prefix} storylines`, InboxStorylines as ComponentType<never>, { game: g, u })
  check(`${prefix} storylines`, MatchPreviewPanel as ComponentType<never>, { game: g, u })
  check(`${prefix} storylines`, StoryChip as ComponentType<never>, { game: g, u })
}

/** Play the store's game on to its summary (or `until` says stop), the way the screens would. */
function playOn(until: () => boolean = () => false): void {
  for (let i = 0; i < 2500; i++) {
    const g = st().game!
    if (until()) return
    if (st().digest) st().dismissDigest()
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
      if (st().playback || g.quickOpen) st().endPlayback()
      else return
    } else if (g.phase === 'match') {
      if (g.live) st().finishLiveNow()
      else if (g.arena?.pending) st().takePenalties(g.arena.pending.shootout.defaultOrder, g.arena.pending.shootout.keepers[0])
      else st().closeMatch()
    } else if (g.arena) st().playArenaStep(true)
    else st().simWeeks(5)
  }
}

const managed = (mode: Mode, seed: string, name: string, short: string): GameSettings => ({ mode, seed, formationId: '4-3-3', teamName: name, shortName: short, leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false })

/** No render here may show any English in the pseudo-locale: a name for an exception, with the reason, if one must. */
const CEILING: Record<string, number> = {}

describe('the pseudo-locale over rounds 8 and 9 (r10)', () => {
  it('a Season with the Office worked and player power on: every Dugout tab, the Office and the storylines', () => {
    show({ ...base, screen: 'game' })
    st().startGame({ ...managed('season', 'r10-i18n-office', 'R10 Office', 'R10O'), playerPower: true })
    st().autoDraftRest()
    st().finishDraft()
    dugoutTabs('Season preseason')
    const ch = new Chooser('r10-i18n-office')
    for (let week = 0; week < 14 && st().game!.phase !== 'summary'; week++) {
      const g = st().game!
      const ids = Object.keys(g.squad).sort()
      officeActions.makePromise(ch.pick(ids), ch.pick(['minutes', 'contract', 'signing'] as const))
      const qs = pressQuestions(g, u)
      if (qs.length) officeActions.answerPress(qs[0], ch.pick(Object.keys(PRESS_ANSWERS[qs[0]])))
      officeActions.converse(ch.pick(ids), ch.pick(['form', 'minutes', 'role', 'future'] as const), ch.pick(['encourage', 'demand', 'explain', 'promise'] as const))
      const req = openRequests(st().game!)[0]
      if (req && week % 2) {
        const id = ids.find((x) => (st().game!.customPlayers[x] ?? u.index[x])?.playerId === req.playerId)
        if (id) officeActions.answerRequest(id, ch.pick(['talk', 'list', 'refuse', 'promise-minutes'] as const))
      }
      if (week % 4 === 3) {
        check('Office', OfficeTab as ComponentType<never>, { onPlayer: noop })
        check('Office inbox', OfficeInbox as ComponentType<never>, { onOpen: noop })
      }
      st().playWeek()
      playOn(() => st().game!.phase === 'week' || st().game!.phase === 'preseason')
    }
    expect(st().game!.office).toBeTruthy()
    dugoutTabs('Season midseason')
  }, 240_000)

  it('a Dynasty: the summary, the summer and the club history', () => {
    show({ ...base, screen: 'game' })
    st().startGame(managed('dynasty', 'r10-i18n-dynasty', 'R10 Dynasty', 'R10D'))
    playOn()
    expect(st().game!.phase).toBe('summary')
    check('Dynasty summary', Summary as ComponentType<never>)
    check('Club history', ClubHistory as ComponentType<never>, { game: st().game!, u })
    st().nextSeason()
    if (st().offseason) check('Dynasty summer', App as ComponentType<never>)
    show({ offseason: null })
    const g = st().game!
    check('Club history', ClubHistory as ComponentType<never>, { game: g, u })
    check('Dynasty summer headline', SummerHeadline as ComponentType<never>, { game: g, u })
    if (g.phase !== 'summary') dugoutTabs('Dynasty summer')
  }, 240_000)

  it('the casual modes: the Daily Arena, the Weekly, the Cup, the Gauntlet and the Run-in', () => {
    const runs: Array<[string, GameSettings | null]> = [
      ['Daily Arena', { ...dailyArenaGameSettings(u, 'arena-2026-10-29', 'Ten FC'), shortName: 'TEN' }],
      ['Weekly', [44, 45, 46, 47, 48, 49, 50, 51, 52].map((w) => weeklyGameSettings(u, `weekly-2026-W${w}`, 'Ten FC')).find(Boolean) ?? null],
      ['Cup', cupGameSettings(u, { teamName: 'Ten FC', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'r10-i18n-cup', hardMode: false, twists: true, size: 8 }, 'TEN')],
      ['Gauntlet', gauntletGameSettings(u, { teamName: 'Ten FC', formationId: '4-3-3', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'r10-i18n-gauntlet', hardMode: false, twists: true }, 'TEN')],
    ]
    const job = suggestRunIns(runInCatalogue(u, 'survival').filter((j) => j.leagueId === 'england'), 'r10-i18n-runin')[0]
    runs.push(['Run-in', runInGameSettings(u, job, { seed: 'r10-i18n-runin' })])
    for (const [name, settings] of runs) {
      expect(settings, name).toBeTruthy()
      show({ ...base, screen: 'game' })
      st().startGame(settings!)
      st().autoDraftRest()
      st().finishDraft()
      if (st().game!.arena) check(`${name} hub`, Arena as ComponentType<never>)
      playOn()
      const g = st().game!
      const screen = g.arena ? ArenaSummary : g.settings.mode === 'runin' ? RunInSummary : Summary
      check(`${name} summary`, screen as ComponentType<never>)
    }
  }, 240_000)

  it("a newcomer's Home and first draft, with the tips", () => {
    show({ ...base, screen: 'home', profile: { ...st().profile, seenTips: {} } })
    check('Newcomer home', Home as ComponentType<never>)
    const first = firstDraftSettings(u, 'r10-i18n-first')
    expect(first).toBeTruthy()
    show({ ...base, screen: 'game' })
    st().startGame(first!)
    check('First draft', Draft as ComponentType<never>)
    st().spin()
    check('First draft', Draft as ComponentType<never>)
    playOn()
    check('First summary', Summary as ComponentType<never>)
  }, 120_000)

  afterAll(() => {
    if (process.env.I18N_REPORT === '1') for (const [name, left] of Object.entries(report)) if (left.length) console.log(`\n${name}: ${left.length} left\n  ${left.join('\n  ')}`)
  })

  it('shows no missing key, keeps the markup sound, and lets no render show more English than before', () => {
    expect([...new Set(fails)]).toEqual([])
    const counts = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]))
    if (process.env.I18N_REPORT === '1') console.log(JSON.stringify(counts, null, 2))
    const over = Object.entries(counts).filter(([k, n]) => n > (CEILING[k] ?? 0)).map(([k, n]) => `${k}: ${n} > ${CEILING[k] ?? 0}`)
    expect(over).toEqual([])
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(30)
  })
})
