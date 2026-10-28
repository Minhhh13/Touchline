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
    expect(summary).toMatch(/\.result-banner \.banner-actions \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/)
    expect(summary).toMatch(/\.result-banner \.banner-actions > \.btn,[\s\S]*?flex: 0 0 calc\(\(100% - 18px\) \/ 4\);[^}]*min-width: 0;[^}]*max-width: none;/)
  })

  it('makes phone navigation, supporting text and setup choices readable', () => {
    const phone = css('mobile.css')
    const game = css('mobileGame.css')
    const setup = css('mobileSetup.css')
    expect(phone).toMatch(/--fs-meta: 0\.8125rem;/)
    expect(phone).toMatch(/:root:not\(\[data-theme='light'\]\) \{[^}]*--text-3: #aebae4;/)
    expect(game).toMatch(/\.topbar nav \{[^}]*overflow-x: auto;/)
    expect(game).toMatch(/\.topbar nav \.nav-label \{[^}]*position: static;[^}]*font-size: 11px;/)
    expect(game).toMatch(/\.topbar nav \.nav-guide \{[^}]*display: none;/)
    expect(setup).toMatch(/\.setup-page \.setup-rules \{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
    expect(setup).not.toMatch(/\.setup-page \.choice-card \.cline \{[^}]*display: none;/)
  })

  it('prepares Home panels before their first tab switch and exposes scroll/reel affordances', () => {
    const setup = css('mobileSetup.css')
    const game = css('mobileGame.css')
    const styles = css('styles.css')
    expect(setup).toMatch(/\[data-phone-panel\]:not\(\[data-phone-panel='more'\]\) \{[^}]*position: absolute;[^}]*visibility: hidden;/)
    expect(game).toMatch(/\.kickoff-page \.phone-scroll-cue \{[^}]*position: sticky;/)
    expect(styles).toMatch(/\.reel-skip \{[^}]*border: 1px solid var\(--primary\);[^}]*font-weight: 700;/)
  })
})
