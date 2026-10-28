import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { reelSkipKey } from '../reelKeys'

// A target that answers `closest` like an element inside the given selector's match (or none)
const target = (owner: string | null) => ({ closest: (s: string) => (owner && s.split(', ').some((p) => p.startsWith(owner)) ? {} : null) })

describe('r8 audit: Space or Enter on a running reel', () => {
  it('skips from the page, never from a focused control or field', () => {
    expect(reelSkipKey({ key: ' ', target: target(null) })).toBe(true)
    expect(reelSkipKey({ key: 'Enter', target: null })).toBe(true)
    // The sound toggle, a fold, the reel's own Skip: the button answers the key itself
    expect(reelSkipKey({ key: 'Enter', target: target('button') })).toBe(false)
    expect(reelSkipKey({ key: ' ', target: target('input') })).toBe(false)
    expect(reelSkipKey({ key: ' ', target: target('summary') })).toBe(false)
    expect(reelSkipKey({ key: ' ', repeat: true, target: null })).toBe(false)
    expect(reelSkipKey({ key: 'Enter', ctrlKey: true, target: null })).toBe(false)
    expect(reelSkipKey({ key: 'a', target: null })).toBe(false)
  })

  it('is the rule of the manager spin, the end case and the January spin', () => {
    for (const f of ['EndCase', 'JanuaryWindow', 'ManagerSpin']) {
      const src = readFileSync(new URL(`../components/${f}.tsx`, import.meta.url), 'utf8')
      expect(src, f).toContain('if (!reelSkipKey(e)) return')
    }
  })
})

describe('r8 audit: the confirm dialog’s default buttons', () => {
  it('come from the common catalogue when drawn, so a translation reaches Cancel', async () => {
    const src = readFileSync(new URL('../components/ConfirmDialog.tsx', import.meta.url), 'utf8')
    expect(src).toContain("req.ok ?? t('ok')")
    expect(src).toContain("req.cancel ?? t('cancel')")
    const { common } = await import('../i18n/en/common')
    expect(common.messages.ok).toBe('OK')
    expect(common.messages.cancel).toBe('Cancel')
  })
})
