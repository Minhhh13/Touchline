/** QA-13 (docs/QA.md): stylesheet rules that only work in the right order. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')

describe('QA-13: the stylesheet', () => {
  it('sets phone fields to 16px after the base field rule, so iOS does not zoom into them on focus', () => {
    const base = css.indexOf('.input,\nselect.input {\n  width: 100%;')
    expect(base).toBeGreaterThan(0)
    // The phone rule: inside a max-width media block, naming .input with 16px
    const phone = [...css.matchAll(/@media \(max-width: 720px\) \{\n(?:\s*\/\*[^*]*\*\/\n)?\s*\.input,\n\s*select\.input,?[^{]*\{\n\s*font-size: 16px;/g)].map((m) => m.index ?? -1)
    expect(phone.length).toBe(1)
    // Same specificity, so the later rule wins: the phone rule must come after the base one
    expect(phone[0]).toBeGreaterThan(base)
  })

  // QA-14: on a 320 px phone (an SE, or a mini with Display Zoom) these widened the layout viewport and the page zoomed out
  const rule = (selector: string) => {
    const i = css.indexOf(`${selector} {`)
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
  }
  it('lets the narrow phone rows give way instead of widening the page', () => {
    // Setup's season picker drops under the step title rather than pushing the start bar off the screen
    expect(rule('.step-head-row')).toContain('flex-wrap: wrap')
    // The Tactics tab's role selects shrink to their row
    expect(rule('.role-pick select.input')).toContain('min-width: 0')
    expect(rule('.role-pick select.input')).toContain('max-width: 100%')
    // Seven nav icons, each over its one-word caption, fit a 320 px top bar
    expect(css).toMatch(/@media \(max-width: 359px\) \{\n {2}\.topbar nav button \{\n {4}padding: 5px 2px 4px;/)
  })

  it('balances its braces', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bare.split('{').length).toBe(bare.split('}').length)
  })
})
