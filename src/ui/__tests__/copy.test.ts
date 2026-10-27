import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { chemistryLinkLabel, money, signedValue } from '../format'
import { scorersText } from '../scorers'

describe('display copy', () => {
  const u = loadTestUniverse()

  it('names the club and season in a chemistry link line', () => {
    expect(chemistryLinkLabel(u, '3 links from arsenal@2015')).toBe('3 links from Arsenal 2015-16')
    expect(chemistryLinkLabel(u, '1 link from arsenal@2008')).toBe('1 link from Arsenal 2008-09')
  })

  it('leaves any other line as it is', () => {
    expect(chemistryLinkLabel(u, 'Shared nationality')).toBe('Shared nationality')
    expect(chemistryLinkLabel(null, '2 links from arsenal@2015')).toBe('2 links from arsenal 2015-16')
  })

  it('writes stoppage-time goals as the match clock does', () => {
    const line = scorersText([
      { name: 'R. Mahrez', minute: 92, playerSeasonId: 'a' },
      { name: 'K. De Bruyne', minute: 12, playerSeasonId: 'b' },
      { name: 'R. Mahrez', minute: 73, playerSeasonId: 'a' },
      { name: 'OG', minute: 40 },
    ])
    expect(line).toBe("De Bruyne 12' · OG 40' · Mahrez 73', 90+2'")
  })

  it('signs a figure with a true minus', () => {
    expect([signedValue(0.4), signedValue(-0.31), signedValue(0)]).toEqual(['+0.4', '−0.31', '0'])
  })

  it('writes no money as £0, not £0k', () => {
    expect([money(0), money(0.5), money(12.34), money(118)]).toEqual(['£0', '£500k', '£12.3M', '£118M'])
  })
})
