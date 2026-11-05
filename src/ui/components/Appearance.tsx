import { lazy, Suspense, useState } from 'react'
import { createPortal } from 'react-dom'
import { Palette } from 'lucide-react'
import { translator } from '../i18n'
import { appearance } from '../i18n/en/appearance'

const t = translator(appearance)
const AppearanceDialog = lazy(() => import('./AppearanceDialog'))

/** The existing focus-trapped dialog loads on demand, clear of header/scene clipping. */
export function AppearanceButton({ className = 'theme-switch', testId = 'theme-switch' }: { className?: string; testId?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} aria-label={t('open')} title={t('open')} aria-haspopup="dialog" aria-expanded={open} data-testid={testId}>
      <Palette size={18} aria-hidden="true" />
    </button>
    {open && createPortal(
      <Suspense fallback={null}><AppearanceDialog onClose={() => setOpen(false)} /></Suspense>, document.body,
    )}
  </>
}
