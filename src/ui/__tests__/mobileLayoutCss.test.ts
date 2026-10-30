import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI = path.resolve(__dirname, '..')
const css = (file: string) => readFileSync(path.join(UI, file), 'utf8')

describe('phone layout CSS', () => {
  it('lets the player-choice page own the scroll instead of nesting a scroller in the player list', () => {
    const game = css('mobileGame.css')
    expect(game).toMatch(/\.app > \.draft-page\[data-phone-tab='players'\] \{[^}]*overflow-y: auto;/)
    expect(game).toMatch(/\.draft-page\[data-phone-tab='players'\] \.draft-list,[^}]*overflow: visible;/)
    expect(game).toMatch(/\.draft-page\[data-phone-tab='players'\] > \.phone-tabs \{[^}]*position: sticky;/)
  })

  it('keeps player and summary actions on aligned tracks', () => {
    const game = css('mobileGame.css')
    const summary = css('mobileSummary.css')
    expect(game).toMatch(/\.prow \.right > \.btn \{[^}]*min-width: 56px;[^}]*justify-content: center;/)
    expect(summary).toMatch(/\.result-banner \.banner-actions \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
    expect(summary).toMatch(/\.result-banner \.banner-actions > \.btn,[\s\S]*?width: 100%;[^}]*min-width: 0;[^}]*max-width: none;/)
  })

  it('makes phone navigation, supporting text and setup choices readable', () => {
    const phone = css('mobile.css')
    const game = css('mobileGame.css')
    const setup = css('mobileSetup.css')
    expect(phone).toMatch(/--fs-meta: 0\.8125rem;/)
    expect(phone).toMatch(/:root:not\(\[data-theme='light'\]\) \{[^}]*--text-3: #aebae4;/)
    expect(game).toMatch(/\.topbar nav \{[^}]*overflow-x: auto;/)
    expect(game).toMatch(/\.topbar nav \.nav-label \{[^}]*position: absolute;[^}]*width: 1px;[^}]*clip: rect\(0 0 0 0\);/)
    expect(game).toMatch(/\.topbar nav \.nav-guide \{[^}]*display: none;/)
    expect(setup).toMatch(/\.setup-page \.setup-rules \{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
    expect(setup).not.toMatch(/\.setup-page \.choice-card \.cline \{[^}]*display: none;/)
  })

  it('prepares Home panels before their first tab switch and exposes scroll/reel affordances', () => {
    const setup = css('mobileSetup.css')
    const game = css('mobileGame.css')
    const styles = css('styles.css')
    expect(setup).toMatch(/\[data-phone-panel\]:not\(\[data-phone-panel='more'\]\) \{[^}]*display: none;/)
    expect(game).toMatch(/\.kickoff-page \.phone-scroll-cue \{[^}]*position: sticky;/)
    expect(styles).toMatch(/\.reel-skip \{[^}]*border: 1px solid var\(--primary\);[^}]*font-weight: 700;/)
  })

  it('uses one page scroller for phone management and summary screens', () => {
    const game = css('mobileGame.css')
    const setup = css('mobileSetup.css')
    const summary = css('mobileSummary.css')
    expect(game).toMatch(/\.app:has\(> \.home\),[\s\S]*?height: auto;[\s\S]*?overflow-x: clip;[\s\S]*?overflow-y: visible;/)
    expect(game).toMatch(/\.dugout-page > \.tab-body,[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/)
    expect(game).toContain('.grid.dugout[data-squad-pane]')
    expect(setup).toMatch(/\.app > \.page\.arena-setup\.has-bottom-bar \{[^}]*overflow: visible;/)
    expect(summary).toMatch(/\.summary > \.summary-body \{[^}]*flex: none;[^}]*overflow: visible;/)
    expect(summary).toMatch(/\.result-banner \.banner-actions \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  })

  it('keeps the Home modes equal and lets the full Dugout flow fit the phone width', () => {
    const game = css('mobileGame.css')
    const setup = css('mobileSetup.css')
    expect(setup).toMatch(/\.home \.modes \{[^}]*grid-auto-rows: 1fr;/)
    expect(setup).toMatch(/\.home \.mode-card \{[^}]*height: 100%;/)
    expect(setup).toMatch(/\.home \.mode-card p \{[^}]*-webkit-line-clamp: 3;/)
    expect(game).toMatch(/\.dugout-page \.cta-main \{[^}]*max-height: none;[\s\S]*?overflow: visible;/)
    expect(game).toMatch(/\[data-squad-block='list'\] \.toolbar \{[^}]*display: grid;[^}]*overflow: visible;/)
    expect(game).toMatch(/\.dugout-page \.depth-row \{[^}]*grid-template-columns: 28px minmax\(0, 1fr\);/)
    expect(game).toMatch(/\.explore-head-actions \{[^}]*width: 100%;[^}]*justify-content: space-between;/)
  })
})
