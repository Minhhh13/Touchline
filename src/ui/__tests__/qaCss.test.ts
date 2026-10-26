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

  it('balances its braces', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bare.split('{').length).toBe(bare.split('}').length)
  })
})
