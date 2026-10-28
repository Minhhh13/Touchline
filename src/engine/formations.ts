import type { Formation, FormationSlot, Position } from './types'

function slots(defs: Array<[string, Position, number, number]>): FormationSlot[] {
  return defs.map(([id, position, x, y]) => ({ id, position, x, y }))
}

/**
 * Pitch coordinates: x is 0..100 across the pitch (left to right),
 * y is 0..100 from own goal (0) to the opposition goal (100).
 */
export const FORMATIONS: Formation[] = [
  {
    id: '4-3-3',
    name: '4-3-3',
    blurb: 'The modern default. Wide forwards stretch play, a midfield three controls it.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 15, 26],
      ['cb1', 'CB', 38, 22],
      ['cb2', 'CB', 62, 22],
      ['rb', 'RB', 85, 26],
      ['dm', 'DM', 50, 42],
      ['cm1', 'CM', 30, 55],
      ['cm2', 'CM', 70, 55],
      ['lw', 'LW', 18, 78],
      ['st', 'ST', 50, 86],
      ['rw', 'RW', 82, 78],
    ]),
  },
  {
    id: '4-4-2',
    name: '4-4-2',
    blurb: 'The classic. Two strikers, two banks of four, direct and hard to break down.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 15, 26],
      ['cb1', 'CB', 38, 22],
      ['cb2', 'CB', 62, 22],
      ['rb', 'RB', 85, 26],
      ['lm', 'LW', 15, 56],
      ['cm1', 'CM', 38, 50],
      ['cm2', 'CM', 62, 50],
      ['rm', 'RW', 85, 56],
      ['st1', 'ST', 38, 84],
      ['st2', 'ST', 62, 84],
    ]),
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    blurb: 'A double pivot protects the back four; a number ten feeds the lone striker.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 15, 26],
      ['cb1', 'CB', 38, 22],
      ['cb2', 'CB', 62, 22],
      ['rb', 'RB', 85, 26],
      ['dm1', 'DM', 38, 44],
      ['dm2', 'DM', 62, 44],
      ['lw', 'LW', 18, 68],
      ['am', 'AM', 50, 66],
      ['rw', 'RW', 82, 68],
      ['st', 'ST', 50, 88],
    ]),
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    blurb: 'Three centre-backs, marauding wing-backs and a packed midfield.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['cb1', 'CB', 28, 22],
      ['cb2', 'CB', 50, 20],
      ['cb3', 'CB', 72, 22],
      ['lwb', 'LB', 10, 52],
      ['dm', 'DM', 50, 42],
      ['cm1', 'CM', 34, 58],
      ['cm2', 'CM', 66, 58],
      ['rwb', 'RB', 90, 52],
      ['st1', 'ST', 38, 84],
      ['st2', 'ST', 62, 84],
    ]),
  },
  {
    id: '3-4-3',
    name: '3-4-3',
    blurb: 'Front-footed. Three forwards and wing-backs pin teams into their own half.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['cb1', 'CB', 28, 22],
      ['cb2', 'CB', 50, 20],
      ['cb3', 'CB', 72, 22],
      ['lwb', 'LB', 10, 52],
      ['cm1', 'CM', 36, 50],
      ['cm2', 'CM', 64, 50],
      ['rwb', 'RB', 90, 52],
      ['lw', 'LW', 22, 78],
      ['st', 'ST', 50, 86],
      ['rw', 'RW', 78, 78],
    ]),
  },
  {
    id: '4-1-4-1',
    name: '4-1-4-1',
    blurb: 'Compact and patient. A holding midfielder screens, two eights run the game.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 15, 26],
      ['cb1', 'CB', 38, 22],
      ['cb2', 'CB', 62, 22],
      ['rb', 'RB', 85, 26],
      ['dm', 'DM', 50, 40],
      ['lm', 'LW', 15, 60],
      ['cm1', 'CM', 38, 58],
      ['cm2', 'CM', 62, 58],
      ['rm', 'RW', 85, 60],
      ['st', 'ST', 50, 88],
    ]),
  },
  {
    id: '4-4-2-diamond',
    name: '4-4-2 Diamond',
    blurb: 'Narrow and creative: a holder, two shuttlers, a ten, and two strikers.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 15, 26],
      ['cb1', 'CB', 38, 22],
      ['cb2', 'CB', 62, 22],
      ['rb', 'RB', 85, 26],
      ['dm', 'DM', 50, 40],
      ['cm1', 'CM', 30, 54],
      ['cm2', 'CM', 70, 54],
      ['am', 'AM', 50, 68],
      ['st1', 'ST', 38, 86],
      ['st2', 'ST', 62, 86],
    ]),
  },
  {
    id: '5-3-2',
    name: '5-3-2',
    blurb: 'Park the bus with style. Five at the back, counter through two strikers.',
    slots: slots([
      ['gk', 'GK', 50, 6],
      ['lb', 'LB', 10, 30],
      ['cb1', 'CB', 30, 22],
      ['cb2', 'CB', 50, 20],
      ['cb3', 'CB', 70, 22],
      ['rb', 'RB', 90, 30],
      ['cm1', 'CM', 30, 52],
      ['dm', 'DM', 50, 46],
      ['cm2', 'CM', 70, 52],
      ['st1', 'ST', 38, 82],
      ['st2', 'ST', 62, 82],
    ]),
  },
]

export const FORMATION_BY_ID: Record<string, Formation> = Object.fromEntries(FORMATIONS.map((f) => [f.id, f]))

export function getFormation(id: string): Formation {
  const f = FORMATION_BY_ID[id]
  if (!f) throw new Error(`Unknown formation ${id}`)
  return f
}
