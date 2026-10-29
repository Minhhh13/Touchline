# Performance on phones

What a mid-range phone pays for TouchLine, measured before the iOS App Store release, what the perf pass of
2026-10-26 (`perf-pass`, from `claude/touchline-preview` 32ace40) changed, what round 2 (`perf-r2`, from 9aaa6c0, the
same evening) changed, round 6's UI work, round 3 (`r7-perf`, 2026-10-27, on engine 6), round 9's first download
(`r9-firstload`, 2026-10-29, on engine 7), round 4 (`r9-perf`, 2026-10-29, on engine 7), round 10 (`r10-perf`), round 11
(`r13-perf`, 2026-10-29, on engine 7) and what to look at next.
Every number is from the production build.

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
   `npm run build` with `BUDGET_DIST=1`). Engine 7 raised the JS budget to 315 KB (the batch 4 integration,
   2026-10-27): the Continental Cup's group stage and two legs and the Dynasty opener are Season-loop rules the store
   reaches synchronously (about 6.5 KB gzip); the integration moved about 3 KB of new online code to on-demand imports
   (`api.ts`'s board readers and chase actions, the store's `startRunInWeek`), and the entry measured 310.5 KB.
   Batch 5 (the round 8 branches, 2026-10-28) raised the budgets to 330 KB and 56 KB: each branch stayed under 315 and
   50 on its own, together they measured 323.0 KB of JS and 53.0 KB of CSS; splitting `week.ts` and the round's styles
   out of the first download would take them back under the old figures. Round 9 did (below): 241.0 KB and 47.0 KB,
   budgets 255 and 50.

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

## Round 6 (`r6-ui`)

Measured as above (iPhone 13 viewport, 4x CPU, network unthrottled; `vite preview` of the build before, `release-combined`
7b2ca17, and after, interleaved), five runs each for Kick off, two for the arena. The machine was quiet (load average under 3). "Longest task" is the
longest task from the tap to the screen being up.

