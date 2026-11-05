import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../format'
import { BriefingList } from '../screens/Dugout'
import { DURATION } from '../motion'
import type { BriefingItem } from '@game/logic/briefing'

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const dark = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='light']"))
const light = css.slice(css.indexOf(":root[data-theme='light']"), css.indexOf('/* ------------------------------------------------------------------ reset'))
const palette = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]))

describe('the refreshed shared palette remains readable', () => {
  for (const [name, block] of [['dark', dark], ['light', light]]) {
    it(`${name}: body, secondary and muted text meet AA on each main surface`, () => {
      const colours = palette(block)
      for (const text of ['text', 'text-2', 'text-3']) {
        for (const surface of ['bg', 'panel', 'panel-2', 'raised']) {
          expect(contrastRatio(colours[text], colours[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      for (const text of ['good', 'warn', 'bad', 'gold-text']) {
        for (const surface of ['panel', 'panel-2', 'raised']) {
          expect(contrastRatio(colours[text], colours[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
    it(`${name}: blue controls and input boundaries stay legible`, () => {
      const colours = palette(block)
      for (const fill of ['primary', 'primary-hover', 'primary-active']) {
        expect(contrastRatio(colours['on-primary'], colours[fill]), fill).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(colours['field-border'], colours['field-bg'])).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('the compact pre-season checklist', () => {
  const items: BriefingItem[] = [
    { id: 'lineup', level: 'block', text: 'Fill the starting XI', action: { label: 'Auto-pick', op: 'autoPick' } },
    { id: 'captain', level: 'ok', text: 'Captain chosen', done: true },
    { id: 'staff', level: 'info', text: 'Choose your staff', done: false, action: { label: 'Club', tab: 'club' } },
  ]
  it('keeps a blocking task visible while optional preparation is collapsed and counted', () => {
    const html = renderToStaticMarkup(createElement(BriefingList, { items, checklist: true, onAction: () => undefined }))
    const details = html.indexOf('<details')
    expect(details).toBeGreaterThan(0)
    expect(html.indexOf('data-brief="lineup"')).toBeLessThan(details)
    expect(html.slice(details)).not.toContain('data-brief="lineup"')
    expect(html.slice(details)).toContain('data-brief="captain"')
    expect(html.slice(details)).toContain('data-brief="staff"')
    expect(html).toContain('1 of 2 done')
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\bopen(?:=|\s|>)/)
    expect(html).toContain('>Club</button>')
  })
  it('does not create an empty disclosure for blockers alone, or change a normal match briefing', () => {
    const blocker = renderToStaticMarkup(createElement(BriefingList, { items: [items[0]], checklist: true, onAction: () => undefined }))
    expect(blocker).toContain('data-brief="lineup"')
    expect(blocker).not.toContain('<details')
    const match = renderToStaticMarkup(createElement(BriefingList, { items: [items[1]], onAction: () => undefined }))
    expect(match).toContain('data-brief="captain"')
    expect(match).not.toContain('<details')
  })
})

describe('the Matchday Ledger UI contract', () => {
  const setupCss = readFileSync(new URL('../screens/Setup.css', import.meta.url), 'utf8')
  const draftCss = readFileSync(new URL('../screens/Draft.css', import.meta.url), 'utf8')
  const homeCss = readFileSync(new URL('../screens/Home.css', import.meta.url), 'utf8')

  it('keeps CSS and TypeScript motion timings in lockstep', () => {
    const timings = [...css.matchAll(/--dur-(\d):\s*(\d+)ms;/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => Number(m[2]))
    expect(timings).toEqual(Object.values(DURATION))
  })

  it('uses ruled working surfaces instead of a generic card entrance', () => {
    expect(homeCss).toContain('border-bottom: var(--border-strong)')
    expect(draftCss).toContain('border-block: var(--border-strong)')
    expect(css).not.toContain('animation: page-in')
    expect(css).not.toContain('@keyframes page-in')
  })

  it('keeps the phone setup action in reading order rather than over the form', () => {
    expect(setupCss).toMatch(/@media \(max-width: 720px\)[\s\S]*\.setup-start\.bottom-bar[\s\S]*position: static/)
    expect(setupCss).toMatch(/\.setup-start \.step-head[\s\S]*display: flex/)
  })
})
