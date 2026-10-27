import { RotateCcw } from 'lucide-react'
import { useStore } from '@game/store'
import { Modal } from './bits'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const t = translator(online)

/**
 * A dialog once another tab or window has saved over this page's save: this page has stopped writing, so the only way
 * on is a reload into the newer save. A full storage is `SaveBanner`'s (in the top bar while writes fail).
 */
export function SaveIssue() {
  const issue = useStore((s) => s.saveIssue)
  if (issue !== 'elsewhere') return null
  return (
    <Modal open title={t('savedElsewhereTitle')} testId="save-elsewhere">
      <div className="col">
        <p>{t('savedElsewhereBody')}</p>
        <p className="muted small">{t('savedElsewhereReload')}</p>
        <button type="button" className="btn primary" onClick={() => location.reload()} data-testid="save-elsewhere-reload">
          <RotateCcw size={16} aria-hidden="true" /> {t('reloadTab')}
        </button>
      </div>
    </Modal>
  )
}
