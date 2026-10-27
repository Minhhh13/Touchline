# QA before the iOS release

The QA hunt of 2026-10-26 on branch `qa-hunt` (from `claude/touchline-preview` at 5035ce6): what was tested, what was found, what was fixed and what is still open. Every fix has a Vitest test; every open item names its file, the reproduction and a proposed patch. ENGINE_VERSION stays `'4'`, no seeded outcome moved (pins, `noMove`, `marketPin`, `dailyPin` green), no new draw, no new save field, and the edge verifier is still `verifier-37d256f009b3b3e9.js`.

## 1. What was tested

### Game logic, through the store (Vitest)

The harnesses drive games through the store's own actions, the calls the screens make, with a test-side chooser seeded by a literal string (never a game's stream). After every step they check: nothing thrown (the store's "Something went wrong" toast), no `NaN`, `Infinity`, `undefined` or `[object Object]` in a user-visible field or string, league tables that add up (points = 3W + D, every club's played games equal its fixtures with a result, wins = losses, goals for = goals against, an even number of draws), no player twice in a lineup, bench or squad (by player-season and by real player), squads within `SQUAD_CAP`, finances finite, the save reloading (persisted, compacted, lz-string compressed, decompressed, merged through `normaliseGame`) as the same compacted game, the challenge link encoding, decoding and replaying to the same claim, and the result credited once (a second `recordResult` changes nothing).

| Sweep | File | Full run (`QA_FULL=1`) |
| --- | --- | --- |
| Quick Draft: random mixes of Crazy, Hard, Underdog, Legends, Speedrun, Gamble, the Upgrader, power-ups, the end case, manager spin or pick, a bench of 0 to 5, Moneyball presets, the Teammate Chain, Classic, Position First, Prime, January on or off, an era; picks by hand and by the assistant, re-spins, every power-up, Auto-complete at a random pick; the kick-off step, January (a listing, a pass, the spin, the Upgrader), bench changes in both halves, the post-season cup played or skipped, the link replayed | `src/game/__tests__/qaQuick.test.ts` | 150 drafts |
| Season and Dynasty (three seasons): a random manager every week (formation, assign, auto-pick, tactics, captain, training, talks, staff, board requests, the wage slider, contract offers, statuses, youth intake, events, bids, loans, offers, releases, enquiries, scouting, assignments, shopping), live matches through both stops with in-play changes, the hold, Finish now and the assistant, Sim 1/2/5, Sim to the big match, Sim to end, friendlies, job moves; a save reloaded mid-match plays on exactly as the one that never reloaded | `qaSeason.test.ts` | 20 seasons, 6 dynasties, 6 reload replays |
| Arena: Final, Cup of 8/16/32 and Gauntlet on four fields, live and assistant matches, penalties in the manager's order and keeper, the lifeline, bonus spins, Sim to end; filed once, never on the leaderboard; assistant runs replay from their link | `qaModes.test.ts` | 36 runs |
| Run-in (title, Europe, survival), the Daily (30 days), hot-seat head-to-head | `qaModes.test.ts` | 12, 30, 20 |
| Every league loaded: Quick Drafts in all seven leagues, the Super League, European Nights, both post-season cups; the casual Weekly over 16 weeks; a Season with the Continental Cup and a three-season Dynasty in each league; the Daily Arena and Cups drawn from every league | `qaEurope.test.ts` | 24 drafts, 16 weeks, 14 managed games, 10 arena runs |
| Every screen rendered on the server (`renderToString`) from each state those walks reach, plus Home, every Setup mode, Explore, Profile, How it works, Privacy, World and Account; the markup checked for bad text, buttons without a name, inputs without a label, images without alt text, dt or dd outside a dl, aria-pressed on a radio, and an aria-label on an element with no role | `src/ui/__tests__/qaRender.test.ts` | 19 walks |
| Saves written by two older builds of the live site (4511789 and d4d9b2f, 23 snapshots from mid-draft to a dynasty summer and a head-to-head) merged into this build, rendered, and played on to the summary | one-off, not committed (the snapshots are 19 MB) | 23 snapshots |

By default each sweep runs about a third of its seeds, so every test stays under 60 s and the suite adds about four minutes; `QA_FULL=1 npx vitest run src/game/__tests__/qa src/ui/__tests__/qa` runs the full counts above (and the coverage checks that every action ran at least once).

### The built app in a browser (Playwright, not committed)

Against `npm run build` and `vite preview`, with `touchline-match-speed` 4 and `touchline-key-moments` off; scripts in the session's scratch folder.

