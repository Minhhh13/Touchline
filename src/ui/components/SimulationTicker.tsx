import { useEffect, useState } from 'react'
import { estimatedSimulationsAt, SIMULATION_TICK_MS } from '../simulationTicker'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'

const t = translator(home)

/** A quiet minute-by-minute estimate, never announced repeatedly or allowed to drive a game. */
export function SimulationTicker({ paused }: { paused: boolean }) {
  const [count, setCount] = useState(() => estimatedSimulationsAt(Date.now()))
  useEffect(() => {
    if (paused) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      clearInterval(timer)
      if (!media.matches) {
        setCount(estimatedSimulationsAt(Date.now()))
        timer = setInterval(() => setCount(estimatedSimulationsAt(Date.now())), SIMULATION_TICK_MS)
      }
    }
    sync()
    media.addEventListener('change', sync)
    return () => {
      clearInterval(timer)
      media.removeEventListener('change', sync)
    }
  }, [paused])
  return <p className="home-simulation-ticker" aria-live="off" title={t('simulationEstimate')} data-testid="simulation-ticker">≈ {t('simulations', { n: count.toLocaleString() })}</p>
}
