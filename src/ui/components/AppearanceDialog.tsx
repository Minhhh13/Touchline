import { translator } from '../i18n'
import { appearance } from '../i18n/en/appearance'
import { Modal } from './bits'
import { AppearanceControls } from './AppearanceControls'

const t = translator(appearance)

export default function AppearanceDialog({ onClose }: { onClose: () => void }) {
  return <Modal open onClose={onClose} title={t('title')} className="appearance-dialog" testId="appearance-dialog">
    <div className="col appearance-options"><AppearanceControls /></div>
  </Modal>
}
