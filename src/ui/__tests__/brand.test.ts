import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Lockup } from '../components/Logo'
import { LOCKUP, MARK, ballPanels, clothStops, lockupBallSvg, lockupFlagSvg, markSvgInner, markTier, pennantPath, tinyPanels, type MarkTier } from '../brand'

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

  it('rests the ball on the touchline, right of the pole, with the line running past both, in every tier', () => {
    for (const t of TIERS) {
      const { ball, line, pole } = MARK.tiers[t]
      expect(ball.cy + ball.r).toBeCloseTo(line.y - line.w / 2, 6)
      expect(ball.cx - ball.r - (pole.x + pole.w / 2)).toBeGreaterThanOrEqual(6)
      expect(pole.x - pole.w / 2 - line.x1).toBeGreaterThanOrEqual(5)
      expect(line.x2 - (ball.cx + ball.r)).toBeGreaterThanOrEqual(4)
    }
  })

  it('stands the pole on the line: its foot, cap and all, ends at the line\'s top edge and nothing pokes below', () => {
    for (const t of TIERS) {
      const { line, pole, caps } = MARK.tiers[t]
      const foot = pole.y2 + (caps === 'round' ? pole.w / 2 : 0)
      expect(foot).toBeCloseTo(line.y - line.w / 2, 6)
    }
  })

  it('draws a thin line: under half of the first logo\'s on the full and mid tiers, one device pixel at 16 px', () => {
    expect(MARK.tiers.full.line.w).toBeLessThanOrEqual(3.6 * 0.5)
    expect(MARK.tiers.mid.line.w).toBeLessThanOrEqual(4.8 * 0.5)
    expect(MARK.tiers.tiny.line.w).toBe(4)
    expect(MARK.tiers.full.caps).toBe('round')
    expect(MARK.tiers.mid.caps).toBe('round')
    // still at least a CSS pixel where each tier starts
    expect((MARK.tiers.mid.line.w * MARK.tierFrom.mid) / MARK.grid).toBeGreaterThan(0.8)
    expect((MARK.tiers.full.line.w * MARK.tierFrom.full) / MARK.grid).toBeGreaterThanOrEqual(1.6)
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
        for (const ref of svg.matchAll(/(?:url\(|href=")#([^)"]+)/g)) expect(ids).toContain(ref[1])
      }
    }
    for (const svg of [lockupFlagSvg('bb2'), lockupFlagSvg('bb2', true), lockupBallSvg('bb2', 'full'), lockupBallSvg('bb2', 'mid')]) {
      const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
      for (const id of ids) expect(id.startsWith('bb2-')).toBe(true)
      for (const ref of svg.matchAll(/(?:url\(|href=")#([^)"]+)/g)) expect(ids).toContain(ref[1])
    }
  })
})

