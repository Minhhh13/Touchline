import { describe, expect, it } from 'vitest'
import { money } from '../format'

describe('Season and Dynasty display', () => {
  it('money reads nothing as £0 and small sums in thousands', () => {
    expect(money(0)).toBe('£0')
    expect(money(0.4)).toBe('£400k')
    expect(money(12.34)).toBe('£12.3M')
  })
})
