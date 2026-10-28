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
})
