/** O-9 (docs/QA.md): ask the browser to keep the save through storage pressure, after a first finished game. */
import { describe, expect, it } from 'vitest'
import { askPersist, finishedResults, persistLine, persistState, shouldAskPersist, type StorageManagerLike } from '../persistStorage'
import { emptyCabinet } from '@game/logic/cabinet'

const fake = (granted: boolean, already = false) => {
  const calls = { persist: 0 }
  let kept = already
  const sm: StorageManagerLike = {
    persisted: () => Promise.resolve(kept),
    persist: () => {
      calls.persist++
      kept = kept || granted
      return Promise.resolve(kept)
    },
  }
  return { sm, calls }
}

describe('persistent storage', () => {
  it('counts finished results from the Trophy Room and the arena runs, and asks only after the first, once', () => {
    expect(finishedResults({ cabinet: emptyCabinet() })).toBe(0)
    expect(finishedResults({ cabinet: { ...emptyCabinet(), byMode: { quick: 2, season: 1 } } })).toBe(3)
    expect(finishedResults({ cabinet: emptyCabinet(), arenaRuns: [{} as never] })).toBe(1)
    expect(finishedResults({})).toBe(0)
    expect(shouldAskPersist(0, false)).toBe(false)
    expect(shouldAskPersist(1, false)).toBe(true)
    expect(shouldAskPersist(4, true)).toBe(false)
  })

  it("reads and asks through the browser's storage manager, and says where it stands", async () => {
    expect(await persistState(undefined)).toBe('unsupported')
    expect(await persistState({})).toBe('unsupported')
    const no = fake(false)
    expect(await persistState(no.sm)).toBe('best-effort')
    expect(await askPersist(no.sm)).toBe('best-effort')
    expect(no.calls.persist).toBe(1)
    const yes = fake(true)
    expect(await askPersist(yes.sm)).toBe('persisted')
    expect(await persistState(yes.sm)).toBe('persisted')
    // A manager that throws (a blocked context) reads as where it stands, never as a crash
    expect(await askPersist({ persisted: () => Promise.resolve(false), persist: () => Promise.reject(new Error('blocked')) })).toBe('best-effort')
    expect(await persistState({ persisted: () => Promise.reject(new Error('blocked')), persist: () => Promise.resolve(true) })).toBe('unsupported')
    for (const s of ['persisted', 'best-effort', 'unsupported'] as const) expect(persistLine(s)).toMatch(/save/)
    expect(persistLine('best-effort')).toMatch(/export a copy/)
  })
})
