/** The QA hunt's open items fixed in the stylesheets (docs/QA.md section 3): O-8, O-12 and O-15. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
const css = read('styles.css')
const phone = read('matchday', 'matchday-phone.css')
const matchday = read('matchday', 'matchday.css')
const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first rule whose selector list is exactly `selectors`, after `from`. */
function body(sheet: string, selectors: string, from = 0): string {
  const i = sheet.indexOf(`${selectors} {`, from)
  return i < 0 ? '' : sheet.slice(i, sheet.indexOf('}', i))
}

describe('O-8: the match-day pickers on a phone', () => {
  it('are 16px inside the phone block, after every rule that sets them smaller, so iOS does not zoom into them', () => {
    const block = phone.indexOf('@media (max-width: 720px) {')
    expect(block).toBeGreaterThan(-1)
    const sel = '  .matchday .md-select,\n  .matchday .md-ment .md-select,\n  .matchday .md-heat-side .md-select,\n  .matchday select.md-highlights'
    const at = phone.indexOf(sel, block)
    expect(at).toBeGreaterThan(block)
    expect(body(phone, sel, block)).toContain('font-size: 16px')
    // matchday-phone.css is imported after matchday.css and matchday-controls.css (MatchDashboard.tsx), so it wins at equal specificity
    const dash = read('matchday', 'MatchDashboard.tsx')
    expect(dash.indexOf("import './matchday-phone.css'")).toBeGreaterThan(dash.indexOf("import './matchday-controls.css'"))
    expect(dash.indexOf("import './matchday-controls.css'")).toBeGreaterThan(dash.indexOf("import './matchday.css'"))
  })
})

describe('O-12: small controls get a 24 px target at every width', () => {
  it('widens the hit area of the setup "i", text links, Boxes, chip buttons, folds and summaries outside any media block', () => {
    const i = css.indexOf('.qinfo-btn::after,\n.linklike::after,\n.boxes-btn::after,\n.fold-head::after,\ndetails > summary.panel-head::after {')
    expect(i).toBeGreaterThan(0)
    // Not nested: the line starts at column 0 and the rule is not inside an @media block
    const before = bare(css.slice(0, i))
    expect(before.split('{').length - before.split('}').length).toBe(0)
    expect(css.slice(i, css.indexOf('}', i))).toContain('inset: -4px -2px')
    // An 18 px "i" with 3 px each side is 24 px
    expect(body(css, '.qinfo-btn::after')).toContain('inset: -3px')
    // A 23 px chip button with 1 px above and below is 25 px
    expect(body(css, 'button.chip::after')).toContain('inset: -1px 0')
    expect(matchday).toMatch(/\.matchday \.md-select \{\n {2}min-height: 24px;/)
  })
})

describe('O-15: the draft head on a 320 px phone', () => {
  it('wraps the row of the cap chip, bonus spins, the clock, Boxes and Home instead of widening the page', () => {
    const block = css.indexOf('  .draft-progress > .row,\n  .draft-progress > .row > .row,')
    expect(block).toBeGreaterThan(0)
    expect(css.slice(block, css.indexOf('}', block))).toContain('flex-wrap: wrap')
    // The Draft's head row is that inner row
    const draft = read('screens', 'Draft.tsx')
    expect(draft).toContain('<div className="draft-progress')
  })
})

describe('the stylesheets', () => {
  it('balance their braces', () => {
    for (const sheet of [css, phone, matchday, read('matchday', 'matchday-controls.css')]) {
      const b = bare(sheet)
      expect(b.split('{').length).toBe(b.split('}').length)
    }
  })
})
