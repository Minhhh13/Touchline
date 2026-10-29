import { defineConfig } from 'vitest/config'
import { BaseSequencer, type TestSpecification } from 'vitest/node'
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath, URL } from 'node:url'

/**
 * The long seeded sweeps, slowest first (seconds on a 4-core machine, 2026-10-28): `npm run test:fast` leaves them
 * out (vitest.fast.config.ts), and every full run starts them first so none is the last file still running.
 */
export const SLOW_FILES = [
  'src/game/__tests__/playWeekSoon.test.ts', // 94
  'src/game/__tests__/qaQuick.test.ts', // 90
  'src/game/__tests__/qaEurope.test.ts', // 65
  'src/game/__tests__/quickWorker.test.ts', // 64
  'src/game/__tests__/cup.test.ts', // 55
  'src/game/__tests__/perfectChase.test.ts', // 55
  'src/game/__tests__/qaSeason.test.ts', // 45
  'src/game/__tests__/h2hClassic.test.ts', // 40
  'src/game/__tests__/r7Fixes.test.ts', // 40
  'src/game/__tests__/qaModes.test.ts', // 40
  'src/online/__tests__/dailyVerify.test.ts', // 39
  'src/game/__tests__/highlights.test.ts', // 36
  'src/game/__tests__/qaDynasty.test.ts', // 33
  'src/game/__tests__/reloadSweep.test.ts', // 32
  'src/game/__tests__/superLeague.test.ts', // 30
  'src/game/__tests__/gauntlet.test.ts', // 29
  'src/game/__tests__/autoDraftPlain.test.ts', // 28
  'src/game/__tests__/bothSides.test.ts', // 28
  'src/game/__tests__/engine6.test.ts', // 28
  'src/game/__tests__/classicRelease.test.ts', // 25
  'src/game/__tests__/quickWorkerBench.test.ts', // 23
  'src/game/__tests__/medical.test.ts', // 16
]

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// A file renamed or removed leaves the list too, or `test:fast` would quietly start running it again
const missing = SLOW_FILES.filter((f) => !existsSync(new URL(`./${f}`, import.meta.url)))
if (missing.length) throw new Error(`SLOW_FILES in vitest.config.ts names files that do not exist: ${missing.join(', ')}`)

/**
 * Vitest's own order (failed first, then slowest by its results cache, else largest file), with the long sweeps moved
 * to the front: a fresh checkout (CI) has no cache, and a long file started last would hold the whole run open.
 */
class SlowFirst extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files)
    const rank = (f: TestSpecification): number => {
      const i = SLOW_FILES.indexOf(f.moduleId.slice(rootDir.length).replaceAll('\\', '/'))
      return i < 0 ? SLOW_FILES.length : i
    }
    return sorted.map((f, i) => ({ f, i, r: rank(f) })).sort((a, b) => a.r - b.r || a.i - b.i).map(({ f }) => f)
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Every test ends on a macrotask so the worker answers Vitest's RPC between tests (src/testSetup.ts)
    setupFiles: ['src/testSetup.ts'],
    // One worker per core (Vitest leaves one free by default): the tests are CPU-bound and the main process mostly waits
    maxWorkers: Math.max(1, availableParallelism()),
    sequence: { sequencer: SlowFirst },
    // Vitest's 5 s default fails seeded tests that need 5 s on a loaded machine (engineBump's stale reel takes 4.7 s
    // alone); a test or describe that names its own timeout keeps it. A time limit only: no assertion or seed changes.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
