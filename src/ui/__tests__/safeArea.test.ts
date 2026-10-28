import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEVICE_INSETS, SAFE_TOKENS, safeAreaOverride, strayInsets } from '../safeArea'

const UI = path.resolve(__dirname, '..')
const css = (f: string) => readFileSync(path.join(UI, f), 'utf8')
const SHEETS = ['styles.css', 'mobile.css', 'mobileGame.css', 'mobileSetup.css', 'matchday/matchday.css', 'matchday/matchday-controls.css', 'matchday/matchday-phone.css', 'matchday/mobileMatch.css']

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(text: string, sel: string): string {
  const i = text.indexOf(`\n${sel} {`)
  expect(i, sel).toBeGreaterThan(-1)
  return text.slice(i, text.indexOf('}', i))
}

describe('safe areas', () => {
  it('reads every inset through the four tokens, so a preview can emulate a device', () => {
    for (const f of SHEETS) expect(strayInsets(css(f)), f).toEqual([])
    const s = css('styles.css')
    for (const side of ['top', 'right', 'bottom', 'left'] as const) expect(s).toContain(`${SAFE_TOKENS[side]}: env(safe-area-inset-${side}, 0px);`)
    expect(strayInsets('  padding-bottom: env(safe-area-inset-bottom);')).toHaveLength(1)
    expect(strayInsets('  --safe-top: env(safe-area-inset-top, 0px);')).toEqual([])
  })

  it('keeps the top bar, the bottom bars, the toast and full-screen sheets clear of the notch and the home indicator', () => {
    const s = css('styles.css')
    expect(rule(s, '.topbar')).toContain('calc(10px + var(--safe-top))')
    expect(rule(s, '.topbar-restore')).toContain('top: calc(10px + var(--safe-top))')
    expect(rule(s, '.toast')).toContain('bottom: calc(22px + var(--safe-bottom))')
    expect(rule(s, '.app.bar-hidden')).toContain('padding-top: var(--safe-top)')
    expect(rule(s, '.app.bar-hidden::before')).toContain('height: var(--safe-top)')
    expect(rule(s, '.save-banner.floating')).toContain('top: calc(10px + var(--safe-top))')
    expect(rule(s, '.decisions-pill')).toContain('bottom: calc(16px + var(--safe-bottom))')
    expect(rule(s, '.assistant-note')).toContain('bottom: calc(16px + var(--safe-bottom))')
    expect(s).toMatch(/\.squad-complete > \.sc-foot \{[^}]*max\(var\(--panel-pad\), var\(--safe-bottom\)\)/)
    expect(s).toMatch(/\.bottom-bar \{[^}]*calc\(10px \+ var\(--safe-bottom\)\)/)
    expect(s).toMatch(/\.cta-bar \{[^}]*var\(--safe-bottom\)/)
    expect(s).toMatch(/\.modal\.card-modal \{[^}]*calc\(var\(--space-3\) \+ var\(--safe-top\)\)/)
    const phone = css('matchday/matchday-phone.css')
    expect(phone).toMatch(/\.md-drawer\.board \{[^}]*padding-top: var\(--safe-top\)/)
    expect(phone).toMatch(/\.decision-sheet:has\(\.md-stop-board\) \{[^}]*padding-top: var\(--safe-top\)/)
    // The phone's sticky scoreboard row stops under the status bar while the app's bar is folded away
    expect(phone).toMatch(/\.md-topbar \{[^}]*position: sticky;[^}]*top: calc\(max\(var\(--topbar-h, 0px\), var\(--safe-top\)\) \+ var\(--md-stick, 0px\)\)/)
  })

  it('writes an override a browser preview can inject', () => {
    expect(safeAreaOverride({ top: 47, right: 0, bottom: 34.4, left: -3 })).toBe(':root{--safe-top:47px !important;--safe-right:0px !important;--safe-bottom:34px !important;--safe-left:0px !important}')
    expect(DEVICE_INSETS['390x844']).toMatchObject({ top: 47, bottom: 34 })
    expect(DEVICE_INSETS['430x932']).toMatchObject({ top: 59, bottom: 34 })
    for (const [k, d] of Object.entries(DEVICE_INSETS)) expect(k).toBe(`${d.width}x${d.height}`)
  })
})
