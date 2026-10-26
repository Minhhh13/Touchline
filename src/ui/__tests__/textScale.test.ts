import { describe, expect, it } from 'vitest'
import { applyTextScale, rootFontSize, TEXT_SCALE_MAX, TEXT_SCALE_WIDE_MAX, textScaleFor } from '../textScale'

/** iOS body text sizes in points, smallest to AX5, as `TextZoom.getPreferred()` reports them (size / 17). */
const DYNAMIC_TYPE = { xSmall: 14, small: 15, medium: 16, large: 17, xLarge: 19, xxLarge: 21, xxxLarge: 23, ax1: 28, ax2: 33, ax3: 40, ax4: 47, ax5: 53 }
const preferred = (pt: number) => pt / 17

function fakeRoot() {
  const attrs = new Map<string, string>()
  return { style: { fontSize: '' }, attrs, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) }
}

describe('Dynamic Type to the root font size', () => {
  it('keeps the design at the default size and below it', () => {
    for (const pt of [DYNAMIC_TYPE.xSmall, DYNAMIC_TYPE.small, DYNAMIC_TYPE.medium, DYNAMIC_TYPE.large]) expect(textScaleFor(preferred(pt), 390)).toBe(1)
  })

  it('follows the larger sizes on a phone in 5% steps, capped at 200%', () => {
    expect(textScaleFor(preferred(DYNAMIC_TYPE.xLarge), 390)).toBe(1.1)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.xxLarge), 390)).toBe(1.25)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.xxxLarge), 390)).toBe(1.35)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.ax1), 390)).toBe(1.65)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.ax2), 390)).toBe(1.95)
    for (const pt of [DYNAMIC_TYPE.ax3, DYNAMIC_TYPE.ax4, DYNAMIC_TYPE.ax5]) expect(textScaleFor(preferred(pt), 390)).toBe(TEXT_SCALE_MAX)
  })

  it('caps the one-screen desktop layout (an iPad) lower', () => {
    expect(textScaleFor(preferred(DYNAMIC_TYPE.xLarge), 1180)).toBe(1.1)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.ax5), 1180)).toBe(TEXT_SCALE_WIDE_MAX)
    expect(textScaleFor(preferred(DYNAMIC_TYPE.ax5), 1099)).toBe(TEXT_SCALE_MAX)
  })

  it('ignores a value that is not a size', () => {
    for (const v of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) expect(textScaleFor(v, 390)).toBe(1)
  })

  it('writes a percentage on the root, and clears it at 100%', () => {
    expect(rootFontSize(1)).toBe('')
    expect(rootFontSize(1.65)).toBe('165%')
    const root = fakeRoot()
    expect(applyTextScale(preferred(DYNAMIC_TYPE.ax1), 390, root)).toBe(1.65)
    expect(root.style.fontSize).toBe('165%')
    expect(root.attrs.get('data-text-scale')).toBe('165')
    applyTextScale(1, 390, root)
    expect(root.style.fontSize).toBe('')
    expect(root.attrs.has('data-text-scale')).toBe(false)
  })
})