- **Flows, end to end**, at 1280x720, 390x844, 430x932 and 375x667, the two themes alternating: Quick Draft (a double-click on Start Draft and on Kick off, a reload mid-draft with a spin showing, at kick-off, in January and at the summary, back and forward), Season (Watch to half time, a reload there, a double-click on Play on, the 70th minute, Sim 5 and its digest, Sim to end, a reload at the summary), the Cup, the Gauntlet, the Run-in, the Daily (a double-click on its card's button), the Weekly, head-to-head (a league switch before its pack loads, a double-click on Play the season), a full storage (every write refused) and offline after the first load. Checked: page errors, console errors, a stall with no way forward, the screen error boundary, bad text, horizontal scroll, a shell screen scrolling the page on a desktop, the leaderboard credited once.
- **Monkeys**: random clicks (5% of them double-clicks, confirms accepted 70% of the time) with a reload every 40 steps, from Home at the four sizes and from 22 deep saves (a spin showing with the tray, the manager spin, the case, January, the playback with a bench, pre-season, a decision, the summer window, a live match at both stops, the report, the summary, the dynasty summer, the Gauntlet hub, a shoot-out waiting, the Cup bracket and summary, the Run-in hub, a head-to-head draft) at 1280x720 and 390x844, and again at 320x568.
- **Accessibility**: axe-core 4.10 (WCAG 2.0/2.1 A and AA) over 17 screens in both themes at 1280x720 and 390x844; Tab through Home for visible focus; every field's font size and every tap target on a phone; the viewport meta (zoomable, no `user-scalable=no`).
- **Links and files**: a damaged `#c=` link, `#s=` and `#h=` in the offline build, a challenge link made on the summary and opened in a new page, the save exported, a non-save file imported (refused, nothing lost), the export imported into a wiped browser.

## 2. Fixed (in commit order)

| Id | Severity | What was wrong | Fix |
| --- | --- | --- | --- |
| QA-1 | Low | A second `h2hFinish` on a finished head-to-head (a fast double-click on Play the season) ran the season again from the moved stream and replaced the result | `store.ts`: Finish does nothing once a result exists |
| QA-2 | High | Head-to-head setup: picking a league whose pack was not loaded (or any league offline) rendered a badge for an undefined club; the render threw and the whole app went white with no control on it | `H2H.tsx`: no badge, an empty select and Start disabled until both clubs exist |
| QA-3 | Low (a11y) | The three set-piece taker selects (Tactics) and Explore's season select had no label | `aria-label`s |
| QA-4 | High | Nothing caught a render error: any throw in a screen unmounted the app, a white page with no way out but a reload | `ScreenBoundary` around the screens in `App.tsx` (since the merge with the release line, the one boundary in `lazyScreens.tsx`, which also says when a screen's chunk did not load): the error, Back to home and Reload, the top bar kept; it clears on the next screen or phase |
| QA-5 | Low | Draft again under Crazy kept the last draft's formation (Crazy draws one from the seed) | `draftAgainSettings` in `logic/draftAgain.ts` (out of `setup.ts`, which the edge verifier bundles) |
| QA-6 | Low (a11y) | dt and dd wrapped in a div (Profile's 38-0 chase, the season records, the Club tab, contract talks) | `dl`; `dl.kv` drops the browser margins |
| QA-7 | Low | A sold or released player stayed named as penalty, free-kick or corner taker (the match already skipped him; the Tactics tab and the briefing did not) | `releasePlayer` clears his duties |
| QA-8 | Low (a11y) | The squad view switch's radios carried `aria-pressed`; the match-day panel bodies and table scrolled with no focusable content | removed; `tabIndex={0}` |
| QA-9 | Medium | `playArenaStep` ran with the last match's report still up, so a second Sim played the next rung without `closeArenaMatch` and could skip a Gauntlet bonus spin | it plays only from the hub (phase `week`) |
| QA-10 | Medium | An aborted View Transition (the viewport resized mid-navigation, as a phone does when it turns or its bars move) left `ready` and `finished` rejected and uncaught: a page error | `motion.ts` catches both |
| QA-11 | Low | A `#c=`, `#s=` or `#h=` link with punctuation glued to its end or cut short was ignored without a word, the bad hash left in the address bar | `ui/gameHash.ts`: trailing punctuation dropped, a damaged link cleared with a toast |
| QA-12 | Low (a11y) | aria-label on spans and divs with no role (the live table's moves, W/D/L badges, the form arrow, the star, the draft grade, report cards, the world board's record, unit strips, the scoreboard, Home's and How it works' rows): never announced | `role="img"` or `role="group"` |
| QA-13 | Medium (iOS) | The rule setting phone fields to 16px came before the base `.input` rule, so every field stayed 14px and iOS zoomed the page into the team name, the season or a bid on focus | the rule now follows the base rule; Setup's season select included |
| QA-14 | Low | At 320 px (an iPhone SE, or a mini with Display Zoom) Setup's season picker, the Tactics tab's role selects and the seven nav icons were wider than the screen: the layout viewport grew to 324 to 371 px and the page rendered zoomed out, Start half off the edge | the picker wraps, the role selects shrink, the nav buttons lose padding below 360 px |

Regression tests: `src/game/__tests__/qaFixes.test.ts` (QA-1, 5, 7, 9), `src/ui/__tests__/qaFixesUi.test.ts` (QA-2, 3, 4, 6, 8, 11, server-rendered), `src/ui/__tests__/qaMotion.test.ts` (QA-10), `src/ui/__tests__/qaCss.test.ts` (QA-13, 14, and the stylesheet's braces); QA-12 is covered by the render sweep.

## 3. Open: in files other agents own, or for the owner

| Id | Severity | Where | What happens, and how to see it | Proposed patch |
| --- | --- | --- | --- | --- |
| O-1 | Low; fixed in engine 6 (`scaleTable` in `src/engine/scenario.ts`, used by `projectedCarryIn` and `jobOf`) | `src/engine/scenario.ts:48` `scaleRow`, used by `projectedCarryIn` (line 99) and `jobOf` | A run-in's carried table scales each club's real row on its own, so the league's columns do not add up: Hull 2014-15, survival, seed `qa-runin-0`: 210 wins against 211 losses, 139 draws, 718 goals for against 720 against at matchweek 28 (`qaModes.test.ts`, the run-in sweep, with the carry-in check switched back on) | After scaling every row, reconcile league-wide: while wins ≠ losses, move one result on the row with the largest rounding remainder (a win to a draw, or a draw to a loss) and the same for goals. It changes run-in tables, so it needs an ENGINE_VERSION bump and new run-in pins |
| O-2 | Low (iOS); **fixed** on `polish-qaopen` (web share fallback) | `src/ui/shareCard.ts:620` `downloadDataUrl`, `src/ui/screens/ProfileScreen.tsx:66` `exportSave` | Download share card and Export save use `<a download>`. A WKWebView only saves a download when the app handles it (`WKDownload`), so in the Capacitor app both are likely to do nothing, or to open the image or JSON in the web view with no way back; check on a device | Where `navigator.canShare({ files })` holds, share a `File` (`navigator.share({ files: [new File([blob], name, { type })] })`); in the Capacitor app use the Share and Filesystem plugins |
| O-3 | High (iOS); fixed on main by `polish-safearea` (2026-10-27, the web half of `ios-native`'s 1ad033d: four safe-area tokens; landscape `.page` content still has no side inset) | `src/ui/styles.css` (`.topbar`, `.app`), with `viewport-fit=cover` in `index.html` | No `env(safe-area-inset-top)`, `-left` or `-right` anywhere: in a full-screen WKWebView the top bar sits under the status bar and the notch, and landscape content runs under the sensor housing (the bottom bars already pad `safe-area-inset-bottom`) | `.topbar { padding-top: max(8px, env(safe-area-inset-top)) }` and `.app { padding-inline: env(safe-area-inset-left) env(safe-area-inset-right) }`, or Capacitor's `ios.contentInset: 'always'`; for the iOS agent to choose |
| O-4 | Low (a11y) | `src/ui/screens/OppositionReport.tsx:63` | The Units list is a div of dt and dd (axe: dlitem) on the Next match tab and the arena hub | `<dl className="kv">` (the `dl.kv` rule from QA-6 keeps its spacing) |
| O-5 | Low (a11y) | `src/ui/components/bits.tsx:279` (tab badge), `src/ui/screens/Draft.tsx:263` (pick count), `:421` (Icons badge), `:433` (twist in the draft log), `src/ui/matchday/SquadStrip.tsx:32`, `src/ui/components/SpinOdds.tsx:11`, `src/ui/components/PlayerRow.tsx:22` (champion chip) | aria-label on a span or div with no role: never announced (axe: aria-prohibited-attr). The render sweep filters exactly these (`OPEN_ARIA` in `qaSsr.ts`) | `role="img"` on the glyphs (badge, count, Icons, twist, chip), `role="group"` on the strip and the odds |
| O-6 | Low (a11y) | `src/ui/screens/Draft.tsx:411` | The draft log scrolls with no focusable content (axe: scrollable-region-focusable) | `<ol className="draft-log" tabIndex={0} aria-label="Draft log">` |
| O-7 | Low; **fixed** on `polish-qaopen` | `src/ui/matchday/MatchDashboard.tsx:96` (`start = resumeMinute(live.mp)`) | A reload (or iOS killing the backgrounded web view) at a stop replays the segment from its start before the stop panel returns: about 50 s at 4x, three and a half minutes at 1x. Skip replay gets straight back. Seen on a Season at half time | Remember per viewer (sessionStorage, keyed by `liveMatchKey(game.live)` and the clock) that the segment was seen, and start the clock at the stop when it was |
| O-8 | Low (iOS); **fixed** on `polish-qaopen` | `src/ui/matchday/matchday*.css` (`.md-select`, 12px; `select.md-highlights`, 13px) | The dashboard's mentality and highlights selects are under 16px, so iOS zooms into them on focus | 16px on phones, if the control row can take the height |
| O-9 | Medium (iOS); **eased** on `polish-qaopen` (persistent storage); the native mirror is for the iOS wrapper | the save in `localStorage` (`src/game/saveStorage.ts`) | Capacitor's own storage guide warns that iOS may clear a web view's `localStorage` when the device runs low on space; an app-store player has no export habit and no cloud save offline | Mirror the save to Capacitor Preferences or a file (the persist storage is one object to wrap); for the iOS agent |
| O-10 | Low; **fixed** on `polish-qaopen` (the label and Retry; precaching every pack is left) | `src/ui/screens/Setup.tsx` and `H2H.tsx` start buttons; `ensureLeagues` in `store.ts` | Offline, a league whose pack never loaded leaves Start on "Loading league data…" for good after one toast; a Dynasty that qualified for Europe cannot start its summer offline (every pack is needed) | Remember a failed load and label the button "Not downloaded: connect to load it" with a Retry; precache every pack in the service worker for the app build |
| O-11 | Low (a11y) | the 21 `table.tbl` (`display: block; overflow-x: auto` under 720 px) | On a phone each table scrolls sideways with no focusable content | `tabIndex={0}` and an `aria-label` on the tables that can overflow, or a wrapper that takes focus |
| O-12 | Low (a11y); **fixed** (phones by the second accessibility pass, every width on `polish-qaopen`) | `bits.tsx` `Info` (18x18), Setup's "change" link (49x19), the dashboard's Boxes control (95x20) | Tap targets under 24x24 px (WCAG 2.2 target size; Apple asks for 44) | A 24 px minimum hit area (padding or a pseudo-element) |
| O-13 | Known; **fixed** by the first accessibility pass (`inkOn` clears 4.5:1 on every kit colour) | club badge kit colours (`inkOn`) | Arsenal, Sunderland, Stoke and other red kits give badge text 4.35 to 4.48:1 against 4.5 (already in HANDOVER section 7) | A darker kit shade for text on the badge |
| O-15 | Low; **fixed** by the second accessibility pass (#78) | `src/ui/screens/Draft.tsx:274` (the head's `<span className="row">`: Speedrun clock, bonus spins, `CapChip`, Boxes, Home) | At 320 px a capped draft (a Gauntlet with Moneyball, seed `qa-cap-g`, £0M of £223M) puts the chip, Boxes and Home on one row that does not wrap: the layout grows to 377 px and the whole draft renders zoomed out (found by the 320 px monkey from the Cup bracket save) | `className="row wrap"` on that span |
| O-14 | Low; **fixed** on `polish-qaopen` | `saveStorage.ts` `onError` in `store.ts` | With the storage full the toast shows on the first refused write and then every twentieth; the rest of the time nothing says that nothing is being saved | A persistent banner while writes fail |

Since the merge with the release line (improve-r5, 2026-10-26): the accessibility passes had already fixed O-4 (the Units list is a `dl.kv`), O-5 (every glyph and group named there has its role), O-6 and O-11 (`scrollFocus.ts` puts the draft log, `table.tbl` and the match-day panels in the Tab order while they scroll, so QA-8's fixed `tabIndex={0}` on the panels was dropped for it), and QA-3, QA-6 and QA-12 overlapped theirs (one version kept each). QA-4's boundary is now the one `ScreenBoundary` in `lazyScreens.tsx`, which also tells a chunk that did not load from a render error. The render sweep's `OPEN_ARIA` filter in `qaSsr.ts` no longer has anything to filter.

### Open items on `polish-qaopen` (2026-10-26)

Each was reproduced against the release build (ec520f3, engine 5) with Playwright before the fix, and checked again after it; every fix has a Vitest test.

| Id | Reproduced | Fix | Test |
| --- | --- | --- | --- |
| O-2 | Chromium has no "download goes nowhere" case, so by the code path: `<a download>` was the only route, for the card and the export alike | `src/ui/saveFile.ts`: a plain browser keeps the download; an iOS home-screen web app (`navigator.standalone`), an embedded iOS web view (no `Safari/` in the user agent) or a browser without `<a download>` opens the share sheet with the file (`navigator.share({ files })`) when `navigator.canShare` takes it, the save as JSON or else as plain text with the same name; any failure but the player closing the sheet falls back to the download. `downloadDataUrl` (every share card) and Export save go through it. No Capacitor code | `saveFile.test.ts` |
| O-7 | Season saved at half time: Skip to half time, reload in the same tab: the panel back in 4.4 s (round 5's sessionStorage mark works); a fresh web view with the same localStorage (what iOS restores after killing a backgrounded app): the half replayed, no panel after 20 s | `matchday/resume.ts` keeps the mark in localStorage (sessionStorage when localStorage refuses it) and reads the mark for the segment on screen first | `matchResume.test.ts` |
| O-8 | 390 px, live match at half time: the mentality select 12px, highlights 13px | `matchday-phone.css`: every match-day select 16px under 720 px (the row already had a 32 px control height) | `qaOpenCss.test.ts` |
| O-9 | (no eviction to see in Chromium) | `src/ui/persistStorage.ts`: after the first finished result (the Trophy Room's per-mode counts and the arena runs) the app asks `navigator.storage.persist()` once per device (`touchline-persist-asked`); Your record's Save data box says whether the save is protected, with Protect my save when it is not. Mirroring the save to native storage stays with the iOS wrapper | `persistStorage.test.ts` |
| O-10 | Offline, a league never loaded: Start read "Loading league data…" for good | the store keeps `failedLeagues` and `classicFailed` (transient); `src/game/logic/leagueLoad.ts` says ready, loading or missing; Setup, the arena, the Run-in, the arena challenge and head-to-head read "Not downloaded: connect to load it" with a Retry (`components/LeagueRetry.tsx`) that also runs when the device comes back online; a Dynasty summer that needs a missing league shows the same Retry. Precaching every pack in the service worker (perf-r2 precaches the built assets) is an owner decision: about 10 MB of packs (before compression) on a first visit | `leagueLoad.test.ts` |
| O-12 | 1280x720: the setup cards' "i" 18x18, "change" 49x19, Advanced 582x19, the dashboard's Boxes 95x20 and its selects 22 to 23 px tall, the summary's Share text 21 px, chip buttons 23 px (phones were already fixed by #78) | `styles.css`: a pseudo-element gives those a 24 px hit area at every width without moving the layout; `matchday.css`: the selects take a 24 px minimum height | `qaOpenCss.test.ts` |
| O-13 | already fixed: `inkOn` picks black for the mid reds (a11y test over every kit colour) | none needed | `a11y.test.ts` |
| O-14 | (the QA hunt's full-storage flow) | the store's transient `saveFailing`, set by the quota error and cleared by the next accepted write; `components/SaveBanner.tsx` keeps a Not saving pill in the top bar beside the brand (it opens Your record, where Export save is; icon only under 360 px; floating top left while the bar is hidden), so it never covers a control | `saveFailing.test.ts` |
| O-15 | 320x568, the Gauntlet cap draft with bonus spins and the Speedrun clock added: no widening (`scrollWidth` 320) | already fixed by #78 (`.draft-progress > .row > .row` wraps under 720 px) | `qaOpenCss.test.ts` pins it |

### O-1: the patch as proposed (engine 6 applied it as `scaleTable`)

`scaleRow` scales each club's real row on its own, so the league's columns do not reconcile: Hull 2014-15 survival (`qa-runin-0`) carries 210 wins against 211 losses and 718 goals for against 720 against at matchweek 28. The fix reconciles the whole table after scaling, moving the fewest results and goals, on the rows whose rounding moved them most. It changes run-in tables (projected positions, gaps and points in the catalogue, the carried rows in every run-in), so it needs ENGINE_VERSION `'6'`, a line in `docs/GAME_DESIGN.md` section 15, new run-in pins (`src/engine/__tests__/scenario*.test.ts`, `src/game/__tests__/runin*.test.ts` and the pins files) and a new edge bundle (the verifier bundles `src/engine`). The catalogue's membership does not move (`fits` reads the real rows). Tried on a scratch copy (not committed) over the 60 league seasons the catalogue draws from in England, Spain, Italy and Germany: 58 did not add up before; after it every one does, and no row moved by more than one result or one goal.

In `src/engine/scenario.ts`, beside `scaleRow`:

```ts
/**
 * Every club's real row scaled back to `n` of `played` matches, reconciled league-wide so the carried table is one a
 * league could have: wins equal losses (then draws are even, since clubs × n is), goals for equal goals against. Each
 * row is scaled by `scaleRow`; then, while wins exceed losses, a win becomes a draw on the row whose win was rounded up
 * most (while losses exceed wins, a loss becomes a draw likewise), and the goal surplus comes off the rows whose goals
 * for (or against) were rounded up most, never below their wins (or losses). Ties go to the higher-placed row. Pure.
 */
export function scaleTable(rows: LeagueSeasonRow[], played: number, n: number): Record<string, CarryRow> {
  const out = rows.map((r) => scaleRow(r, played, n))
  const exact = (x: number) => (x * n) / played
  const excess = (i: number, k: 'won' | 'lost' | 'goalsFor' | 'goalsAgainst') => out[i][k] - exact(rows[i][k])
  const pick = (k: 'won' | 'lost' | 'goalsFor' | 'goalsAgainst', ok: (i: number) => boolean) => {
    let best = -1
    for (let i = 0; i < out.length; i++) if (ok(i) && (best < 0 || excess(i, k) > excess(best, k))) best = i
    return best
  }
  const total = (k: keyof CarryRow) => out.reduce((a, r) => a + r[k], 0)
  for (let gap = total('won') - total('lost'); gap !== 0; gap = total('won') - total('lost')) {
    const k = gap > 0 ? 'won' : 'lost'
    const i = pick(k, (j) => out[j][k] > 0)
    if (i < 0) break
    out[i][k]--
    out[i].drawn++
  }
  for (let gap = total('goalsFor') - total('goalsAgainst'); gap !== 0; gap = total('goalsFor') - total('goalsAgainst')) {
    const k = gap > 0 ? 'goalsFor' : 'goalsAgainst'
    const floor = gap > 0 ? 'won' : 'lost'
    const i = pick(k, (j) => out[j][k] > out[j][floor])
    if (i < 0) break
    out[i][k]--
  }
  return Object.fromEntries(rows.map((r, i) => [r.clubId, out[i]]))
}
```

Then `projectedCarryIn` and `jobOf` build their carry from it, the host keyed as `USER_TEAM`:

```ts
const scaled = scaleTable(rows, played, n)
return Object.fromEntries(rows.map((r) => [r.clubId === hostClubId ? USER_TEAM : r.clubId, scaled[r.clubId]]))
```

and the test that goes with it: over every catalogue job in every loaded league, the carried rows give Σwon = Σlost, an even Σdrawn, Σ(won + drawn + lost) = clubs × takeover, ΣgoalsFor = ΣgoalsAgainst, each row's `won + drawn + lost = takeover`, and no row more than one result or one goal from its own `scaleRow`; then switch the run-in sweep's carry-in check in `qaSeasonHarness.ts` back on (it checks the carried table with the played fixtures).

## 4. Coverage notes

- The logic held up: no crash, NaN, broken table, duplicate player, double credit or save drift in about 340 seeded games over every mode; every challenge and arena link replayed to its claim; both older builds' saves loaded and played on. The bugs were at the edges of the screens: a league not loaded, a double tap, a reload, a resize, the smallest phones, iOS.
- Not covered: online play (the build has no `VITE_SUPABASE_*`, so sign-in, cloud sync, ranked posts and rooms were not exercised), real iOS Safari or WKWebView (Chromium only; the iOS items above come from the code and the platform's rules), the sound, the share card's pixels, and the classic pack's on-demand loading on `main` (#74, not on this branch).
- Machine load during the run (a load average of 15 to 34 on four cores, from other agents) slowed every test four to ten times; the timeouts that showed up were load, not bugs, and the default sweep sizes are set so each test stays under 60 s even then.
