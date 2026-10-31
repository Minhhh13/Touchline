import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PHONE_LISTINGS } from '../screens/Dugout'

describe('the market on a phone', () => {
  it('hides the listings after the first PHONE_LISTINGS until Show all, on a phone only', () => {
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
    const phone = css.indexOf('@media (max-width: 720px) {\n  .listings.capped')
    expect(phone).toBeGreaterThan(0)
    expect(css.slice(phone, phone + 200)).toContain(`.listings.capped > .listing:nth-child(n + ${PHONE_LISTINGS + 1})`)
    // The button shows only on a phone; a desktop's box scrolls every listing
    expect(css).toMatch(/\.listings-more \{\s*display: none;\s*\}/)
    const dugout = readFileSync(join(__dirname, '..', 'screens', 'Dugout.tsx'), 'utf8')
    expect(dugout).toContain('data-testid="listings-more"')
    expect(dugout).toMatch(/setFilterState\(f\)\s*\n\s*setAllListed\(false\)/)
  })
})
