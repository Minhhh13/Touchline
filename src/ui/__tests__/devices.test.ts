/** The device pass (docs/DESIGN_SYSTEM.md section 13, "Devices"): stylesheet rules for notches, phones on their side and tablets. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
const phoneCss = readFileSync(join(__dirname, '..', 'matchday', 'matchday-phone.css'), 'utf8')
const html = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')

describe('the device pass', () => {
  it('draws under the notch (viewport-fit=cover) and pads the bars clear of it through the safe-area tokens', () => {
    expect(html).toContain('viewport-fit=cover')
    // The top bar, its restore pill, the folded bar's page and the toast: main's safe-area tokens (safeArea.test.ts)
    expect(css).toContain('top: calc(10px + var(--safe-top));')
    expect(css).toContain('bottom: calc(22px + var(--safe-bottom));')
    // A fixed bar that is also a panel clears the home indicator
    expect(css).toMatch(/\.bottom-bar\.panel \{\n {4}padding-bottom: calc\(10px \+ var\(--safe-bottom\)\);/)
    // A phone on its side keeps its one-row bar below the status bar
    expect(css).toContain('padding-top: calc(4px + var(--safe-top));')
    // The match day's full-height substitution board starts below the status bar
    expect(phoneCss).toMatch(/\.matchday \.md-drawer\.board \{[^}]*padding-top: var\(--safe-top\)/)
  })

  it("puts the iPad shell's inset after the shell's own padding, so it wins", () => {
    const shell = css.indexOf('  .app.shell > .page {\n    max-width: 1600px;')
    const ipad = css.indexOf('  .app.shell > .page {\n    padding-bottom: max(var(--space-4), var(--safe-bottom));')
    expect(shell).toBeGreaterThan(0)
    expect(ipad).toBeGreaterThan(shell)
  })

  it('gives a phone on its side a one-row bar and the phone targets', () => {
    expect(css).toContain('@media (max-height: 500px) and (max-width: 1100px) and (pointer: coarse) {\n  .app > .topbar {\n    flex-wrap: nowrap;')
    // The accessibility pass's two phone target blocks, r10's for the account flag list, menu and chip, and the phones
    // pass's (round 12) reach a short touch screen too
    expect(css.split('@media (max-width: 720px), (max-height: 500px) and (pointer: coarse) {').length - 1).toBe(4)
  })

  it('caps a pitch below the desktop shell, never a formation picture', () => {
    expect(css).toMatch(/@media \(max-width: 1099\.98px\) \{\n {2}\.pitch-wrap:not\(\.pitch-mini \.pitch-wrap\) \{\n {4}max-width: min\(100%, 520px, calc\(\(100dvh - 40px\) \* 0\.75\)\);/)
  })

  it('keeps a name link with an ellipsis tappable', () => {
    // overflow: hidden clips an ::after target, so the name grows by padding with a margin that keeps the row
    expect(css).toMatch(/\.link-btn\.name \{\n {4}padding-block: 12px;\n {4}margin-block: -12px;/)
  })
})

/** Phones, round 12 (docs/QA.md, "Round 12: phones"): what the pass on six phones, upright and on their side, found */
describe('the phones pass (round 12)', () => {
  const game = readFileSync(join(__dirname, '..', 'gameScreens.css'), 'utf8')
  const r12 = css.slice(css.indexOf('/* Phones, round 12'))
  const drawer = readFileSync(join(__dirname, '..', 'matchday', 'drawers', 'Drawer.tsx'), 'utf8')
  const bits = readFileSync(join(__dirname, '..', 'components', 'bits.tsx'), 'utf8')

  it('is the last word in the sheet', () => {
    expect(css.indexOf('/* Phones, round 12')).toBeGreaterThan(css.indexOf('@media (max-width: 720px) and (min-height: 501px) {\n  .app:not(.bar-hidden):not(.dock-off) {'))
  })

  it("keeps a page's own content clear of the notch on a phone on its side", () => {
    // A border, so no screen's own `padding` rule can undo it; 0 px wherever the insets are
    expect(r12).toMatch(/\.app > \.page \{\n {2}border-inline: 0 solid transparent;\n {2}border-left-width: var\(--safe-left\);\n {2}border-right-width: var\(--safe-right\);\n\}/)
  })

  it('shows the skip links below the status bar and clear of the notch', () => {
    expect(r12).toMatch(/\.skip-link \{\n {2}top: calc\(var\(--space-2\) \+ var\(--safe-top\)\);\n {2}left: calc\(var\(--space-2\) \+ var\(--safe-left\)\);/)
  })

  it('keeps every field at 16 px on a phone on its side, so iOS never zooms into one', () => {
    const side = r12.slice(r12.indexOf('@media (max-height: 500px) and (pointer: coarse) {'))
    for (const sel of ['.input,', 'select.input,', '.input.sm,', 'table.tbl select.input.sm,', '.step-head-row .season-pick {\n    font-size: 16px;']) expect(side).toContain(sel)
    expect(phoneCss).toMatch(/@media \(max-height: 500px\) and \(pointer: coarse\) \{\n {2}\.matchday \.md-select,[^}]*select\.md-highlights \{\n {4}font-size: 16px;/)
  })

  it('gives the small targets the pass found 44 px, without overlapping a neighbour', () => {
    expect(r12).toMatch(/\.linklike::after \{\n {4}inset: -13px -4px;/)
    expect(r12).toMatch(/\.link-btn\.holder \{\n {4}min-height: 44px;\n {2}\}\n {2}\.link-btn\.holder::after \{\n {4}inset: 0 -2px;/)
    expect(r12).toMatch(/\.top-line \{\n {4}min-height: 44px;/)
    expect(r12).toMatch(/button\.star::after \{\n {4}content: '';\n {4}position: absolute;\n {4}inset: -10px;/)
    expect(phoneCss).toMatch(/\.matchday \.md-x::after \{\n {4}content: '';\n {4}position: absolute;\n {4}inset: -8px;/)
  })

  it("lets the arena's team talk take each word's width, wrapping rather than overlapping", () => {
    expect(game).toMatch(/\.arena-prep \.segmented \{\n {4}display: flex;\n {4}width: 100%;\n {4}flex-wrap: wrap;\n {2}\}\n {2}\.arena-prep \.segmented button \{\n {4}flex: 1 1 auto;/)
  })

  it("closes the match day's drawers when pulled down, as every other phone sheet", () => {
    expect(drawer).toContain('useSheetDrag(ref, onClose, DRAWER_SHEET_HANDLE)')
    expect(drawer).toContain('{...drag}')
    expect(drawer).toContain('<div className="sheet-grip" aria-hidden="true"')
    expect(bits).toContain('useSheetDrag(boxRef, onClose, MODAL_SHEET_HANDLE)')
    expect(phoneCss).toMatch(/\.matchday \.md-drawer > \.sheet-grip \{\n {4}display: block;[^}]*touch-action: none;/)
  })
})
