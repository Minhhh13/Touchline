import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('one icon per meaning', () => {
  it('Setup’s Job security toggle draws a Lucide icon, not an emoji', () => {
    const setup = read('screens/Setup.tsx')
    expect(setup).toContain('<Armchair size={14} aria-hidden="true" /> Job security')
    expect(setup).not.toMatch(/\p{Extended_Pictographic}\s*Job security/u)
  })

  it('every Copy button says Copied with Check, the online room’s too', () => {
    const rooms = read('online/Rooms.tsx')
    expect(rooms).toMatch(/copied \? <Check size=\{16\}/)
    expect(rooms).not.toMatch(/copied \? <CircleCheck/)
  })
})
