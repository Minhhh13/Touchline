/** The device pass (docs/DESIGN_SYSTEM.md section 13, "Devices"): stylesheet rules for notches, phones on their side and tablets. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
const phoneCss = readFileSync(join(__dirname, '..', 'matchday', 'matchday-phone.css'), 'utf8')
const html = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')

describe('the device pass', () => {
  it('draws under the notch (viewport-fit=cover) and pads everything clear of it', () => {
    expect(html).toContain('viewport-fit=cover')
    // The gutter every page, bar and sheet pads by clears a landscape notch
    expect(css).toContain('--gutter: max(16px, env(safe-area-inset-left), env(safe-area-inset-right));')
    // The top bar and its restore pill start below the status bar, after the base rules so they win
    const base = css.indexOf('.topbar {\n  display: flex;')
    const inset = css.indexOf('.topbar {\n  padding-top: calc(10px + env(safe-area-inset-top));\n}')
    expect(base).toBeGreaterThan(0)
    expect(inset).toBeGreaterThan(base)
    expect(css).toContain('top: calc(10px + env(safe-area-inset-top));')
    expect(css).toContain('.app.bar-hidden {\n  padding-top: env(safe-area-inset-top);\n}')
    // The toast and a fixed bar that is also a panel clear the home indicator
    expect(css).toContain('bottom: calc(22px + env(safe-area-inset-bottom));')
    expect(css).toMatch(/\.bottom-bar\.panel \{\n {4}padding-bottom: calc\(10px \+ env\(safe-area-inset-bottom\)\);/)
    // The match day's full-height substitution board starts below the status bar
    expect(phoneCss).toMatch(/\.matchday \.md-drawer\.board \{\n {4}padding-top: env\(safe-area-inset-top\);/)
  })

  it("puts the iPad shell's inset after the shell's own padding, so it wins", () => {
    const shell = css.indexOf('  .app.shell > .page {\n    max-width: 1600px;')
    const ipad = css.indexOf('  .app.shell > .page {\n    padding-bottom: max(var(--space-4), env(safe-area-inset-bottom));')
    expect(shell).toBeGreaterThan(0)
    expect(ipad).toBeGreaterThan(shell)
  })

  it('gives a phone on its side a one-row bar and the phone targets', () => {
    expect(css).toContain('@media (max-height: 500px) and (max-width: 1100px) and (pointer: coarse) {\n  .app > .topbar {\n    flex-wrap: nowrap;')
    // The accessibility pass's two phone target blocks reach a short touch screen too
    expect(css.split('@media (max-width: 720px), (max-height: 500px) and (pointer: coarse) {').length - 1).toBe(2)
  })

  it('caps a pitch below the desktop shell, never a formation picture', () => {
    expect(css).toMatch(/@media \(max-width: 1099\.98px\) \{\n {2}\.pitch-wrap:not\(\.pitch-mini \.pitch-wrap\) \{\n {4}max-width: min\(100%, 520px, calc\(\(100dvh - 40px\) \* 0\.75\)\);/)
  })

  it('keeps a name link with an ellipsis tappable', () => {
    // overflow: hidden clips an ::after target, so the name grows by padding with a margin that keeps the row
    expect(css).toMatch(/\.link-btn\.name \{\n {4}padding-block: 12px;\n {4}margin-block: -12px;/)
  })
})
