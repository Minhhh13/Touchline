# Performance on phones

What a mid-range phone pays for TouchLine, measured before the iOS App Store release, what the perf pass of
2026-10-26 (`perf-pass`, from `claude/touchline-preview` 32ace40) changed, what round 2 (`perf-r2`, from 9aaa6c0, the
same evening) changed, and what to look at next. Every number is from the production build.

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

## Round 2 (`perf-r2`)

Measured as above (iPhone 13 viewport, 4x CPU, the live match at 6x where noted), before (9aaa6c0) and after
interleaved, median of three. The machine was quieter than in round 1 (load average 2 to 8), so the "before" column
is faster than round 1's "after" for the same code. "Max task" is the longest task on the main thread from the tap
until the screen is up (and its save written); "worst frame" the longest gap between two frames in that time.

| Phone, 4x CPU | Before | After |
| --- | --- | --- |
| Season: Kick off (Watch) to the live pitch: max task, worst frame, all long tasks | 611 ms, 589 ms, 941 ms | 388 ms, 407 ms, 727 ms |
| Season: Play matchweek (Watch) | 395 ms, 400 ms, 720 ms | 172 ms, 186 ms, 272 ms |
| Season: Play matchweek (Sim result) | 275 to 344 ms, 294 to 352 ms, 520 to 532 ms | 160 to 175 ms, 165 to 180 ms, 272 to 278 ms |
| Dynasty: Kick off, Play matchweek (Watch), (Sim result) max task | 575, 291, 320 to 371 ms | 354, 194, 162 to 167 ms |
| The save after a matchweek (its own task, a quarter second later) | 230 to 340 ms (1.1 s seen under load) | none: compressed in a worker |
| Quick season kick-off to the playback: max task, worst frame, to the playback | 920 ms, 930 ms, 1.11 s | 92 ms, 110 ms, 0.48 s |
| Cold start, Fast 3G (no service worker): loading screen, Home rendered, "TTI" | 3.38 s, 7.48 s, 7.54 s | 4.41 s, 6.60 s, 6.67 s |
| Live match at 1x, 6x CPU: main thread per second, fps (p95 frame) | 936 to 953 ms, 50 fps (31 to 33 ms) | 889 to 893 ms, 52 fps (30 to 31 ms); capped within seconds |
| Entry chunk with its static imports (gzip) | 290 KB | 292 KB (+ `saveWorker` 5 KB and `quickWorker` 82 KB raw, both lazy) |
| Edge verifier | `verifier-37d256f009b3b3e9.js` | unchanged by these six changes (measured on engine 4; merged onto engine 5 the e5 bundle stays `verifier-603b905d0570f641.js`) |

What changed:

1. **The save compresses in a worker** (`src/game/saveWorker.ts`, lz-string only, started by `saveEncoder.ts` on the
   first write). `compressToUTF16` was the whole of the "save write": 0.4 to 1.1 s of one task a quarter second
   after every matchweek on the phone (the profile: 708 of 762 ms). The page now only stringifies (about 40 ms) and
   stores the bytes the worker returns, which are the bytes `encodeSave` gives. One write is in flight at a time and a
   newer one waits for it; `flush` (page hidden or closed) still writes synchronously and drops the worker's late
   bytes; a worker that fails, errors or takes 8 s hands the write back to the page. Where there is no Worker (the
   tests) nothing changed. `persistedState` returns the same object while nothing persisted changed, and the storage
   skips a state it was just given, so a toast or a view change no longer rewrites the whole save.
2. **Play matchweek in three parts** (`playWeekSoon` in the store, the Dugout's button and Space): the busy button
   painted first, the matchweek played with the same `produce` as `playWeek`, a task for the page, then the game and
   the view set in one update (one render of the match screen instead of two). `playWeekSoon.test.ts` plays seeded
   Season and Dynasty seasons through the store with Watch, Auto-play and Sim result and finds every week's game,
   events included, equal to `playWeek`'s. What is left in the tap is the match screen's first render (about 370 ms
   on the first match of a session, 170 after).
3. **The quick season's kick-off plays in a worker** (`src/game/quickWorker.ts`): the tactics step warms it (it loads
   the packs itself, as the store does), and `kickOffSoon` sends it a structured copy of the game; it runs the same
   `kickOff` (`quickJob.ts`) and the store sets the frozen result. It runs a job only on a universe whose mark (the
   data stamp, the leagues, the counts, a rating checksum) is the page's, and anything else (no Worker, an error, a
   different universe, 20 s, a game that moved) plays the season on the page as before. `quickWorker.test.ts`: 50
   seeded kick-offs, with and without January and a bench, byte for byte the page's on two separately built
   universes. The worker bundle has no store and no React. The worker's copy of the packs costs memory (about 10 MB
   on the phone while the tactics step is up); it is let go when the kick-off ends or the screen closes.
