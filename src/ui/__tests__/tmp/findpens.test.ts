import { it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { loadTestUniverse } from '../../../engine/__tests__/helpers'
import { useStore } from '@game/store'
import { cupGameSettings } from '@game/logic/arena'
import { show } from '../qaSsr'
const u = loadTestUniverse(['england'])
it('finds', () => {
  const st = () => useStore.getState()
  for (let n = 0; n < 60; n++) {
    const seed = `PENS-${n}`
    show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, screen: 'game' })
    st().startGame(cupGameSettings(u, { teamName: 'Mill Lane City', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, size: 8 }, 'MIL'))
    st().autoDraftRest(); st().finishDraft()
    st().playArenaStep(true)
    st().completeLive()
    if (st().game!.arena?.pending) { console.log('FOUND', seed); return }
  }
})
