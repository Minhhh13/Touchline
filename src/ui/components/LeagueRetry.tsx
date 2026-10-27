import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '@game/store'
import { LEAGUE_MISSING_LINE, gateLabel, leagueGate, type LeagueGate } from '@game/logic/leagueLoad'

/**
 * Beside a start button: when a league it needs could not be fetched (offline, O-10 in docs/QA.md), a line saying so
 * and Retry; it also retries by itself when the device comes back online. Nothing while the packs are here or loading.
 */
export function LeagueRetry({ needs, classic = false }: { needs: string[]; classic?: boolean }) {
  const ensureLeagues = useStore((s) => s.ensureLeagues)
  const missing = useLeagueGate(needs, classic) === 'missing'
  const key = needs.join()
  useEffect(() => {
    if (!missing || typeof window === 'undefined') return
    const retry = () => void ensureLeagues(key.split(','), classic)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [missing, key, classic, ensureLeagues])
  if (!missing) return null
  return (
    <div className="league-retry" role="status" data-testid="league-retry">
      <span className="small muted">{LEAGUE_MISSING_LINE}</span>
      <button type="button" className="btn sm" onClick={() => void ensureLeagues(needs, classic)} data-testid="league-retry-btn">
        <RefreshCw size={14} aria-hidden="true" /> Retry
      </button>
    </div>
  )
}

/** Where the packs these leagues need stand: ready, loading or missing (their last load failed). */
export function useLeagueGate(needs: string[], classic = false): LeagueGate {
  const loadedLeagues = useStore((s) => s.loadedLeagues)
  const failedLeagues = useStore((s) => s.failedLeagues)
  const loadingLeagues = useStore((s) => s.loadingLeagues)
  const classicLoaded = useStore((s) => s.classicLoaded)
  const classicFailed = useStore((s) => s.classicFailed)
  return leagueGate(needs, { loadedLeagues, failedLeagues, loadingLeagues, classicLoaded, classicFailed }, classic)
}

/** A waiting start button's words: "Loading league data…", or "Not downloaded: connect to load it" once a load failed. */
export function LeagueWait({ needs, classic = false }: { needs: string[]; classic?: boolean }) {
  const gate = useLeagueGate(needs, classic)
  return <>{gateLabel(gate === 'ready' ? 'loading' : gate, '')}</>
}