4. **The service worker precaches every built asset** (the stamp plugin replaces `'__ASSETS__'` in `sw.js` with the
   `./assets/` list; `addAll([...SHELL, ...ASSETS])`), so offline no longer depends on the idle prefetch having
   reached every chunk (the workers and the online chunks were never prefetched). So the install never competes with
   the first load, `main.tsx` registers the worker once the screen prefetch is done (`whenScreensFetched`), 30 s at
   most. Checked offline at 1280 and 390 with a real worker: 68 of 68 assets cached, Quick Draft to the playback and
   a Season live match offline, no page error. (Flags not yet seen stay uncached, as before.)
   A cached asset is matched by its name alone (`ignoreVary`): the precache's requests carry no `Origin` header and a
   module import does, so on a host that answers `Vary: Origin` (vite preview; the live site sends only
   `Vary: Accept-Encoding`) every chunk missed offline until this was added on the engine 5 merge.
5. **The data starts with the JavaScript on a first visit**: `index.html` preloads `data/leagues.json`, England's
   `meta.json` and (low priority) `players.json`, with `crossorigin`, which matches `fetch`'s default mode and
   credentials in `packs.ts` and `universe.ts` (one request per pack, checked). Only on a page no service worker
   controls: Chromium never matches a preload on a controlled page ("cross-world service worker resource mismatch"),
   which requested every pack twice and refreshed each twice in the background. On the preview's HTTP/1.1 the script
   now shares the line with the data, so the loading screen comes about 1 s later and Home 0.9 s sooner; a host that
   honours priorities (HTTP/2) should send the low-priority pack after the script, and in the iOS app the files are
   local.
6. **The live pitch caps itself at 30 fps** while a device keeps missing 60 (`src/ui/match/frameCap.ts`: over half of
   the frames after a drawn one over 22 ms, after 20 frames; lifted once nine in ten drawn frames are again followed
   by a 60 fps frame). A skipped frame returns before touching anything, so every drawn frame shows exactly what it
   would have. The stage carries `data-capped`. Modest on the emulator (about 5 % less main thread): the paint of the
   rest of the page continues.
7. **Not done: the managers data out of the first download.** `src/engine/managers.ts` reads `data/managers.json`
   with a static import and `src/game/logic/managers.ts` calls it synchronously at kick-off; both are in the edge
   verifier's bundle, and a lazy load would need an async step in one of them (or a build-time swap that an early
   call could read empty, which would move seeds). Left for an engine release.

No seeded outcome moved: the pins, `noMove`, `dailyPin` and `marketPin` tests pass untouched (ENGINE_VERSION was `'4'`
when this was measured; merged onto engine 5 at ec520f3, `quickWorker.test.ts` still finds the worker's 50 seasons
byte for byte the page's).

## Next

In order of what a phone would gain:

1. **Home's first render** is the start's longest task (about 375 ms at 4x: React's render and commit of Home, and a
   forced layout for `--topbar-h` in App.tsx that costs about 100 ms of style and layout in the first frame).
   England's `buildLeague` is only 100 to 120 ms of the start now that the classic pack is lazy (round 1's 500 ms
   counted it); a column-index build was tried in round 2 and measures the same on the phone. It did not ship: it
   renames the edge verifier, so it is parked on the branch `perf-r2-with-buildleague` for a future engine bump, when
   the function is redeployed anyway.
2. **The match screen's first render** (about 370 ms at 4x on a session's first match, 170 after): `MatchDashboard`'s
   memos (`samplePlayers`, the feed, the commentary) run in the render that opens it; they could start a frame
   later, or the dashboard could mount its panels over two frames.
3. **Close the January window and bench changes in the worker**: `closeJanuary` and `makeQuickChange` replay the
   whole quick season on the page (about the kick-off's 0.9 s); `quickJob.ts` can take them as further ops.
4. **Sim 5 and Sim to end** run their weeks in one produce (0.6 + 0.3 s at 4x); `playWeekSoon`'s pattern (a week a
   task, the same produce per week) would keep the page answering.
5. **The in-memory game**: compact finished results in memory as the save does (invariant 5 already limits what
   may read them), about 0.7 MB a matchweek. Test: seeded seasons with and without it give identical games.
6. **`src/engine/data/managers.json`** (60 KB, 20 KB gzip) is in the entry chunk (round 2, item 7).
7. **The global stylesheet** (222 KB) costs a 230 ms style recalculation on Home's first frame; screen-only rules
   could move into the screens' chunks.
8. **Flags for offline**: the drawn flags are cached only once seen; the precache list could take the ones the packs
   name.
