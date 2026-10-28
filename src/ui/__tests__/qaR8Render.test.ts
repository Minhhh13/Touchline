/**
 * QA round 3 (r8): engine 7's Continental Cup on screen. A Season and a two-season Dynasty with the cup on and every
 * league loaded are walked through the store; every new state is server-rendered (the app, the Dugout's Europe tab,
 * the match screen at a live group match or leg, the Summary), in English and in the pseudo-locale, checked for a
 * throw, NaN or undefined, a missing key and the markup basics, and the Europe tab's English left over in the
 * pseudo-locale must be data only.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { useStore } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { App } from '../App'
import { CupTab } from '../screens/Dugout'
import { Summary } from '../screens/Summary'
import { Chooser } from '../../game/__tests__/qaHarness'
import { openFiltered, show } from './qaSsr'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)
const st = () => useStore.getState()

/** Text nodes of a render, decoded. */
function texts(html: string): string[] {
  const clean = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  const out: string[] = []
  for (const m of clean.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) out.push(decode(m[1]))
  for (const seg of clean.split(/<[^>]+>/)) out.push(decode(seg))
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const DATA = new Set<string>(['R8 United', 'R8U'])
for (const c of Object.values(u.clubById)) [c.name, c.shortName].forEach((n) => n && DATA.add(n))
for (const l of u.available) DATA.add(l.name)

/** English in a pseudo render that is not a club, a league or the test's team. */
function leftover(html: string): string[] {
  return texts(html).filter((s) => !isPseudo(s) && !DATA.has(s) && /\b[a-z]{3,}\b/.test(s.replace(/\b\d{4}-\d{2}\b/g, '')))
}

function renderBoth(label: string, C: ComponentType<never>, props: Record<string, unknown>, fails: string[], english?: string[]): void {
  let en = ''
  let pseudo = ''
  try {
    setLocaleMessages({ id: 'en', messages: {} })
    show({})
    en = renderToString(createElement(C, props as never))
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    pseudo = renderToString(createElement(C, props as never))
  } catch (e) {
    fails.push(`${label} threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : String(e)}`)
    return
  } finally {
    setLocaleMessages({ id: 'en', messages: {} })
  }
  if (en.includes('⟦') || pseudo.includes('⟦')) fails.push(`${label}: a missing key ${pseudo.match(/⟦[^⟧]*⟧/)?.[0]}`)
  for (const p of openFiltered(en)) fails.push(`${label}: ${p}`)
  for (const p of openFiltered(pseudo)) fails.push(`${label} (pseudo): ${p}`)
  if (english) english.push(...leftover(pseudo).map((x) => `${label}: ${x}`))
}

function settings(mode: Mode, seed: string, leagueId: string, leagueSeason: number): GameSettings {
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode, seed, formationId: '4-3-3', teamName: 'R8 United', shortName: 'R8U', leagueId, wheelLeagues: [leagueId], hostClubId: clubs[seed.length % clubs.length], leagueSeason, rules: { ...SEASON_RULES, leagues: [leagueId] }, jobSecurity: false, difficulty: 'calibrated', continental: true }
}

function walk(seed: string, s: GameSettings, fails: string[], english: string[]): number {
  const ch = new Chooser(seed)
  show({ universe: u, loadedLeagues: ALL, game: null, parked: {}, toast: null, digest: null, playback: null, screen: 'game', offseason: null, matchView: 'ticker' })
  st().startGame(s)
  const seen = new Set<string>()
  let europe = 0
  for (let i = 0; i < 900; i++) {
    const g = st().game
    if (!g) return europe
    const c = g.season?.continental
    const stage = c ? `${c.groups ? 'g' : 'k'}${c.ties.length}${c.eliminated ? 'x' : ''}${c.won ? 'w' : ''}` : ''
    const key = [g.year, g.phase, g.live ? `${g.live.comp ?? g.live.kind}${g.live.leg ?? ''}${g.live.mp.clock ?? 45}` : '', stage, st().matchView, st().digest ? 'digest' : ''].join('|')
    if (!seen.has(key)) {
      seen.add(key)
      renderBoth(`${seed} ${key} App`, App as ComponentType<never>, {}, fails)
      if (c && (g.phase === 'week' || g.phase === 'preseason')) {
        europe++
        renderBoth(`${seed} ${key} Europe tab`, CupTab as ComponentType<never>, { comp: 'continental' }, fails, english)
      }
      if (g.phase === 'summary') renderBoth(`${seed} ${key} Summary`, Summary as ComponentType<never>, {}, fails, english)
    }
    if (g.phase === 'draft') {
      st().autoDraftRest()
      st().finishDraft()
    } else if (g.phase === 'summary') {
      if (g.settings.mode === 'dynasty' && g.year < 2) {
        st().nextSeason()
        if (st().offseason) st().dismissOffseason()
        continue
      }
      return europe
    } else if (g.phase === 'match') {
      if (g.live) {
        if (ch.chance(0.5)) st().advanceLive({}, ch.chance(0.5))
        else st().completeLive()
        st().setMatchView(ch.chance(0.5) ? 'report' : 'ticker')
      } else st().closeMatch()
    } else {
      if (st().offseason) st().dismissOffseason()
      if (st().digest) st().dismissDigest()
      const r = ch.int(0, 9)
      if (r < 5) st().playWeek()
      else if (r < 8) st().simWeeks(ch.pick([1, 2]))
      else st().simToNextBigMatch()
    }
    if (st().toast?.startsWith('Something went wrong')) {
      fails.push(`${seed}: ${st().toast}`)
      return europe
    }
  }
  fails.push(`${seed}: did not finish`)
  return europe
}

describe('QA r8: the Continental Cup on screen, in English and the pseudo-locale', () => {
  const runs: Array<[Mode, string, number]> = [['season', 'england', 2024], ['dynasty', 'spain', 2023], ['season', 'germany', 2015]]
  for (const [mode, leagueId, season] of runs)
    it(`${mode} in ${leagueId} ${season}`, () => {
      const fails: string[] = []
      const english: string[] = []
      const seed = `r8-render-${mode}-${leagueId}`
      const europe = walk(seed, settings(mode, seed, leagueId, season), fails, english)
      if (process.env.I18N_REPORT) console.log([...new Set(english.map((x) => x.replace(/^.*?(Europe tab|Summary): /, '$1: ')))].join('\n'))
      expect(europe).toBeGreaterThan(5)
      // The Europe tab's only English is the bracket's round words from game logic (`bracket.ts`); GroupTables went through `t()` (r8)
      const tab = english.filter((x) => x.includes('Europe tab: ')).map((x) => x.replace(/^.*Europe tab: /, ''))
      // The Season summary's Continental Cup chip goes through `t()` (r8)
      expect(english.filter((x) => /Summary: (Out in the |Winners$|Continental Cup$)/.test(x))).toEqual([])
      expect(tab.filter((x) => !/^(Quarter-final|Semi-final|Final|After the groups, matchweek \d+|Drawn after matchweek \d+)$/.test(x))).toEqual([])
      expect([...new Set(fails)].slice(0, 12)).toEqual([])
    }, 300_000)
})