describe('the lockup', () => {
  it('stands the flag and the ball on a short line, the ball clear of the pole and the pennant, left of the name', () => {
    const { ball, pole, pennant, name, rule, roll } = LOCKUP
    // the pole's round foot ends at the line's top edge
    expect(pole.y2 + pole.w / 2).toBeCloseTo(rule.y, 6)
    expect(ball.cx - ball.r - (pole.x + pole.w / 2)).toBeGreaterThanOrEqual(5)
    const cy = rule.y - ball.r
    for (const [x, y] of points(pennantPath(pennant))) expect(Math.hypot(x - ball.cx, y - cy)).toBeGreaterThan(ball.r + 2.5)
    // the line runs a little past the ball and stops well short of the name
    const end = rule.left + rule.length
    expect(end - (ball.cx + ball.r)).toBeGreaterThanOrEqual(2)
    expect(end - (ball.cx + ball.r)).toBeLessThanOrEqual(6)
    expect(name.left - end).toBeGreaterThanOrEqual(3)
    // the name stands on the same ground as the ball
    expect(name.baseline).toBe(rule.y)
    // the roll starts with the ball clear of the pole
    expect(ball.cx - roll - ball.r).toBeGreaterThan(pole.x + pole.w / 2)
  })

  it('flutters the pennant along the cloth in a loop, its edge at the pole fixed, staying clear of the ball', () => {
    const P = LOCKUP.pennant
    const svg = lockupFlagSvg('w', true)
    const values = /attributeName="d" [^>]*values="([^"]+)"/.exec(svg)![1].split(';')
    expect(values.length).toBe(LOCKUP.wave.frames + 1)
    expect(values[0]).toBe(values[values.length - 1])
    expect(new Set(values).size).toBe(LOCKUP.wave.frames)
    const cy = LOCKUP.rule.y - LOCKUP.ball.r
    for (const d of values) {
      const pts = points(d)
      expect(pts.length).toBe(points(pennantPath(P)).length)
      expect(pts[0]).toEqual([P.x, P.top])
      expect(pts[pts.length - 1]).toEqual([P.x, P.bottom])
      for (const [x, y] of pts) expect(Math.hypot(x - LOCKUP.ball.cx, y - cy)).toBeGreaterThan(LOCKUP.ball.r + 2.5)
    }
    // the pole and the resting shape and folds are untouched; without the wave nothing animates
    expect(svg.replace(/<animate [^>]*\/>/g, '').replace(/"><\/stop>/g, '"/>')).toBe(lockupFlagSvg('w'))
    expect(lockupFlagSvg('w')).not.toContain('<animate')
    // one animation moves the shape (drawn three times through <use>), one per fold stop moves the folds with it
    const stops = clothStops(P).length
    expect(svg.match(/<animate /g)?.length).toBe(1 + stops)
    expect(svg.match(/<use /g)?.length).toBe(3)
    for (const m of svg.matchAll(/attributeName="stop-color" [^>]*values="([^"]+)"/g)) {
      const v = m[1].split(';')
      expect(v.length).toBe(LOCKUP.wave.frames + 1)
      expect(v[0]).toBe(v[v.length - 1])
    }
    const moving = [...svg.matchAll(/attributeName="stop-color" [^>]*values="([^"]+)"/g)].filter((m) => new Set(m[1].split(';')).size > 2)
    expect(moving.length).toBeGreaterThan(stops / 2)
  })

  it('folds the cloth: two or three light and dark bands from the pole to the tip, in every frame', () => {
    const lum = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).reduce((a, b, i) => a + b * [0.2126, 0.7152, 0.0722][i], 0)
    const red = lum(MARK.red)
    for (let f = 0; f < LOCKUP.wave.frames; f++) {
      const st = clothStops({ ...LOCKUP.pennant, amp: LOCKUP.wave.amp }, (f / LOCKUP.wave.frames) * 2 * Math.PI)
      // crests: runs of stops clearly lighter or darker than the plain red
      const signs = st.map(([, c]) => lum(c) - red).filter((d) => Math.abs(d) > 6).map(Math.sign)
      const runs = signs.filter((s, i) => i === 0 || s !== signs[i - 1]).length
      expect(runs).toBeGreaterThanOrEqual(3)
      expect(runs).toBeLessThanOrEqual(6)
      expect(st[0][0]).toBe(0)
      expect(st[st.length - 1][0]).toBe(1)
    }
    // fainter on the 22 to 63 px tier, so the red stays clean in the top bar and at 32 px
    const spread = (k: number) => Math.max(...clothStops(MARK.tiers.mid.pennant, 0, k).map(([, c]) => Math.abs(lum(c) - red)))
    expect(spread(MARK.cloth.strength.mid)).toBeLessThan(spread(MARK.cloth.strength.full))
    // the 16 px pennant is one flat red path: no folds, no shade
    const tiny = markSvgInner('t', { tier: 'tiny' })
    expect(tiny).toContain(`fill="${MARK.red}"`)
    expect(tiny).not.toContain('-pf')
    expect(tiny).not.toContain('<use')
  })

  it('rounds the pennant\'s tip, inside its length', () => {
    for (const P of [LOCKUP.pennant, MARK.tiers.full.pennant, MARK.tiers.mid.pennant]) {
      const pts = points(pennantPath(P))
      const xs = pts.map(([x]) => x)
      expect(Math.max(...xs)).toBeLessThanOrEqual(P.tipX + 1e-6)
      // more than one point at the far end: a curve, not a spike
      expect(pts.filter(([x]) => x > P.tipX - (P.tip ?? 0) * 0.6).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('sizes the mark to the name: cap height plus a little, the ball about the x-height, half a letter between, centred in the box', () => {
    const { name, finial, pennant, ball, rule } = LOCKUP
    const cap = 0.73 * name.size
    const xh = 0.55 * name.size
    const top = finial.cy - finial.r
    expect((name.baseline - top) / cap).toBeGreaterThan(1.05)
    expect((name.baseline - top) / cap).toBeLessThan(1.25)
    // the pennant's top level with or just above the cap tops
    expect(name.baseline - cap - pennant.top).toBeGreaterThanOrEqual(0)
    expect(name.baseline - cap - pennant.top).toBeLessThanOrEqual(3)
    expect((2 * ball.r) / xh).toBeGreaterThan(0.85)
    expect((2 * ball.r) / xh).toBeLessThan(1.1)
    // the gap after the line is 0.35 to 0.6 of a letter (Sora's o is 0.68 of the size)
    const gap = name.left - (rule.left + rule.length)
    expect(gap / (0.68 * name.size)).toBeGreaterThan(0.3)
    expect(gap / (0.68 * name.size)).toBeLessThan(0.6)
    // finial to the line's bottom is centred in the 64u box
    expect(Math.abs((top + rule.y + rule.w) / 2 - LOCKUP.grid / 2)).toBeLessThan(1)
  })

  it('carries the name once as text; the glint copy is generated content', () => {
    const html = renderToStaticMarkup(createElement(Lockup, { animate: 'load' }))
    expect(html.replace(/<[^>]*>/g, '')).toBe('TouchLine')
    expect(html).toContain('<span class="tl-touch">Touch</span>')
    expect(html).toContain('data-text="TouchLine"')
    // rendered without a window (as under reduced motion) the pennant is still
    expect(html).not.toContain('<animate')
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.tl-shine::before {\n  content: attr(data-text);')
  })

  it('matches the stylesheet', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
    const u = (n: number) => `calc(${n} * var(--u))`
    expect(block('.tl-lockup')).toContain(`padding: 0 0 0 ${u(LOCKUP.name.left)}`)
    expect(block('.tl-rule')).toContain(`top: ${u(LOCKUP.rule.y)}`)
    expect(block('.tl-rule')).toContain(`height: ${u(LOCKUP.rule.w)}`)
    expect(block('.tl-rule')).toContain(`left: ${u(LOCKUP.rule.left)}`)
    expect(block('.tl-rule')).toContain(`width: ${u(LOCKUP.rule.length)}`)
    expect(block('.tl-rule')).not.toContain('right:')
    expect(block('.tl-ball')).toContain(`left: ${u(LOCKUP.ball.cx - LOCKUP.ball.r)}`)
    expect(block('.tl-ball')).toContain(`top: ${u(LOCKUP.rule.y - 2 * LOCKUP.ball.r)}`)
    expect(block('.tl-name')).toContain(`margin-top: ${u(LOCKUP.name.top)}`)
    expect(block('.tl-name')).toContain(`font-size: ${u(LOCKUP.name.size)}`)
    // the line box's baseline sits 0.84 of the font size below its top (Sora)
    expect(LOCKUP.name.top + 0.84 * LOCKUP.name.size).toBeCloseTo(LOCKUP.name.baseline, 0)
    expect(css).toContain(`translateX(${u(-LOCKUP.roll)}) rotate(-${((LOCKUP.roll / LOCKUP.ball.r) * 180 / Math.PI).toFixed(1)}deg)`)
    expect(css).not.toContain('.tl-track')
    // each half of the name keeps a solid colour under its gradient, and forced colours get plain text
    expect(block('.tl-touch')).toContain('color: var(--text)')
    expect(css).toContain('@media (forced-colors: active)')
  })
})
