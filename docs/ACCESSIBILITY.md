# TouchLine: accessibility

What TouchLine supports for VoiceOver, keyboard-only play and larger text, how to check it, and what is left. The target is WCAG 2.2 AA where it is practical for a game, and no blocker for App Store review or for a player using assistive technology. The rules for new components are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) section 15.

First pass: 2026-10-26, branch `a11y-pass` from `main` at 301da2e. Second pass: 2026-10-26, branch `a11y-r2` from the `a11y-pass` tip (44908c5).

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
  - the season playback: one line for a big moment ("Matchweek 12: Top of the league!") and one at full time (`playback-live`). The tally and the running strip are deliberately not live: they changed at every game.
- Landmarks: the top bar is the banner, and each screen's own `.page` is the main landmark (`role="main"`, `id="main"`, set by `watchMainLandmark` in `src/ui/landmarks.ts`, which follows the screens as they change). The shell's CSS selects `.app > .page` directly, so there is no `<main>` wrapper. The first Tab stop is a "Skip to content" link (`skip-link`), off the screen until it has the focus, which puts the focus on the screen's page (the next Tab is its first control) without touching the URL's hash.
- The Gauntlet's ladder is a labelled list whose rungs read as words ("Rung 3, won 2-1 v Stoke City"); a played rung shows its W or L beside the colour.
- After a reel lands the focus moves to where the choice is (`useFocusOnLanding`): the landed club's name in the draft (the squad is the next Tab stop), the first Pick on the manager spin, On to kick-off or the Icon's first slot on the case, his first slot or Keep my XI on the January case. It only moves when the focus had fallen to `<body>` or to a disabled control, never away from something the player chose.

**Keyboard.**

- Every control is a real `<button>`, link or form field, or answers Enter and Space as one (`pressable`, `isActivationKey`): Explore's club rows, the pitch's slots (a read-only pitch is a labelled image and takes no Tab stop).
- The reels and dials skip with Space or Enter while they run, and each has a Skip button; the substitution board takes Tab, the arrow keys, Enter and Escape as well as a drag or a tap (`SubBoard.tsx`).
- A box that scrolls with nothing focusable inside (a results table, the draft log, the privacy text, the end case's odds) joins the Tab order while it scrolls, so the arrow keys scroll it (`src/ui/scrollFocus.ts`; Safari does not make such boxes focusable on its own).
- The focus ring is the global 2 px `--focus` outline on `:focus-visible` and is never removed from a control.
- Hover cards (the player peek) and Info tips close on Escape (WCAG 1.4.13).
- `\` hides and shows the top bar (section 13 of the design system).

**Colour and contrast.**

- Every text pair in the token set passes 4.5:1 (DESIGN_SYSTEM.md section 3). Ink on a club's colour (badges, the match day's codes, shirts and discs, the reel's cards) is chosen by WCAG contrast (`inkOn`, `textColourFor`) and clears 4.5:1 on every colour: a mid red such as Arsenal's takes black, not white.
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

**Keyboard.** Tab through a whole quick season without the mouse: Home, Quick Draft, Start Draft, Space on Spin, Enter on Skip (the focus should land on the club's name), Tab into the squad, pick, Auto-complete, On to kick-off, Spin 3 managers, Skip, Pick (the focus should be on the first Pick), Open the case, Skip (On to kick-off should have the focus), Kick off, Skip to the end, See the summary. Every step should show a focus ring, and no Tab press should leave an open dialog.

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

## 4. What is left

After the second pass (round 2):

- **iOS text size needs the wrapper.** The page is ready (section 5): `@capacitor/text-zoom@8.0.1` and three calls in the wrapper's start-up, not yet made because the iOS PR is undecided.
- **Most of the CSS is in px.** Only the type scale tokens are rem, so Dynamic Type grows body copy, small text, chips, headings and buttons, but not the 245-odd component font sizes still in px (the match day's panels, the reels, the pitch labels, the summary's big figures). Moving them to the tokens, screen by screen, is the follow-up. Browser zoom (Ctrl and +) works everywhere, which is what WCAG 1.4.4 asks.
- **The match day's phone controls** (its tool buttons and selects, 32 px, and its phone tabs, 31 px) are under 44 px: the compact match layout is fitted to the window height, and growing them is left to the match-day owners. They pass WCAG 2.5.8 (24 px).
- **The match day's formation panels**: two centre-backs' shirt buttons overlap on a small pitch (axe `target-size`, 2 nodes at 1280x720, in the live match and an arena final's replay). The squad strip under them does the same with full-size cards (WCAG 2.5.8's "equivalent" exception).
- **The setup cards' "i"** stays 32 px, clear of its card's own target; the shortlist star and the Explore rows on a tablet (721 to 1099 px) keep their desktop sizes.
- **The live pitch is a picture.** The 2D pitch is `aria-hidden`; a screen reader follows the match through the commentary line, the score and the stops. There is no spoken play-by-play of every pass, by design.
- **Not audited:** the Upgrader dial, the online screens signed in (only their signed-out and offline states could be reached without the live project), a head-to-head room in play (needs two signed-in devices), and VoiceOver on a real device. Run them before the App Store submission.

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

The root size is a percentage, so it multiplies the web view's 16 px. What grows is everything set in rem: the `--fs-*` type tokens, which carry body copy, small text, chips, headings, buttons and inputs. What stays is drawn to a fixed geometry in px: the lockup, the pitches, the reels, the crests, and about 245 component font sizes still in px (converting those to the tokens is the follow-up that makes the larger sizes reach every label). `data-text-scale` (the percentage) is set on `<html>` for any rule that must know.

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
