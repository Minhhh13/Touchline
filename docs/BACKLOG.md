# TouchLine: improvement backlog

Kept by the continuous-improvement agent: each round researches (the live game played as a player would, at 1280x720, 1920x1080, 2000x860 to 930 and 390x844 in both themes; this repository's known issues; 38-0 and Football Manager), ranks what it found here, does the best small and safe items, and says what is next. Impact is what a player notices; effort is S (an hour), M (a day), L (more); risk is the chance of moving a seed, a save or a layout elsewhere.

Rules every item keeps: no `ENGINE_VERSION` bump and no seeded outcome moved; no new draw on a default path; new save fields optional; one screen per page from 1100 px wide; tokens, Lucide icons, no real crests or marks; a Vitest test for every behaviour; the UI decides nothing.

## Round 1 (2026-10-26): done

| # | Item | Kind | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Home: three waiting games (one current, two parked) squeezed the mode cards to 97 px at 1280x720, "Play today's puzzle" over the Daily Challenge title. Two or more strips now share one row on a desktop, led by the mode; the line is `resumeStatus` | Bug | High | S | Low |
| 2 | The pitch ran past its box: Squad complete (110 to 180 px of box scroll at 1280x720 to 2000x930, keeper on the edge, bench out of sight; a stale `.page.fit .pitch` cap matched nothing) and the Dugout (70 px at 2000x860). Both are size containers now | Bug | High | S | Low |
| 3 | The main call below the fold: the arena hub's Manage this one / Sim this tie (170 px under at 1280x720) and Squad complete's Simulate season (at 1280x720 and 1366x768). Sticky at the foot of their box | Bug | High | S | Low |
| 4 | Draft recap: the empty "All picks made" box becomes the draft's grade, verdict, tally, best pick, the one that got away and where the wheel went | Feel | High | M | Low |
| 5 | "1 seasons" on Home's Profile tile, "1 apps" on squad rows, the player card and the dressing room | Bug | Medium | S | Low |
| 6 | Power-ups drawn as emoji (tray, locker, draft log, case reel and odds; "©️" for the armband) become Lucide icons | Polish | Medium | S | Low |
| 7 | Match report goals: the assist wrapped mid-name ("E. / Konsa") | Bug | Low | S | Low |
| 8 | Phone Home: the casual tiles cut their line mid-word with no ellipsis; it wraps now | Bug | Low | S | Low |

## Round 2 (2026-10-26): done

| # | Item | Kind | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Dugout: a pending dressing-room decision was a 179 px panel above the tabs (tab body 234 px at 2000x860, one squad row; 104 px at 1280x720). On a desktop it is one 58 px strip (story cut to fit, choices inline, hints as tooltips, More opens the rest); tab body 371 / 249 px. Still inline, not a dialog (round 1's owner question 4) | Bug | High | M | Low |
| 2 | Draft recap: the Hindsight XI, the best XI the same spins held (exact search over the slot sets, pure, no draws), its rating against yours, your exact picks ticked | Feel | High | M | Low |
| 3 | Pick grades under Prime ratings (Setup's default) compared the pick at his career best with the rest of his squad at that season's rating, so grades and the recap ran high. Every man now goes through the same lookup | Bug | High | S | Low |
| 4 | Squad complete's third box: a scouting report (key man, weak link, out of position, age, pairs who know each other) and the manager's edge on this XI ("+1.5% goals · −1.0% conceded") | Feel | Medium | M | Low |
| 5 | Manager spin and case: the empty lower half is now "What a manager brings" (each style's edge on your XI) and, on the case, your locker's counts and what each item does; cards wait in place before their reel lands; the idle reel is a face-down card under the needle, so the "?" is whole | Polish | Medium | M | Low |
| 6 | Item reels kept their stop from the first measure: widen the window after a spin and the needle sat 84 px off the landed card (past the next one). They re-measure on a resize, as the draft's reel does | Bug | Medium | S | Low |
| 7 | The keeper's role ran over the goal line on the Draft's pitch (and the playback's bench pitch at 1280x720), and on a 200 px pitch his name ran past the edge, cut ("D. Henderso"). Name and role sit higher beside the disc, at most as wide as the room to the edge | Polish | Low | S | Low |
| 8 | Dynasty pre-season: the youth intake's stacked candidates left the squad list 44 px at 2000x860 and nothing at 1280x720 (tab body clipped by 154 px). Candidates side by side; on a short window the intake gives way first (found in the re-audit) | Bug | High | S | Low |

## Round 3 (2026-10-26): done

| # | Item | Kind | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | The owner's decision: the draft's grade in the quick-season share text and on the share card ("Draft grade B", the recap's own grade; `draftGradeLine`). The Hindsight XI gap stays out | Feel | Medium | S | Low |
| 2 | The owner's decision: one "On to kick-off" on the Draft, the left box's; the recap keeps its content and, up to 820 px tall, tightens so the Hindsight XI starts above its box's fold (140 to 92 px of box scroll at 1280x720 with the coach mark; none from 1366x768) | Polish | Medium | S | Low |
| 3 | 54 names with a stray ",NN" ("D. Cousin,20"): cleaned when the store loads the universe (`tidyUniverseNames`), so every screen, match text, the news, the share text and challenge views read "D. Cousin"; packs, stamps and the verifier unchanged; seeded games proven identical but for the names. Root cause and the rebuild fix in `docs/DATA.md` | Data | Medium | S | Low |
| 4 | A coach mark on the recap: what A to D mean, how to read the Hindsight XI's ticks and S5 tags (`draft-recap`, the eighth tip) | Clarity | Low | S | Low |
| 5 | Pre-season's youth intake is one 60 px line of chips on a desktop window up to 940 px tall: whole at 1280x720 with the coach mark (it scrolled 119 px inside itself), and the squad grid 165 to 286 px at 2000x860, 235 to 356 at 2000x930 | Polish | Medium | S | Low |
| 6 | Phone match day: the crumb clipped its Boxes button's phone target by 5 px; it shows now, and a long round label ends in an ellipsis | Polish | Low | S | Low |
| 7 | The arena's first field pass ran on the click (a 470 to 580 ms long task for a Giants cup): worked out in idle slices while the run drafts (`useArenaWarmup`, `arenaWarmup.ts`), now 56 to 98 ms; every run plays the same warmed or cold | Perf | Medium | M | Low |

The owner's other two answers stood as they were: Home's waiting games stay mode first, and the Dugout's pending decision stays inline as the strip with More.

## Round 4 (2026-10-26): done

| # | Item | Kind | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Two rating bases on one screen: the recap, the pick grades and the Hindsight XI now count a man by the pitch disc's number (`inSlotRating` = `discRating`), so "84 at CB" in the recap is the 84 on his disc; the share text's grade follows. Display only, no draw | Clarity | Medium | S | Low |
| 2 | Pre-season Dugout on a short desktop window: the panel's title, match-play chips and buttons share a row and the checklist runs across under them (174 to 120 px at 1280x720, the tab body +55 px; 271 to 199 px at 1100x700); the pitch column's floor is 150 px, so at 2000x860 with the coach mark the keeper is back inside the pitch box (it was about 60 px short). The "labels run together" half was already gone: under 200 px the pitch shows numbers only since #69 | Bug | High | S | Low |
| 3 | Arena hub: the calls lost their second card (it read as a panel in a panel), "Choose a captain" is whole beside the training focus, a tall window's pitch sits in the middle of its box instead of over an empty half (2560x1440), and the hub's opposition report is "Opposition report" (the first box names the opponent; it wrapped to three lines) | Polish | Medium | S | Low |
| 4 | World board at 1280x720: the side box's help is an Info tip up to 940 px tall, so no half line shows above the sign-in foot | Polish | Low | S | Low |
| 5 | A recap with no grade (a run-in's reinforcements, grades hidden) was "Squad ready" over an empty box; it lists the picks (position, name, overall unless hidden, season) | Feel | Medium | S | Low |
| 6 | Head-to-head draft: Manager 2's pitch started at the third box's foot at 1280x720 (his XI out of view); the two pitches share the box, the manager on the clock with more room | Bug | Medium | S | Low |
| 7 | The half-time and 70th-minute pop-up wrapped "Fire up" and "Attacking" onto lines of their own at 1280x720; each choice keeps one row | Polish | Low | S | Low |
| 8 | Copy: "in the La Liga 2008-09" (setup line, Daily and Weekly notices, a challenge banner) reads "in La Liga"; the quick summary's "your best run 1-0" is "best perfect start 6-0" and only from two games; the arena summary says "simmed" rather than "the assistant" | Copy | Low | S | Low |
| 9 | Phone Dugout: the tab strip ran under "Boxes" ("Tactics" cut); the control is its icon beside the tabs | Polish | Low | S | Low |
| 10 | Head-to-head setup: Difficulty's two choices stacked in their cell, out of line with Season | Polish | Low | S | Low |

## Round 5 (2026-10-26): done

| # | Item | Kind | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | The owner's decision on grades: a pick is measured against the best play its spin held for the open slots, counting the spins after it (the Hindsight XI's search, per spin), not the best man for his own slot. The assistant's draft averaged A on 99% of picks and 100% of drafts; over 200 seeded drafts per ratings mode it is now 28% A, 60% B, 12% C (picks 69% A, 19% B, 9% C, 3% D), a random draft a D. The number shown stays the pitch disc's; the share line reads the same grade | Feel | High | M | Low |
| 2 | The owner's decision on large screens: from 2200 px wide a 2160 px page cap (2560 from 3000), from 2200x1200 the type, space and control tokens a fifth larger; checked 1280x720 to 2560x1440 and 3440x1440 | Polish | Medium | S | Low |
| 3 | Kick off the season (and Play matchweek) paints Kicking off… first and plays the week after that paint: the click's interaction to paint 1216-1880 ms before, 208-544 ms after (4x CPU slowdown, loaded machine) | Perf | High | S | Low |
| 4 | The Weekly setup's right box: the theme's story, this week's result and best replay, the streak, last week and the four before | Feel | Medium | S | Low |
| 5 | The quick summary's one bright call (a cup on offer, else Copy result); found on the way, Skip it on an unloaded Continental Cup only toasted (`passQuickCup`) | Polish | Medium | S | Low |
| 6 | A reload during a live match picks the clock up where the tab left it, or at the stop, and says so | Feel | Medium | S | Low |
| 7 | Pre-season at 1280x720 with the coach mark and the youth intake: the two share a row, the squad grid 179 to 225 px, the keeper in view | Polish | Low | S | Low |
| 8 | A run-in's Draft pitch shows the XI the job will start with, signings included | Clarity | Low | S | Low |
| 9 | The live table's P counts finished games only (P 1 for the whole round at 1') | Polish | Low | S | Low |

## Next (ranked for round 6)

| # | Item | Kind | Impact | Effort | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Fix the ",NN" names at the source (strip the ESD suffix in `build.mjs` and `enrich-nations.mjs`, rerun the enrichment, rebuild, drop `tidyUniverseNames`) | Data | Medium | S | Medium | The data owner's call: a new stamp, `packHashes.json`, pins re-baselined, deploy after 00:00 UTC |
| 2 | The week after Kick off is still one long task (about 700 ms at 4x, then a save write of about 300 ms): split the match day's first build (`matchPath`, the ball path) from the mutation, and the save's compression into idle time | Perf | Medium | M | Low | `perf-pass`'s area (`afterPaint.ts`, `saveStorage.ts`); measure on a phone |
| 3 | Large screens: about 320 literal px font sizes do not follow the type tokens, so chips and small labels stay small at 1440p | Polish | Medium | M | Medium | Move the commonest literal sizes to `--fs-*` in small blocks; the accessibility agent's CSS area |
| 4 | Grades: show the best play on the pick's tooltip on a phone too (the log's `title` is hover only), and a "best play" mark on the Hindsight XI | Clarity | Low | S | Low | `Draft.tsx` (TL-02's modals are near), `DraftRecap.tsx` |
| 5 | The Weekly's record could show the week's world board rank once signed in | Feel | Low | S | Low | `src/online/api.ts` boards, offline fallback |
| 6 | Squad complete and the hubs: the assistant plays a CB-capable midfielder at CB (D. Rice −12) | Bug | Medium | S | Low | Engine 5's TL-04 (PR #65) |
| 7 | A reload resumes per tab only: another tab or the app after a cold start replays the segment | Feel | Low | S | Low | `resume.ts`; a save field would be a save-shape change |
| 8 | 1100x700 pre-season with the coach mark and the intake still leaves the grid its 120 px floor | Polish | Low | S | Low | Short-window CSS |
| 9 | Old Dynasty saves keep ",NN" in their aged copies; the playback's faint "Into the top four" chip and truncated club names (U19) | Polish | Low | S | Low | As in round 4's list |

## Owned by other agents (do not take)

Since 2026-10-26 the main session has given these to other agents: stale draft-turn modals (TL-02: `PowerUps.tsx`, `Upgrader.tsx`, the Draft's modals); rating labels across the card, slot preview and pitch (TL-03: `slotSheet.ts`, `Pitch`, `PlayerRow`); odds rounding (TL-08: `SpinOdds` and the other odds panels); Modal dialog semantics (TL-06: `bits.tsx` Modal, the digest); `Arena.tsx` and the OppositionReport layout; the player highlight on the live pitch (`matchday/SquadStrip`, `LivePitch`); and every engine and logic fix on the ENGINE_VERSION 5 branch (auto-subs, fixtures in `season.ts`, `autoPickLineup` and the assistant's placement, `development.ts`). Round 4 (the main session gave it the arena hub's polish) touched `OppositionReport.tsx` by one line (the title's name in a `.opp-of` span, hidden in the arena hub only), the arena hub's CSS, `ArenaSummary.tsx` by one word, a block in `matchday-controls.css` (the stop's segmented choices), `H2H.tsx` (a wrapper round each draft pitch), `DraftRecap.tsx` (the Tip's wording and a `Signings` list at the end, where the sound agent also hooks) and `WorldBoard.tsx`; never `Arena.tsx`, `Pitch`, `slotSheet.ts` or any verifier file. Round 5 touched `Draft.tsx` by three lines (the pick tooltip through `gradeNote`, the Pitch's `lineup` prop for a run-in's projected XI and a note under it; never `Pitch` itself), `DraftRecap.tsx` (the Tip's wording and the miss line), `CupRuns.tsx` (the Play button's class), `GameByGame.tsx` (one class), `MatchDashboard.tsx` (the resume hook) and `Dugout.tsx` (the busy kick-off button), each in its own commit, and no verifier file. Round 3 touched none of them except one line of `Draft.tsx` (the recap's call, which lost its button props, 075594b) and a CSS rule in `matchday-phone.css` (the crumb, 5d2a09d, allowed as tiny); the arena work is a hook in `App.tsx` and new modules, not `Arena.tsx`. Round 2 touched none of them except two lines of the pitch slot's CSS (the keeper's label, d9ff866) and `DraftRecap.tsx`, which only `Draft.tsx` renders (its call is unchanged). Round 1 touched `PowerUps.tsx`, `Upgrader.tsx` and `Draft.tsx` (the power-up icons in 8fc9b95, the draft recap in 2b2f41f) and the arena hub's CSS (3890fe1) before that, each in its own commit.

## Research notes (round 1)

- **38-0** (the spin-the-wheel draft): players praise the Monte Carlo verdict and the hidden-ratings Expert mode; the moment that sells it is the reveal of how good the draft was. TouchLine's pick grades already judged each pick; the recap now judges the draft at the moment it ends.
- **Football Manager 26**: the common complaints are a match day without enough live data, and a UI that hides information and wastes screen space; the praise is for the match overview that puts the 2D pitch beside live data and staff advice. TouchLine's one-screen rule answers the second; round 1 fixed boxes where the key thing (the pitch, the main button) was out of view.
- The owner's report of things cut off at about 2000x860 to 930 matched the pitch boxes (Squad complete, Dugout) and the arena's calls.

## Research notes (round 2)

- **38-0**: its pages sell the Monte Carlo verdict and the reveal of how good the XI was; the tips page weights the keeper heaviest (1.3×) and says even a flawless XI converts a perfect season about two times in three. The Hindsight XI answers the question every 38-0 player asks after the last spin ("what could I have had?") from the same spins, with no new draw. Sources: [38-0 tips](https://38-0-game.com/tips), [38-0 how to play](https://38-0.app/how-to-play), [Product Hunt](https://www.producthunt.com/p/38-0-pro/38-0-pro).
- **Football Manager**: decisions belong in context, not in front of the game; round 2 kept the dressing-room decision inline and made it small rather than a dialog, until the owner decides.
- The re-audit of https://touchline.quest (main, read only) at 2000x860, 2000x930, 1280x720 and 390x844: Home, Setup, the draft, the manager spin, the case, Squad complete, the playback, January, the summary, Explore, Profile, How it works, Head-to-head, a Dynasty pre-season Dugout and a live match to half time. No page error and no desktop page scroll anywhere; found the youth intake crowding (fixed), the stray ",NN" names (round 3 #1), the keeper's role on the playback's bench pitch at 1280x720 (fixed by #7) and the phone crumb (round 3 #9).

## Research notes (round 3)

- The re-audit of https://touchline.quest (main, read only, built 14:58 UTC) at 2000x860, 2000x930, 1280x720 and 390x844: Home, Setup, the draft, the recap, the manager spin, the case, the playback, January, the summary, a Season pre-season Dugout, a live match to half time, Explore, World, Profile, How it works, Head-to-head, the arena's setup and its hub, in both themes where the screen has its own colours (Home, Setup, the draft, the recap, the summary, the Dugout, the hub) and Floodlit elsewhere. No page error and no desktop page scroll anywhere. Found: the recap's sticky button covering the Hindsight XI at 1280x720 (gone with decision 2), the youth intake scrolled to its head at 1280x720 (round 3 #5), the phone crumb (#6), the pre-season pitch box and labels (round 4 #2), the arena hub's double border (round 4 #5) and the World board's half line (round 4 #8). The audit's other flags were false positives: the reel's clipped strips, the season drum's labels inside their window, sticky table heads over scrolled rows, and phone navigation labels hidden by design.
- Measured on this branch's build against the round 2 build (`vite preview`, the same steps): the arena click, the youth intake and the recap at 1280x720, 1366x768, 1920x1080, 2000x860, 2000x930 and 390x844, the phone crumb, the share text and card, and Explore's search for the faulty names ("D. Cousin,20" before, "D. Cousin" after). No page error.

## Research notes (round 4)

- Played on this branch's build (`vite preview`) with Playwright at 1280x720, 1920x1080, 2560x1440, 2000x860, 390x844 and 820x1180, plus 1180x820, 1366x1024 and 1024x768 (iPad landscape) for the iOS release: Quick Draft from Home to the summary (setup, the draft, the recap, the manager spin, the case, Squad complete, the playback, January, the summary), Season to a live half time, Dynasty's pre-season, the arena's Final, Gauntlet and Cup hubs and a Gauntlet to its summary, the Daily Arena, the Run-in from setup to its Dugout, Head-to-head setup and draft, the Weekly's setup, Explore, Profile, How it works and (on a build with a stand-in Supabase URL, every request refused) the World board. No page error, no desktop page scroll on any shell screen, no horizontal scroll at any size. Phones and the 820 px iPad stack and scroll as designed.
- The audit's clipped-box flags on the reels (the strip inside its window) and its overlaps between scrolled rows and sticky heads were false positives, as in round 3.
- Slow clicks measured: finishing a Season draft 284 ms (long tasks 178 and 233), Take over in the Run-in 185 ms, the arena's Sim to the end 251 ms; Kick off the season 1.5 s (round 5 #2).

## Research notes (round 5)

- The grade calibration ran on this branch over 200 seeded auto-drafts per ratings mode (England, 4-3-3): the per-spin regret (XI points left against the best play on the open slots, later spins each filling one slot with their best man) is 0 on about two picks in three for the assistant, 1 to 2 on one in five, 3 or more on the rest, so a draft of the highest rating who fits lands on B; a random pick from what fits grades D, a draft 60% assistant and 40% random C to D. A spin's best-man-for-his-slot gap is a floor of the new measure, so no pick grades higher than before.
- CSS `zoom` on the root was measured in Chromium 153 at 2560x1440: `100dvh` inside it resolves to 1800 px, so every shell page ran a fifth past the window; the large-screen step is tokens only.
- Played on this branch's build (`vite preview`, service workers blocked so every rebuild is fresh) with Playwright at 1280x720, 1366x768, 1920x1080, 2000x860, 2560x1440, 3440x1440 and 390x844: Quick Draft from Home to the summary (both cups passed), Season to a live match, a reload at 14', the Dynasty pre-season with an injected youth intake, the Weekly setup and a Run-in's reinforcements. No page error, no desktop page scroll.
