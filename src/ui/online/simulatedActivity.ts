/** A display-only counter, not telemetry or a count of verified games. */
export const SIMULATION_BASE = 500_000
export const SIMULATION_EPOCH = Date.UTC(2026, 9, 31, 17, 0, 0)
export const SIMULATION_STEP_MS = 2_400

export function simulatedGamesAt(now = Date.now()): number {
  return SIMULATION_BASE + Math.floor(Math.max(0, now - SIMULATION_EPOCH) / SIMULATION_STEP_MS)
}
