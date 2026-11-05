import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Lockup, LogoMark, Wordmark } from '../components/Logo'
import { MARK, markSvgInner, markTier, pennantPath, type MarkTier } from '../brand'

const TIERS: MarkTier[] = ['full', 'mid', 'tiny']

function points(d: string): [number, number][] {
  return d
    .replace(/[MZ]/g, '')
    .split('L')
    .map((p) => p.trim().split(/\s+/).map(Number) as [number, number])
}

describe('the flat TouchLine mark', () => {
  it('picks its detail tier by rendered size', () => {
    expect(markTier(512)).toBe('full')
    expect(markTier(64)).toBe('full')
    expect(markTier(48)).toBe('mid')
    expect(markTier(24)).toBe('mid')
    expect(markTier(20)).toBe('tiny')
    expect(markTier(16)).toBe('tiny')
  })

  it('keeps the flag, ball and touchline physically related at every size', () => {
    for (const tier of TIERS) {
      const { ball, line, pole, pennant } = MARK.tiers[tier]
      expect(ball.cy + ball.r).toBeCloseTo(line.y - line.w / 2, 6)
      expect(ball.cx - ball.r).toBeGreaterThan(pole.x + pole.w / 2)
      expect(line.x2).toBeGreaterThan(ball.cx + ball.r)
      expect(pole.y2 + (tier === 'tiny' ? 0 : pole.w / 2)).toBeCloseTo(line.y - line.w / 2, 6)
      for (const [x, y] of points(pennantPath(pennant))) expect(Math.hypot(x - ball.cx, y - ball.cy)).toBeGreaterThan(ball.r + 2.5)
    }
  })

  it('is one flat cobalt tile with a red flag and no generated sheen or looping SVG motion', () => {
    const svg = markSvgInner('flat', { tier: 'full' })
    expect(svg).toContain(`fill="${MARK.tile}"`)
    expect(svg).toContain(`fill="${MARK.red}"`)
    expect(svg).not.toMatch(/linearGradient|radialGradient|filter|<animate|<use/)
  })

  it('has useful colour, mono and inverse variants', () => {
    const colour = markSvgInner('c', { tier: 'mid', variant: 'colour' })
    const mono = markSvgInner('m', { tier: 'mid', variant: 'mono' })
    const inverse = markSvgInner('i', { tier: 'mid', variant: 'inverse' })
    expect(colour).toContain(`<rect width="64" height="64" rx="${MARK.tileRadius}" fill="${MARK.tile}"/>`)
    expect(mono).not.toContain('<rect width="64" height="64"')
    expect(mono).toContain('currentColor')
    expect(inverse).toContain('fill="#ffffff"')
    expect(inverse).toContain(MARK.tile)
    expect(inverse).toContain(MARK.red)
  })

  it('keeps the favicon generated from the tiny tier', () => {
    const actual = readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8').trim()
    expect(actual).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${markSvgInner('tl', { tier: 'tiny' })}</svg>`)
  })

  it('keeps the open football white while the pole follows the scene ink', () => {
    const svg = markSvgInner('day', { tier: 'full', tile: 'none' })
    expect(svg).toContain('height="42" fill="currentColor"')
    expect(svg).toContain('d="M36 34H46V37H50V49H46V53H36V50H32V38H36Z" fill="#f5f1df"')
    expect(svg).toContain(`width="7" height="7" fill="${MARK.panel}"`)
  })

  it('lets app colour outlines follow the palette without recolouring exported or inverse icons', () => {
    const live = renderToStaticMarkup(createElement(LogoMark, { size: 32 }))
    expect(live).toContain(`stroke="var(--brand-line, ${MARK.keyline})"`)
    expect(markSvgInner('icon', { tier: 'tiny' })).toContain(`stroke="${MARK.keyline}"`)
    expect(markSvgInner('inverse', { tier: 'mid', variant: 'inverse', themeable: true })).toContain(`stroke="${MARK.tile}"`)
  })
})

describe('the wordmark lockup', () => {
  it('ships every declared font subset as a valid offline-precached WOFF2 file', () => {
    const css = ['fonts.css', 'readingFonts.css'].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n')
    const worker = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8')
    const paths = [...new Set([...css.matchAll(/url\('\/(fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]))]
    expect(paths).toHaveLength(15)
    for (const path of paths) {
      expect(readFileSync(new URL(`../../../public/${path}`, import.meta.url)).subarray(0, 4).toString(), path).toBe('wOF2')
      expect(worker, path).toContain(`'./${path}'`)
    }
  })
  it('carries the product name once as real text and no decorative animation copy', () => {
    const html = renderToStaticMarkup(createElement(Lockup, { height: 40, animate: 'hover' }))
    expect(html.replace(/<[^>]*>/g, '')).toBe('TouchLine')
    expect(html).toContain('class="tl-lockup tl-hover"')
    expect(html).toContain('style="--tl-h:40px"')
    expect(html).toContain('role="img" aria-label="TouchLine"')
    expect(html).not.toMatch(/tl-shine|tl-flag|tl-ball|<animate/)
  })

  it('keeps the standalone mark accessible only when it has a title', () => {
    const titled = renderToStaticMarkup(createElement(LogoMark, { size: 32, title: 'TouchLine' }))
    const decorative = renderToStaticMarkup(createElement(LogoMark, { size: 32 }))
    expect(titled).toContain('role="img"')
    expect(titled).toContain('aria-label="TouchLine"')
    expect(decorative).toContain('aria-hidden="true"')
  })

  it('keeps a local pixel identity and a separate smooth reading face', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
    expect(css).toContain("--font-brand: 'VT323'")
    expect(css).toContain("--font-display: 'Barlow'")
    expect(css).toContain("--font-body: 'Barlow'")
    expect(css).toContain('font-family: var(--font-brand);')
    expect(css).toContain('.brand:active .tl-hover .logo-mark')
    expect(html).toContain('fonts/vt323-latin.woff2')
    expect(html).toContain('favicon.svg?v=20261105')
    expect(html).not.toContain('fonts.googleapis.com')
    expect(renderToStaticMarkup(createElement(Wordmark))).toContain('Touch<span class="wordmark-line">Line</span>')
  })
  it('opens the Home mark into the scene while keeping the default app tile', () => {
    const open = renderToStaticMarkup(createElement(LogoMark, { size: 64, open: true }))
    const app = renderToStaticMarkup(createElement(LogoMark, { size: 64 }))
    expect(open).toContain('fill="currentColor"')
    expect(open).not.toContain('stroke-width="2"')
    expect(app).toContain('stroke-width="2"')
    expect(open).toContain('M18 12H34')
  })

  it('opts only Home into nine bouncing letters without repeating its accessible name', () => {
    const home = renderToStaticMarkup(createElement(Lockup, { animate: 'letters', open: true }))
    const header = renderToStaticMarkup(createElement(Lockup, { animate: 'hover' }))
    expect(home.replace(/<[^>]*>/g, '')).toBe('TouchLine')
    expect(home.match(/class="tl-letter"/g)).toHaveLength(9)
    expect(home.match(/aria-label="TouchLine"/g)).toHaveLength(1)
    expect(home).toContain('animation-delay:720ms')
    expect(header).not.toContain('class="tl-letter"')
  })
})
