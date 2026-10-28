import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

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
    // Seeded sweeps play whole seasons; on a shared CI runner the 5 s default timed some out with every assertion
    // passing (engineBump, managers on 2026-10-28). A test that needs longer still says so itself.
    testTimeout: 30_000,
  },
})
