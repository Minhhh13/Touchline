import { HardDriveDownload } from 'lucide-react'
import { SAVE_FAILING_LINE, useStore } from '@game/store'

/**
 * While the browser refuses every save write (its storage is full), a banner stays up so nobody plays on believing the
 * game is saved (O-14 in docs/QA.md); the toast only shows on the first refusal and every twentieth. It offers the way
 * out, Your record's Export save, and goes once a write goes through.
 */
export function SaveBanner() {
  const failing = useStore((s) => s.saveFailing)
  const screen = useStore((s) => s.screen)
  const go = useStore((s) => s.go)
  if (!failing) return null
  return (
    <div className="save-banner" role="alert" data-testid="save-banner" data-dialog-keep="">
      <span>{SAVE_FAILING_LINE}</span>
      {screen !== 'profile' && (
        <button type="button" className="btn sm" onClick={() => go('profile')} data-testid="save-banner-export">
          <HardDriveDownload size={14} aria-hidden="true" /> Export save
        </button>
      )}
    </div>
  )
}
