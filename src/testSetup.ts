import { afterEach } from 'vitest'
import { loadRules } from './game/rulesHook'

// Vitest's runner goes from one test to the next on microtasks only, so a file of synchronous seeded tests never
// reaches the event loop, and the worker cannot read the main process's answers to its RPC calls. Its 60 s RPC limit is
// fixed (not a setting), so a file over a minute (superLeague, qaQuick on a CI runner) ended in "Timeout calling
// onTaskUpdate" with every test passing. A macrotask after each test lets the worker read them; no test changes.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)))

// The store reads the game rules from their own chunk once it has loaded (src/game/rulesHook.ts): every lazy screen
// loads it before it renders, and the tests load it once here, so a store action runs at once, as on a screen
await loadRules()