| Phone, 4x CPU | Before | After |
| --- | --- | --- |
| Season: Kick off (Watch) to the live pitch, the tasks | 222 to 275 ms (the week), then 406 to 520 ms (the match screen's render) | 226 to 326 ms (the week), 50 to 77 ms each for the feed and ball path and the two sample slices, 306 to 425 ms (the render) |
| Season: Kick off, longest task (median of five) | 406 to 520 ms (476) | 306 to 425 ms (319) |
| Arena Final, drafted fast (Auto-complete, then On to the final at once): longest task, to the hub | 2,180 to 2,292 ms, 2.7 to 2.8 s | 251 to 252 ms, 2.4 to 2.9 s (the busy button painted, the rest in 12 ms slices) |
| The same after four seconds on the arena's setup | 1,969 ms, 2.4 s | 224 to 298 ms, 0.75 to 0.8 s |
| Phone market in January (38 listings): the page | 19,288 px | 5,920 px (eight listed, Show all) |

What changed:

1. **The match day's first build before its render** (`src/ui/match/prepare.ts`): the Dugout hands `playWeekSoon` a
   `prepare` step that builds the live segment's feed and ball path (`matchPath`) in one task and the sampled positions
   (`samplePlayersIn`, 25 minutes a task) in the next, between playing the week and setting it; the dashboard's memos
   read the same caches (WeakMaps on the store's frozen match objects). The CPU profile of the render before: the
   memos 267 ms (`samplePlayers` 101, `matchPath` 88), the rest React's mount and the first layout (the phone layout's
   `measure` forcing it, about 85 to 100 ms). `prepare.test.ts`: the same values, and the same weeks as `playWeek`.
2. **The arena's field warmed on its setup** (`arenaSetupPool`, `useArenaWarmup`) and a cold remainder worked out in
   12 ms slices behind the Draft's busy finish button (`useFinishDraft`), so `beginArena` reads the memoised strengths.
3. **The save write** was already off the page (`perf-r2`'s worker): after Kick off a 50 to 70 ms task stringifies it.

Left: the week's own task (`produce` over `playMatchweekAs`: the AI fixtures' `simulateMatch` about 110 ms of it) and
the match screen's mount; both in BACKLOG's Next. No seeded outcome moved; ENGINE_VERSION `'6'`, the edge bundles
`verifier-0fee2b6b3c0bbd80.js`, `verifier-603b905d0570f641.js` and `verifier-37d256f009b3b3e9.js` unchanged.

## Round 3 (`r7-perf`)

The third phone round, on `release-e6` (engine 6, 4899025). Measured as above (iPhone 13 viewport, DPR 3, touch, 4x CPU,
network unthrottled), `vite preview` of the build before (`release-e6`) and after, interleaved, two to six runs each.
The machine was quiet (load average 1 to 3). Saves made by the store (a Season and a Dynasty at pre-season, Everton
2023-24, England) were loaded into the page, which waits 9 s after load before the 4x throttle so the lockup's
flutter and the screen prefetch are done. "Longest task" is from the tap until the screen is up and 1.5 s after.

| Phone, 4x CPU | Before | After |
| --- | --- | --- |
| Season: Play matchweek (Sim result), longest task, weeks 2 to 6 | 148 to 429 ms | 93 to 194 ms |
| Season: Kick off (Watch) to the live pitch, longest task | 309 to 414 ms (the week 206 to 362, the render 300 to 414) | 135 to 251 ms (week slices under 100, the render 123 to 251) |
| Live match at 1x: main thread a second (fps) | 571 to 618 ms (59 to 60 fps) | 467 to 493 ms (59 to 60 fps) |
| Sim 5 / Sim to the next big match / Sim to end, longest task | 987 / 2,906 / 3,699 ms | 155 / 160 / 229 ms |
| Dynasty: the same three (the run to the next big match is shorter here) | 1,019 / 1,280 / 4,804 ms | 155 to 223 / 160 to 177 / 229 to 583 ms |
| Dynasty: on to next season (a new league built) | 702 ms | 598 to 742 ms (left, below) |
| Quick Draft: Auto-complete | 2,037 to 2,816 ms | 296 to 457 ms |
| Quick Draft: close the January window (stick) | 1,657 ms | 84 to 105 ms |
| Quick Draft: the summary | 349 ms | 286 to 337 ms |
| Arena (Cup, Gauntlet): Auto-complete / the first tie simmed | 1,963 to 2,535 / 667 to 850 ms | 375 to 503 / 95 to 226 ms |
| Desktop 1280x720: page overflow on every screen of these flows | 0 | 0 |
| Edge verifier | `verifier-d0ebd30afcbcd00b.js` (engine 6) | unchanged (no bundled file touched) |

What changed:

1. **The matchweek in slices.** `playMatchweek` and `playMatchweekAs` (`week.ts`, `assistant.ts`, neither in the
   edge bundle) are stepped generators: a pause after the week's set-up (an event answered, the XI picked), after every
   fixture and after every stop the assistant answers in a Sim result. `runSteps` runs them whole, so `playWeek` and
   every other caller are unchanged. The store's `playWeekSoon` runs the same steps on an Immer draft held across tasks
   (`createDraft` ... `finishDraft`, the shared `sliced` runner) and gives the page a task whenever a slice passes 16 ms
   (`WEEK_SLICE_MS`); a game that moves meanwhile lets the draft go and plays as before. Nothing runs between two steps
   but the wait, so the draws and the game are `playWeek`'s: `playWeekSoon.test.ts` plays 12 seeded seasons a step a
   task. The profile showed why the week was 226 to 326 ms: the plain week is about 15 ms on a desktop, through Immer's
   proxies about 40. The bookkeeping after the user's match (`afterLeagueMatch`: the AI cup ties, `afterMatchweek`) is
   still one step inside the last stop of a Sim result (about 30 ms on a desktop in a cup week): splitting it would
   mean a stepped `advanceLiveMatch` chain; nothing in `src/engine` had to change.
2. **Sim 5, Sim to end, Sim to the next big match** use the same runner (`simWeeksSoon`, `simToNextBigMatchSoon`,
   over `simWeeksSteps` and `simToNextStopSteps`), and at each week's end the runner finishes that week's draft and
   starts a fresh one (`GameBox`, `WEEK_END`), so a whole season is never frozen in one task (it was 270 ms at 4x).
   Tested equal to the plain actions, digest and stop included, over 8 seeds.
3. **Auto-complete off the proxies.** The engine's `autoDraft` scans the pool thousands of times; on the Immer draft
   most of its 2 s at 4x was the proxies (`get`, `isDraftable`). The store now runs it on a plain copy of the draft
   (`plainCopy`: `structuredClone(current(...))`) and puts the copy back. The same functions on the same data:
   `autoDraftPlain.test.ts`, 48 drafts in four rule sets, byte for byte.
4. **The January window in the worker.** `closeJanuary` and `closeJanuarySpin` replay the whole quick season (round 2's
   Next, item 3); the panel now sends them to the quick-season worker as jobs (`quickJob.ts`), as the kick-off is, and
   the page plays them where the worker cannot. `quickWorker.test.ts` checks both closes byte for byte.
5. **The live pitch.** A trace of the live match (5 s at 1x) put the main thread's time in the paint pipeline, not the
   script: Paint about 200 ms a second and Layerize 120, against about 120 for the loop. Experiments by elimination:
   with the pitch hidden the page drops to about 350 ms a second; CSS transforms instead of `transform` attributes and
   a canvas for the moving parts measured no better on this rasteriser (the canvas's commit cost 500 ms a second). What
   did: the squad strip alone was re-recorded with the pitch every frame (90 ms a second of Paint); every box beside the
   pitch is now a stacking context (`isolation: isolate` in `matchday.css`) and keeps its cached paint, and the loop
   keeps its own record of the attributes it wrote rather than reading each back. Paint fell from about 200 to 90 ms a
   second. What is drawn is the same, and `frameCap.ts` is untouched. On a desktop (1280x720) the per-frame Layout of
   the pitch (about 200 ms a second at 4x, every SVG child laid out again) is left: a fixed-size SVG halves it but adds
   Layerize, measured about even.
6. **The lockup's flutter** on a touch screen: its three loops were counted per mount, and the top bar's lockup mounts
   again whenever the bar comes back (every match day), repainting the whole page every frame for 7.8 s each time; now
   once per page load (`touchWaveOn`).
7. **The match screen's mount (about 300 ms).** Its profile: React's render about 150 ms, a forced layout of the new
   board inside the commit (CompactLayout's sticky offset, then the tab strip's scroll, about 100 to 130 ms each time
   the first was moved), the sound bank filled on the first tap (60 ms). Now the phone board mounts in two frames (the
   pulse row, the tabs and the strip after the first paint), the measurements wait for the paint (the layout is then
   the frame's own), the noise buffers fill when first read, and a dialog takes the focus after its first paint (the
   digest's focus forced 160 ms of layout).
8. **The rest of the flows** (every task over 200 ms in the Quick Draft, Season, Dynasty and arena flows): Setup's
   nation scan after the first paint, the Draft's odds panel through `useDeferredValue`, the title fanfare's score after
   the summary paints, the summary's game list no longer forcing its first layout, and the arena's Manage live and Sim
   the match paint-first with the replay prepared before its render (`playArenaStepSoon`, `prepareMatchScreen`).

Left, each over 200 ms at 4x: a Dynasty summer's new league built in one task (`buildLeague`, 600 to 740 ms here;
France is the slowest pack to build, table above; the column-index build is parked on `perf-r2-with-buildleague` for an engine release, since `buildLeague` is in
the edge bundle); Auto-complete's own loop (180 ms, the engine's `autoDraft` in one call) and the Draft's render after
it; the first render of the quick summary (about 290 ms) and the match report (about 230 to 290 ms). No seeded outcome
moved: the pins, `noMove`, `dailyPin` and `marketPin` pass untouched, ENGINE_VERSION is `'6'`.

## Round 9 (`r9-firstload`)

The first download after round 8, on `main` at d76e552 (engine 7, round 8 and accessibility round 4). Byte counts are
the budget test's (`gzip -9` of the entry chunk and every chunk it imports statically, and of the global stylesheet);
the cold loads are the iPhone 13 viewport, 4x CPU and Fast 3G as above, behind a gzip static server, no service worker,
median of three interleaved runs; the matchweeks are a Season save at pre-season (Everton 2023-24, England, Sim result)
loaded into the page, 4x CPU from 9 s after load, two runs each, before and after interleaved. The machine was quiet
(load average under 3).

| | Before (main) | After |
| --- | --- | --- |
| Entry JS with its static imports (gzip -9) | 323.1 KB | 241.0 KB |
| Global stylesheet (gzip -9) | 53.2 KB | 47.0 KB |
| On the wire before Home (gzip 6): JS, CSS | 325.7 KB, 53.8 KB | 243.3 KB, 47.6 KB |
| Cold start, first contentful paint | 6.49 to 6.52 s (6.51) | 5.42 to 5.51 s (5.44) |
| Cold start, Home rendered | 7.05 to 7.17 s (7.06) | 6.51 to 6.55 s (6.51) |
| Long tasks before Home: total, longest | 811 to 974 ms (817), 392 to 427 ms (402) | 785 to 888 ms (816), 361 to 415 ms (388) |
| Play matchweek (Sim result), Kick off: tap to the report, longest task | 709 to 807 ms, 207 to 248 ms | 744 to 827 ms, 215 to 261 ms |
| Play matchweek (Sim result), weeks 2 to 6: longest task | 93 to 143 ms | 98 to 182 ms |
| Edge verifier | `verifier-ecc269657e48639b.js` | unchanged |

The matchweek is the same code in the same order (the store calls it through the rules chunk), so its figures are
equal within the runs' spread; the first paint comes about a second sooner because 82 KB less script is downloaded,
parsed and compiled before it on Fast 3G. Screenshots of Home, the Dugout, its Cup tab, the player card and the match
report, at 1280 and 390 in both themes, are pixel-identical before and after (one dark Dugout differed by one colour
level on 43 pixels of a panel edge, a rasteriser dither, identical on a second run).

What changed:

1. **The rules chunk** (`src/game/rules.ts`, held by `src/game/rulesHook.ts`). The store imported every game rule it
   runs once a game is under way: the season loop (`week.ts`, the assistant, the Dynasty, contracts, the board, the
   office's steps), the quick season and its worker client, the post-season cups, challenges (and through them the
   managers' data, 18 KB gzip), the Run-in, head-to-head and Season Highlights. They are re-exported by `rules.ts` and
   the store calls each by its old name through `late(name)`, so no call reads differently. Every game screen loads the
   chunk with its own (App.tsx's `withRules`; HowTo and Privacy do not need it), so its actions find it in place. Home's
   own actions need it only to settle an open quick season or seed a run-in: start, abandon and resume then load it and
   run again (`waitForRules`, tested with a fresh store in `rulesHook.test.ts`), and `openChallenge` awaits it. A save
   loads without it: `matchPlay.ts` (`assistantTakesStops`) and `h2hNeedsClassic.ts` were split out of `assistant.ts`
   and `h2hClassic.ts`, which re-export them. The tests load it in `src/testSetup.ts`, in a `beforeAll` so a file's
   `vi.mock` of an engine module is in place first.
2. **The online layer loads on use.** `api.ts` imported the account checks (`auth.ts`, which reads the verifier's
   `HIDDEN_CHARS`) and the challenge links statically, and with them the challenge codec and the engine's replay; each
   is now an `import()` in the async action that uses it. Home's ranked tag (`usePinnedDaily`) loads the Daily's ranked
   mapping and `engineRoute.ts` once a board's pin is in (the pin itself arrives after Home is up).
3. **The game screens' sheet** (`src/ui/gameScreens.css`, loaded through `gameStyles.ts` by `withRules`): the player
   card (both sections), the match report, the playback's short windows, the Cup brackets, the arena hub's calls column
   and the pre-season coach mark, in their old order. A section could move only if no later rule of styles.css matched
   the same elements with the same specificity and property (it would win a tie it lost before): each was checked with
   a script over the stylesheet, and the one such rule (the large screen's cap on the report page) moved with them.
   `budget.test.ts` checks that every selector there names a class Home and the shell never render.

The budget test now also fails on a value import of a rules module in `store.ts`, on a `late()` name the chunk does
not export, and on a game screen that does not wait for the rules. No seeded outcome moved: the pins, `noMove`,
`dailyPin`, `marketPin` and the whole suite pass untouched, and the edge bundle keeps its name.

## Round 4 (`r9-perf`)

The fourth phone round, on `main` after round 8 and accessibility round 4 (engine 7, d76e552). Measured as above
(iPhone 13 viewport, DPR 3, touch, `isMobile`, 4x CPU through `Emulation.setCPUThrottlingRate`, network unthrottled),
`vite preview` of the build before (d76e552) and after, one after the other, one or two runs each. The harness drives
the store's real flows from a cleared page (Season: Setup, Auto-complete, the Dugout's thirteen tabs, three Sim result
matchweeks with their reports, Sim 5, a Watch matchweek at 1x, Sim result, Sim to end; Quick Draft: Auto-complete, the
manager spin, the kick-off, a bench change, the January close; Explore: typing into the search), with the 4x throttle on
only from the tap until 1.5 s after the screen is up. "Longest task" is from `PerformanceObserver` long tasks in that
window; profiles came from `Profiler.start` on an unminified build. The machine was shared (other builds), so runs vary
by about 20 %; a long task under 100 ms moves by more than the changes here.

| Phone, 4x CPU, longest task | Before | After |
| --- | --- | --- |
| Explore: the first search (every league loads behind it) | 1,290 to 1,406 ms (13 to 15 long tasks, 2.2 to 2.8 s in all) | 429 to 496 ms (the league builds, below) |
| Explore: typing the next search | 66 to 352 ms | 67 to 148 ms (one run 357, while the rating list was building) |
| Quick Draft: a bench change in the playback | 734 ms (the season replayed on the page) | none over 50 ms (the worker) |
| Quick Draft: Auto-complete | 313 to 452 ms | 189 to 205 ms |
| Quick Draft: kick-off / January close (stick) | 67 to 80 / 89 to 134 ms | 69 / 86 to 95 ms (unchanged: already in the worker) |
| Season: Play matchweek (Sim result) to the report | 91 to 231 ms | 62 to 104 ms |
| Season: the report's Continue back to the Dugout | 121 to 148 ms | 133 to 177 ms (the Dugout's own style and layout, left) |
| Season: Dugout tab switches (thirteen tabs) | 0 to 171 ms (Fixtures 82 to 171, Club 111 to 165) | 0 to 143 ms (Fixtures 87, Club 143) |
| Season: Sim 5 / Sim to end | 138 to 154 / 280 to 292 ms | 194 (one run; nothing in its path changed but the tab ink) / 230 ms |
| Season: the live match's Sim result to the report | 181 to 186 ms | 160 ms |
| Live pitch at 1x: fps, p95 frame, main thread a second | 60 fps, 17 ms, 367 to 383 ms | 60 fps, 17 ms, 407 ms (the same code) |
| The Office tab | 56 to 58 ms | 63 ms |
| Edge verifier | `verifier-ecc269657e48639b.js` | unchanged (no bundled file touched) |

What changed:

1. **Explore's index never builds inside a render.** The first search loads every league; each load is a new universe,
   and the search's render then built the whole player index (and the nation counts) in one task, over a second each
   time. `exploreIndex.ts` now builds it a step at a time (`exploreIndexSteps`, a pause every 2,500 player-seasons),
   which `src/ui/useExploreIndex.ts` runs in 12 ms slices (`indexSoon`); Search, Compare and Records keep their last
   answer up and say "Loading every league…" until it is built (`useExploreIndex`, `useLast`). Each build is also
   cheaper: an entry whose player-seasons are the very same objects as in the last index is kept (the store merges the
   same objects at every load), the sorts use one `Intl.Collator` (localeCompare's order without its per-call set-up),
   `byRating` sorts rating-and-season buckets (the same order, a fraction of the id comparisons) and is stepped too
   (`ratingsSoon`), folded names are cached, the walks over `u.index` skip `Object.values`' copy, and
   `tidyUniverseNames` skips player-seasons it has already looked at. `exploreIndexReuse.test.ts`: the kept and the
   stepped indexes equal one built from nothing, the orders equal localeCompare's.
2. **The bench change in the worker** (round 3's Next, item 3). `benchChangeSoon` paints the bench panel busy, then
   sends the change to the quick-season worker as the job `quickChange`, with the staleness check (`quickSeasonStale`)
   inside the job unless the page already knows the season fresh (`quickSeasonKnownFresh`): the first change after a
   reload used to replay the season twice on the page. A stale season, an error, no Worker or a game that moved falls
   back to `benchChange`. The bench panel keeps the worker warm while a change can still be made. `quickWorkerBench.test.ts`
   (16 seeded changes and second changes, byte for byte, checked and not) and `quickBenchSoon.test.ts` (the store through
   a stand-in Worker running the real job, the stale and refused paths).
3. **Auto-complete** paints "Drafting…" first, the Draft's pick grades and recap (the Hindsight XI search, worked out
   twice and on every render before) are memoised on a deferred draft (an interruptible render after the commit, only
   ever this draft's), and `useFocusOnLanding` moves the focus after the paint (the focus forced the new layout inside
   the task).
4. **No forced layout in a commit from the tab ink or the font wait.** The tab strip's ink measured the selected tab in a
   layout effect, so the Dugout, the match report and every tab switch laid out the new screen inside the commit (70 to
   100 ms at 4x); the ResizeObserver's first report, after the frame's layout, measures it now. Every `Pitch` mount read
   `document.fonts.ready`, which forces the page's style (126 ms at the season's end); `whenFontsReady` reads it once
   a page.
5. **The last 32 bare `useStore()` calls** (the match day's dashboard and stop panel, the Office tab, the January window,
   contract talks, the end case, the cup runs, the badge nudges, the World boards, the rooms) read the store through
   `useStorePick`, so a toast or a busy flag no longer re-renders them.

Measured and left:

- **Explore's first search, 430 to 500 ms:** the league packs' `buildLeague` (France's is the slowest) and
  `mergeUniverses`, both in the edge bundle; the column-index build on `perf-r2-with-buildleague` is for an engine
  release.
- **The Dugout's mount and its heavy tabs (Club, Fixtures), 110 to 180 ms:** the browser's own style, layout and paint
  of a large screen ("(program)" in the profile, the script under 20 ms); `content-visibility` on the boxes out of view
  or a smaller first mount would be the next step.
- **Sim 5 and Sim to end in total** (about 5 s for a season at 4x, never more than 230 ms in one task): about 30 % of the
  CPU is Immer's proxies (`get`, `isDraftable`, the array traps) over the week's draft. A plain copy, as Auto-complete
  uses, would mean copying a game that holds every result of the season each week (round 3's Next, item 5, the
  in-memory compaction, would make that cheap).
- **A dialog's focus going back to its opener** forces layout on close (about 70 ms after the Sim to end question); it
  stays synchronous, so the focus never lands anywhere else first.

No seeded outcome moved: the pins, `noMove`, `dailyPin` and `marketPin` pass untouched, ENGINE_VERSION is `'7'`.
## Round 10 (`r10-perf`)

Two items round 9 left: Explore's search per keystroke, and whether splitting `setup.ts` would shrink the first
download. Measured on `main` at 869c434 (before) and this branch (after), both `vite preview` builds, Playwright's
Chromium at 390x844 (DPR 3, touch), 4x CPU throttle, network unthrottled, every league loaded first (the first search
loads them). The script types four names one key at a time, 1.7 s apart, and records from each keydown the time until
the first rows of the new list are painted (a frame and a task after the results box first changes) and the longest
task; then it types three names at a phone's pace (180 ms a key) and records the longest task. Two runs each.

| Phone, 4x CPU, Explore search | Before (`main` 869c434) | After |
| --- | --- | --- |
| Keydown to the new rows painted, median of the keystrokes with 2 letters or more | 245 to 253 ms | 83 to 89 ms |
| The same, worst keystroke | 763 to 834 ms (two-letter queries: 200 rows at once) | 144 to 165 ms (narrowing a 200-row list after a pause) |
| Longest task while a key's results arrive | 333 to 435 ms | 0 to 100 ms (most keys under 50) |
| Typing at a phone's pace, longest task | 179 to 289 ms | none over 50 ms |
| Rows drawn in the end | the first 200 | the first 200, the same rows in the same order (about 1.1 s after the last key) |

What changed (display only, no draw, nothing bundled):

1. **The name narrows the index** (`src/game/logic/exploreIndex.ts`): `nameMatchesOf(u, words)` returns the players
   whose names hold every word, in index order. A query whose earlier words each lie inside one of its words ("haa"
   after "ha", "de br" after "de b") filters the earlier answer, kept for the last eight queries per universe; without
   one, `String.indexOf` over one string of every folded name (built once beside the index, `warmExplore`) finds the
   players holding the longest word, and only those are checked. Each entry also holds its best season (`best`).
   `searchPlayers` and `filterPlayers` read it; a filter with only a name skips the per-season check (every season
   matches). The old search and filter are kept verbatim in `src/game/__tests__/exploreSearchSame.test.ts`, which
   compares them row for row over more than a thousand queries typed letter by letter (with slips and backspaces,
   from a warm and a cold cache) and 600 filters with every sort and random filters beside the name. In Node the
   two-letter queries went from 7 to 10 ms to 4 to 6 ms and a narrowing one to under 1 ms.
2. **Typing renders only the search** (`src/ui/screens/Explore.tsx`, `ExploreViews.tsx`): the form's state moved from
   Explore into a small `SearchState` (kept in a ref across views), so a keystroke no longer renders the whole screen;
   the results box is its own component (`SearchOut`) with the deferred value inside it, so the deferred render draws
   the results alone and not the form, and the rows (`SearchRows`, memoised) are left alone by the keystroke's own
   render. The nation list's options are built once per universe.
3. **The rows come a slice at a time** (`src/ui/progressiveRows.ts`): the first 12 rows with the list, the rest 24 at
   a time after each paint once the list has stood for 250 ms, so typing never meets a step; each new list gets a
   new box (`listKey`), one removal instead of 200.
4. **Rows out of view skip layout and paint**: `content-visibility: auto` on the search's rows (`styles.css`, with the
   rows' height as the intrinsic size, 60 px and 125 px on a phone); the row's focus ring is drawn inside it, since the
   containment clips what a row draws outside itself.

Where a keystroke's 85 ms go now (4x): the input's own render and frame (about 25 to 40 ms), the filter (5 to 30 ms,
the most for a two-letter query), React's render of 12 rows (about 20 ms) and their style, layout and paint (about 30
ms). A keystroke that narrows a list that grew to 200 rows during a pause also removes it (about 20 ms more).

**The `setup.ts` split: not done, it saves nothing.** Tried on `main` at 869c434: Home's Daily read from `daily.ts`,
the rule chips and `shortNameFor` moved to their own module, and the store's `createGame` and `beginSeason` went
through the rules chunk. The entry measured 243.7 KB gzip against 243.1 KB before: `setup.ts` stays in the entry
through `onboarding.ts`, `weekly.ts`, `arenaDaily.ts` and `arena.ts`, and what it imports (the match engine, the
season engine, the arena) is in the entry anyway through the store's static `arena.ts` import (the store sends an
arena live match there). A split would only pay with the arena's live-match path moved to the rules chunk as well,
and `arena.ts` is in the edge verifier's graph too. The edge bundle keeps its name (`verifier-ecc269657e48639b.js`).

## Round 11 (`r13-perf`)

The fifth phone round, on `main` at 5c6ae29 (#97, round 12; engine 7). Measured as above: Playwright's Chromium at
390x844 (DPR 3, touch, `isMobile`), 4x CPU through `Emulation.setCPUThrottlingRate`, the production build behind a
small gzip server; Fast 3G only for the cold loads. The harness drives each flow from a cleared page and reads long
tasks (`PerformanceObserver`) from the tap until 1.5 s after the screen is up; frame intervals from a
`requestAnimationFrame` loop for the live match and the playback; traces (devtools.timeline) and CPU profiles on an
unminified build for the costs. Before is `main` 5c6ae29, after is this branch, run one after the other (the cold loads
interleaved, three each twice). The machine was quiet this time, but every run drafts a new seed, so a flow varies by
about 20 % from run to run; a range is the runs' spread.

| Phone, 4x CPU | Before (`main` 5c6ae29) | After |
| --- | --- | --- |
| Cold load (Fast 3G): longest task before Home | 554 to 790 ms | 257 to 385 ms (the entry chunk's evaluation, 257 to 410 before too) |
| Cold load: first paint / Home up | 5.2 to 5.5 s / 6.7 to 7.1 s | 4.5 to 5.4 s / 6.9 to 7.0 s (the network: 919 KB over Fast 3G) |
| Quick Draft: Finish to Squad complete, longest task | 258 to 372 ms (ready in 0.7 to 1.0 s) | 235 to 268 ms (ready in 0.6 s) |
| Explore: open, longest task | 413 to 490 ms | 244 to 271 ms |
| Explore: the first search (every league loads), longest task | 571 to 896 ms | 349 to 409 ms |
| Explore: typing a name at 180 ms a key | 0 to 78 ms | 0 to 79 ms (unchanged) |
| Quick Draft: Home to Setup / Setup's Start to the Draft | 136 to 157 / 171 to 234 ms | unchanged (nothing in their path changed) |
| Quick Draft: Auto-complete / Kick off to the playback / Skip | 216 to 248 / 105 / 93 to 191 ms | unchanged |
| Quick Draft: the playback running | 58 fps, p95 17 ms | the same |
| Season: Finish draft to the Dugout | 307 to 558 ms | 438 to 517 ms (unchanged, left: below) |
| Season: Play matchweek (Sim result) to the report / back | 115 to 264 / 189 to 356 ms | 111 to 237 / 236 to 255 ms (unchanged) |
| Season: Sim 5 to the digest | 257 to 320 ms (2.2 to 2.9 s in all) | 278 ms (2.5 s; unchanged) |
| Live match at 2x / 4x: fps, p95 frame, frames over 50 ms in 25 s | 51 fps, 33 ms, 6 to 8 / 47 fps, 33 ms, 21 | 46 fps, 33 ms, 16 / 46 fps, 33 ms, 21 (unchanged code; left) |
| Arena: Finish draft to the hub | 171 ms | unchanged (nothing in its path changed) |
| Edge verifier | `verifier-ecc269657e48639b.js` | unchanged (no bundled file touched) |

The three biggest costs and what changed (display and timing only, no draw, nothing bundled):

1. **The cold load's task before Home** (650 to 735 ms at 4x in the after-runs' "before"). One task held the last
   league's `buildLeague`, `mergeUniverses`, `tidyUniverseNames`, Home's first render and commit, and a forced style
   and layout of the whole first screen from App.tsx's `--topbar-h` effect (`getBoundingClientRect` in the effect,
   about 100 ms). The store's loader now yields between the merge (`packs.ts`'s `loadPacks`, after the builds), the tidy
   and the store write that renders the screens, and the top bar's height comes from the ResizeObserver's first report,
   after the frame's own layout (only the scroll padding reads it). The work is the same; the longest piece is now
   the entry chunk's evaluation.
