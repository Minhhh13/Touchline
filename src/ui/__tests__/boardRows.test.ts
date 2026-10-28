import { describe, expect, it } from 'vitest'
import { levelRows, podiumOf, signedGd } from '../boardRows'

describe('World board rows', () => {
  it('marks a row level only when a neighbour matches on every ranking value', () => {
    expect(levelRows(['92|2|65', '88|3|60', '88|3|60', '88|4|60', '80|1|1'])).toEqual([false, true, true, false, false])
    expect(levelRows(['5|1', '5|1', '5|1'])).toEqual([true, true, true])
    expect(levelRows(['1'])).toEqual([false])
    expect(levelRows([])).toEqual([])
  })

  it('puts the first three on the podium and nobody else', () => {
    expect([1, 2, 3, 4, 0, 50].map(podiumOf)).toEqual([1, 2, 3, null, null, null])
  })

  it('signs a goal difference the way every board prints it', () => {
    expect([12, 0, -3].map(signedGd)).toEqual(['+12', '0', '-3'])
  })
})
