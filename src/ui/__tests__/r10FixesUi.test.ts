import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from '../i18n/en/app'
import { contrastRatio } from '../format'

const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
const word = (key: string): string => (app.messages as Record<string, string>)[key]

describe('R9-O1: the phone dock names each button starting with the word on screen', () => {
  const nav = src('App.tsx').split('<nav>')[1].split('</nav>')[0]
  const buttons = nav.split('<button').slice(1)

  it('every phone caption starts its button\'s name, on a phone where the full label is only read aloud', () => {
    expect(buttons.length).toBeGreaterThanOrEqual(6)
    let named = 0
    for (const b of buttons) {
      const tiny = /<span className="nav-tiny"( aria-hidden="true")?>\{(?:t\('(\w+)'\)|(\w+))\}<\/span>/.exec(b)
      expect(tiny, b).not.toBeNull()
      const hidden = !!tiny![1]
      const label = /<span className="nav-label">(.*?)<\/span>\n/.exec(b)![1]
      // On a phone the long Explore label is display: none, the short one is read
      const labelKeys = [...label.replace(/<span className="nav-long">.*?<\/span>/, '').matchAll(/t\('(\w+)'\)|\{(\w+)\}/g)].map((m) => m[1] ?? m[2])
      if (!tiny![2]) {
        // The game's own entry: the caption and the label are the same expression
        expect(hidden).toBe(true)
        expect(labelKeys).toEqual([tiny![3]])
        continue
      }
      const caption = word(tiny![2])
      const name = [...(hidden ? [] : [caption]), ...labelKeys.map(word)].join(' ')
      expect(name.startsWith(caption), `${caption} → "${name}"`).toBe(true)
      // A caption equal to the label stays hidden so the name is not said twice
      if (labelKeys.map(word).join(' ') === caption) expect(hidden).toBe(true)
      else named++
    }
    expect(named).toBe(3)
  })

  it('the captions stay out of the desktop name: display: none outside the phone block', () => {
    expect(src('styles.css')).toMatch(/\.topbar nav \.nav-tiny \{\n {2}display: none;\n\}/)
  })
})

describe('R9-O3: no component reads the whole store', () => {
  function tsx(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : tsx(join(dir, e.name))) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []))
  }

  it('every component under src/ui picks its keys (useStorePick or a selector), never a bare useStore()', () => {
    const files = tsx(join(__dirname, '..'))
    expect(files.length).toBeGreaterThan(100)
    const bare = files.filter((f) => /useStore\(\)/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(f.indexOf('src/ui')))
    expect(bare).toEqual([])
  })
})

describe('R9-O4: the Office\'s conversation topics wrap in their box', () => {
  it('the topics are a wrapping segmented row, never a sideways scroller', () => {
    const office = src('screens/OfficeTab.tsx')
    const row = /<div className="([^"]*)"[^>]*role="radiogroup" aria-label=\{t\('talks'\)\}/.exec(office)
    expect(row).not.toBeNull()
    expect(row![1].split(' ')).toEqual(['segmented'])
    expect(src('styles.css')).toMatch(/\n\.segmented \{\n {2}display: inline-flex;\n {2}flex-wrap: wrap;/)
  })
})

describe('r9 visual leftover: what sits on the grass clears 3:1 on both stripes (WCAG 1.4.11)', () => {
  const css = src('styles.css')
  const token = (name: string): string => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(css)![1]
  it('the out-of-position, fit and cover glows and the flagged disc', () => {
    for (const glow of ['pitch-bad', 'pitch-fit', 'pitch-cover']) {
      for (const grass of ['pitch', 'pitch-2']) expect(contrastRatio(token(glow), token(grass)), `${glow} on ${grass}`).toBeGreaterThanOrEqual(3)
    }
  })
})
