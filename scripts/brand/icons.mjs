// Build the favicon and the app icons from the mark in src/ui/brand.ts.
//
//   node scripts/brand/icons.mjs
//
// Writes public/favicon.svg (the tiny tier: browsers draw it at 16 px) and
// rasterises public/icons/icon-192.png, icon-512.png, icon-maskable-512.png and
// apple-touch-icon.png (the full tier) with Playwright (an SVG in a page,
// screenshotted at the exact size). Needs Node 22.18+ (it imports brand.ts
// directly) and Playwright with Chromium; set PLAYWRIGHT_MODULE to its entry
// file if it is not installed in this project.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { markSvg, markTier } from '../../src/ui/brand.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

writeFileSync(resolve(root, 'public/favicon.svg'), markSvg('tl', 64, { tier: markTier(16) }) + '\n')

const targets = [
  { file: 'icons/icon-192.png', px: 192, svg: markSvg('tl', 192, { tier: markTier(192) }), transparent: true },
  { file: 'icons/icon-512.png', px: 512, svg: markSvg('tl', 512, { tier: markTier(512) }), transparent: true },
  // Maskable: full bleed, the glyph inside the 80% safe circle
  { file: 'icons/icon-maskable-512.png', px: 512, svg: markSvg('tl', 512, { tier: 'full', tile: 'square', scale: 0.78 }), transparent: false },
  // iOS rounds the corners itself and wants no transparency
  { file: 'icons/apple-touch-icon.png', px: 180, svg: markSvg('tl', 180, { tier: 'full', tile: 'square', scale: 0.94 }), transparent: false },
]

const entry = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
const { chromium } = await import(entry)
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const t of targets) {
  await page.setViewportSize({ width: t.px, height: t.px })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${t.svg}</body></html>`)
  const out = resolve(root, 'public', t.file)
  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out, omitBackground: t.transparent, clip: { x: 0, y: 0, width: t.px, height: t.px } })
  console.log('wrote', t.file)
}
await browser.close()
console.log('wrote favicon.svg')
