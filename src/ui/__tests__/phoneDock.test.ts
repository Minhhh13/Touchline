/** The phone pass (r8): the nav as a bottom dock on an upright phone, and what stands on it (styles.css, App.tsx). */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The game screens' sheet (gameScreens.css, round 9's first download) holds the match report's shoot-out rules
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8') + readFileSync(join(__dirname, '..', 'gameScreens.css'), 'utf8')
const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
const phoneCss = readFileSync(join(__dirname, '..', 'matchday', 'matchday-phone.css'), 'utf8')
const dockAt = css.indexOf('@media (max-width: 720px) and (min-height: 501px) {\n  .app:not(.bar-hidden):not(.dock-off) {')
const dock = css.slice(dockAt, css.indexOf('\n}\n', dockAt))

describe('the phone dock', () => {
  it('is the nav fixed to the bottom of an upright phone, clear of the home indicator', () => {
    expect(dockAt).toBeGreaterThan(0)
    expect(dock).toContain('--dock-h: calc(58px + var(--safe-bottom));')
    expect(dock).toMatch(/\.app:not\(\.dock-off\) > \.topbar nav \{[^}]*position: fixed;[^}]*bottom: 0;[^}]*calc\(4px \+ var\(--safe-bottom\)\)/)
    // A blur on the bar would make it the dock's containing block, and a transform in its entrance would carry the dock
    expect(dock).toMatch(/\.app:not\(\.dock-off\) > \.topbar \{[^}]*backdrop-filter: none;/)
    expect(dock).toContain('animation-name: dock-bar-in;')
    expect(css).toMatch(/@keyframes dock-bar-in \{\n {2}from \{\n {4}opacity: 0;\n {2}\}\n\}/)
  })

  it('lifts everything else fixed to the bottom onto it, and comes after their own rules so it wins', () => {
    for (const sel of ['.bottom-bar {\n    bottom: var(--dock-h);', '.cta-bar {\n    bottom: var(--dock-h);', '.toast {\n    bottom: calc(22px + var(--dock-h) + var(--dock-safe));', '.room-turn-pill {\n    bottom: calc(12px + var(--dock-h) + var(--dock-safe));']) expect(dock).toContain(sel)
    for (const own of ['.toast {\n  position: fixed;', '.decisions-pill {\n  position: fixed;', '  .room-turn-pill {\n    position: fixed;', '  .cta-bar {\n    position: fixed;']) {
      expect(css.indexOf(own)).toBeGreaterThan(0)
      expect(css.indexOf(own)).toBeLessThan(dockAt)
    }
    // Off the phone (and with no dock) the tokens give back the plain home-indicator padding
    expect(css).toContain(':root {\n  --dock-h: 0px;\n  --dock-safe: var(--safe-bottom);\n}')
  })

  it("keeps a phone shoot-out's Take the penalties above the dock (r9)", () => {
    expect(css).toMatch(/\.shootout-foot \{\n {2}position: sticky;\n {2}bottom: calc\(var\(--space-2\) \+ var\(--dock-h\) \+ var\(--dock-safe\)\);/)
  })

  it('stands down for the match day and while the keyboard is up', () => {
    expect(app).toContain("game?.phase === 'match' && !shell ? 'dock-off' : ''")
    expect(css).toMatch(/\.app\.dock-off > \.topbar nav \{\n {4}display: none;/)
    expect(css).toMatch(/\.app:has\(input:not\([^)]*\):focus, textarea:focus\) \{\n {4}--dock-h: 0px;/)
    expect(phoneCss).toMatch(/@media \(max-width: 720px\) and \(min-height: 501px\) \{\n {2}\.matchday \.md-tool,[^}]*min-height: 44px;/)
  })

  it('lets a touch screen drop a tapped nav button or card back to rest', () => {
    expect(css).toMatch(/@media \(hover: none\) \{\n {2}\.topbar nav button:not\(\.active\):hover \{/)
  })
})

describe('a small phone on its side', () => {
  it("puts the Dugout's call bar back in its card rather than over a 320 px screen", () => {
    const at = css.indexOf('@media (max-width: 720px) and (max-height: 500px) {\n  .cta-bar {\n    position: static;')
    expect(at).toBeGreaterThan(css.indexOf('  .cta-bar {\n    position: fixed;'))
  })
})
