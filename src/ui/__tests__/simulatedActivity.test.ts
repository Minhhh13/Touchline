import { describe, expect, it } from 'vitest'
import { SIMULATION_BASE, SIMULATION_EPOCH, SIMULATION_STEP_MS, simulatedGamesAt } from '../online/simulatedActivity'

describe('display-only simulated-games counter', () => {
  it('starts at 500,000 and never goes below its base', () => {
    expect(simulatedGamesAt(SIMULATION_EPOCH - 10_000)).toBe(500_000)
    expect(simulatedGamesAt(SIMULATION_EPOCH)).toBe(SIMULATION_BASE)
  })

  it('increases from a fixed epoch at a stable rate across reloads', () => {
    expect(simulatedGamesAt(SIMULATION_EPOCH + SIMULATION_STEP_MS - 1)).toBe(SIMULATION_BASE)
    expect(simulatedGamesAt(SIMULATION_EPOCH + SIMULATION_STEP_MS)).toBe(SIMULATION_BASE + 1)
    expect(simulatedGamesAt(SIMULATION_EPOCH + SIMULATION_STEP_MS * 50)).toBe(SIMULATION_BASE + 50)
  })
})
