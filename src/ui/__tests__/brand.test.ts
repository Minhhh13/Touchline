import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Lockup } from '../components/Logo'
import { LOCKUP, MARK, ballPanels, lockupBallSvg, lockupFlagSvg, markSvgInner, markTier, pennantPath, tinyPanels, type MarkTier } from '../brand'

const TIERS: MarkTier[] = ['full', 'mid', 'tiny']

/** The points of an M…L…Z path. */
function points(d: string): [number, number][] {
  return d
    .replace(/[MZ]/g, '')
    .split('L')
    .map((p) => p.trim().split(/\s+/).map(Number) as [number, number])
}

describe('the mark', () => {
  it('picks its detail tier by rendered size', () => {
    expect(markTier(512)).toBe('full')
    expect(markTier(64)).toBe('full')
    expect(markTier(48)).toBe('mid')
    expect(markTier(24)).toBe('mid')
    expect(markTier(20)).toBe('tiny')
    expect(markTier(16)).toBe('tiny')
  })

  it('rests the ball on the touchline, right of the pole, in every tier', () => {
    for (const t of TIERS) {
      const { ball, line, pole } = MARK.tiers[t]
      expect(ball.cy + ball.r).toBeCloseTo(line.y - line.w / 2, 6)
      expect(ball.cx - ball.r).toBeGreaterThan(pole.x + pole.w / 2 + 8)
      // the pole crosses just below the line
      expect(pole.y2).toBeGreaterThan(line.y + line.w / 2)
    }
  })

  it('keeps the pennant clear of the ball in every tier', () => {
    for (const t of TIERS) {
      const { ball, pennant } = MARK.tiers[t]
      for (const [x, y] of points(pennantPath(pennant))) expect(Math.hypot(x - ball.cx, y - ball.cy)).toBeGreaterThan(ball.r + 2.5)
    }
  })

  it('puts every edge of the 16 px tier on a whole pixel (4 units)', () => {
    const { ball, line, pole, pennant } = MARK.tiers.tiny
    const edges = [pole.x - pole.w / 2, pole.x + pole.w / 2, pole.y1, pole.y2, line.x1, line.x2, line.y - line.w / 2, line.y + line.w / 2, ball.cx - ball.r, ball.cx + ball.r, ball.cy - ball.r, ball.cy + ball.r, pennant.top, pennant.bottom]
    for (const e of edges) expect(e % 4).toBe(0)
    expect(MARK.tiers.tiny.caps).toBe('butt')
    // the 16 px pennant is 5 px tall so its red still reads
    expect(pennant.bottom - pennant.top).toBeGreaterThanOrEqual(20)
  })

  it('draws a ball with a front pentagon and the panels round it', () => {
    const panels = ballPanels(0, 0, 1)
    expect(panels.filter((p) => p.type === 'pent').length).toBeGreaterThanOrEqual(6)
    expect(panels.filter((p) => p.type === 'hex').length).toBeGreaterThanOrEqual(10)
    // one pentagon sits in the middle of the ball, facing front
    const centred = panels.filter((p) => p.type === 'pent' && points(p.d).every(([x, y]) => Math.hypot(x, y) < 0.6))
    expect(centred.length).toBe(1)
  })

  it('draws real panels on the 16 px ball, so the favicon reads as a ball and not an eye at 32 device px, and keeps its top a clean white arc', () => {
    const svg = markSvgInner('t', { tier: 'tiny' })
    const { cx, cy, r } = MARK.tiers.tiny.ball
    const patches = tinyPanels(cx, cy, r)
    expect(patches.length).toBeGreaterThan(1)
    expect(svg.match(/<path d="M[^"]*"\/>/g)?.length).toBe(patches.length)
    // the front pentagon is one of them, and nothing reaches into the top third of the ball
    expect(patches.some((d) => points(d).every(([x, y]) => Math.hypot(x - cx, y - cy) < r * 0.6))).toBe(true)
    for (const d of patches) for (const [, y] of points(d)) expect(y).toBeGreaterThan(cy - r * 0.6)
    expect(readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8').trim()).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${markSvgInner('tl', { tier: 'tiny' })}</svg>`)
  })

  it('prefixes every id with the instance id, so two marks on a page never share a gradient', () => {
    for (const t of TIERS) {
      for (const variant of ['colour', 'mono', 'inverse'] as const) {
        const svg = markSvgInner('aa1', { tier: t, variant })
        const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
        for (const id of ids) expect(id.startsWith('aa1-')).toBe(true)
        for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1])
      }
    }
    for (const svg of [lockupFlagSvg('bb2'), lockupBallSvg('bb2', 'full'), lockupBallSvg('bb2', 'mid')]) {
      for (const m of svg.matchAll(/id="([^"]+)"/g)) expect(m[1].startsWith('bb2-')).toBe(true)
    }
  })
})

describe('the lockup', () => {
  it('rests the ball clear of the pole and clear of the pennant, left of the name', () => {
    const { ball, pole, pennant, name, rollFrom } = LOCKUP
    expect(ball.cx - ball.r - (pole.x + pole.w / 2)).toBeGreaterThanOrEqual(2)
    expect(name.left - (ball.cx + ball.r)).toBeGreaterThanOrEqual(6)
    const cy = LOCKUP.rule.y - ball.r
    for (const [x, y] of points(pennantPath(pennant))) expect(Math.hypot(x - ball.cx, y - cy)).toBeGreaterThan(ball.r + 2.5)
    // the roll starts with the ball wholly behind the pole's centre, where its track begins
    expect(rollFrom + ball.r).toBeLessThan(pole.x)
  })

  it('carries the name once as text; the glint copy is generated content', () => {
    const html = renderToStaticMarkup(createElement(Lockup, { animate: 'load' }))
    expect(html.replace(/<[^>]*>/g, '')).toBe('TouchLine')
    expect(html).toContain('data-text="TouchLine"')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.tl-shine::before {\n  content: attr(data-text);')
  })

  it('matches the stylesheet', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
    const u = (n: number) => `calc(${n} * var(--u))`
    expect(block('.tl-lockup')).toContain(`${u(LOCKUP.name.endPad)} 0 ${u(LOCKUP.name.left)}`)
    expect(block('.tl-rule')).toContain(`top: ${u(LOCKUP.rule.y)}`)
    expect(block('.tl-rule')).toContain(`height: ${u(LOCKUP.rule.w)}`)
    expect(block('.tl-rule')).toContain(`left: ${u(LOCKUP.rule.left)}`)
    expect(block('.tl-track')).toContain(`left: ${u(LOCKUP.pole.x)}`)
    // track left + ball left = the ball's resting left edge; track top + ball top = its top on the line
    const trackTop = Number(/top: calc\(([\d.]+)/.exec(block('.tl-track'))![1])
    const ballLeft = Number(/left: calc\(([\d.]+)/.exec(block('.tl-ball'))![1])
    const ballTop = Number(/top: calc\(([\d.]+)/.exec(block('.tl-ball'))![1])
    expect(LOCKUP.pole.x + ballLeft).toBeCloseTo(LOCKUP.ball.cx - LOCKUP.ball.r, 6)
    expect(trackTop + ballTop).toBeCloseTo(LOCKUP.rule.y - 2 * LOCKUP.ball.r, 6)
    expect(block('.tl-name')).toContain(`margin-top: ${u(LOCKUP.name.top)}`)
    expect(block('.tl-name')).toContain(`font-size: ${u(LOCKUP.name.size)}`)
    expect(css).toContain(`translateX(${u(LOCKUP.rollFrom - LOCKUP.ball.cx)})`)
  })
})
