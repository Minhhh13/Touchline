# TouchLine: accessibility

What TouchLine supports for VoiceOver, keyboard-only play and larger text, how to check it, and what is left. The target is WCAG 2.2 AA where it is practical for a game, and no blocker for App Store review or for a player using assistive technology. The rules for new components are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) section 15.

First pass: 2026-10-26, branch `a11y-pass` from `main` at 301da2e.

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

- The type scale tokens (`--fs-xs` to `--fs-hero`) are in rem, so text set with them follows a reader's larger default font size; at the default 16 px they are the same 11 to 64 px as before.
- Phones (720 px and below): the top bar's pills are 44 px tall and its round buttons, the fold heads and the Info buttons take a 44 px target (the setup cards' "i" 32 px, clear of its card); player rows, the manager guide, the season picker and Home's figures wrap or give way under larger text rather than run off the screen.
- The desktop's one-screen fit is unchanged (every rule above that changes size is phone-only).

## 2. How to test

**axe-core.** Not a dependency. Fetch it into an empty scratch folder (`npm pack axe-core@4.10.2`, then `tar -xzf`) and inject `package/axe.min.js` with Playwright's `page.addScriptTag`, then run `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })` on each screen, at 390x844 and 1280x720. The screens: Home, Setup, the Draft (idle, the reel running, choosing, squad ready), the manager spin, the end case, Kick-off, the season playback, January (before and after its case), the Summary, every Dugout tab, the live match (playing, the 45' and 70' stops, the report), the arena setup and hub, Profile, How it works, Explore, Privacy and the head-to-head setup.

**Keyboard.** Tab through a whole quick season without the mouse: Home, Quick Draft, Start Draft, Space on Spin, Enter on Skip (the focus should land on the club's name), Tab into the squad, pick, Auto-complete, On to kick-off, Spin 3 managers, Skip, Pick (the focus should be on the first Pick), Open the case, Skip (On to kick-off should have the focus), Kick off, Skip to the end, See the summary. Every step should show a focus ring, and no Tab press should leave an open dialog.

**VoiceOver (iOS).** Settings, Accessibility, VoiceOver; or the Accessibility Shortcut (triple-click). Swipe through Home and a draft: every control should say what it is and what it does, the reel's landing should be read once, the score should be read once per goal in a live match, and a toast should be read. Rotor, Headings, to move between a screen's panels.

**Reduced motion.** macOS System Settings, Accessibility, Display, Reduce motion (iOS: Accessibility, Motion); in Playwright `browser.newContext({ reducedMotion: 'reduce' })` and check `document.getAnimations().filter((a) => a.playState === 'running')` is empty on each screen.

**Larger text.** The app's CSS is mostly in px, so `html { font-size: 150% }` only grows the token-based text. iOS's text size reaches a web view through `-webkit-text-size-adjust` (what a text-zoom plugin sets), which scales every font size, px included; to simulate it in Chromium, scale each element's computed font size once (`el.style.fontSize = computed × 1.25` or `× 1.5`) and check, at 390 px wide, that nothing runs past the window (`document.scrollingElement.scrollWidth <= innerWidth`) and nothing overlaps.

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

## 4. What is left

- **iOS text size.** The web view does not follow the iOS text size by itself. The Capacitor wrapper should read the preferred size and apply it, for example with `@capacitor/text-zoom` (`TextZoom.getPreferred()` then `TextZoom.set()`, which sets `-webkit-text-size-adjust`). The phone layouts were checked to 150 % with that kind of scaling; above it, long labels wrap more and some phone screens get long.
- **Most of the CSS is in px.** Only the type scale tokens are in rem; the 240-odd px font sizes in components follow text zoom but not a desktop browser's default font size. Browser zoom (Ctrl and +) works everywhere, which is what WCAG 1.4.4 asks.
- **The 44 px target is met on phones for the top bar, fold heads and Info buttons only.** Small buttons (`.btn.sm`, 36 px), chips (32 px with their hit area) and the setup cards' "i" (32 px) pass WCAG 2.5.8 (24 px) but not Apple's 44 pt guideline.
- **The live pitch is a picture.** The 2D pitch is `aria-hidden`; a screen reader follows the match through the commentary line, the score and the stops. There is no spoken play-by-play of every pass, by design.
- **The season playback's moment chip** fades to 35 % opacity as it ages (`moment-pop`), so an old chip is under 4.5:1; the moment is also said once and shown in the chase line.
- **The match day's formation panels** (above): their shirt buttons can overlap on a small pitch.
- **Home's lockup at 150 % text** runs past the hero on a 390 px phone and is clipped ("TouchLi"); the name is in the top bar and the page title.
- **No `<main>` landmark or skip link.** Screens are not wrapped in a `<main>` because the shell's CSS selects `.app > .page`; headings mark each screen's panels. A skip link to the screen's first heading is a small follow-up.
- **Not audited:** the online screens (Account, World, rooms), Head-to-head's draft and result, Dynasty's pre-season and summer, the Run-in, the Gauntlet's ladder and the arena summary, the Upgrader dial, the player card modal's tabs; and VoiceOver on a real device (the checks above are axe, Playwright and code reading). Run them before the App Store submission.
