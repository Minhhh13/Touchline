/** Home's approximate display tally. The owner confirmed the starting total on 5 November 2026. */
export const SIMULATIONS_BASELINE = 300_000
export const SIMULATIONS_BASELINE_AT = Date.UTC(2026, 10, 5, 8, 35)
export const SIMULATION_TICK_MS = 60_000

/** An explicitly estimated display, independent of the engine, player count and saved games. */
export function estimatedSimulationsAt(now: number): number {
  return SIMULATIONS_BASELINE + Math.floor(Math.max(0, now - SIMULATIONS_BASELINE_AT) / SIMULATION_TICK_MS)
}
