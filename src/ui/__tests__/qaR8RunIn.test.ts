/**
 * QA round 3 (r8): the Run-in's Bundesliga play-off (engine 7) through the store. German survival run-ins, simmed to
 * the end with a reload before the summary, until a good number finish 16th: each 16th plays the play-off once, two
 * legs settled on aggregate, the verdict says how it went, the summary and the Profile's run-ins render without a
 * throw or NaN in English and the pseudo-locale, and a reload of the finished save is the same game.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { runInCatalogue } from '@engine/scenario'
import { USER_TEAM, seasonTable } from '@engine/season'
import { tieScore } from '@engine/continental'
import { useStore } from '@game/store'
import { runInGameSettings, runInVerdict } from '@game/logic/runin'
import { setLocaleMessages } from '../i18n'
import { PSEUDO_LOCALE } from '../i18n/pseudo'
import { App } from '../App'
import { RunInSummary } from '../screens/RunInSummary'
import { expectReloadSame, loadStore } from '../../game/__tests__/qaHarness'
import { openFiltered, show } from './qaSsr'

const u = loadTestUniverse(['germany'])
const st = () => useStore.getState()

describe('QA r8: the Bundesliga play-off in a Run-in, through the store', () => {
  it('every German 16th plays it once, and every screen of the result renders', () => {
    const jobs = runInCatalogue(u, 'survival').filter((j) => j.leagueId === 'germany')
    expect(jobs.length).toBeGreaterThan(10)
    const fails: string[] = []
    let playOffs = 0
    let survived = 0
    for (let i = 0; i < jobs.length * 2 && playOffs < 6; i++) {
      const job = jobs[i % jobs.length]
      const seed = `r8-playoff-${i}`
      loadStore(u, ['germany'])
      show({ screen: 'game' })
      st().startGame(runInGameSettings(u, job, { seed }))
      st().autoDraftRest()
      st().finishDraft()
      st().simToEnd()
      if (st().digest) st().dismissDigest()
      if (st().game?.phase === 'match') st().closeMatch()
      const g = st().game!
      if (g.phase !== 'summary') {
        fails.push(`${seed}: ended in ${g.phase}`)
        continue
      }
      const s = g.season!
      const table = seasonTable(s)
      const pos = table.findIndex((r) => r.teamId === USER_TEAM) + 1
      if (pos === table.length - 2 && !s.sacked) {
        if (!s.playOff) {
          fails.push(`${seed}: 16th with no play-off`)
          continue
        }
        playOffs++
        const sc = tieScore(s.playOff.tie)!
        if (sc.legs?.length !== 2 || !s.playOff.tie.winnerId) fails.push(`${seed}: play-off ${JSON.stringify(sc)}`)
        if (s.playOff.tie.winnerId === USER_TEAM) survived++
        const v = runInVerdict(g, u)!
        if (!/relegation play-off/.test(v.line)) fails.push(`${seed}: verdict ${v.line}`)
        if (v.met !== (s.playOff.tie.winnerId === USER_TEAM)) fails.push(`${seed}: met ${v.met}, won the play-off ${s.playOff.tie.winnerId === USER_TEAM}`)
      } else if (s.playOff) fails.push(`${seed}: a play-off for ${pos}th`)
      for (const id of ['en', PSEUDO_LOCALE]) {
        setLocaleMessages({ id, messages: {} })
        show({})
        for (const [name, C] of [['App', App], ['RunInSummary', RunInSummary]] as Array<[string, ComponentType]>) {
          try {
            for (const p of openFiltered(renderToString(createElement(C)))) fails.push(`${seed} ${id} ${name}: ${p}`)
          } catch (e) {
            fails.push(`${seed} ${id} ${name} threw: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
      setLocaleMessages({ id: 'en', messages: {} })
      show({ screen: 'profile' })
      try {
        for (const p of openFiltered(renderToString(createElement(App)))) fails.push(`${seed} profile: ${p}`)
      } catch (e) {
        fails.push(`${seed} profile threw: ${e instanceof Error ? e.message : String(e)}`)
      }
      expectReloadSame(seed)
    }
    expect([...new Set(fails)].slice(0, 10)).toEqual([])
    expect(playOffs).toBeGreaterThanOrEqual(3)
    // Both outcomes come up
    console.log(`play-offs ${playOffs}, survived ${survived}`)
  }, 600_000)
})
