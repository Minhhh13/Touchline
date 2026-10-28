import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { POWER_UPS, POWER_UP_INFO } from '@engine/powerups'
import { canUnpackFromLocker, lockerCount, lockerOn } from '@game/logic/endCase'
import { LOCKER_ICON, PowerUpIcon } from './icons'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'

const t = translator(draft)

/**
 * The locker on a Quick Draft without the power-up tray: the power-ups end-of-draft cases have dropped, by count, each
 * a button that unpacks one into this draft (`unpackPowerUp`), where it then sits in a tray of its own and works as the
 * tray's. Nothing shows when the locker is empty or closed (the Daily, a challenge link, a draft with the tray).
 */
export function LockerBar({ game, busy }: { game: Game; busy: boolean }) {
  const profile = useStore((s) => s.profile)
  const unpackPowerUp = useStore((s) => s.unpackPowerUp)
  if (!lockerOn(game)) return null
  const held = POWER_UPS.filter((k) => lockerCount(profile, k) > 0)
  if (!held.length) return null
  return (
    <div className="panel tight locker" data-testid="locker">
      <b className="small row" style={{ gap: 6 }}>
        <LOCKER_ICON size={14} aria-hidden="true" />
        {t('locker')}
      </b>
      {held.map((k) => (
        <button key={k} type="button" className="btn sm locker-btn" disabled={busy || !canUnpackFromLocker(game, profile, k)} onClick={() => unpackPowerUp(k)} title={t('unpackTip', { line: POWER_UP_INFO[k].line })} data-testid={`locker-${k}`}>
          <PowerUpIcon kind={k} size={14} /> {POWER_UP_INFO[k].title} <span className="n">×{lockerCount(profile, k)}</span>
        </button>
      ))}
      <span className="help">{t('lockerHelp')}</span>
    </div>
  )
}