2. **Squad complete's pre-season odds** (a 340 ms task at 4x, about 1.3 s after the tap). The sampling ran in 20 ms
   slices already, but its first slice built the odds league whole: 380 pairings, each the match engine's pre-match
   sums for both sides (`pairingExpectation`, in the edge bundle, so not memoised there). `oddsLeagueSteps`
   (`src/game/logic/odds.ts`) pauses after every five sides and every `ODDS_PAIRING_STEP` (20) pairings, and
   `usePreSeasonOdds` steps it in the same slices; `oddsLeague` runs it whole. `odds.test.ts` writes the old one-call
   build out and holds the stepped league equal to it. What is left of the step is the screen's own render.
3. **Explore's wheel chances** (the engine's `spinOdds` over a league's wheel, about 300 ms at 4x). `wheelChances` was
   cached per universe, and every league load is a new universe, so Explore's render worked England's wheel out on
   open and again after each of the eight loads the first search starts. A wheel is now kept by the very club-seasons
   it was worked out over (`exploreDb.ts`: the first spin's odds read nothing else, and every merged universe holds the
   same club-season objects), and `src/ui/useWheelChances.ts` works a missing wheel out after the paint, the line
   showing an ellipsis until then (`knownWheelChances` never works one out). `exploreDb.test.ts`: a merged universe
   reuses the wheel and a universe built afresh works out an equal one.

