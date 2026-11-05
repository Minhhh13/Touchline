import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulationTicker } from '../components/SimulationTicker'
import { estimatedSimulationsAt, SIMULATIONS_BASELINE_AT, SIMULATION_TICK_MS } from '../simulationTicker'

afterEach(() => vi.useRealTimers())

describe('the approximate Home simulation tally', () => {
  it('starts from the owner-verified 300,000, including on a device with an older clock', () => {
    expect(estimatedSimulationsAt(SIMULATIONS_BASELINE_AT)).toBe(300_000)
    expect(estimatedSimulationsAt(SIMULATIONS_BASELINE_AT - 86_400_000)).toBe(300_000)
  })

  it('adds a single whole estimate per minute and resumes from elapsed time', () => {
    expect(estimatedSimulationsAt(SIMULATIONS_BASELINE_AT + SIMULATION_TICK_MS - 1)).toBe(300_000)
    expect(estimatedSimulationsAt(SIMULATIONS_BASELINE_AT + SIMULATION_TICK_MS)).toBe(300_001)
    expect(estimatedSimulationsAt(SIMULATIONS_BASELINE_AT + 10 * SIMULATION_TICK_MS)).toBe(300_010)
  })

  it('shows that it is an estimate rather than a live usage metric and never announces each tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(SIMULATIONS_BASELINE_AT)
    const html = renderToStaticMarkup(createElement(SimulationTicker, { paused: true }))
    expect(html).toContain('300,000 games simulated')
    expect(html).toContain('≈')
    expect(html).toContain('it is not live activity data')
    expect(html).toContain('aria-live="off"')
  })
})
