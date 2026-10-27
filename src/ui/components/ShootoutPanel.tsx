import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { useMediaQuery } from './LivePitch'
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'

const t = translator(arena)

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
    }
    const take = (
      <button type="button" className="btn primary big" data-testid="take-penalties" onClick={() => takePenalties(list, gk)}>
        {t('takePens')}
      </button>
    )
    return (
      <div className="panel" style={{ borderColor: 'var(--gold)', marginBottom: 12 }} data-testid="shootout-panel">
        <div className="panel-head">
          <h2>{t('penalties')}</h2>
          <span className="small muted">{t('pensHelp')}</span>
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
                    {p && <span className="muted small taker-meta">{t('takerMeta', { shooting: p.attributes.shooting, composure: p.attributes.mentality })}</span>}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn sm ghost" aria-label={t('moveUp', { name: p?.name ?? id })} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn sm ghost" aria-label={t('moveDown', { name: p?.name ?? id })} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="col">
            <label className="field">
              {t('inGoal')}
              <select className="input" value={gk} onChange={(e) => setKeeper(e.target.value)} data-testid="shootout-keeper">
                {pending.keepers.map((id) => (
                  <option key={id} value={id}>
                    {t('keeperOption', { name: get(id)?.name ?? id, n: get(id)?.attributes.goalkeeping ?? '?', bench: pending.defaultOrder.includes(id) ? 'no' : 'yes' })}
                  </option>
                ))}
              </select>
            </label>
            <p className="help">{t('takersHelp', { names: pending.theirOrder.slice(0, 5).map((id) => u.index[id]?.name ?? id).join(', ') })}</p>
            {!phone && take}
          </div>
        </div>
        {phone && <div className="shootout-foot">{take}</div>}
      </div>
    )
  }

  if (!pens) return null
  const kicks = pens.kicks.slice(0, shown)
  const us = kicks.filter((k) => k.us && k.scored).length
  const them = kicks.filter((k) => !k.us && k.scored).length
  const done = shown >= pens.kicks.length
  return (
    <div className="panel" style={{ borderColor: 'var(--gold)', marginBottom: 12 }} data-testid="shootout-reveal">
      <div className="panel-head">
        <h2>
          {t('penaltiesScore', { us, them })}
        </h2>
        {done ? (
          <span className={`chip ${pens.us > pens.them ? 'good' : 'bad'}`} data-testid="shootout-result">
            {t(pens.us > pens.them ? 'wonPens' : 'lostPens', { score: `${pens.us}-${pens.them}` })}
          </span>
        ) : (
          // In the head beside the score, so the box keeps one line of kicks under it
          <button type="button" className="btn sm ghost" onClick={() => setShown(pens.kicks.length)}>
            {t('showAll')}
          </button>
        )}
      </div>
      <div className="row wrap shootout-kicks" style={{ gap: 6 }}>
        {kicks.map((k, i) => (
          <span key={i} className={`chip ${k.scored ? 'good' : 'bad'}`} title={t(k.us ? 'ours' : 'theirs')}>
            {k.us ? '' : '⇢ '}
            {name(k.takerId, k.us)} {k.scored ? '✓' : '✗'}
          </span>
        ))}
      </div>
      {pens.keeperSwap && <p className="help">{t('keeperSwap', { on: get(pens.keeperSwap.on)?.name, off: get(pens.keeperSwap.off)?.name })}</p>}
    </div>
  )
}
