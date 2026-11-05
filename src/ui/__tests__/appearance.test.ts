import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppearanceButton } from '../components/Appearance'
import { AppearanceControls } from '../components/AppearanceControls'

describe('the shared appearance picker', () => {
  it('exposes a named dialog trigger in both the game header and the Home tools', () => {
    for (const props of [{}, { className: 'home-theme-toggle', testId: 'home-theme-toggle' }]) {
      const html = renderToStaticMarkup(createElement(AppearanceButton, props))
      expect(html).toContain('aria-label="Appearance and colours"')
      expect(html).toContain('aria-haspopup="dialog" aria-expanded="false"')
      expect(html).not.toContain('role="dialog"')
    }
  })

  it('offers the same three themes and Dark palettes as labelled radio groups', () => {
    const html = renderToStaticMarkup(createElement(AppearanceControls))
    expect(html).toContain('role="radiogroup" aria-label="Theme"')
    expect(html).toContain('role="radiogroup" aria-label="Dark colours"')
    expect(html.match(/role="radio"/g)).toHaveLength(6)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2)
    for (const name of ['Auto', 'Light', 'Dark', 'Slate', 'Midnight', 'Warm']) expect(html).toContain(name)
    expect(html).toContain('Light keeps its own colours.')
    expect(html.match(/class="palette-swatch [^"]+" aria-hidden="true"/g)).toHaveLength(3)
  })
})
