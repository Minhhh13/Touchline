import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { POWER_UPS, POWER_UP_INFO } from '@engine/powerups'
import { canUnpackFromLocker, lockerCount, lockerOn } from '@game/logic/endCase'

/**
 * The locker on a Quick Draft without the power-up tray: the power-ups end-of-draft cases have dropped, by count, each
 * a button that unpacks one into this draft (`unpackPowerUp`), where it then sits in a tray of its own and works as the
 * tray's. Nothing shows when the locker is empty or closed (the Daily, a challenge link, a draft with the tray).
 */
export function LockerBar({ game, busy }: { game: Game; busy: boolean }) {
  const { profile, unpackPowerUp } = useStore()
  if (!lockerOn(game)) return null
  const held = POWER_UPS.filter((k) => lockerCount(profile, k) > 0)
  if (!held.length) return null
  return (
    <div className="panel tight locker" data-testid="locker">
      <b className="small">🎒 Locker</b>
      {held.map((k) => (
        <button key={k} type="button" className="btn sm locker-btn" disabled={busy || !canUnpackFromLocker(game, profile, k)} onClick={() => unpackPowerUp(k)} title={`Unpack into this draft: ${POWER_UP_INFO[k].line}`} data-testid={`locker-${k}`}>
          <span aria-hidden="true">{POWER_UP_INFO[k].icon}</span> {POWER_UP_INFO[k].title} <span className="n">×{lockerCount(profile, k)}</span>
        </button>
      ))}
      <span className="help">Unpack one into this draft; it is gone from the locker once unpacked.</span>
    </div>
  )
}
