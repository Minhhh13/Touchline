/**
 * The pseudo-locale over every migrated screen (docs/DESIGN_SYSTEM.md section 17): each screen is server-rendered
 * from states the store's own actions reach, once in English and once in `en-XA`. The pseudo render must carry the
 * pseudo marks, show no `⟦missing key⟧`, and pass the same markup checks as `qaRender.test.ts`; its English left over
 * (text that skipped `t()`: game-logic lines, engine labels, strings not migrated yet) is counted per screen and may
 * only go down (`CEILING`). `I18N_REPORT=1` prints what is left on each screen.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { h2hComplete } from '@engine/h2h'
import { useStore } from '@game/store'
import { setupRules } from '@game/logic/setup'
import { finalGameSettings } from '@game/logic/arena'
import type { GameSettings, Mode } from '@game/types'
import { setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { openFiltered, show } from './qaSsr'
import { App } from '../App'
import { surname } from '../match/shirts'
import { surname as shortSurname } from '@game/logic/slotSheet'
import { Home } from '../screens/Home'
import { HowTo } from '../screens/HowTo'
import { ProfileScreen } from '../screens/ProfileScreen'
import { Explore } from '../screens/Explore'
import { Privacy } from '../screens/Privacy'
import { Setup } from '../screens/Setup'
import { Draft } from '../screens/Draft'
import { KickOff } from '../screens/KickOff'
import { SeasonPlayback } from '../screens/SeasonPlayback'
import { Summary } from '../screens/Summary'
import { Dugout } from '../screens/Dugout'
import { MatchScreen } from '../screens/MatchScreen'
import { H2HScreen } from '../screens/H2H'
import { Arena } from '../screens/Arena'
import { ArenaSetup } from '../screens/ArenaSetup'
import { ArenaSummary } from '../screens/ArenaSummary'
import { RunInSetup } from '../screens/RunInSetup'

const u = loadTestUniverse(['england'])

// Data on screen is never English to translate: names of players, clubs, nations and leagues, and the test's teams
const DATA = new Set<string>(['QA XI', 'QA United', 'QAX', 'QAU', 'Ann', 'Bob', 'Touchline XI', 'TouchLine'])
for (const p of Object.values(u.index)) [p.name, surname(p.name), shortSurname(p.name)].forEach((n) => DATA.add(n))
for (const c of Object.values(u.clubById)) [c.name, c.shortName].forEach((n) => n && DATA.add(n))
for (const n of Object.values(u.nations)) DATA.add(n.name)
for (const l of u.available) DATA.add(l.name)

/** The text a render shows: text nodes and the attributes a screen reader or a tooltip reads. */
function texts(html: string): string[] {
  const clean = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  const out: string[] = []
  for (const m of clean.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) out.push(decode(m[1]))
  for (const seg of clean.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]+>/)) out.push(decode(seg))
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** English that skipped `t()`: a segment with a lower-case word of three letters or more that is neither pseudo nor data. */
function leftover(html: string): string[] {
  return texts(html).filter((s) => {
    if (isPseudo(s) || DATA.has(s)) return false
    const rest = s
      .split(/\s*(?:·|,|:|—|–|\(|\)|\/|\|)\s*/)
      .map((x) => x.replace(/\b\d{4}-\d{2}\b|[\d.,%'+−-]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((x) => x && !DATA.has(x) && !isPseudo(x))
    return rest.some((x) => /\b[a-z]{3,}\b/.test(x))
  })
}

type Render = { name: string; C: ComponentType<never>; props?: Record<string, unknown> }
const report: Record<string, string[]> = {}
const fails: string[] = []

function render(C: ComponentType<never>, props: Record<string, unknown> = {}): string {
  show({})
  return renderToString(createElement(C, props as never))
}

/** One screen in English and in the pseudo-locale. */
function check({ name, C, props }: Render): void {
  setLocaleMessages({ id: 'en', messages: {} })
  let en = ''
  let pseudo = ''
  try {
    en = render(C, props)
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    pseudo = render(C, props)
  } catch (e) {
    fails.push(`${name} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
    return
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
  if (en.includes('⟦') || pseudo.includes('⟦')) fails.push(`${name}: a missing key ${pseudo.match(/⟦[^⟧]*⟧/)?.[0]}`)
  if (!isPseudo(pseudo)) fails.push(`${name}: no pseudo text at all`)
  for (const p of openFiltered(pseudo)) fails.push(`${name} (pseudo): ${p}`)
  report[name] = [...new Set([...(report[name] ?? []), ...leftover(pseudo)])]
}

const NOOP = { onPlayer: () => {}, onMessage: () => {}, onOpen: () => {} }
const st = () => useStore.getState()
const base = { universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, offseason: null, matchView: 'ticker' as const, h2h: null }

function quickSettings(seed: string, mode: Mode = 'quick'): GameSettings {
  const rules = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'prime', eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: ['england'], benchPicks: 3, modes: [], powerUps: true, managers: true, managerSpin: true, endCase: true })
  return { mode, seed, formationId: '4-3-3', teamName: 'QA XI', shortName: 'QAX', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january: true }
}

/**
 * Which screens have been through `t()`, and the most English each may still show in the pseudo-locale (what is left
 * is the game logic's and the engine's words, listed by `I18N_REPORT=1`), with two of headroom for the Daily's and
 * the Weekly's date-seeded puzzles. Lower a ceiling when a screen gets cleaner; raising one means a string skipped `t()`.
 */
const CEILING: Record<string, number> = {
  'App home': 2,
  'App howto': 2,
  'App profile': 2,
  'App explore': 2,
  'App privacy': 2,
  'App h2h': 2,
  'Home': 2,
  'HowTo': 11,
  'Profile': 2,
  'Explore': 2,
  'Privacy': 2,
  'H2H setup': 4,
  'Setup quick': 7,
  'Setup daily': 3,
  'Setup season': 5,
  'Setup dynasty': 5,
  'Setup weekly': 2,
  'Arena setup': 3,
  'Run-in setup': 3,
  'Draft': 3,
  'Kick-off': 2,
  'Season playback': 7,
  'Summary': 8,
  'Dugout': 5,
  'Match': 3,
  'Arena': 4,
  'Arena summary': 3,
  'H2H draft': 2,
  'H2H result': 3,
}

describe('the pseudo-locale renders every migrated screen', () => {
  it('menus, setup for every mode, and the shell', () => {
    for (const screen of ['home', 'howto', 'profile', 'explore', 'privacy', 'h2h'] as const) {
      show({ ...base, screen })
      check({ name: `App ${screen}`, C: App as ComponentType<never> })
    }
    show({ ...base, screen: 'home' })
    for (const [name, C] of [['Home', Home], ['HowTo', HowTo], ['Profile', ProfileScreen], ['Explore', Explore], ['Privacy', Privacy], ['H2H setup', H2HScreen]] as const) check({ name, C: C as ComponentType<never> })
    for (const mode of ['quick', 'daily', 'season', 'dynasty', 'weekly'] as Mode[]) {
      show({ ...base, screen: 'setup', setupMode: mode })
      check({ name: `Setup ${mode}`, C: Setup as ComponentType<never> })
    }
    show({ ...base, screen: 'setup', setupMode: 'arena' })
    check({ name: 'Arena setup', C: ArenaSetup as ComponentType<never> })
    show({ ...base, screen: 'setup', setupMode: 'runin' })
    check({ name: 'Run-in setup', C: RunInSetup as ComponentType<never> })
  }, 60_000)

  it('a Quick Draft: the draft, kick-off, the season and the summary', () => {
    show({ ...base, screen: 'game' })
    st().startGame(quickSettings('i18n-quick'))
    check({ name: 'Draft', C: Draft as ComponentType<never> })
    st().spin()
    check({ name: 'Draft', C: Draft as ComponentType<never> })
    st().autoDraftRest()
    check({ name: 'Draft', C: Draft as ComponentType<never> })
    st().finishDraft()
    for (let i = 0; i < 12 && st().game?.phase === 'kickoff'; i++) {
      check({ name: 'Kick-off', C: KickOff as ComponentType<never> })
      const g = st().game!
      if (g.managerSpin && !g.managerSpin.picked && g.managerSpin.options.length) st().pickManager(g.managerSpin.options[0].id)
      else if (g.endCase && !g.endCase.done) {
        if (!g.endCase.opened) st().openCase()
        else if (g.endCase.drop.kind === 'icon') st().subCaseIcon(null)
        else st().finishCase()
      } else st().kickOff()
    }
    for (let i = 0; i < 4 && st().game?.phase === 'january'; i++) {
      check({ name: 'Season playback', C: SeasonPlayback as ComponentType<never> })
      st().closeJanuary(null)
    }
    check({ name: 'Season playback', C: SeasonPlayback as ComponentType<never> })
    st().endPlayback()
    check({ name: 'Summary', C: Summary as ComponentType<never> })
  }, 60_000)

  it('a Season: the Dugout and a live match', () => {
    show({ ...base, screen: 'game' })
    st().startGame({ mode: 'season', seed: 'i18n-season', formationId: '4-3-3', teamName: 'QA United', shortName: 'QAU', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated', continental: false })
    st().autoDraftRest()
    st().finishDraft()
    check({ name: 'Dugout', C: Dugout as ComponentType<never>, props: NOOP })
    st().playWeek()
    if (st().game?.live) {
      check({ name: 'Match', C: MatchScreen as ComponentType<never> })
      st().completeLive()
      check({ name: 'Match', C: MatchScreen as ComponentType<never> })
      st().closeMatch()
    }
    if (st().digest) st().dismissDigest()
    check({ name: 'Dugout', C: Dugout as ComponentType<never>, props: NOOP })
  }, 60_000)

  it('an arena final and a head-to-head', () => {
    show({ ...base, screen: 'game' })
    st().startGame(finalGameSettings(u, { teamName: 'QA XI', formationId: '4-3-3', field: 'giants', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'i18n-final', hardMode: false, twists: true }, 'QAX'))
    st().autoDraftRest()
    st().finishDraft()
    check({ name: 'Arena', C: Arena as ComponentType<never> })
    for (let i = 0; i < 40 && st().game?.phase !== 'summary'; i++) {
      const g = st().game!
      if (g.phase === 'match') {
        if (g.live) st().completeLive()
        else if (g.arena?.pending) st().takePenalties(g.arena.pending.shootout.defaultOrder, g.arena.pending.shootout.keepers[0])
        else st().closeMatch()
      } else st().playArenaStep(true)
    }
    check({ name: 'Arena summary', C: ArenaSummary as ComponentType<never> })
    show({ ...base, screen: 'h2h' })
    st().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'fulham' }], 'england', ['england'], 2024, 'calibrated', false, 'i18n-h2h')
    check({ name: 'H2H draft', C: H2HScreen as ComponentType<never> })
    for (let i = 0; i < 200 && !h2hComplete(st().h2h!.draft); i++) {
      if (st().h2h!.draft.picking === null) st().h2hSpin()
      else st().h2hAuto()
    }
    st().h2hFinish()
    check({ name: 'H2H result', C: H2HScreen as ComponentType<never> })
  }, 60_000)

  afterAll(() => {
    if (process.env.I18N_REPORT === '1') for (const [name, left] of Object.entries(report)) console.log(`\n${name}: ${left.length} left\n  ${left.join('\n  ')}`)
  })

  it('shows no missing key, keeps the markup sound, and lets no screen show more English than before', () => {
    expect(fails).toEqual([])
    const counts = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]))
    const over = Object.entries(counts).filter(([k, n]) => n > (CEILING[k] ?? 0)).map(([k, n]) => `${k}: ${n} > ${CEILING[k] ?? 0}`)
    if (process.env.I18N_REPORT === '1') console.log(JSON.stringify(counts, null, 2))
    expect(over).toEqual([])
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(20)
  })
})