Measured and left:

- **Season's Finish draft to the Dugout, 440 to 560 ms:** `finishDraft` and `beginSeason` in the store write (about 120
  ms at 4x), the Dugout's render (about 170 ms) and the browser's style and layout of a large screen, then the focus
  rescue's `focus()` forcing layout once more (about 55 ms). Splitting it means painting the Draft busy first and
  letting the season begin in a task of its own, then the Dugout's mount in two frames, as the match day mounts.
- **The live match at 4x** keeps 46 to 47 fps on this phone, about 21 frames over 50 ms in 25 s, long tasks under
  100 ms: the pitch's canvas and the panels' paint, unchanged since round 3's isolation.
- **The first tap of a visit** pays about 50 ms for the `AudioContext` (`unlockAudio`, the browser's own cost) and the
  idle prefetch's first screen about 150 ms of `modulepreload` links (`__vitePreload`'s `appendChild`), both after Home.
- **Explore's index build** still runs 50 to 110 ms steps at 4x (2,500 player-seasons a step) while the first search
  loads every league; a smaller step would take longer in all.

No seeded outcome moved: the pins, `noMove`, `dailyPin` and `marketPin` pass untouched, ENGINE_VERSION is `'7'`.

## Next

In order of what a phone would gain:

1. **Home's first render** (round 11 split the pack work and the forced layout for `--topbar-h` off it; the entry
   chunk's evaluation, 260 to 410 ms at 4x, is now the start's longest task).
   England's `buildLeague` is only 100 to 120 ms of the start now that the classic pack is lazy (round 1's 500 ms
   counted it); a column-index build was tried in round 2 and measures the same on the phone. It did not ship: it
   renames the edge verifier, so it is parked on the branch `perf-r2-with-buildleague` for a future engine bump, when
   the function is redeployed anyway. A Dynasty summer that loads a new league pays 600 to 740 ms for its build (round 3).
