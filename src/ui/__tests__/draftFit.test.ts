import { describe, expect, it } from 'vitest'
import { fitGroups } from '../draftFit'

describe('fitGroups: a draft row’s fits and covers apart', () => {
  it('splits a midfielder’s own positions from the centre-back slot he only covers', () => {
    expect(fitGroups({ positions: ['CM', 'DM'] }, ['CB', 'CB', 'DM', 'CM', 'CM'])).toEqual({ fits: ['DM', 'CM'], covers: ['CB'] })
  })
  it('a player who only covers gets no "fits" chip, and one who fits everything no cover chip', () => {
    expect(fitGroups({ positions: ['RB'] }, ['CB']).fits).toEqual([])
    expect(fitGroups({ positions: ['GK'] }, ['GK']).covers).toEqual([])
  })
})
