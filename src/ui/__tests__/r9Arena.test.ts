/**
 * Round 9's arena polish, rendered on the server from games the store's own actions reach: the Gauntlet ladder's bonus
 * spin gifts, and the arena summary's Daily Arena line, its shoot-out rows and its seasons kept on one line.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { useStore } from '@game/store'
import { arenaClubName, cupGameSettings, gauntletGameSettings, GAUNTLET_BONUS_AFTER } from '@game/logic/arena'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import type { GameSettings } from '@game/types'
import { GauntletLadder } from '../components/GauntletLadder'
import { ArenaSummary } from '../screens/ArenaSummary'
import { show } from './qaSsr'
import { ShootoutRows } from '../components/ShootoutRows'
import { clubCode } from '../arenaText'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

/** Draft by the assistant and play the run out as Sim to the end does; penalties take the default order. */
function playOut(settings: GameSettings): void {
  show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, screen: 'game', offseason: null })
  st().startGame(settings)
  for (let i = 0; i < 400 && st().game!.phase !== 'summary'; i++) {
    const g = st().game!
    if (g.phase === 'draft') {
      st().autoDraftRest()
      st().finishDraft()
    } else if (g.phase === 'match') {
      if (g.live) st().completeLive()
      else if (g.arena?.pending) st().takePenalties(g.arena.pending.shootout.defaultOrder, g.arena.pending.shootout.keepers[0])
      else st().closeMatch()
    } else st().playArenaStep(false)
  }
  expect(st().game!.phase).toBe('summary')
  // A server render reads the store's initial state: bring it up to date
  show({})
}

const choices = (seed: string) => ({ teamName: 'Nine FC', formationId: '4-3-3', field: 'wheel' as const, wheelLeagues: ['england'], difficulty: 'calibrated' as const, seed, hardMode: false, twists: true })

describe('the Gauntlet ladder marks the rungs a bonus spin follows (r9)', () => {
  it('a gift on rungs 2, 4, 6 and 8 while they are ahead, none once climbed', () => {
    show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game' })
    st().startGame(gauntletGameSettings(u, choices('r9-ladder'), 'NIN'))
    st().autoDraftRest()
    st().finishDraft()
    const a = st().game!.arena!
    expect(a.step).toBe(0)
    const html = renderToString(createElement(GauntletLadder, { u, a }))
    expect(html.match(/rung-gift/g)?.length).toBe(GAUNTLET_BONUS_AFTER.length)
    expect(html.match(/a bonus spin after it/g)?.length).toBe(GAUNTLET_BONUS_AFTER.length * 2)
    playOut(gauntletGameSettings(u, choices('r9-ladder-2'), 'NIN'))
    const done = st().game!.arena!
    const after = renderToString(createElement(GauntletLadder, { u, a: done }))
    expect(after.match(/rung-gift/g)?.length ?? 0).toBe(GAUNTLET_BONUS_AFTER.filter((r) => r > done.log.length).length)
  }, 60_000)
})

