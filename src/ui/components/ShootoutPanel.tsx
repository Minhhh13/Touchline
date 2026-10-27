import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { useMediaQuery } from './LivePitch'
import { kickLine, takerMoved } from '../arenaText'

/** The kicks reveal one at a time, at once for anyone who asked the system for less motion. */
function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * An arena shoot-out. While a live match level at 90 waits (`arena.pending`):
 * the men on the pitch in the default order with up and down buttons, a
 * keeper and "Take the penalties". Once taken (or when the assistant took
 * them), the kicks reveal one at a time.
 */
export function ShootoutPanel() {
  const { universe: u, game, takePenalties } = useStore()
  const pending = game?.arena?.pending?.shootout ?? null
  const [order, setOrder] = useState<string[] | null>(null)
  const [keeper, setKeeper] = useState<string | null>(null)
  // The last move in the order, said once; the focus stays with the man moved (on his other arrow at either end)
  const [moved, setMoved] = useState<{ id: string; at: number; by: number } | null>(null)
  useEffect(() => {
    if (!moved || typeof document === 'undefined') return
    const active = document.activeElement as HTMLButtonElement | null
    if (active && active !== document.body && !active.disabled) return
    document.querySelector<HTMLButtonElement>(`[data-taker="${CSS.escape(moved.id)}"][data-dir="${moved.by < 0 ? 'down' : 'up'}"]`)?.focus()
  }, [moved])
  const last = game?.arena?.log.at(-1)
  const pens = last?.pens
  const revealKey = pens ? `${game?.id}-${game?.arena?.log.length}-${pens.kicks.length}` : ''
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!pens) return
    if (prefersReducedMotion()) {
      setShown(pens.kicks.length)
      return
    }
    setShown(0)
    const total = pens.kicks.length
    const id = setInterval(() => {
      setShown((n) => {
        if (n + 1 >= total) clearInterval(id)
        return Math.min(total, n + 1)
      })
    }, 650)
    return () => clearInterval(id)
    // The reveal restarts only for a new shoot-out
  }, [revealKey])
  // On a phone the takers stack above the keeper: Take the penalties rides at the foot of the window instead
  const phone = useMediaQuery('(max-width: 720px)')
  if (!u || !game?.arena) return null
  const get = playerLookup(game, u)
  const name = (id: string, ours: boolean) => (ours ? get(id)?.name : u.index[id]?.name) ?? id

  if (pending) {
    const list = order ?? pending.defaultOrder
    const gk = keeper ?? pending.keepers[0]
    const move = (i: number, by: number) => {
      const next = [...list]
      const j = i + by
      if (j < 0 || j >= next.length) return
      ;[next[i], next[j]] = [next[j], next[i]]
      setOrder(next)
      setMoved({ id: next[j], at: j, by })
    }
    const take = (
      <button type="button" className="btn primary big" data-testid="take-penalties" onClick={() => takePenalties(list, gk)}>
        Take the penalties
      </button>
    )
    return (
      <div className="panel" style={{ borderColor: 'var(--gold)', marginBottom: 12 }} data-testid="shootout-panel">
        <div className="panel-head">
          <h2>Penalties</h2>
          <span className="small muted">Level at 90. Pick the order: the pressure grows on kicks four and five and in sudden death, so composure counts there.</span>
        </div>
        <div className="grid two">
          <ol className="plist" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {list.map((id, i) => {
              const p = get(id)
              return (
                <li key={id} className="prow" style={{ cursor: 'default' }} data-testid="taker">
                  <span className="mono" style={{ width: 22 }}>{i + 1}</span>
                  <span className="name">
                    {p?.name ?? id}
                    {p && <span className="muted small taker-meta">shooting {p.attributes.shooting} · composure {p.attributes.mentality}</span>}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn sm ghost" aria-label={`Move ${p?.name ?? id} up`} disabled={i === 0} onClick={() => move(i, -1)} data-taker={id} data-dir="up">
                      ↑
                    </button>
                    <button type="button" className="btn sm ghost" aria-label={`Move ${p?.name ?? id} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} data-taker={id} data-dir="down">
                      ↓
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="col">
            <label className="field">
              In goal
              <select className="input" value={gk} onChange={(e) => setKeeper(e.target.value)} data-testid="shootout-keeper">
                {pending.keepers.map((id) => (
                  <option key={id} value={id}>
                    {get(id)?.name ?? id} (goalkeeping {get(id)?.attributes.goalkeeping ?? '?'}){pending.defaultOrder.includes(id) ? '' : ' · off the bench, uses a change'}
                  </option>
                ))}
              </select>
            </label>
            <p className="help">The takers go in this order and start again from the top in sudden death. Their side: {pending.theirOrder.slice(0, 5).map((id) => u.index[id]?.name ?? id).join(', ')}.</p>
            {!phone && take}
          </div>
        </div>
        {phone && <div className="shootout-foot">{take}</div>}
        <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="shootout-order-live">
          {moved ? takerMoved(get(moved.id)?.name ?? moved.id, moved.at) : ''}
        </span>
      </div>
    )
  }

  if (!pens) return null
  const kicks = pens.kicks.slice(0, shown)
  const us = kicks.filter((k) => k.us && k.scored).length
  const them = kicks.filter((k) => !k.us && k.scored).length
  const done = shown >= pens.kicks.length
  const lastKick = kicks.at(-1)
  const verdict = pens.us > pens.them ? `Won ${pens.us}-${pens.them} on penalties` : `Lost ${pens.us}-${pens.them} on penalties`
  return (
    <div className="panel" style={{ borderColor: 'var(--gold)', marginBottom: 12 }} data-testid="shootout-reveal">
      <div className="panel-head">
        <h2>
          Penalties {us}-{them}
        </h2>
        {done ? (
          <span className={`chip ${pens.us > pens.them ? 'good' : 'bad'}`} data-testid="shootout-result">
            {verdict}
          </span>
        ) : (
          // In the head beside the score, so the box keeps one line of kicks under it
          <button type="button" className="btn sm ghost" onClick={() => setShown(pens.kicks.length)}>
            Show them all
          </button>
        )}
      </div>
      <div className="row wrap shootout-kicks" style={{ gap: 6 }}>
        {kicks.map((k, i) => (
          <span key={i} className={`chip ${k.scored ? 'good' : 'bad'}`} title={k.us ? 'Ours' : 'Theirs'}>
            <span aria-hidden="true">{k.us ? '' : '⇢ '}</span>
            <span className="sr-only">{k.us ? 'Ours: ' : 'Theirs: '}</span>
            {name(k.takerId, k.us)} <span aria-hidden="true">{k.scored ? '✓' : '✗'}</span>
            <span className="sr-only">{k.scored ? ' scored' : ' missed'}</span>
          </span>
        ))}
      </div>
      {/* Each kick said once as it shows (the chips are ticks and colours), then the verdict */}
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="shootout-live">
        {lastKick ? kickLine(lastKick, kicks.length, name(lastKick.takerId, lastKick.us), us, them, done ? verdict : null) : ''}
      </span>
      {pens.keeperSwap && <p className="help">{get(pens.keeperSwap.on)?.name} came off the bench to face them, for {get(pens.keeperSwap.off)?.name}.</p>}
    </div>
  )
}
