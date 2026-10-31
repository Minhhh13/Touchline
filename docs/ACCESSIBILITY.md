# TouchLine: accessibility

What TouchLine supports for VoiceOver, keyboard-only play and larger text, how to check it, and what is left. The target is WCAG 2.2 AA where it is practical for a game, and no blocker for App Store review or for a player using assistive technology. The rules for new components are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) section 15.

First pass: 2026-10-26, branch `a11y-pass` from `main` at 301da2e. Second pass: 2026-10-26, branch `a11y-r2` from the `a11y-pass` tip (44908c5). Third pass: 2026-10-27, branch `claude/r7-a11y` from `release-e6` (4899025, engine 6 with every polish batch). Fourth pass: 2026-10-28, branch `claude/r8-a11y` from `release-e7` (00a5cc7, engine 7 with every polish batch). Sixth pass: 2026-10-29, branch `claude/r10-i18n-a11y` from `main` (869c434).

## 1. What is supported

**Screen readers (VoiceOver on iOS and macOS, NVDA, TalkBack).**

- Every button, select and input has a name. Icon-only buttons carry an `aria-label`; Lucide icons inside a labelled control are hidden from screen readers (lucide-react adds `aria-hidden` when an icon has no label of its own).
- Dialogs are real modal dialogs (`useDialog`, since TL-06): named by their title, the focus moved in and kept inside, Escape closes, the page behind is `inert`, the focus returns to the opener.
- Key-value lists (the Club tab's board and finances, the opposition report, Stats records, the 38-0 chase on Profile, contract talks, Season Story) are real `<dl>` lists, so a term is read with its value.
- A mark that means something (a form arrow, a draft grade, the Champion trophy, a booking, a twist in the draft log, the odds bar, a live table's move) is `role="img"` with a label; a labelled box of parts (unit ratings, the deadline ticker, Home's rows) is `role="group"`.
- Results are read as words: a form guide reads "Form: won, won, drawn, lost", not "double-u double-u D L" (`resultsLabel`, `outcomeWord` in `src/ui/a11y.ts`).
- Live announcements are polite and short, from regions that stay in the page (a region that mounts with its text is often skipped by VoiceOver):
  - the toast (`toast-live`);
  - the match: the score once each time it changes (`score-live`), the key commentary line (goals, cards, injuries, substitutions) and the assistant's word (`feedPanels.tsx`), the substitution board's staging (`sub-announce`);
  - the draft reel: the season, then the club and its tier (`reel-live`); the manager spin, the end-of-draft case and the January case: what landed (`mspin-live`, `case-live`, `january-spin-live`);
  - the Upgrader (the draft's and January's): the gamble while the dial turns, then the verdict and the roll (`upgrader-live`; the dial is a picture);
  - an arena shoot-out: each kick as it shows, with the score, then the verdict (`shootout-live`); a taker moved in the penalty order (`shootout-order-live`); the kick chips read "Ours: Kane scored" rather than a tick and a colour;
  - the head-to-head draft: whose turn it is (the notice over the squad);
  - the season playback: one line for a big moment ("Matchweek 12: Top of the league!") and one at full time (`playback-live`). The tally and the running strip are deliberately not live: they changed at every game.
- Landmarks: the top bar is the banner, and each screen's own `.page` is the main landmark (`role="main"`, `id="main"`, set by `watchMainLandmark` in `src/ui/landmarks.ts`, which follows the screens as they change). The shell's CSS selects `.app > .page` directly, so there is no `<main>` wrapper. The first Tab stop is a "Skip to content" link (`skip-link`), off the screen until it has the focus, which puts the focus on the screen's page (the next Tab is its first control) without touching the URL's hash.
- The Gauntlet's ladder is a labelled list whose rungs read as words ("Rung 3, won 2-1 v Stoke City"); a played rung shows its W or L beside the colour.
- After a reel lands the focus moves to where the choice is (`useFocusOnLanding`): the landed club's name in the draft and the head-to-head draft (the squad is the next Tab stop), the first Pick on the manager spin, On to kick-off or the Icon's first slot on the case, his first slot or Keep my XI on the January case. It only moves when the focus had fallen to `<body>` or to a disabled control, never away from something the player chose.
- The focus is never dropped (round 3). When the control that had it leaves the page (a picked player's row, the Pick of a manager spin, a whole screen swapped for the next), the focus rescue (`src/ui/focusRescue.ts`) puts it on the first control of the nearest box still there, or on the new screen's page (its `role="main"`, so a screen reader starts reading the new screen and the next Tab is its first control). Where the next step is known it goes there: Spin after a pick and the finish button once the squad is complete (the Draft and the head-to-head), Open the January case and its Tap to skip, the Upgrader's skip and its close, Done when a cup's trophy rises, the first listing that "Show all" brings into view on a phone's market, the other arrow of a penalty taker moved to the top or the bottom.
- Tab strips are one Tab stop: the arrows, Home and End move along the Dugout's tabs, the player card's, World's boards (a vertical strip, `aria-orientation`) and the playback's (WAI-ARIA tabs, `onTabListKey`). The top bar marks the current screen with `aria-current="page"`.
- Radio groups are one Tab stop too and say what they choose (round 4): every `Segmented` choice on Profile (theme, sound and its three categories, reel speed, error reports), Head-to-head ("Where to play": Play with a friend or This device), World's filters, Explore and the Stats tables, plus the setup cards, the manager cards, the Dugout's match-play, squad-view and Inbox filters and the match day's shouts; the arrows, Home and End move and choose (`onRadioGroupKey`, `radioTabIndex`).
- The Continental Cup's groups (engine 7) read in words: each table's short heads in full ("Played", "Goal difference", "Points"), your row as "your side" and the top two as "through to the knockouts" (the outline and the green edge are drawn too), and your fixtures as "Matchday 2, at Ajax, Won 2-1" or "after matchweek 7". A two-legged tie prints its legs beside the bracket's sides.
- The Dynasty renewal list names its man on each button ("Offer terms to Kane", "Let Kane go"), and Let go asks the game's own question first (`askConfirm`, danger); the focus goes back to the list.
- Setup's Shuffle (the random team name) leaves the focus on itself and reads the new name from a region that stays mounted ("Team name: Ashvale Rovers"); the head-to-head switch keeps the focus on the same switch when the page under it changes; the storylines' form chips read "Your form, oldest first: won, drawn, lost" and the Dugout's story chip carries its tooltip's sentence for a screen reader.

**Keyboard.**

- Every control is a real `<button>`, link or form field, or answers Enter and Space as one (`pressable`, `isActivationKey`): Explore's club rows, the pitch's slots (a read-only pitch is a labelled image and takes no Tab stop).
- The reels and dials skip with Space or Enter while they run, and each has a Skip button; the substitution board takes Tab, the arrow keys, Enter and Escape as well as a drag or a tap (`SubBoard.tsx`).
- A box that scrolls with nothing focusable inside (a results table, the draft log, the privacy text, the end case's odds) joins the Tab order while it scrolls, so the arrow keys scroll it (`src/ui/scrollFocus.ts`; Safari does not make such boxes focusable on its own).
- The focus ring is the global 2 px `--focus` outline on `:focus-visible` and is never removed from a control (a page or panel focused only so the next Tab starts inside it draws none).
- Hover cards (the player peek) and Info tips close on Escape (WCAG 1.4.13).
- `\` hides and shows the top bar (section 13 of the design system).

**Colour and contrast.**

- Every text pair in the token set passes 4.5:1 (DESIGN_SYSTEM.md section 3). The match day's red rating pill takes the status ink (it was 2.5:1 in both themes). An unavailable man in the planner and the depth chart is struck through in `--text-3` on a dashed edge, never faded (it was 2.5:1 in Daylight).
- The xG story's lines clear 3:1 against the chart panel (WCAG 1.4.11): a kit under 3:1 (a sky blue in Daylight, a deep red in Floodlit, as well as white, yellow, navy and black) is drawn over a casing in the theme that needs it (`LINE_CONTRAST` in `src/ui/match/charts.ts`, 2:1 before round 3). Ink on a club's colour (badges, the match day's codes, shirts and discs, the reel's cards) is chosen by WCAG contrast (`inkOn`, `textColourFor`) and clears 4.5:1 on every colour: a mid red such as Arsenal's takes black, not white.
- A result never rests on colour alone: a coloured score or tie chip carries its W, D or L (`.res-letter`), and the W/D/L badges and form guides show the letter.

**Motion.** `prefers-reduced-motion: reduce` stops every entrance, transition, loop and the celebration (the motion section's blocks in `styles.css`); the reels land at once, the live pitch draws once a minute. A probe of `document.getAnimations()` on Home, Profile, How it works, Explore, Setup, the Draft and the manager spin found nothing running under reduced motion.

**Larger text and touch.**

- Phones (720 px and below) since the second pass: every button (small ones too), the chip buttons, segmented choices, tabs, inputs, selects and sliders are 44 px tall, icon-only small buttons 44 px wide; the round icon buttons (theme, sound, Info, the shortlist star, Boxes, the inline "change" links) keep their look and grow an invisible 44 px `::after`; Explore's club rows are 44 px tall. The setup cards' "i" stays 32 px, clear of its card.
- At 175 % and 200 % text (the root font size, which is how iOS Dynamic Type will arrive: section 5) the phone rows that ran past a 390 px window wrap instead; Home's lockup scales with its column under 520 px (it was clipped on a 320 px screen) and opts out of a text-size adjustment.
- The type scale tokens (`--fs-xs` to `--fs-hero`) are in rem, so text set with them follows a reader's larger default font size; at the default 16 px they are the same 11 to 64 px as before.
- Phones (720 px and below): the top bar's pills are 44 px tall and its round buttons, the fold heads and the Info buttons take a 44 px target (the setup cards' "i" 32 px, clear of its card); player rows, the manager guide, the season picker and Home's figures wrap or give way under larger text rather than run off the screen.
- The desktop's one-screen fit is unchanged (every rule above that changes size is phone-only).

## 2. How to test

**axe-core.** Not a dependency. Fetch it into an empty scratch folder (`npm pack axe-core@4.10.2`, then `tar -xzf`) and inject `package/axe.min.js` with Playwright's `page.addScriptTag`, then run `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })` on each screen, at 390x844 and 1280x720. The screens: Home, Setup, the Draft (idle, the reel running, choosing, squad ready), the manager spin, the end case, Kick-off, the season playback, January (before and after its case), the Summary, every Dugout tab, the live match (playing, the 45' and 70' stops, the report), the arena setup and hub, Profile, How it works, Explore, Privacy and the head-to-head setup. Since the second pass also, in both themes: a room link on an offline build, the head-to-head draft (idle and choosing) and result, the Run-in's setup, draft, hub and summary, the Gauntlet's setup and hub (before and after a rung), an arena final's replay and summary, Explore's player card, the Dugout's player card and its tabs, Dynasty's summary, summer, bonus draft, pre-season and summer market, Profile's Trophy Room after an arena run and after a Dynasty season, and, on a build with placeholder `VITE_SUPABASE_*` values and no network to them, Home, World, Account, the online room setup, Privacy and Profile.

**Signed in, with no project (round 6).** Build with `VITE_SUPABASE_URL=https://fake-touchline.supabase.co` and any `sb_publishable_…` key, serve it, and in Playwright `context.route('https://fake-touchline.supabase.co/**', …)` answer every request: `/auth/v1/*` with the session, `/rest/v1/rpc/<fn>` with rows (`*_board`, `*_summary`, `*_my_entries`, `chase_my_status`, `profile_put` and `save_claim` as `{ status: 'ok', revision: 1 }`), `/rest/v1/profiles` with one row or none (the setup step), `/rest/v1/cloud_saves` with another device's game for a conflict, Storage and the Edge Function with an error. Before the page loads, put a session in `touchline-auth-v1` (`access_token` a JWT with `sub` and a future `exp`; the signature is never checked) and, for the posts list, `posts` in `touchline-online-v1`. Nothing reaches a real project.

**Keyboard.** Since round 3 a Playwright harness drives every mode from the keyboard alone: it presses Tab until the control it wants has the focus (failing when it never comes), checks every stop on the way shows a ring, is visible and is not inert or hidden, then presses Enter, Space or the arrows, and logs where the focus lands after each step (`<body>` there is a bug). The flows: the Quick Draft to the Summary and its cup night (both January choices: the case and the Upgrader), a Season to a live match (the 45' stop, a substitution made on the board with Enter, the arrows and Enter, the 70' stop, Finish), Dynasty to the summer, the Cup and the Gauntlet to their summaries, the hot-seat head-to-head to its result, the Run-in to its verdict, Explore, Profile and How it works. By hand: Tab through a whole quick season without the mouse: Home, Quick Draft, Start Draft, Space on Spin, Enter on Skip (the focus should land on the club's name), Tab into the squad, pick, Auto-complete, On to kick-off, Spin 3 managers, Skip, Pick (the focus should be on the first Pick), Open the case, Skip (On to kick-off should have the focus), Kick off, Skip to the end, See the summary. Every step should show a focus ring, and no Tab press should leave an open dialog.

**VoiceOver (iOS).** Settings, Accessibility, VoiceOver; or the Accessibility Shortcut (triple-click). Swipe through Home and a draft: every control should say what it is and what it does, the reel's landing should be read once, the score should be read once per goal in a live match, and a toast should be read. Rotor, Headings, to move between a screen's panels.

**Reduced motion.** macOS System Settings, Accessibility, Display, Reduce motion (iOS: Accessibility, Motion); in Playwright `browser.newContext({ reducedMotion: 'reduce' })` and check `document.getAnimations().filter((a) => a.playState === 'running')` is empty on each screen.

**Larger text.** iOS Dynamic Type will arrive as the root font size (section 5), so test with `html { font-size: 175% }` and `200%` at 390x844: nothing may run past the window (`document.scrollingElement.scrollWidth <= innerWidth`), and to find the culprit hide one child at a time from `<body>` down until the overflow goes (a grid item with long uppercase text is the usual one). The app's CSS is mostly in px, so the root size only grows the token-based text. iOS's text size reaches a web view through `-webkit-text-size-adjust` (what a text-zoom plugin sets), which scales every font size, px included; to simulate it in Chromium, scale each element's computed font size once (`el.style.fontSize = computed × 1.25` or `× 1.5`) and check, at 390 px wide, that nothing runs past the window (`document.scrollingElement.scrollWidth <= innerWidth`) and nothing overlaps.

**Touch targets.** At 390 px wide, list every visible control whose box (or its `::after` hit area) is under 44 by 44 px; anything under 24 px fails WCAG 2.5.8.

## 3. Results of the first pass

axe-core 4.10.2, WCAG 2.0 to 2.2 A and AA rules, the same 37 screen states at each size, the same flows on the same build before and after (dark theme). Counts are failing nodes.

| | 1280x720 before | 1280x720 after | 390x844 before | 390x844 after |
|---|---|---|---|---|
| Critical | 8 | 0 | 8 | 0 |
| Serious | 97 | 2 | 81 | 0 |
| `dlitem` (dt/dd outside a `<dl>`) | 42 | 0 | 42 | 0 |
| `color-contrast` | 23 | 0 | 29 | 0 |
| `aria-prohibited-attr` (a label on a span with no role) | 24 | 0 | 6 | 0 |
| `scrollable-region-focusable` | 8 | 0 | 4 | 0 |
| `select-name` (critical) | 4 | 0 | 4 | 0 |
| `aria-allowed-attr` (critical: `aria-pressed` on a radio) | 4 | 0 | 4 | 0 |
| `target-size` | 0 | 2 | 0 | 0 |

In Daylight the same flows (every screen at 390x844 including the Dugout tabs and the live match; Home to the Summary at 1280x720) found 0.

The `target-size` nodes are the match day's formation panels: two centre-backs' shirt buttons overlap on a small pitch. They only pick a man out (display), and the squad strip under them does the same with full-size cards, which is WCAG 2.5.8's "equivalent" exception.

Other checks on the same build (390x844 unless named):

- Keyboard landing: the draft's reel landed with the focus on the club's name (before: on `<body>` or the disabled Spin button), the manager spin on the first Pick, the case on On to kick-off, the January case on his first slot (before: `<body>` in all three).
- Touch targets under 24 px: 4 before (the setup cards' three "i" buttons at 18 px, the Advanced fold head at 21 px tall), 0 after; the top bar's pills went from 48x34 to 48x44 and its round buttons from 34 to a 44 px target.
- Larger text at 125 % and 150 %: before, the page ran sideways on Setup (15 and 72 px), the Draft (31 px at 150 %) and the manager spin (8 and 104 px), and Home's mode cards drew their picture over their text; after, nothing runs past the window on Home, Profile, How it works, Explore, Setup, the Draft or the manager spin, and the mode cards keep their picture in its square.
- Reduced motion: no running animation on any screen probed.
- The quick flow (Home to Summary, the first spin, the manager spin and the case driven from the keyboard) at 1280x720 and at 1920x1080 under reduced motion: no page error, and no page scroll on Home, the Draft, the manager spin, the case, Kick-off, the playback, January and the Summary.
- Vitest: 1,436 tests pass and 1 is skipped in 173 files (the new `src/ui/__tests__/a11y.test.ts` has 14); typecheck and build pass; the edge verifier bundle is still `verifier-37d256f009b3b3e9.js`.

## 3b. Results of the second pass

axe-core 4.10.2, the same rules, on the `a11y-pass` tip (before) and this branch (after), Floodlit and Daylight. Counts are failing nodes; each screen state counted once (its latest run). The new screens: 30 states (section 2's second-pass list) in Floodlit at both sizes, 26 to 30 of them in Daylight (the Dugout's player card and an arena final's replay were added to the flows after the first Daylight runs).

| New screens | 1280x720 Floodlit | 1280x720 Daylight | 390x844 Floodlit | 390x844 Daylight |
|---|---|---|---|---|
| Before | 58 (41 critical) | 60 (41 critical) | 56 (41 critical) | 58 (41 critical) |
| After | 2 | 2 | 0 | 0 |

What they were, and the fix:

- `label` (critical, 40): Dynasty's summer market, every listing's bid field had no name; it reads "Your bid for <player>, in £ millions".
- `color-contrast` (12): the Gauntlet's rungs still ahead were dimmed to 60 % opacity (4.06:1); a dashed outline instead.
- `scrollable-region-focusable` (3 to 5): the game-by-game lists of a head-to-head result and a Season summary, and the match day's stat flanks in an arena final's replay at 1280x720, scroll with nothing focusable inside; `.gbg-list` and `.md-flank > dl` joined `SCROLL_BOXES`. One more pass now runs 1.5 s after each burst of changes, for a box that starts to scroll with no DOM change of its own.
- `select-name` (critical, 1): the World board's country filter; named "Country".
- `target-size` (1): the Dynasty checklist's Info buttons at 390 px sat too close to each other; drawn at 24 px there.
- `target-size` (6, found by the final smoke on one seed): the Dressing room's groups list names inline, and on a phone a long group wrapped to lines 19 px apart; each name is 24 px tall there now (three more seeds clean).
- Left: `target-size` 2 at 1280x720, the match day's centre-backs' overlapping shirt buttons (section 4).

Round 1's 37 states, rerun on both builds (Floodlit): 1280x720 1 before (the same shirt overlap; it depends on the formation drawn) and 0 after; 390x844 0 and 0. In Daylight at 390x844 after: 0.

The offline build: a room link (`#h=...`) shows the toast "Online rooms need the online version of TouchLine." and stays on Home, and Head-to-head shows only the hot-seat setup (no "Play online" switch); both clean. Every flow above ran with no page error.

Other checks on the after build:

- Skip link: the first Tab at 1280x720 and 390x844 lands on "Skip to content" (shown at the top left), Enter puts the focus on the screen's page (`#main`), and the next Tab is Home's first mode card; one `role="main"` on every screen visited, following the screen as it changes; no page scroll at 1280x720.
- Phone targets at 390x844 (Home, Profile, How it works, Explore, Head-to-head, Privacy, the Run-in and arena setups, Setup, the Draft, the manager spin, Kick-off, the playback, the Summary): 258 of 540 controls under 44 px before, 6 of 552 after (the setup cards' three "i" by design, the two inline "change" links at 43 px, the Summary's Boxes at 42). In the Dugout what stays under 44 px is the squad's and planner's position and XI chips (33 px, rows of them, kept clear of each other) and, in the live match, the match day's own tool buttons, selects and tabs (31 to 32 px); nothing is under 24 px.
- Text at 175 % and 200 % at 390x844, 200 % at 820x1180 and 115 % at 1280x720: section 5.

## 3c. Results of the third pass

axe-core 4.10.2, the same rules, on `release-e6` (before) and this branch (after). Every state was reached from the keyboard alone (section 2's harness): 51 states a run (the Quick Draft 14 with its cup night, a Season 7 with a live match and a substitution, the Cup and the Gauntlet 4 each, the head-to-head 4, the Run-in 4, Dynasty 2, Explore, Profile, How it works and the head-to-head setup 4), at 1280x720 in Floodlit and 390x844 in Daylight, plus the Season flow at 390x844 Floodlit and 1280x720 Daylight. Counts are failing nodes.

| Rule | Before | After |
|---|---|---|
| `target-size`: the head-to-head draft's pitches (slot label boxes overlapping) | 7 to 10 | 0 |
| `target-size`: the Dugout's keeper slot on a short pitch | 1 | 0 |
| `target-size`: the match day's formation panel (section 4) | 1 to 2 | 1 to 2 |
| `color-contrast`: the match day's red rating pill (both themes) | 4 | 0 |
| `color-contrast`: a substituted man's card in the squad strip (faded to 50 %) | 3 | 0 |
| `scrollable-region-focusable`: the manager guide, the case locker, the arena summary's bracket, the head-to-head log | 1 each | 0 |

The Upgrader, left unaudited by round 2, was audited through the January Upgrader (choose, the dial turning, landed): 0 nodes in both themes and sizes; its words were added (section 1).

Two `color-contrast` nodes on the newest game row of a playback are the row's drop-in animation caught mid-fade (the same row passes once it lands) and are not counted.

Keyboard (before, on `release-e6`): every screen change left the focus on `<body>` (Home to the Draft, the Draft to the manager spin, the case, Kick-off, the playback, the Summary, the Dugout, the match, every arena step), as did a pick, Auto-complete, the January choices, the case's Open and Pick a manager; the head-to-head draft never moved the focus after a landing; the tab strips took one Tab stop per tab. After: the focus never fell to `<body>` in any flow except for the moment a reel spins (its Spin button is disabled; the landing then takes it); a screen change lands on the new page, and the steps in section 1 land where the next choice is. The substitution board was played from the keyboard alone: Enter on a bench card, an arrow onto a starter, Enter, Confirm, every step announced.

Larger text at 200 % on a 390 px phone, the quick flow (Home, Setup, the Draft, the manager spin, the case, Kick-off, the playback, January and its market): before, Setup ran 17 px past the window (Moneyball), the draft's squad 5 to 86 px (a "fits LB/CB/RB/DM/CM" chip), Squad complete 63 px ("Pundits' prediction" and the chance rows); after, nothing. Reduced motion: no animation running on any of those screens. Touch targets: nothing under 24 px but the visually hidden radios inside their cards and the Classic toggle's 15 px box inside its label (the label is the target); the draft log's grade buttons were 22 px wide and are 24.

Every flow ran with no page error and, at 1280x720, no page scroll. Vitest: 1,822 tests pass and 21 are skipped in 249 files (the new `a11yRound3.test.ts` has 9, `arenaText.test.ts` 2 more); typecheck, build, the first-download budget and `check:dist-keys` pass; `dist/edge` holds `verifier-37d256f009b3b3e9.js`, `verifier-603b905d0570f641.js` and `verifier-d0ebd30afcbcd00b.js`, unchanged.

## 3d. Results of the fourth pass

axe-core 4.10.2, the same rules, on `release-e7` (before, 00a5cc7) and this branch (after), on a build with placeholder `VITE_SUPABASE_*` values (so World, Account, the error-report setting and "Play with a friend" show) in Floodlit and Daylight at 1280x720 and 390x844, reduced motion on. The states: Home, Setup and Setup after a Shuffle, the head-to-head setup on both sides of its switch, every World tab (the Daily, the Weekly, All time, the 38-0 chase and the three casual boards), Profile with the sound and error-report settings, Explore (seasons, clubs, league, top players, search and its results, compare), the Quick Draft from the idle draft through the manager spin, the case, Kick-off, the playback and January to the Summary, a Season with the Continental Cup on (the Dugout, the digest, every tab: Inbox with the storylines, Next match with the preview, Europe with the groups, Cup, Squad, Planner, Stats, Club, the season's end), a live league match (playing, the 45' stop, the report) and a Dynasty to year 2 (the summer report, pre-season, the renewal list). About 200 states a side over the four runs (a step the harness timed out on, the phone Season among them, was run again on its own). Counts are failing nodes, all four theme and size runs together. 
| Rule | Before | After |
|---|---|---|
| `nested-interactive`: Explore's player rows held their compare and shortlist buttons inside the row's button (the seasons list 120, search results 36) | 156 | 0 |
| `target-size`: Explore's search results' shortlist star (18 px, 2 px from the compare button) | 30 | 0 |
| `target-size`: Explore's league page, the record holders and the ranked names (19 px rows 4 px apart) | 12 | 0 |
| `target-size`: the match day's formation panel (round 3's leftover, section 4), a live match and its report at 1280x720 | 6 | 0 |
| `color-contrast`: the Planner's and the Squad tab's depth chips for an unavailable man (opacity 0.45 and 0.55: 2.5:1 in Daylight, 2.8:1 to 3.6:1 in Floodlit) | 8 | 0 |
| `scrollable-region-focusable`: the Stats tab's records panel at 1280x720 | 2 | 0 |
| **Total** | **214** | **0** |

The formation panel's men are now their shirt alone as the button (24 px), with the rating pill and the name drawn outside the button's box and taking no pointer, so two centre-backs 28 px apart no longer overlap as targets; side-by-side screenshots of the old and new panels at 1280 and 1920 px in both themes put the shirts, ratings and names in the same places.

Not counted by axe, found by reading the new components and by the keyboard harness (before on `release-e7`, after on this branch):

- Every `Segmented` was an unnamed radio group of separate Tab stops that ignored the arrows: Profile's seven settings read "On, radio button" with no setting named. After: named, one Tab stop, the arrows choose (the harness: Tab reaches "Sound", ArrowRight turns it off and keeps the focus on Off, ArrowLeft back).
- Head-to-head's "Play with a friend" switch swaps the page: the focus fell to the rescue's first control. After: it stays on the switch (ArrowRight lands on This device, ArrowLeft back on Play with a friend).
- Shuffle changed the field under a keyboard user with nothing said. After: "Team name: Stonemere Thistle", once, polite.
- The renewal list's buttons were all "Offer terms" and "Let go", and Let go let a man leave with no question. After: named per man, and asked.
- The Continental Cup groups marked the qualifiers with a green edge and your side with an outline only, and read "MD 3" and "W 2-1" letter by letter. After: in words (section 1).
- Explore's shortlist star was a `span` with a button role, out of the Tab order on the seasons list. After: a real button, in the Tab order, beside the row.
- Storyline form chips read "W W D" ("double-u double-u D"). After: "won, won, drawn".

Larger text at 200 % on a 390 px phone (Profile, the head-to-head setup on both sides, Setup, Explore): before, Profile ran 19 px past the window (the Trophy cabinet's plaques, "Invincibles", at a fixed 76 px) and the hot-seat setup 23 px ("Start the head-to-head" on one line); after, nothing.

Contrast, both themes: besides axe on every state above, the kit colours were checked where they meet a panel. Text on a kit (badges, the match day's codes, shirts, the reel's cards) already takes `inkOn`/`textColourFor`; the xG lines take a casing (round 3); a kit swatch has a ring; the momentum bars and goal dots are stroked. A white or yellow kit in Daylight found nothing new.

Every flow ran with no page error (the harness's own timeouts aside), and a last smoke of the final build in both themes and both sizes (Home, Setup, Head-to-head, Profile, Explore and its views, a Quick Draft to its Summary, a live match to its report) found no page error and no failing node. Vitest (`--testTimeout=180000`): 2,092 tests pass and 22 are skipped in 285 files (4 skipped files; the new `a11yRound4.test.ts` has 12); typecheck, build, the first-download budget and `check:dist-keys` pass; `dist/edge` holds `verifier-37d256f009b3b3e9.js`, `verifier-5e7764386729eb13.js`, `verifier-603b905d0570f641.js` and `verifier-f088fc41409257f9.js`, unchanged.

## 3e. Results of the fifth pass

Round 5 (`claude/r9-a11y-names`, from `main` d76e552). Round 4 named the `Segmented` switches on Profile, Head-to-head, World, the Account switch, Explore and the Stats tables; 46 more were still unnamed radio groups (a screen reader read "Defensive, radio button, 1 of 3" with no "Mentality"): the Tactics tab's six instructions, training and the team talk, the quick season's tactics step, the match day's instructions drawer and its 45' and 70' stops, Setup (league, bench, era, opposition), the arena setup (format, size, field, wheel, league, era, difficulty) and the arena hub's team talk, the Run-in setup's brief and league, the online room's league, wheel and difficulty, the salary cap, the Draft's sort, the playback speed and the Stats switch. Each now carries the name its screen already prints beside it, through `t()` (new keys `sortPlayers`, `playbackSpeed`, `statsView`, `leagueChoice`). `Segmented`'s `label` is required, so TypeScript refuses a new unnamed one, and `src/ui/__tests__/a11yRound5.test.ts` parses every `.tsx` under `src/ui` (the TypeScript compiler's own parser) and fails on an unnamed `Segmented`, an unnamed `role="radiogroup"` or a button whose only content is icons with no `aria-label`; it found the 10 icon-only buttons already named. The Office's talk topics (a radio group built by hand) take the radio keys and one Tab stop.

axe-core 4.10.2, the same rules, on `main` before (with the names in, which axe does not test for a radio group) and on this branch after, on a build with placeholder `VITE_SUPABASE_*` values, reduced motion on, Floodlit and Daylight at 1280x720 and 390x844, 39 states a run: Home, Head-to-head on both sides of its switch, Explore, Profile, How it works, World, the Season, Run-in, Cup (with its more options) and Gauntlet setups, the Quick Draft's setup (and more options), draft, completed draft, playback and Summary, a Season's draft, the Dugout on each of its 13 tabs, a live league match, its 45' and 70' stops and the report. 156 states a side, with no page error.

| Rule | Before | After |
|---|---|---|
| `target-size`: a tip's "No more tips" link (19 px tall, 2 px under Got it) on the draft, the Dugout and the match day | 28 | 0 |
| `scrollable-region-focusable`: the match day's stat lists beside the pitch and on the report, at 1280x720 (content ending on a fractional pixel at the box's edge rounds to a scrollHeight 1 px over its clientHeight; the scroll-focus watcher allowed a pixel of slack, axe allows none: the watcher's test is now `overflows()`, any overflow) | 8 | 0 |
| **Total** | **36** | **0** |

Larger text, 200 % root size on a 390 px phone, both themes, every phone state above (the width past the window, before; nothing after):

- World 30 px: the heading's one long word ("leaderboard") and the foot's one-line "Sign in to post to the World board". The heading breaks a word only when it must (`overflow-wrap: break-word`), the foot's button wraps.
- The Run-in setup 79 px: its "Run-in of the week" and Back row never wrapped (it wraps).
- The Dugout's Office tab 58 px: the press conference's answers are one-line buttons (`.btn.press-answer` wraps).
- The Dugout's Club tab 66 px: the finance ledger's terms kept one line, leaving the figures no room; on a phone they wrap.
- The match day 19 to 50 px (playing, both stops, the report): the scoreboard kept its 112 px clock beside the score; on a phone the clock drops under it.

The harness finds the culprit by listing, at 200 %, the innermost elements whose box or text runs past the window with no clipping ancestor (text overflow counts: a `white-space: nowrap` button's box stays inside while its text does not).

## 3f. Results of the sixth pass

Round 6 (`claude/r10-i18n-a11y`, from `main` 869c434, 2026-10-29): the signed-in online screens, never audited before, and the translation gaps the pseudo-locale still showed.

**Signed in, with no Supabase.** A production build with placeholder `VITE_SUPABASE_*` values and a Playwright fake of the whole project at the network layer: a seeded session in `touchline-auth-v1` (an unsigned token: the client never checks the signature), and every Data API, Storage, Auth and Edge Function request to the placeholder host answered by the fake (the boards' RPCs with fifty rows and your own row inside them or at 72nd, the summaries, `profiles` with or without a row, `cloud_saves` with another device's game for the conflict, `profile_put` and `save_claim` failing for the error state). The real app runs signed in on it. States: Account signed in with this device's posts in every state (posted, waiting to retry, waiting for the account, posting, unranked, refused, closed, a chase post) and its top-bar menu open; the profile setup step of a new account; the save status failing; the World boards with your row pinned at the foot (Today's Daily, All-time, the 38-0 chase, the Daily Arena) and inside the list (the week's challenge, the Weekly Challenge); a conflict card (two different Quick Drafts, this device's and the cloud's). axe-core 4.10.2, the same rules, Floodlit and Daylight, 1280x720, 390x844 and 390x844 at 200 % text, reduced motion: 72 states, no page error.

| Finding | Before | After |
|---|---|---|
| `color-contrast`: your row on a board: the row's tint was laid twice (the row's and each cell's), and on the darker blue the "You" chip read 4.04:1 (Floodlit) and 4.38:1 (Daylight), the W of your W-D-L 4.26:1 and 4.21:1 | 16 | 0 |
| Phone targets at 390x844: the flag and favourite-club lists' rows (33 px), the account menu's items (36 px) and the signed-in round chip (34 px, no hit area) | 243 controls a state | 3 (the round top-bar buttons at 42 px with their hit areas, as before) |
| Text past the window at 200 % | none | none |

**Translation gaps.** The pseudo-locale (`en-XA`) over the screens rounds 8 and 9 added (`src/ui/__tests__/i18nR10.test.ts`: every Dugout tab before and in mid-season with the Office worked and player power on, the storylines, a Dynasty's summary, summer and club history, the Daily Arena, Weekly, Cup, Gauntlet and Run-in summaries and hubs, a newcomer's Home and first draft with the tips) showed up to 64 lines of English a render, nearly all of them lines the game logic writes for itself: the Inbox's news, the briefing, the dressing room's reasons, the planner, morale reasons, the Office's answers, round names, the pundit, the setup summaries. They now read through `logicLine()` (`docs/DESIGN_SYSTEM.md` section 17): none of those renders shows English any more. The signed-in screens (`i18nOnline.test.ts`, from the online store's states) printed the save status, this device's posts and a failed read in English (`src/online/core/status.ts`, `postText.ts`), a placeholder address, a raw phase and an ISO date in the cloud history, and totals in the device's number format: all through `t()` and `format.ts` now. The form guide's screen-reader words ("Form: won, drawn, lost") were English in `a11y.ts` and are now the `common` catalogue's.

## 3g. Results of the seventh pass

Round 7 (`claude/r13-a11y`, from `main` f30a767 with round 12's `claude/youthful-mccarthy-a57idu` merged, 2026-10-29): the game screens round 6 did not reach. Display only: no draw, no save field, ENGINE_VERSION `'7'`, the edge bundle still `verifier-ecc269657e48639b.js`.

**How.** A Playwright harness (outside the repo, like the earlier rounds') drives the game through the store's own screens on `npx vite preview`, reduced motion on, and at every state runs axe-core 4.10.2 (the same WCAG 2.0 to 2.2 A and AA tags), measures the page's width past the window and its height past a desktop window (the one-screen rule), logs where the focus is, flags a result coloured `.res-w`/`.res-d`/`.res-l` (or `data-outcome`) with no W, D or L or word beside it, and walks 40 Tab presses (every stop must be visible, not inert, not zero-sized and inside an open dialog, and never `<body>` but for the wrap past the document's end). A `MutationObserver` records every text a live region (`aria-live`, `role="status"`, `alert`, `log`) takes, so a moment read twice, or an assertive one, shows up. The flows:

- the Quick Draft: the idle draft, the reel landing, choosing, the completed draft, the manager spin (running and landed), the end case (idle, running, landed), Squad complete and Kick-off's tactics, the playback, January (its options, the January case idle, running and landed), the playback after January, a game's highlights, the Summary and both cup nights (the night, the trophy lifted, closed);
- a Season with the Continental Cup and Player power on: the Dugout before the season on every tab, a live league match on Watch (playing, the 45' stop, the substitution board from the keyboard: Enter on a bench card, an arrow onto a slot, Enter, Make changes; the 70' stop and Escape on it; the report), Sim 5 and its digest, the Dugout mid-season on every tab including the Office, the player card, Sim to the end and the Season summary;
- the Cup of 8 (the setup, the hub, a tie managed live through both stops, the reports, the summary) and the Gauntlet (the setup, the hub, rungs live and simulated, the bonus spin's draft, the reports);
- the Run-in (the setup, the draft, the hub, the summary);
- an arena shoot-out reached live: a save with a pending shoot-out (found by playing seeded Cup runs through the store) opens on "Penalties": the order (an arrow button moved from the keyboard), Take the penalties with Enter, the kicks' reveal and the result on the report.

Six runs: Floodlit and Daylight at 1280x720, at 390x844, and at 390x844 with `html { font-size: 200% }`: 603 states, no page error. Then a seventh pass of the fixes on the final build.

| Finding | Before | After |
|---|---|---|
| `color-contrast`: a Continental Cup side out of its group (the Season summary, the Dugout's Europe tab) faded its cells to opacity 0.6: a 16 px club badge's code at 3.1:1 to 4.2:1, the names and figures at 4.32:1 in Daylight; grey ink (`--text-2`, 9.2:1 and 9.8:1) and a greyscale badge now | 54 | 0 |
| `color-contrast`: the draft's "fits ST" and "can cover" chips on a hovered row in Daylight (4.3:1, 3.95:1) and the Office's "Agent: greedy" on the his-view box in Floodlit (4.31:1): a tinted chip there lays its tint over the panel | 3 | 0 |
| A Fixtures calendar week with no match faded to opacity 0.6 (no state met it; the rule is gone): a dashed edge | rule | 0 |
| The live region said a moment again: two regions swapped in the banner's place (React reuses them as one) re-read the booking before the assistant's word; the board mounts afresh after each stop and its new regions read the last moment again ("45' Coutinho is booked." twice, the 68' change twice); the assistant's 15' and 30' checkpoints can match word for word. One region (`banner-live`) through `useSayOnce` (`src/ui/liveOnce.ts`: each moment once, nothing said for what a region holds when it mounts), the score region too, the assistant's word with its minute | 1 to 4 a match | 0 |
| Escape on a stop pop-up minimised it to the Decisions pill and left the focus on the page | page | the pill |
| Closing a cup night after its Play gave way (Play becomes the result before the night opens) put the focus on the other cup's card | the other card | its own card (`data-focus-home`, `focusHomeOf`) |
| The page scrolled 65 to 209 px on the Dugout's Europe tab at 1280x720: the groups' `sr-only` words were `position: absolute` with no positioned ancestor inside the scrolling tab, so they hung below the window. `.sr-only` is pinned to its containing block's corner | 2 states | 0 |
| Past a 390 px window: the shot map's legend (6 to 12 px at 100 % text) | 2 states | 0 |
| Past a 390 px window at 200 % text: Kick-off's Simulate buttons (140 px), the end case's odds (6 px), the match report's stats table (145 to 195 px) and its Next button (80 px), the Office's chips (31 to 64 px), the Trophy Room's unlock rows (14 px), the Gauntlet hub's lifeline (12 to 109 px), the Fixtures calendar (10 to 16 px), the January position chart's rival key (37 px), the report's tactics overlay head (15 px), the Season summary's stat strip (3 px, "£152M" in a `1fr` column) | 35 states | 0 |

Keyboard: no stop without a ring, none inert, none outside an open dialog, and the focus never fell to `<body>` in any walk (Draft, manager spin, end case, Kick-off, playback, January, highlights, Summary and cup night, Dugout, the live match playing and at both stops, the substitution board, the report, the digest, the player card, the Season summary, the Run-in's setup, hub and summary, the arena hub, the shoot-out). After each step the focus landed on the next choice: the reel on the club's name, the manager spin on the first Pick, the case on On to kick-off, the January case on its first slot, a closed highlight on its own button, the digest on the waiting decision, a closed player card on his row, the substitution board's drop on the slot and Make changes on Make a change. Escape closed every sheet it met: Modal, DecisionSheet and the match day's drawers all go through `useDialog`; the save-elsewhere notice has no close on purpose.

Screen-reader names: axe's `button-name`, `link-name` and `label` found nothing on these screens. Every coloured result carried its letter or word (the playback rows, the cup ties, the Run-in's games, the Fixtures calendar, the digest, the shoot-out's "Won on pens"). Every live region was polite; none assertive. The shoot-out reads "J. Vardy takes kick 1." as the order changes and the last kick's line with the verdict.

At 200 % text after the fixes, a seventh pass on the final build (the Season in Daylight, the Quick Draft and the Gauntlet in Floodlit, all at 390x844 and 200 %; the Season in Floodlit and the Cup in Daylight at 1280x720; the shoot-out in Daylight at 200 %): no axe node, nothing past the window, no repeated announcement within a match.

Not a bug, noted: a save resumed at a pending shoot-out lands on the Live replay after Take the penalties (the report or replay toggle, `matchView`, is not saved; a live tie reaches the shoot-out from the report and stays there). The match report's score board breaks two long club names mid-word at 200 % text on a phone ("Ne wca stle"): it reads, and it fits.

Vitest: `src/ui/__tests__/a11yRound7.test.ts` (12 tests: `takeFresh` and `sayStep`, the banner's one region and the score's, `focusHomeOf`, the cup card's focus home, the stop pill, `.sr-only`, the chip tints, the group rows, every wrapping rule above).

## 4. What is left

After the seventh pass (round 7):

- **English left on screen, by design or for later.** The live pitch's caption pill (`aria-hidden`; the match commentary and the events' own text are translated since round 12, R11-O3), the data credits in How it works (the datasets' own titles and licences), and the share text and card (English on purpose). Everything else in the pseudo-locale is data.
- **The World boards' panels** are not `role="tabpanel"` (the tabs name their board and the table beside them has its own heading).
- **The match day's phone controls** (its tool buttons and selects, 32 px, and its phone tabs, 31 px) stay under 44 px: the compact match layout is fitted to the window height. They pass WCAG 2.5.8 (24 px).
- **iOS text size needs the wrapper.** The page is ready (section 5): `@capacitor/text-zoom@8.0.1` and three calls in the wrapper's start-up, waiting on the iOS PR.
- **The setup cards' "i"** stays 32 px, clear of its card's own target; the shortlist star and the Explore rows on a tablet (721 to 1099 px) keep their desktop sizes.
- **The live pitch is a picture** (`aria-hidden`); a screen reader follows the match through the score, the key commentary lines and the stops. No spoken play-by-play of every pass, by design.
- **Focus on a dialog's box.** `useDialog` focuses a dialog's own box when it opens, and the box draws the focus ring; a screen reader names the dialog, which is right, but a sighted keyboard user sees a ring round the whole sheet until the first Tab.
- **Not swept in round 5:** the arena hubs and summaries, Explore's sub-views, Dynasty and the head-to-head draft were not in round 5's harness (round 4's states for them were clean, and round 5 changed only names and wrapping on them); the new names were read from the markup and the test, not by VoiceOver.
- **Not audited:** a head-to-head room in play (it needs the live project and two devices; the signed-in screens were audited in round 6 against a network fake) and VoiceOver on a real device. The arena shoot-out was reached live in round 7 (from a seeded save).
- **Round 7's sweep stopped short of:** Dynasty, the head-to-head draft, Explore and the Daily, Weekly and Daily Arena setups (none of them is a game screen round 6 left out; rounds 4 and 5 swept them); the Gauntlet was capped at six rungs a run (the hub, rungs, a bonus spin and the reports met); the Season's own Cup tie live, the January window of a Season and the Dugout's Market bids were not driven. Run them before the App Store submission.

## 5. iOS Dynamic Type (the plan for the native wrapper)

A WKWebView does not follow the iOS text size by itself. The page is ready for it (second pass); the wrapper (`ios-native`, Capacitor 8, owned by the iOS agent, its PR undecided) does the native half. Nothing below is installed on this branch.

**The dependency.** `@capacitor/text-zoom`, pinned exactly: `npm i -E @capacitor/text-zoom@8.0.1` (published 2026-02-12, peer `@capacitor/core >=8.0.0`, so it matches the wrapper's `@capacitor/core` and `@capacitor/ios` 8.5.3), then `npx cap sync ios`. On iOS only `getPreferred()` is native: it returns `UIFont.preferredFont(forTextStyle: .body).pointSize / 17`, so 1 is the default size. Its `set()` is plain JavaScript that writes `-webkit-text-size-adjust` on `<body>`, which grows every px font size (the lockup's name but not its flag, the pitch labels, the reels): **do not call `set()`**.

**The mapping.** The preferred value goes on the root font size through `applyTextScale` (`src/ui/textScale.ts`, pure and tested), never through a text-size adjustment; `html` opts out of Safari's own inflation (`-webkit-text-size-adjust: 100%`) so the two cannot stack.

| iOS text size | Body pt | `getPreferred()` | Root font size, phone (< 1100 px) | Root font size, wide (1100 px and up) |
|---|---|---|---|---|
| xSmall, Small, Medium | 14, 15, 16 | 0.82 to 0.94 | 100 % (never below the design) | 100 % |
| Large (default) | 17 | 1 | 100 % | 100 % |
| xLarge | 19 | 1.12 | 110 % | 110 % |
| xxLarge | 21 | 1.24 | 125 % | 115 % |
| xxxLarge | 23 | 1.35 | 135 % | 115 % |
| AX1 | 28 | 1.65 | 165 % | 115 % |
| AX2 | 33 | 1.94 | 195 % | 115 % |
| AX3 to AX5 | 40 to 53 | 2.35 to 3.12 | 200 % (the cap) | 115 % |

The root size is a percentage, so it multiplies the web view's 16 px. What grows is everything set in rem: the `--fs-*` type tokens, which carry body copy, small text, chips, headings, buttons and inputs. What stays is drawn to a fixed geometry in px: the lockup, the pitches, the reels, the crests and the other text drawn to a fixed geometry, each marked `/* px: ... */` in the stylesheets (since `polish-visual` on 2026-10-26 every other component size is on the tokens, so the larger sizes reach every label; the top bar under 1100 px keeps 13 px like a tab bar, and the summary's record, the phone tier and January's W-D-L are capped by the window's width so they stay whole at 200 %). `data-text-scale` (the percentage) is set on `<html>` for any rule that must know.

**Where to call it.** In the wrapper's native start-up module (the one `ios-native` loads only when `Capacitor.isNativePlatform()`, beside its safe-area and status-bar set-up), as early as possible so the first paint is already at the reader's size, again when the app returns to the foreground (the reader may have changed the setting in Control Centre), and on a resize (rotation, iPad Split View), which can cross the 1100 px cap:

```ts
import { App } from '@capacitor/app'
import { TextZoom } from '@capacitor/text-zoom'
import { applyTextScale } from '../ui/textScale'

let preferred = 1
const readTextSize = async () => {
  preferred = (await TextZoom.getPreferred()).value
  applyTextScale(preferred, window.innerWidth)
}
void readTextSize()
void App.addListener('resume', () => void readTextSize())
window.addEventListener('resize', () => applyTextScale(preferred, window.innerWidth))
```

**What was checked** (Playwright, the root font size set in CSS, as above): at 390x844, 175 % and 200 % on Home, Profile, How it works, Explore, Head-to-head, Privacy, the Run-in and arena setups, Setup, the Draft, the manager spin, Kick-off, the playback, the Summary, every Dugout tab and the live match to half-time: nothing runs past the window after the second pass's wraps (before them: the Draft by 46 px, the manager spin by 27, the Summary by 33, Profile by 14, the Dugout's squad by 112, tactics by 153 and planner by 41 at 200 %). At 820x1180 (a tablet) at 200 %: the same screens, after the manager spin's edges wrap. At 1280x720 at 115 %: the one-screen fit holds and nothing is clipped beyond 100 %; at 135 % the page still does not scroll but the Setup cards crowd, which is why the wide layout is capped at 115 %. To check on a device: Settings, Accessibility, Display and Text Size, Larger Text, and drag to an accessibility size.
