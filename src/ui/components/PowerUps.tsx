import { useState } from 'react'
import { useStore } from '@game/store'
import { isComplete, positionFirst, targetSlot, type DraftState } from '@engine/draft'
import { ICONS_SEASON } from '@engine/icons'
import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ARMBAND_BOOST, POWER_UP_INFO, POWER_UPS_ICON, armbandId, canArmband, canLock, canPeek, canReroll, canSwap, lockedId, peekedSeason, powerUpUsed, rerollOptions, swapTargets, trayKinds } from '@engine/powerups'
import { canUpgrade, upgradeBaseRating, upgradeCandidates } from '@engine/upgrader'
import { formatOdds } from '@game/logic/tierOdds'
import { Modal, Pos } from './bits'
import { PowerUpButton } from './PowerUpButton'
import { Upgrader } from './Upgrader'
import { seasonLabel } from '../format'

type Sheet = 'reroll' | 'swap' | 'armband' | 'lock' | null

/**
 * The power-up tray on a Quick Draft with power-ups: six one-use buttons (the Upgrader, Re-roll season, Peek, Swap,
 * Captain's armband, Lock), each with an Info tip, and a sheet for those that need a choice. Every decision is the
 * store's and the engine's (`src/engine/powerups.ts`); this only shows what each would do, with the odds first.
 */
