import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { focusHomeOf, type HomeLike } from '../dialogLayers'
import { sayStep, takeFresh } from '../liveOnce'

// Round 7 (docs/ACCESSIBILITY.md section 3g): the game screens round 6 did not reach, the Draft mid-spin to the
// match day, the arena's shoot-out and the Run-in, audited with axe-core, the keyboard and a live-region recorder.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('../styles.css')

/** One CSS rule's body by its exact selector list (the text before `{`). */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('a live region says each moment once', () => {
  it('takeFresh admits an id the first time only, and never an empty one', () => {
    const spoken = new Set<string>()
    expect(takeFresh(spoken, 'k3')).toBe(true)
    expect(takeFresh(spoken, 'a15')).toBe(true)
    // The banner goes back from the assistant's word to the booking before it: not read again
    expect(takeFresh(spoken, 'k3')).toBe(false)
    expect(takeFresh(spoken, 'k4')).toBe(true)
    expect(takeFresh(spoken, null)).toBe(false)
    expect(takeFresh(spoken, '')).toBe(false)
  })

  it('what a region holds when it mounts is not news: the board mounts afresh after each stop', () => {
    const spoken = new Set<string>()
    // The 45' booking was the last moment before the stop: the new board's region records it and stays quiet
    expect(sayStep(spoken, 'k12', true)).toBe(false)
    expect(sayStep(spoken, 'k12', false)).toBe(false)
    expect(sayStep(spoken, 'k13', false)).toBe(true)
    // A region that mounts before any moment says the first one
    const quiet = new Set<string>()
    expect(sayStep(quiet, null, true)).toBe(false)
    expect(sayStep(quiet, 'k0', false)).toBe(true)
  })

  it('the score region in the top bar says each score once through the same hook', () => {
    const src = read('../matchday/TopBar.tsx')
    expect(src).toMatch(/const scoreSaid = useSayOnce\(/)
    expect(src).toMatch(/data-testid="score-live">\s*\{scoreSaid\}/)
  })

  it('the match day banner has one polite region, mounted in both its forms and fed through useSayOnce', () => {
    const src = read('../matchday/panels/feedPanels.tsx')
    const banner = src.slice(src.indexOf('export function CommentaryBanner'))
    const body = banner.slice(0, banner.indexOf('\n}\n'))
    expect(body.match(/aria-live=/g)).toHaveLength(1)
    expect(body).toContain('useSayOnce(')
    // The assistant's form and the commentary's form both render the same region
    expect(body.match(/\{region\}/g)).toHaveLength(2)
  })
})

describe('the focus after a dialog or a pop-up goes', () => {
  type El = HomeLike<string> & { home: string | null }
  const el = (home: string | null, isConnected = true): El => ({ home, isConnected, closest: (sel: string) => (sel === '[data-focus-home]' ? home : null) })

  it("focusHomeOf reads the opener's box while it is on the page", () => {
    expect(focusHomeOf(el('cup-continental'), null, null)).toBe('cup-continental')
    expect(focusHomeOf(el(null), null, 'elsewhere')).toBeNull()
    expect(focusHomeOf(null, null, 'elsewhere')).toBeNull()
  })

  it('an opener already gone takes the box it sat in when it took the focus, and only if it was that control', () => {
    const play = el(null, false)
    expect(focusHomeOf(play, play, 'cup-continental')).toBe('cup-continental')
    expect(focusHomeOf(play, el('cup-cup'), 'cup-cup')).toBeNull()
  })

  it('each cup card on the summary is a focus home, so closing a cup night lands on its own card', () => {
    expect(read('../components/CupRuns.tsx')).toMatch(/className=\{`cup-card \$\{comp\}`\}[^>]*data-focus-home/)
    expect(read('../useDialog.ts')).toContain('focusHomeOf<HTMLElement>(opener, lastOutside, lastOutsideHome)')
  })

  it('a stop pop-up minimised by Escape gives the focus to the pill that brings it back', () => {
    const src = read('../matchday/StopPanel.tsx')
    expect(src).toMatch(/if \(wasOpen\.current && !open\) pillRef\.current\?\.focus/)
    expect(src).toMatch(/<button ref=\{pillRef\}.*data-testid="decisions-pill"/)
  })
})

describe('contrast and larger text on the game screens', () => {
  it('a visually hidden word is pinned to its containing block, so it never hangs below a scrolling box', () => {
    const body = rule('.sr-only')
    expect(body).toMatch(/position: absolute/)
    expect(body).toMatch(/top: 0/)
    expect(body).toMatch(/left: 0/)
  })

  it("a tinted chip on a hovered row or on the Office's his-view box keeps its tint over the panel", () => {
    for (const tone of ['good', 'warn', 'bad']) {
      const body = rule(`.prow:hover .chip.${tone},\n.office-view .chip.${tone}`)
      expect(body).toContain(`linear-gradient(var(--${tone}-soft), var(--${tone}-soft)) var(--panel)`)
    }
  })

  it("Kick-off's two Simulate buttons and the end case's items may wrap at 200 % text", () => {
    expect(rule('.btn.wraps')).toMatch(/white-space: normal/)
    const kick = read('../screens/KickOff.tsx')
    expect(kick).toMatch(/className="btn primary wraps".*data-testid="kickoff-go-tactics"/)
    expect(kick).toMatch(/className="btn ghost wraps".*data-testid="kickoff-skip"/)
    expect(rule('.case-odds-table td.small')).toMatch(/overflow-wrap: anywhere/)
  })
})
