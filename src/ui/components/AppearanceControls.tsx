import { useStorePick } from '../useStorePick'
import { useDarkPalette } from '../palette'
import { translator } from '../i18n'
import { appearance } from '../i18n/en/appearance'
import { Segmented } from './bits'
import './Appearance.css'

const t = translator(appearance)

/** The same settings in Profile and the quick picker, backed by the existing preferences. */
export function AppearanceControls() {
  const { profile, setTheme } = useStorePick('profile', 'setTheme')
  const [palette, setPalette] = useDarkPalette()
  return <>
    <div className="field">
      <span>{t('theme')}</span>
      <Segmented label={t('theme')} value={profile.theme} onChange={setTheme} options={[
        { value: 'auto', label: t('auto'), hint: t('autoHint') },
        { value: 'light', label: t('light') },
        { value: 'dark', label: t('dark') },
      ]} />
    </div>
    <div className="field" data-testid="dark-palette">
      <span>{t('colours')}</span>
      <Segmented label={t('colours')} value={palette} onChange={setPalette} options={[
        { value: 'slate', label: <><span className="palette-swatch slate" aria-hidden="true" />{t('slate')}</> },
        { value: 'midnight', label: <><span className="palette-swatch midnight" aria-hidden="true" />{t('midnight')}</> },
        { value: 'warm', label: <><span className="palette-swatch warm" aria-hidden="true" />{t('warm')}</> },
      ]} />
      <span className="small muted">{t('coloursHint')}</span>
    </div>
  </>
}
