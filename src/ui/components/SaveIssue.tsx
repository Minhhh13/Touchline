import { RotateCcw } from 'lucide-react'
import { useStore } from '@game/store'
import { Modal } from './bits'

/**
 * A dialog once another tab or window has saved over this page's save: this page has stopped writing, so the only way
 * on is a reload into the newer save. A full storage is `SaveBanner`'s (in the top bar while writes fail).
 */
export function SaveIssue() {
  const issue = useStore((s) => s.saveIssue)
  if (issue !== 'elsewhere') return null
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
