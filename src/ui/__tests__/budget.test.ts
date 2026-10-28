import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

/**
 * The phone's first download (docs/PERFORMANCE.md). The static half always runs: App.tsx imports Home and no other
 * screen, so every other screen stays out of the first chunk. The built half reads `dist/` when it is there (after
 * `npm run build`; CI runs it after the build with BUDGET_DIST=1, which makes a missing `dist/` a failure): the entry
 * chunk and everything it imports statically, and the stylesheet, against gzip budgets with some headroom over what
 * they weigh today.
 */
const root = path.resolve(__dirname, '..', '..', '..')
const dist = path.join(root, 'dist')
const need = process.env.BUDGET_DIST === '1'

/**
 * Gzip budgets in KB: the JS Home needs (282 KB when set; 310 KB until engine 7), the global stylesheet (43 KB).
 * Engine 7 (the batch 4 integration) raised the JS budget to 315: its Continental Cup group stage and two legs
 * (`src/engine/continental.ts`, `week.ts`'s midweeks, `cupMatches.ts` for the digest) and the Dynasty opener's
 * renewals and cover are game rules the store's Season loop reaches synchronously, about 6.5 KB gzip. The same
 * integration took about 3 KB of new online code out of the first download (the board readers, the chase's mapping
 * and outbox, the Run-in of the week, all loaded on demand by async actions); the entry measured 310.5 KB after it.
 * Splitting `week.ts` out of the store's static graph is the next step (docs/PERFORMANCE.md, round 2's "Next").
 * Batch 5 (the round 8 branches together) raised them to 330 and 56: each branch stayed under 315 and 50 on its own
 * (310.8 to 314.5 KB of JS, 49.0 to 49.4 KB of CSS), but together the store's new season and office rules, Home's
 * reasons to come back and first-run marker, the trophy unlocks and the round's global styles (the front, the phone
 * dock, the season screens) measured 323.0 KB and 53.0 KB. Taking them back under the old budgets is the same split.
 */
const BUDGET_KB = { entryJs: 330, css: 56 }

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length / 1024

describe('the first download stays small', () => {
  it('imports only Home among the screens up front; the rest are lazy chunks', () => {
    const app = readFileSync(path.join(root, 'src/ui/App.tsx'), 'utf8')
    const staticScreens = [...app.matchAll(/^import [^\n]* from '\.\/(screens|online)\/(\w+)'/gm)].map((m) => `${m[1]}/${m[2]}`)
    expect(staticScreens).toEqual(['screens/Home'])
    for (const s of ['Setup', 'Draft', 'Dugout', 'MatchScreen', 'Explore', 'ProfileScreen', 'H2H', 'Arena', 'Summary']) expect(app).toContain(`import('./screens/${s}')`)
  })

  it.runIf(need || existsSync(path.join(dist, 'index.html')))('keeps the entry chunk and the stylesheet under budget (needs a fresh `npm run build`)', () => {
    const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
    const entry = html.match(/<script type="module"[^>]*src="[^"]*?(assets\/[^"]+\.js)"/)?.[1]
    const css = html.match(/<link rel="stylesheet"[^>]*href="[^"]*?(assets\/[^"]+\.css)"/)?.[1]
    expect(entry).toBeTruthy()
    expect(css).toBeTruthy()
    // The entry and every chunk it imports statically (a shared chunk), never the ones it imports with import()
    const seen = new Set<string>()
    const walk = (rel: string) => {
      if (seen.has(rel)) return
      seen.add(rel)
      const code = readFileSync(path.join(dist, rel), 'utf8')
      for (const m of code.matchAll(/(?:^|[;}\s])(?:import\s*(?:[\w${},\s*]+from\s*)?|export\s*[\w${},\s*]*from\s*)["']\.\/([\w.-]+\.js)["']/g)) walk(`assets/${m[1]}`)
    }
    walk(entry!)
    const js = [...seen].reduce((sum, rel) => sum + gz(path.join(dist, rel)), 0)
    expect(js, `entry JS ${js.toFixed(0)} KB gzip over ${[...seen].length} chunk(s)`).toBeLessThan(BUDGET_KB.entryJs)
    expect(gz(path.join(dist, css!)), 'global stylesheet KB gzip').toBeLessThan(BUDGET_KB.css)
  })
})