describe('the arena summary (r9)', () => {
  it('a Daily Arena run says it counted, with the streak; the same day again says practice when the result differs', () => {
    const seed = 'arena-2026-10-29'
    show({ profile: { ...st().profile, arenaDaily: undefined } })
    playOut({ ...dailyArenaGameSettings(u, seed, 'Nine FC'), shortName: 'NIN' })
    const first = renderToString(createElement(ArenaSummary))
    const book = st().profile.arenaDaily!
    expect(book.results[seed]).toBeDefined()
    expect(first).toContain('data-testid="arena-daily-standing"')
    expect(first).toContain('Today&#x27;s Daily Arena is in')
    // A second go filed over a different counted result reads as practice
    show({ profile: { ...st().profile, arenaDaily: { ...book, results: { ...book.results, [seed]: { ...book.results[seed], score: book.results[seed].score + 3, label: 'something else' } } } } })
    const again = renderToString(createElement(ArenaSummary))
    expect(again).toContain('A practice run')
    expect(again).toContain('something else')
  }, 60_000)

  it('an ordinary Cup run has no Daily line; a shoot-out reads one row a side; no season breaks at its hyphen', () => {
    let pens = 0
    for (let i = 0; i < 12 && pens < 2; i++) {
      playOut(cupGameSettings(u, { ...choices(`r9-cup-${i}`), size: 8 }, 'NIN'))
      const html = renderToString(createElement(ArenaSummary)).replace(/<!-- -->/g, '')
      expect(html).not.toContain('arena-daily-standing')
      // Every opponent's season sits in a span of its own that will not wrap
      for (const s of st().game!.arena!.log) {
        const season = /\d{4}-\d{2}$/.exec(arenaClubName(u, s.opponent))?.[0]
        expect(season).toBeTruthy()
        expect(html).toContain(` <span style="white-space:nowrap">${season}</span>`)
      }
      const last = st().game!.arena!.log.at(-1)!
      if (last.pens) {
        pens++
        expect(html).toContain('data-testid="arena-pens"')
        const kicks = last.pens.kicks
        expect(html.match(/aria-label="[^"]+, (scored|missed)"/g)?.length).toBe(kicks.length)
        expect(html).toContain(`Penalty shoot-out · ${last.pens.us}-${last.pens.them}`)
      } else expect(html).not.toContain('arena-pens')
    }
  }, 120_000)
})

describe('ShootoutRows: the shoot-out as a scoreboard (r9)', () => {
  const kicks = [
    { us: true, takerId: 'a', scored: true },
    { us: false, takerId: 'b', scored: false },
    { us: true, takerId: 'c', scored: false },
  ]
  const render = (pending: boolean, list = kicks) => renderToString(createElement(ShootoutRows, { kicks: list, ourCode: 'NIN', theirCode: 'CHE', name: (k) => `P-${k.takerId}`, pending })).replace(/<!-- -->/g, '')
  it('one row a side in kick order, each kick named for a screen reader, dashed places to five while pending', () => {
    const live = render(true)
    const ours = /data-testid="shootout-ours"(.*?)data-testid="shootout-theirs"/.exec(live)![1]
    expect(ours).toContain('NIN')
    expect(ours.indexOf('P-a')).toBeLessThan(ours.indexOf('P-c'))
    expect(ours).not.toContain('P-b')
    expect(live).toContain('aria-label="P-a, scored"')
    expect(live).toContain('aria-label="P-b, missed"')
    expect(live.match(/shootout-open/g)?.length).toBe(3 + 4)
    expect(render(false)).not.toContain('shootout-open')
    // Sudden death: past five a side, no places left to fill
    const long = Array.from({ length: 14 }, (_, i) => ({ us: i % 2 === 0, takerId: `k${i}`, scored: i < 12 }))
    expect(render(true, long)).not.toContain('shootout-open')
    expect(render(true, long).match(/data-testid="shootout-kick"/g)?.length).toBe(14)
  })
  it('names a club-season by its code', () => {
    expect(clubCode(u, 'chelsea@2012')).toBe(u.clubById.chelsea.code)
    expect(clubCode(u, 'nowhere-fc@2012')).toBe('NOW')
  })
})

describe('the Gauntlet bonus spin names itself (r9)', () => {
  it('the draft heading says a bonus spin and the rungs climbed, never "The draft"', async () => {
    const { Draft } = await import('../screens/Draft')
    let seen = 0
    for (let n = 0; n < 6 && seen < 2; n++) {
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game' })
      st().startGame(gauntletGameSettings(u, choices(`r9-bonus-${n}`), 'NIN'))
      for (let i = 0; i < 200 && st().game!.phase !== 'summary'; i++) {
        const g = st().game!
        if (g.phase === 'draft') {
          if (g.arena!.step > 0) {
            show({})
            const html = renderToString(createElement(Draft)).replace(/<!-- -->/g, '')
            expect(html).toContain(`<h1>Bonus spin: ${g.arena!.step} rungs climbed</h1>`)
            seen++
          }
          st().autoDraftRest()
          st().finishDraft()
        } else if (g.phase === 'match') {
          if (g.live) st().completeLive()
          else if (g.arena?.pending) st().takePenalties(g.arena.pending.shootout.defaultOrder, g.arena.pending.shootout.keepers[0])
          else st().closeMatch()
        } else st().playArenaStep(false)
      }
    }
    expect(seen).toBeGreaterThan(0)
  }, 60_000)
})

describe('the report waits for the shoot-out reveal (r9)', () => {
  it('reads "Penalties" and a plain Continue until the last kick shows, then the verdict and the next round', async () => {
    const { MatchScreen } = await import('../screens/MatchScreen')
    const { setShootoutRevealed, shootoutKey, shootoutRevealed } = await import('../shootoutReveal')
    const { arenaContinueLabel } = await import('@game/logic/arena')
    let checked = 0
    for (let n = 0; n < 20 && checked < 2; n++) {
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game', matchView: 'report' })
      st().startGame(cupGameSettings(u, { ...choices(`r9-report-${n}`), size: 8 }, 'NIN'))
      st().autoDraftRest()
      st().finishDraft()
      for (let i = 0; i < 20 && st().game!.phase !== 'summary'; i++) {
        const g = st().game!
        if (g.phase === 'match') {
          const pens = g.arena!.log.at(-1)?.pens
          if (pens && !g.arena!.pending) {
            show({ matchView: 'report' })
            const key = shootoutKey(g.id, g.arena!.log.length, pens.kicks.length)
            expect(shootoutRevealed(key)).toBe(false)
            const held = renderToString(createElement(MatchScreen)).replace(/<!-- -->/g, '')
            expect(held).toMatch(/data-testid="report-outcome">PENALTIES</)
            expect(held).toContain('Continue →')
            setShootoutRevealed(key, true)
            const after = renderToString(createElement(MatchScreen)).replace(/<!-- -->/g, '')
            expect(after).toMatch(pens.us > pens.them ? /data-testid="report-outcome">WON ON PENS</ : /data-testid="report-outcome">LOST ON PENS</)
            expect(after).toContain(arenaContinueLabel(g))
            checked++
          }
          st().closeMatch()
        } else st().playArenaStep(false)
      }
    }
    expect(checked).toBeGreaterThan(0)
  }, 120_000)
})

describe('SeasonName (r9)', () => {
  it('keeps a club-season\'s season on one line, and a plain name as it is', async () => {
    const { SeasonName } = await import('../components/SeasonName')
    expect(renderToString(createElement(SeasonName, { name: 'Manchester United 2026-27' })).replace(/<!-- -->/g, '')).toBe('Manchester United <span style="white-space:nowrap">2026-27</span>')
    expect(renderToString(createElement(SeasonName, { name: 'Arsenal' }))).toBe('Arsenal')
  })
})