2. **The match report's and the quick summary's first render** (about 230 to 340 ms): the same two-frame mount as the
   match day, or their heaviest memos built before (as `prepare.ts` does for the match day).
3. **Bench changes in the worker**: done in round 4.
4. **Auto-complete one pick a task**: the engine's `autoDraft` in one call is about 110 ms at 4x on a plain draft (round
   4); a game-side loop over `spin`, `assistantChoice` and `pick` (tested equal to `autoDraft`) could slice it.
5. **The in-memory game**: compact finished results in memory as the save does (invariant 5 already limits what
   may read them), about 0.7 MB a matchweek. Test: seeded seasons with and without it give identical games.
6. **`src/engine/data/managers.json`** left the entry chunk with the rules chunk in round 9; it still rides in the
   quick-season worker and the edge verifier (round 2, item 7).
7. **The global stylesheet** (255 KB minified after round 9 moved 34 KB to `gameScreens.css`) costs a style
   recalculation on Home's first frame; more screen-only sections could follow (the Draft's reel, the manager pick, the
   digest), each checked for later rules of equal weight first.
8. **Flags for offline**: the drawn flags are cached only once seen; the precache list could take the ones the packs
   name.
9. **What Home still carries of the game**: the match engine, the season engine and the arena (about 60 KB minified)
   ride in the entry through the store's static import of `arena.ts` (its live-match path) as well as through
   `setup.ts`. Round 10 measured splitting `setup.ts` alone: no gain (243.1 to 243.7 KB). Moving the arena's actions
   behind the rules chunk first, then the split, could; both files are in the edge verifier's graph, so that waits for
   an engine release.
10. **Season's Finish draft to the Dugout** (440 to 560 ms at 4x, round 11): the Draft painted busy, the season begun in
    a task of its own, then the Dugout mounted in two frames.
