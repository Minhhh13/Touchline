import { HardDrive, RotateCcw } from 'lucide-react'
import { useStore } from '@game/store'
import { Modal } from './bits'

/**
 * Why this page is not saving, for as long as it is not: a banner while the browser's storage refuses every write
 * (it goes with the next write that lands), and a dialog once another tab or window has saved over this page's save
 * (this page has stopped writing, so the only way on is a reload into the newer save).
 */
export function SaveIssue() {
  const issue = useStore((s) => s.saveIssue)
  const go = useStore((s) => s.go)
  const screen = useStore((s) => s.screen)
  if (issue === 'elsewhere') {
    return (
      <Modal open title="Saved in another tab" testId="save-elsewhere">
        <div className="col">
          <p>TouchLine was saved in another tab or window. This tab has stopped saving, so it cannot put its older game back over that progress.</p>
          <p className="muted small">Reload to carry on from the latest save. Anything done in this tab since the other one saved is not kept.</p>
          <button type="button" className="btn primary" onClick={() => location.reload()} data-testid="save-elsewhere-reload">
            <RotateCcw size={16} aria-hidden="true" /> Reload this tab
          </button>
        </div>
      </Modal>
    )
  }
  if (issue !== 'full') return null
  return (
    <div className="save-issue" data-testid="save-full">
      <HardDrive size={16} aria-hidden="true" />
      <span>Not saving: this browser's storage is full</span>
      {screen !== 'profile' && (
        <button type="button" className="btn sm" onClick={() => go('profile')} data-testid="save-full-profile">
          Free space
        </button>
      )}
    </div>
  )
}
