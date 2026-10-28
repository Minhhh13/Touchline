import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { statsSeries, xgStory } from '@engine/matchStats'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { matchPath } from '../match/epochs'
import { CompactLayout } from '../matchday/CompactLayout'
import type { MatchdayData } from '../matchday/types'
import { resultFeed, u } from './feeds'

const feed = resultFeed(0)
const get = (id: string) => u.index[id]
const d: MatchdayData = {
  mode: 'replay', feed, mpath: matchPath(feed), series: statsSeries(feed, get), samples: [], story: xgStory(feed), commentary: [],
  minute: 0, final: false,
  home: { code: 'HOM', name: feed.home.name, colour: '#123456', keeper: '#abcdef', numbers: {} },
  away: { code: 'AWA', name: feed.away.name, colour: '#654321', keeper: '#fedcba', numbers: {} },
  ratings: {}, userSide: 'home', selected: null, highlight: null, select: () => undefined, show: () => undefined,
  scores: [], table: null, ref: null, ctx: { matchweek: 1, competition: 'league', opponentClubId: feed.away.teamId, home: true },
  live: null, game: createGame(dailyGameSettings(u, 'daily-2026-10-26')), u, getPlayer: get, getName: (id) => get(id)?.name,
}

function render(pulse = true, panels = true): string {
  return renderToStaticMarkup(createElement(CompactLayout, {
    d, friendly: true, pulse, panels,
    crumb: 'Matchweek 1', top: 'Score and controls', pitch: createElement('div', { 'data-testid': 'kept-pitch' }),
    stop: createElement('div', { 'data-testid': 'always-available-decision' }), banner: 'Latest commentary', momentum: 'Momentum',
    strip: 'The XI and substitutions', drawer: createElement('div', { 'data-testid': 'always-available-drawer' }),
  }))
}

describe('the phone match views', () => {
  it('starts on Pitch while Stats and Squad remain available with their contents mounted', () => {
    const html = render()
    expect(html).toContain('data-view="pitch"')
    for (const tab of ['pitch', 'stats', 'squad']) expect(html).toContain(`data-view-tab="${tab}"`)
    expect(html).toContain('data-testid="kept-pitch"')
    expect(html).toContain('Latest commentary')
    expect(html).toContain('Momentum')
    expect(html).toContain('The XI and substitutions')
    expect(html).toContain('aria-label="Match panels"')
  })

  it('keeps decisions and drawers outside the view container, so a hidden tab cannot hide a live stop', () => {
    const html = render()
    expect(html.indexOf('data-testid="always-available-decision"')).toBeLessThan(html.indexOf('class="md-mobile-body"'))
    expect(html.indexOf('data-testid="always-available-drawer"')).toBeGreaterThan(html.lastIndexOf('role="tabpanel"'))
  })

  it('respects Boxes choices without removing the essential pitch, XI or decision controls', () => {
    const html = render(false, false)
    expect(html).not.toContain('data-view-tab="stats"')
    expect(html).not.toContain('aria-label="Match panels"')
    expect(html).not.toContain('Momentum')
    expect(html).toContain('data-view-tab="pitch"')
    expect(html).toContain('data-view-tab="squad"')
    expect(html).toContain('The XI and substitutions')
    expect(html).toContain('data-testid="always-available-decision"')
  })
})
