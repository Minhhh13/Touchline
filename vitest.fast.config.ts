import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import base, { SLOW_FILES } from './vitest.config'

// `npm run test:fast`, the local loop: every test file but the long seeded sweeps (`SLOW_FILES` in vitest.config.ts,
// most of the suite's time), so a change gets a verdict in a few minutes. `npm test` stays the gate and CI runs it.
export default mergeConfig(base, defineConfig({ test: { exclude: [...configDefaults.exclude, ...SLOW_FILES] } }))
