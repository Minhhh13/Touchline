import { useEffect, useState } from 'react'
import type { DraftUpgrade } from '@engine/draft'
import type { PlayerSeason } from '@engine/types'
import { UPGRADE_BOOSTS, upgradeChance, upgradeGain, upgradeLoss, type UpgradeBoost } from '@engine/upgrader'
import type { Tier } from '@game/logic/rarity'
import { Modal, Pos } from './bits'
import { POWER_UP_INFO } from '@engine/powerups'
import { PowerUpButton } from './PowerUpButton'

/** The dial's win arc takes a rarity colour by how big the gamble is. */
const BOOST_TIER: Record<UpgradeBoost, Tier> = { 2: 'purple', 5: 'pink', 10: 'red' }
/** How long the needle spins before the result shows. */
export const DIAL_MS = 2400

/**
 * The dial: a ring with the winning share (`chance` per cent, from twelve o'clock clockwise) in the boost's rarity
 * colour and the rest dark. With a `roll` the needle spins a few turns and stops on it, inside the arc on a win.
 */
function Dial({ chance, tier, roll, spinning }: { chance: number; tier: Tier; roll: number | null; spinning: boolean }) {
  const r = 52
  const c = 2 * Math.PI * r
  // The roll's middle, so a roll of 0 sits just past twelve o'clock and 99 just before it
  const angle = roll === null ? 0 : 360 * 4 + (roll + 0.5) * 3.6
  return (
    <div className={`upg-dial${spinning ? ' spinning' : ''}`} data-tier={tier} data-testid="upgrader-dial">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="upg-track" cx="60" cy="60" r={r} />
        <circle className="upg-win" cx="60" cy="60" r={r} strokeDasharray={`${(chance / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="upg-needle" style={{ transform: `rotate(${angle}deg)`, transitionDuration: roll === null ? '0ms' : `${DIAL_MS}ms` }} />
      <div className="upg-centre">
        <b data-testid="upgrader-chance">{chance}%</b>
        <span>to win</span>
      </div>
    </div>
  )
}

/**
 * The Player Upgrader: a panel by the reel and, when opened, a sheet to choose a drafted player and a boost with the
 * exact chance on a dial before confirming. The gamble itself is the store's (`upgradePlayer`); this only shows the
 * odds the engine uses (`upgradeChance`) and spins the needle onto the roll the engine made.
 */
export function Upgrader({ players, ratingOf, available, result, hideRatings, onConfirm, tray, lockedId }: { players: PlayerSeason[]; ratingOf: (id: string) => number; available: boolean; result: DraftUpgrade | null | undefined; hideRatings: boolean; onConfirm: (id: string, boost: UpgradeBoost) => void; /** In the power-up tray: a tray button instead of a panel. */ tray?: boolean; /** The player under the Lock power-up, whose loss costs nothing. */ lockedId?: string | null }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [boost, setBoost] = useState<UpgradeBoost>(5)
  // The result is shown once the needle has landed; until then the sheet says it is spinning
  const [shown, setShown] = useState(false)
  const [rolling, setRolling] = useState(false)
  useEffect(() => {
    if (!rolling || !result) return
    const t = window.setTimeout(() => {
      setRolling(false)
      setShown(true)
    }, DIAL_MS + 150)
    return () => window.clearTimeout(t)
  }, [rolling, result])

  const pick = chosen && players.some((p) => p.id === chosen) ? chosen : null
  const player = pick ? players.find((p) => p.id === pick) : undefined
  const base = pick ? ratingOf(pick) : 0
  const chance = pick ? upgradeChance(base, boost) : 0
  const resultPlayer = result ? players.find((p) => p.id === result.id) : undefined
  const done = !!result && (shown || !open)
  const locked = !!pick && pick === lockedId
  const summary = result ? (done ? `${resultPlayer?.name ?? 'Your player'}: ${result.won ? `won, +${result.delta}` : result.locked ? 'lost, the lock held' : `lost, ${result.delta}`} (${result.chance}% chance)` : 'The dial is spinning…') : 'Once per draft: gamble +2, +5 or +10 on a drafted player.'

  return (
    <div className={tray ? 'pu-upgrader' : 'panel tight upg-panel'} data-testid="upgrader">
      {tray ? (
        <PowerUpButton icon={POWER_UP_INFO.upgrader.icon} title={POWER_UP_INFO.upgrader.title} line={POWER_UP_INFO.upgrader.line} status={result ? (done ? (result.won ? `Won +${result.delta}` : result.locked ? 'Lock held' : `Lost ${result.delta}`) : 'Spinning…') : available ? 'Ready' : 'Draft a player'} used={!!result} disabled={!available} onClick={() => setOpen(true)} testId="pu-upgrader" />
      ) : (
      <div className="row between">
        <div>
          <b>⬆️ Player Upgrader</b>
          <div className="small muted">{summary}</div>
        </div>
        {!result && (
          <button className="btn sm primary" disabled={!available} onClick={() => setOpen(true)} data-testid="upgrader-open" title={available ? undefined : 'Draft a player first'}>
            Upgrade
          </button>
        )}
      </div>
      )}
      <Modal open={open} onClose={() => !rolling && setOpen(false)} title="Player Upgrader" sheet testId="upgrader-sheet">
        <div className="col" style={{ gap: 12 }}>
          {!result && (
            <>
              <div className="small muted">Pick one of your players and a boost. Win and his rating rises by the boost; lose and it drops by half. He stays in your side either way. The higher he is already, the worse the odds.</div>
              <div className="upg-players" role="listbox" aria-label="Drafted players">
                {players.map((p) => (
                  <button key={p.id} type="button" role="option" aria-selected={pick === p.id} className={`upg-player${pick === p.id ? ' on' : ''}`} onClick={() => setChosen(p.id)} data-testid="upgrader-player">
                    <Pos p={p.positions[0]} />
                    <span className="nm">{p.name}</span>
                    {!hideRatings && <b>{ratingOf(p.id)}</b>}
                  </button>
                ))}
              </div>
              <div className="segmented" role="group" aria-label="Boost">
                {UPGRADE_BOOSTS.map((b) => (
                  <button key={b} type="button" className={boost === b ? 'active' : ''} onClick={() => setBoost(b)} data-testid={`boost-${b}`}>
                    +{b}
                  </button>
                ))}
              </div>
            </>
          )}
          {(pick || result) && (
            <div className="upg-stage">
              <Dial chance={result ? result.chance : chance} tier={BOOST_TIER[(result?.boost ?? boost) as UpgradeBoost] ?? 'pink'} roll={result ? result.roll : null} spinning={rolling} />
              {!result && player && (
                <div className="col small" style={{ gap: 4 }}>
                  <b>{player.name}</b>
                  <span>
                    Win ({chance}%): {hideRatings ? `+${upgradeGain(base, boost)}` : `${base} → ${base + upgradeGain(base, boost)}`}
                  </span>
                  <span>
                    Lose ({100 - chance}%): {locked ? '🔒 locked, no change' : hideRatings ? `-${upgradeLoss(boost)}` : `${base} → ${base - upgradeLoss(boost)}`}
                  </span>
                </div>
              )}
              {result && shown && (
                <div className={`upg-result ${result.won ? 'won' : 'lost'}`} data-testid="upgrader-result">
                  <b>{result.won ? 'Upgraded!' : result.locked ? 'The lock held' : 'Downgraded'}</b>
                  <span>
                    {resultPlayer?.name ?? 'Your player'} {result.locked ? 'keeps his rating' : result.delta > 0 ? `+${result.delta}` : result.delta}
                  </span>
                </div>
              )}
            </div>
          )}
          {!result ? (
            <button className="btn primary" disabled={!pick} onClick={() => { if (pick) { setRolling(true); setShown(false); onConfirm(pick, boost) } }} data-testid="upgrader-confirm">
              {pick ? `Spin at ${chance}%` : 'Choose a player'}
            </button>
          ) : (
            <button className="btn" disabled={rolling} onClick={() => setOpen(false)} data-testid="upgrader-close">
              {rolling ? 'Spinning…' : 'Back to the draft'}
            </button>
          )}
          <div className="tiny-note small muted">In-game only: no money, nothing to buy. The chance shown is the exact chance.</div>
        </div>
      </Modal>
    </div>
  )
}
