import { HardDriveDownload } from 'lucide-react'
import { SAVE_FAILING_LINE, useStore } from '@game/store'

/**
 * While the browser refuses every save write (its storage is full), a warning stays in the top bar so nobody plays on
 * believing the game is saved (O-14 in docs/QA.md); the toast only shows on the first refusal and every twentieth. It
 * opens Your record, where Export save is, and goes once a write goes through. In the bar it never covers a control;
 * with the bar hidden it floats in the corner opposite the bar's restore pill.
 */
export function SaveBanner({ floating = false }: { floating?: boolean }) {
  const failing = useStore((s) => s.saveFailing)
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  if (!failing) return null
  const label = `${SAVE_FAILING_LINE}. ${screen === 'profile' ? 'Export your save from Save data.' : 'Open Your record to export your save.'}`
  return (
    <div className={`save-banner ${floating ? 'floating' : ''}`} role="alert" data-testid="save-banner" data-dialog-keep="">
      <button type="button" className="save-banner-btn" onClick={() => go('profile')} aria-label={label} title={label} data-testid="save-banner-export" disabled={screen === 'profile'}>
        <HardDriveDownload size={16} aria-hidden="true" />
        <span className="save-banner-text">Not saving</span>
      </button>
    </div>
  )
}
