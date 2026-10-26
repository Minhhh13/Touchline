# Performance on phones

What a mid-range phone pays for TouchLine, measured before the iOS App Store release, what the perf pass of
2026-10-26 (`perf-pass`, from `claude/touchline-preview` 32ace40) changed, and what to look at next. Every number is
from the production build.

## How it was measured

- **The phone.** Headless Chromium (Playwright 1.63) with an iPhone 13 viewport (390 × 844, DPR 3, touch, `hover: none`),
  4x CPU throttling (`Emulation.setCPUThrottlingRate`) and DevTools' Fast 3G (562.5 ms latency, 1.44 Mbit/s down,
  675 kbit/s up, `Network.emulateNetworkConditions`). Fast 3G is applied only to the cold-load runs; the in-game
  numbers are CPU only.
- **The server.** `npm run build && npx vite preview --port 4438 --strictPort`, behind a small gzip proxy, because
  `vite preview` serves everything uncompressed while the live host compresses text. Byte counts below are what
  crossed the wire.
- **What is recorded.** Long tasks from a `PerformanceObserver` (over 50 ms), frame intervals from a
  `requestAnimationFrame` loop, main-thread time per second from CDP `Performance.getMetrics`, the JS heap from CDP
  `Runtime.getHeapUsage` after two forced collections, the trace (`Tracing.start`, devtools.timeline) for what a
  long task or a frame spends its time on, and React commits through a minimal DevTools hook.
- **"TTI"** here is Home rendered (the first `.mode-card`) followed by 3 s with no long task. After the pass the idle
  prefetch of the other screens runs in that window, so the long tasks before Home are given too.
- **Noise.** The machine ran other agents' builds and browsers (load average 10 to 20 on 4 cores) and Chromium
  rasterises in software, so absolute numbers are pessimistic and runs vary by about 20 %. Cold loads are the median
  of three runs, before and after interleaved; a real iPhone composites and rasterises on the GPU and is faster.
- The harness is not in the repository (Playwright is not a dependency, as for the smokes). To rerun: drive the
  steps below with the CDP settings above.

## Results

### The first download and Home

| Cold start to Home (phone, Fast 3G, median of 3) | Before | After |
| --- | --- | --- |
| JavaScript before Home (gzip) | 535 KB, one chunk | 281 KB entry chunk |
| Stylesheet (gzip) | 50 KB | 43 KB (+ 7.5 KB with the match screen) |
| League data before Home (gzip) | 859 KB (England 476, its classic pack 367, meta 16) | 492 KB (no classic pack) |
| Loading screen shown | 5.29 s | 3.48 s |
| First contentful paint | 6.38 s | 4.54 s |
| Home rendered | 11.72 s | 7.75 s |
| Long tasks before Home (total) | 1.76 s | 1.04 s |
| "TTI" (Home + 3 s quiet) | 12.68 s | 11.28 s (the idle prefetch runs in it) |
| JS heap at Home | 13.9 MB | 10.2 MB |
| Home at rest: main thread per second, fps (4x CPU) | 935 ms, 32 fps | 134 ms, 60 fps |

### Time to the first spin (Quick Draft)

| Phone, 4x CPU, Fast 3G | Before | After |
| --- | --- | --- |
| Tap Quick Draft to Start Draft enabled | 0.83 s | 0.80 to 1.83 s (median 1.18) |
| Start Draft to Spin enabled | 0.49 s | 0.50 s |
| Spin to the reel landed (7.2 s by design) | 8.30 s | 8.28 s |
| The reel: fps, p95 frame, worst frame | 48 fps, 29 ms, 752 ms | 53 fps, 24 ms, 625 ms |
| Launch to the first reel landed | about 21.3 s | about 17.7 s |

### Bundle sizes (`dist/assets`, gzip)

| | Before | After |
| --- | --- | --- |
| Entry chunk | 1,679 KB (532 KB) | 846 KB (281 KB) |
| Lazy screen chunks | none | 68 files; the largest: Dugout 132 KB (40), MatchScreen 129 KB (42), LivePitch 69 KB (26), Summary 52 KB (16), H2H 42 KB (12), Draft 38 KB (13), Setup 32 KB (11), KickOff 28 KB (9) |
| Online build (Render's) | entry plus the lazy Supabase runtime (236 KB, 63) | entry 859 KB (285), runtime unchanged and still lazy, the account chip and panel lazy too |
| Edge verifier | `verifier-37d256f009b3b3e9.js` | unchanged |

### League packs

| Pack | On the wire (gzip) | JSON.parse, phone 4x | `buildLeague`, desktop Node |
| --- | --- | --- | --- |
| England `players.json` (11,166 rows) | 464 KB | 23 ms | about 110 ms |
| England `players-classic.json` (only when asked for now) | 357 KB | 24 ms | built with England's standard seasons |
| England `meta.json` | 15 KB | 2 ms | |
| France | 409 KB | 52 ms | about 210 ms |
| Germany | 395 KB | 13 ms | about 100 ms |
| Italy | 428 KB | 24 ms | about 140 ms |
| Netherlands | 346 KB | 22 ms | about 30 ms |
| Portugal | 342 KB | 28 ms | about 30 ms |
| Spain | 433 KB | 23 ms | about 50 ms |

Parsing is cheap; building is not: England's `buildLeague` was most of the 780 ms task before Home on the phone
(the trace: 280 ms in `response.json()` and its GC, 500 ms in the build).

### Memory

| JS heap (desktop viewport, no throttle) | Before | After |
| --- | --- | --- |
| Dynasty: Home, after seasons 1, 2, 3 | 13.8, 19.3, 46.3, 46.8 MB | 10.1, 16.0, 16.9, 43.7 MB |
| Season: the Dugout, after 10 matches watched live at 4x | 15.8 to 23.0 MB | 12.4 to 19.8 MB |

The Dynasty's jump (season 2 before, season 3 after: the seeds differ) is the Continental Cup loading all seven
leagues. The live matches add about 0.7 MB each, before and after: the season's full results kept in memory (the
save compacts them, the in-memory game does not). No cache grows without a bound: every engine memo is a `WeakMap`
on the universe, and the odds cache holds 24.

