/** A fixed bottom bar gives way when it takes more than a third of the window (src/ui/tallBar.ts, phones round 12) */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAR_SHARE_MAX, barTooTall } from '../tallBar'

describe('a tall bottom bar', () => {
  it('stays fixed at its usual size on every phone the pass played', () => {
    // The Dugout's call bar at 100 %: 163 px on an iPhone SE (667), about 200 px on an iPhone 15 (852)
    expect(barTooTall(163, 667)).toBe(false)
    expect(barTooTall(200, 852)).toBe(false)
    expect(barTooTall(125, 800)).toBe(false)
  })
  it('gives way at 200 % text on a small phone', () => {
    expect(barTooTall(330, 667)).toBe(true)
    expect(barTooTall(318, 852)).toBe(true)
  })
  it('never decides from a missing measurement', () => {
    for (const [b, v] of [[0, 667], [300, 0], [Number.NaN, 667], [300, Number.NaN]]) expect(barTooTall(b, v)).toBe(false)
    expect(BAR_SHARE_MAX).toBeCloseTo(1 / 3)
  })
  it('is used by every screen with a fixed bottom bar, and the stylesheet sets it in the page', () => {
    for (const s of ['Dugout', 'Setup', 'Arena', 'ArenaSetup', 'RunInSetup']) {
      const src = readFileSync(join(__dirname, '..', 'screens', `${s}.tsx`), 'utf8')
      expect(src).toContain('const tallBar = useTallBar(barHeight)')
      expect(src).toContain("${tallBar ? ' bar-static' : ''}")
    }
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
    expect(css).toMatch(/\.page\.bar-static \.bottom-bar,\n {2}\.page\.bar-static \.cta-bar \{\n {4}position: static;\n {4}z-index: auto;/)
  })
})