export function PowerUpTray({ u, d, get, hideRatings, busy, onRerolled }: { u: LoadedUniverse; d: DraftState; get: (id: string) => PlayerSeason | undefined; hideRatings: boolean; /** The reel is running. */ busy: boolean; onRerolled: () => void }) {
  const { game, upgradePlayer, rerollSeason, peekSpin, swapSlots, giveArmband, lockPlayer } = useStore()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const drafting = game?.phase === 'draft'
  const complete = isComplete(d)
  const players = upgradeCandidates(d).flatMap((id) => get(id) ?? [])
  const options = rerollOptions(u, d)
  const peeked = peekedSeason(d)
  const lock = lockedId(d)
  const band = armbandId(d)
  const slotPos = (id: string) => d.formation.slots.find((s) => s.id === id)?.position
  const nameOf = (id: string) => get(id)?.name ?? 'your player'
  const close = () => {
    setSheet(null)
    setFrom(null)
    setTo(null)
    setWho(null)
  }

  const peekUse = d.powerUps?.find((x) => x.kind === 'peek')
  const rerollUse = d.powerUps?.find((x) => x.kind === 'reroll')
  const swapUse = d.powerUps?.find((x) => x.kind === 'swap')
  const status = {
    reroll: rerollUse && rerollUse.kind === 'reroll' ? `→ ${seasonLabel(rerollUse.to)}` : busy ? 'Reel running' : !d.current ? 'After a spin' : options.length ? `${options.length} season${options.length === 1 ? '' : 's'}` : 'No other season',
    peek: peekUse && peekUse.kind === 'peek' ? (peeked !== null ? `Next: ${peeked === ICONS_SEASON ? 'Icons' : seasonLabel(peeked)}` : `Saw ${peekUse.season === ICONS_SEASON ? 'Icons' : seasonLabel(peekUse.season)}`) : complete ? 'Draft complete' : d.current ? 'Before a spin' : positionFirst(d) && !targetSlot(d) ? 'Choose a slot' : 'Ready',
    swap: swapUse && swapUse.kind === 'swap' ? `${slotPos(swapUse.from)} ⇄ ${slotPos(swapUse.to)}` : d.current ? 'Between spins' : canSwap(u, d) ? 'Ready' : 'No move yet',
    armband: band ? `${nameOf(band)} +${ARMBAND_BOOST}` : canArmband(d) ? 'Ready' : 'Draft a player',
    lock: lock ? nameOf(lock) : d.upgrade ? 'Upgrader used' : canLock(d) ? 'Ready' : 'Draft a player',
  }
  const starters = d.formation.slots.filter((s) => d.lineup[s.id] && swapTargets(u, d, s.id).length)
  const targets = from ? swapTargets(u, d, from) : []
  // The whole tray, or only what was unpacked from the locker into a draft without it
  const kinds = trayKinds(d)
  const fromLocker = !d.rules.powerUps

  return (
    <div className="panel tight pu-tray" data-testid="power-ups">
      <div className="row between wrap pu-head" style={{ marginBottom: 8 }}>
        <b>{fromLocker ? '🎒 From your locker' : `${POWER_UPS_ICON} Power-ups`}</b>
        <span className="small muted">One use each · in-game only</span>
      </div>
      {peeked !== null && (
        <div className="notice small" data-testid="peek-notice" style={{ marginBottom: 8 }}>
          {POWER_UP_INFO.peek.icon} Peek: the next spin lands in <b>{peeked === ICONS_SEASON ? 'the Icons collection' : seasonLabel(peeked)}</b>.
        </div>
      )}
      <div className="pu-grid">
        {kinds.includes('upgrader') && (
          <Upgrader tray players={players} ratingOf={(id) => upgradeBaseRating(u, d, id) ?? 0} available={canUpgrade(d) && drafting} result={d.upgrade} hideRatings={hideRatings} lockedId={lock} onConfirm={(id, boost) => upgradePlayer(id, boost)} />
        )}
        {kinds.includes('reroll') && (
          <PowerUpButton icon={POWER_UP_INFO.reroll.icon} title={POWER_UP_INFO.reroll.title} line={POWER_UP_INFO.reroll.line} status={status.reroll} used={powerUpUsed(d, 'reroll')} disabled={!drafting || busy || !canReroll(u, d)} onClick={() => setSheet('reroll')} testId="pu-reroll" />
        )}
        {kinds.includes('peek') && (
          <PowerUpButton icon={POWER_UP_INFO.peek.icon} title={POWER_UP_INFO.peek.title} line={POWER_UP_INFO.peek.line} status={status.peek} used={powerUpUsed(d, 'peek')} disabled={!drafting || busy || !canPeek(u, d)} onClick={() => peekSpin()} testId="pu-peek" />
        )}
        {kinds.includes('swap') && (
          <PowerUpButton icon={POWER_UP_INFO.swap.icon} title={POWER_UP_INFO.swap.title} line={POWER_UP_INFO.swap.line} status={status.swap} used={powerUpUsed(d, 'swap')} disabled={!drafting || busy || !canSwap(u, d)} onClick={() => setSheet('swap')} testId="pu-swap" />
        )}
        {kinds.includes('armband') && (
          <PowerUpButton icon={POWER_UP_INFO.armband.icon} title={POWER_UP_INFO.armband.title} line={POWER_UP_INFO.armband.line} status={status.armband} used={powerUpUsed(d, 'armband')} disabled={!drafting || !canArmband(d)} onClick={() => setSheet('armband')} testId="pu-armband" />
        )}
        {kinds.includes('lock') && (
          <PowerUpButton icon={POWER_UP_INFO.lock.icon} title={POWER_UP_INFO.lock.title} line={POWER_UP_INFO.lock.line} status={status.lock} used={powerUpUsed(d, 'lock')} disabled={!drafting || !canLock(d)} onClick={() => setSheet('lock')} testId="pu-lock" />
        )}
      </div>

      <Modal open={sheet === 'reroll'} onClose={close} title={`${POWER_UP_INFO.reroll.icon} Re-roll season`} sheet testId="reroll-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">Same club, a new year: the reel spins again over the club's other seasons on this wheel. Each is equally likely.</div>
          <div className="pu-odds" data-testid="reroll-odds">
            {options.map((cs) => (
              <span key={cs.season} className="pu-odd">
                {seasonLabel(cs.season)} <b>{formatOdds(1 / options.length)}</b>
              </span>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!options.length}
            onClick={() => {
              rerollSeason()
              onRerolled()
              close()
            }}
            data-testid="reroll-confirm"
          >
            Re-roll (1 in {options.length})
          </button>
          <div className="tiny-note small muted">In-game only: no money, nothing to buy. The chances shown are the exact chances.</div>
        </div>
      </Modal>

      <Modal open={sheet === 'swap'} onClose={close} title={`${POWER_UP_INFO.swap.icon} Swap`} sheet testId="swap-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">{from ? `Move ${nameOf(d.lineup[from])} to:` : 'Choose a starter to move. He can go to any slot he can cover; a player already there moves the other way if he can cover too.'}</div>
          <div className="upg-players" role="listbox" aria-label={from ? 'Slots' : 'Starters'}>
            {!from &&
              starters.map((s) => {
                const p = get(d.lineup[s.id])
                return (
                  <button key={s.id} type="button" role="option" aria-selected={false} className="upg-player" onClick={() => setFrom(s.id)} data-testid="swap-from">
                    <Pos p={s.position} />
                    <span className="nm">{p?.name ?? '?'}</span>
                  </button>
                )
              })}
            {from &&
              targets.map((id) => {
                const occupant = d.lineup[id] ? get(d.lineup[id]) : undefined
                const pos = slotPos(id)
                return (
                  <button key={id} type="button" role="option" aria-selected={to === id} className={`upg-player${to === id ? ' on' : ''}`} onClick={() => setTo(id)} data-testid="swap-to">
                    {pos && <Pos p={pos} />}
                    <span className="nm">{occupant ? `⇄ ${occupant.name}` : 'Open slot'}</span>
                  </button>
                )
              })}
          </div>
          <div className="row between">
            <button className="btn sm ghost" disabled={!from} onClick={() => { setFrom(null); setTo(null) }}>
              Back
            </button>
            <button
              className="btn primary"
              disabled={!from || !to}
              onClick={() => {
                if (from && to) swapSlots(from, to)
                close()
              }}
              data-testid="swap-confirm"
            >
              {from && to ? `Move to ${slotPos(to)}` : 'Choose a slot'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={sheet === 'armband' || sheet === 'lock'} onClose={close} title={sheet === 'lock' ? `${POWER_UP_INFO.lock.icon} Lock` : `${POWER_UP_INFO.armband.icon} Captain's armband`} sheet testId="pick-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">{sheet === 'lock' ? 'Choose a player to lock: if the Upgrader loses on him, his rating stays where it is. Use it before the Upgrader.' : `Choose a player to wear the armband: +${ARMBAND_BOOST} to his rating for the season.`}</div>
          <div className="upg-players" role="listbox" aria-label="Drafted players">
            {players.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={who === p.id} className={`upg-player${who === p.id ? ' on' : ''}`} onClick={() => setWho(p.id)} data-testid="pu-player">
                <Pos p={p.positions[0]} />
                <span className="nm">{p.name}</span>
                {!hideRatings && <b>{p.overall}</b>}
              </button>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!who}
            onClick={() => {
              if (who) (sheet === 'lock' ? lockPlayer : giveArmband)(who)
              close()
            }}
            data-testid="pu-player-confirm"
          >
            {who ? (sheet === 'lock' ? `Lock ${nameOf(who)}` : `Armband to ${nameOf(who)}`) : 'Choose a player'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