### Frames and long tasks in play (phone, 4x CPU)

| Moment | Before | After |
| --- | --- | --- |
| Live match at 1x: fps, p95 frame, main thread per second | 37 fps, 68 ms, 895 ms | 44 fps, 43 ms, 878 ms |
| Live match at 4x | 40 fps, 45 ms, 959 ms | 36 fps, 59 ms, 921 ms |
| Sim 5: long tasks | 1,088 + 262 ms | 635 + 325 + 238 ms (the same work); the button paints "Simulating…" first |
| Quick season kick-off | one task, 0.83 to 1.71 s by load | the same task; the button paints "Simulating…" first |
| Pre-season odds after a tactics change | 11 tasks of about 370 ms; odds after 4.7 s | no slice over 50 ms; one 160 to 180 ms task (the first step's league build); odds after 5.6 s |
| Arena, the first team-strength pass (Cup) | 0.5 to 1.2 s of long tasks, the longest 0.24 to 0.71 s | the same code, 0.6 to 0.9 s, longest 0.34 to 0.41 s |

The live match is not React (two commits in five seconds): the pitch's loop rewrites about 25 SVG transforms a
frame and the page then paints (1.1 s of Paint, 0.5 s of Commit and 0.5 s of Layerize in five seconds), with a
software rasteriser. A phone's GPU takes much of that off the main thread.

## What changed

1. **Every screen but Home is its own chunk** (`src/ui/lazyScreens.tsx`, App.tsx's `SCREENS`). Once Home is up the
   chunks are fetched one at a time, Quick Draft's path first, each within 400 ms even on a page that never goes idle,
   so they are in before the first tap and in the service worker's cache for an offline visit. A screen already
   loaded renders without a Suspense frame; one still coming shows the loading skeleton; one that cannot load shows
   a reload card. On a first visit, everything fetched before the worker took the page is fetched again through it
   (`cacheLoadedAssets`), which also caches the entry chunk, which no first visit used to. The account chip is lazy.
2. **The classic pack loads on demand** (`src/game/packs.ts`): with the Classic toggle, Explore, or a game with
   `rules.classic` (at start, on a resume, a cloud restore or a challenge link). `withClassic` adds the classic
   seasons to the standard league already built and equals one `buildLeague` with them; a universe without them
   plays every standard game identically (`classicRelease.test.ts`). The pack is fetched without parsing 8 s after
   start for the service worker, and a classic load that cannot fetch it fails visibly.
3. **The lockup's flutter and Home's neon light rest on a touch screen** after three loops (`TOUCH_WAVE_LOOPS`). Both
   repainted the page on the main thread every frame, for ever, on every screen with the top bar.
4. **The pre-season odds sample 20 ms slices** with a turn for the page between them (the same odds: any split of
   the seasons draws the same stream, tested).
5. **Kick-off and the Sim buttons paint their busy state before the work** (`src/ui/afterPaint.ts`).
6. **A budget test** (`src/ui/__tests__/budget.test.ts`): App.tsx imports Home and no other screen; after a build,
   the entry chunk with its static imports stays under 310 KB gzip and the stylesheet under 50 KB (CI runs it after
   `npm run build` with `BUDGET_DIST=1`).

No seeded outcome moved: the pins, `noMove`, `dailyPin` and `marketPin` tests pass untouched, ENGINE_VERSION is `'4'`.

## Next

In order of what a phone would gain:

1. **Build England faster** (`src/engine/universe.ts`, `buildLeague`): resolve the column indices once per file
   instead of a keyed lookup per field, and reuse one closure per file for the depth and trait readers. It is about
   500 ms of the phone's start. Test plan: deep-equal the old and new builds of all seven packs and the classic pack,
   and keep `stamps.test.ts`, the pins and `classicGate.test.ts` green.
2. **Precache every hashed asset when the service worker installs** (`public/sw.js` with the stamp plugin in
   `vite.config.ts` writing the list), so offline does not depend on the page's prefetch; and preload
   `data/leagues.json`, `data/england/players.json` and `meta.json` from `index.html` so the data starts with the
   JavaScript (one Fast 3G round trip, about 0.6 s). Proposed patches are in the pass's report.
3. **The quick season's kick-off off the main thread**: `runQuickSeason` in a worker that loads the packs itself
   from the cache (about 10 MB more), the same code and seed, the result posted back. Test: a quick season played
   in the worker equals the one in the page for 50 seeds.
4. **The live pitch at 30 fps when it cannot keep up** (its lite mode already drops the camera and pass lines), or
   its dots as composited HTML layers instead of SVG transforms.
5. **The in-memory game**: compact finished results in memory as the save does (invariant 5 already limits what
   may read them), about 0.7 MB a matchweek. Test: seeded seasons with and without it give identical games.
6. **`src/engine/data/managers.json`** (60 KB, 20 KB gzip) is in the entry chunk; it is only needed at a Quick
   Draft's kick-off.
7. **The global stylesheet** (222 KB) costs a 230 ms style recalculation on Home's first frame; screen-only rules
   could move into the screens' chunks.
