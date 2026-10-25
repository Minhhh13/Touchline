// Build the favicon and the app icons from the mark in src/ui/brand.ts.
//
//   node scripts/brand/icons.mjs
//
// Writes public/favicon.svg and rasterises public/icons/icon-192.png,
// icon-512.png, icon-maskable-512.png and apple-touch-icon.png with Playwright
// (an SVG in a page, screenshotted at the exact size). Needs Node 22.18+ (it
// imports brand.ts directly) and Playwright with Chromium; set
// PLAYWRIGHT_MODULE to its entry file if it is not installed in this project.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MARK } from '../../src/ui/brand.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const g = MARK.grid

/**
 * The mark as a standalone SVG.
 * tile: 'rounded' (the tile with transparent corners) or 'full' (a full-bleed square for masks and iOS).
 * scale: the glyph's scale about the centre, to keep it inside a mask's safe zone.
 */
function markSvg({ px, tile = 'rounded', scale = 1, detail = px >= MARK.detailFrom }) {
  const t = (32 * (1 - scale)).toFixed(3)
  const glyph = [
    `<path d="${MARK.lines}" fill="none" stroke="#fff" stroke-width="${MARK.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${MARK.arc}" fill="none" stroke="#fff" stroke-width="${MARK.arcWidth}" stroke-linecap="round"/>`,
    `<circle cx="${MARK.ball.cx}" cy="${MARK.ball.cy}" r="${MARK.ball.r}" fill="#fff"${detail ? ' mask="url(#ball)"' : ''}/>`,
  ].join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${g} ${g}">`,
    '<defs>',
    `<linearGradient id="tile" x1="0" y1="0" x2="${g}" y2="${g}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${MARK.gradient[0]}"/><stop offset="1" stop-color="${MARK.gradient[1]}"/></linearGradient>`,
    detail ? `<mask id="ball" maskUnits="userSpaceOnUse" x="0" y="0" width="${g}" height="${g}"><rect width="${g}" height="${g}" fill="#fff"/><path d="${MARK.pentagon}" fill="#000"/></mask>` : '',
    '</defs>',
    tile === 'full' ? `<rect width="${g}" height="${g}" fill="url(#tile)"/>` : `<rect width="${g}" height="${g}" rx="${MARK.tileRadius}" fill="url(#tile)"/>`,
    scale === 1 ? glyph : `<g transform="translate(${t} ${t}) scale(${scale})">${glyph}</g>`,
    '</svg>',
  ].join('')
}

// The favicon is shown at 16 to 32 px, so it carries no pentagon
writeFileSync(resolve(root, 'public/favicon.svg'), markSvg({ px: 64, detail: false }) + '\n')

const targets = [
  { file: 'icons/icon-192.png', px: 192, svg: markSvg({ px: 192 }), transparent: true },
  { file: 'icons/icon-512.png', px: 512, svg: markSvg({ px: 512 }), transparent: true },
  // Maskable: full bleed, the glyph inside the 80% safe circle
  { file: 'icons/icon-maskable-512.png', px: 512, svg: markSvg({ px: 512, tile: 'full', scale: 0.78 }), transparent: false },
  // iOS rounds the corners itself and wants no transparency
  { file: 'icons/apple-touch-icon.png', px: 180, svg: markSvg({ px: 180, tile: 'full', scale: 0.94 }), transparent: false },
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
