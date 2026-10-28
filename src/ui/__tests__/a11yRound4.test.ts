import { readFileSync } from 'node:fs'
import { createElement, type KeyboardEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { onRadioGroupKey, radioTabIndex, resultsLabel } from '../a11y'
import { Segmented } from '../components/bits'
import { GroupTables } from '../components/GroupTables'
import { TeamNameField } from '../components/SetupBits'
import { SCROLL_BOXES } from '../scrollFocus'
import type { GroupView } from '@game/logic/bracket'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('radio groups (the Segmented choice and its kin)', () => {
  it('one Tab stop: the checked radio, or the first when none is', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, 1))).toEqual([-1, 0, -1])
    expect([0, 1, 2].map((i) => radioTabIndex(i, -1))).toEqual([0, -1, -1])
  })

  it('the arrows focus and choose the next radio, wrapping; other keys and other targets do nothing', () => {
    const log: string[] = []
    const radio = (id: string) => ({ id, focus: () => log.push(`focus ${id}`), click: () => log.push(`click ${id}`) })
    const radios = [radio('on'), radio('off')]
    const key = (k: string, target: unknown) => ({ key: k, target, currentTarget: { querySelectorAll: () => radios }, preventDefault: () => log.push('prevented') }) as unknown as KeyboardEvent<HTMLElement>
    onRadioGroupKey(key('ArrowRight', radios[1]))
    expect(log).toEqual(['prevented', 'focus on', 'click on'])
    log.length = 0
    onRadioGroupKey(key('Enter', radios[0]))
    onRadioGroupKey(key('ArrowLeft', {}))
    expect(log).toEqual([])
  })

  it('a Segmented is a named group with exactly one radio in the Tab order', () => {
    const html = renderToStaticMarkup(createElement(Segmented<'on' | 'off'>, { label: 'Sound', value: 'off', onChange: () => undefined, options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }))
    expect(html).toContain('role="radiogroup" aria-label="Sound"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>Off</)
  })

  it('every choice of the round-4 screens names its group', () => {
    for (const file of ['../screens/ProfileScreen.tsx', '../screens/H2H.tsx', '../online/WorldBoard.tsx', '../online/AccountPanel.tsx', '../screens/Explore.tsx', '../screens/ExploreViews.tsx', '../screens/StatsTables.tsx']) {
      const src = read(file)
      const uses = src.match(/<Segmented(<[^>]*>)?\s[^>]*?(?=value=)/g) ?? []
      expect(uses.length, file).toBeGreaterThan(0)
      for (const u of uses) expect(u, file).toMatch(/label=/)
    }
  })
})

describe('the Continental Cup groups in words', () => {
  const group: GroupView = {
    name: 'A',
    complete: true,
    rows: [
      { teamId: 'me', played: 6, won: 4, drawn: 1, lost: 1, goalsFor: 10, goalsAgainst: 4, points: 13, place: 1, through: true },
      { teamId: 'b', played: 6, won: 3, drawn: 1, lost: 2, goalsFor: 8, goalsAgainst: 6, points: 10, place: 2, through: true },
      { teamId: 'c', played: 6, won: 1, drawn: 2, lost: 3, goalsFor: 5, goalsAgainst: 9, points: 5, place: 3, through: false },
    ],
    matches: [
      { matchday: 1, matchweek: 3, home: 'me', away: 'b', hg: 2, ag: 1 },
      { matchday: 2, matchweek: 7, home: 'c', away: 'me' },
    ],
  }
  const html = renderToStaticMarkup(createElement(GroupTables, { groups: [group], nameOf: (id: string) => `Club ${id}`, badge: () => null, userId: 'me' }))

  it('the green edge and the outline are said, not only drawn', () => {
    expect(html.match(/through to the knockouts/g)).toHaveLength(2)
    expect(html.match(/your side/g)).toHaveLength(1)
  })

  it('the short heads and the fixtures read in full', () => {
    for (const words of ['Place', 'Played', 'Goal difference', 'Points', 'Matchday 1', 'Won 2-1', 'after matchweek 7']) expect(html).toContain(words)
    expect(html).toContain('<span aria-hidden="true">GD</span>')
  })
})

describe('round 4 fixes in the markup', () => {
  it('the team name Shuffle has a live region that stays mounted, empty until used', () => {
    const html = renderToStaticMarkup(createElement(TeamNameField, { value: 'Ashvale FC', onChange: () => undefined, fallback: 'Touchline XI' }))
    expect(html).toMatch(/<span class="sr-only" aria-live="polite" data-testid="team-name-live"><\/span>/)
  })

  it('no button inside a button, and no span posing as one, on Explore', () => {
    for (const file of ['../screens/Explore.tsx', '../screens/ExploreViews.tsx']) expect(read(file)).not.toMatch(/role="button"/)
    // The compare and shortlist buttons ride in `actions`, which PlayerRow draws outside its own button
    expect(read('../screens/Explore.tsx')).toMatch(/actions=\{<><CompareButton/)
    expect(read('../screens/ExploreViews.tsx')).not.toMatch(/right=\{\s*<span className="row" style=\{\{ gap: 2 \}\}>\s*<CompareButton/)
    expect(read('../components/PlayerRow.tsx')).toMatch(/<div className="prow-shell">\s*\{row\}\s*<span className="prow-actions">\{actions\}<\/span>/)
  })

  it('the renewal list names its man on each button and asks before letting him go', () => {
    const src = read('../screens/PlannerTab.tsx')
    expect(src).toMatch(/aria-label=\{t\('offerTermsTo', \{ name: c\.name \}\)\}/)
    expect(src).toMatch(/aria-label=\{t\('letGoNamed', \{ name: c\.name \}\)\}/)
    expect(src).toMatch(/await askConfirm\(t\('letGoConfirm'/)
  })

  it('an unavailable man in the planner and depth chart is never faded by opacity (2.5:1 in Daylight)', () => {
    const css = read('../styles.css')
    for (const sel of ['.plan-names .chip.dim', '.depth-names .chip.dim']) {
      const rule = css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
      expect(rule, sel).not.toMatch(/opacity/)
      expect(rule, sel).toMatch(/color: var\(--text-3\)/)
    }
  })

  it('a dashboard panel that scrolls with nothing focusable joins the Tab order', () => {
    expect(SCROLL_BOXES.split(', ')).toContain('.grid > .panel')
  })

  it('form chips read as words', () => {
    expect(resultsLabel(['W', 'D', 'L'], 'Your form, oldest first')).toBe('Your form, oldest first: won, drawn, lost')
    expect(read('../components/Storylines.tsx')).toMatch(/aria-label=\{resultsLabel\(form,/)
  })
})
