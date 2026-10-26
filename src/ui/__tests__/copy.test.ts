import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { chemistryLinkLabel } from '../format'

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
})
