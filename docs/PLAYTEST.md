# New-player playtest, round 7 (2026-10-27)

TouchLine played start to finish as a brand-new player would, from a cleared `localStorage`, with Playwright on the
production build (`npm run build`, `vite preview`), on a phone (390x844, touch) and a desktop (1280x720), a screenshot
at every step. Branch `claude/r7-playtest`, from `release-e6` (engine 6). Signed "Claude (r7 playtest)" in the
handover's change log.

## 1. What was played

| Mode | Path | Devices |
| --- | --- | --- |
| First run | Home's three steps, Play your first draft, a hand pick, Auto-complete, the manager spin, the end case, kick-off, the playback, January (spin and keep), a bench change, the summary, both post-season cups | Desktop and phone |
| Quick Draft setup | Every card read; started a draft from it | Desktop |
| The Daily | Setup, draft, kick-off, playback, January, summary, Home after it | Desktop, twice |
| The Weekly | Setup (European Nights, seven leagues), draft, season, summary | Desktop |
| Season | Setup, an 18-man draft, the Dugout, a live match (Watch at 4x, half time, the late stop, the report), Sim to end, summary | Desktop and phone (Dugout, live match) |
| Dynasty | Year 1 to its summary, On to year 2, the summer, the summer draft, year 2's Dugout and a match | Desktop |
| The Cup (16) | Setup, draft, the draw, Sim to the end, summary | Desktop |
| The Gauntlet | Setup, draft, the ladder, the lifeline's question, Sim to the end, summary | Desktop |
| Cup Final | Setup (size Final), draft, a live final simmed from the dashboard, summary | Desktop |
| Daily Arena | Home tile, draft, Sim to the end, summary | Desktop |
| Run-in | Setup (Survival), reinforcements draft, Sim to end, summary | Desktop |
| Hot-seat head-to-head | Setup, 22 picks through the assistant, the season, the result | Desktop |
| Profile, How it works | Read through | Desktop |

No page error and no console error in any run. No desktop shell screen scrolled the page at 1280x720.

## 2. Findings, ranked by how much they hurt a new player

High: the player is confused or loses trust.

1. **Every "are you sure?" was the browser's own box** (24 places: Auto-complete, Sim to end, Abandon, Discard, Release, Change the draw, starting over an unfinished run, Delete my data...): a grey system dialog headed with the site's address, and a system alert in the iOS web view. **Fixed**: the game's own dialog (`askConfirm`, `ConfirmHost`), worded buttons ("Abandon", "Sim to end"), danger in red, Escape and the backdrop say no, the focus goes back to the button.
2. **A bench change named nobody.** Choosing who the bench player replaces, the small pitch shows ratings only ("Tap the starter Haaland replaces" over eleven bare numbers). **Fixed**: the starters he can replace are listed as buttons by slot and name under the pitch.
3. **"Perfect run over at 1-0"** shown right beside "Lost 0-1 to Manchester United": read as a score. **Fixed**: "Perfect run over in game 2" (the game that ended it), the same wording the first-game case already used.
4. **A draft row's green "fits CB/DM/CM" for a midfielder** whose CB is only a cover, while the tip above says green is his own position and amber a cover. **Fixed**: a green "fits DM/CM" and an amber "can cover CB" chip.
5. **A finished game on Home said "Continue" and "Abandon … This cannot be undone"**, though its result is already in the record. **Fixed**: "See the result" and "Clear" (no question asked, a tip says the result stays in the Profile).
6. **Five unlabeled icons in the phone's top bar** (crossed swords, a magnifier, a trophy, a book). **Fixed**: a one-word caption under each icon (Home, Draft or Season, H2H, Explore, Profile, Guide) on a phone held upright; a phone on its side keeps the one-row icon bar.

Medium: the player hunts or guesses.

7. **The Daily card after playing** showed a bare flame and "1", and still pushed "Play it again" as the main button. **Fixed**: "Today: 59 pts" in place of the puzzle line, the streak's tip says "1 day in a row", and the replay is a plain "Play it again for fun".
8. **The Daily's and the Weekly's rule chips** ("Squad First", "Season ratings", "All-time", "Twists on") explained nothing. **Fixed**: each chip has a plain-words tip on hover, tap or focus (`ruleNotes.ts`).
9. **"On to kick-off" opened the manager spin**, then the case, then kick-off. **Fixed**: with the manager spin on the button says "On to your manager".
10. **The case's result wore two rarity scales**: "Purple · Decent" (the wheel's colour tier) beside "Rare". **Fixed**: the case's own rarity only, in its colour.
11. **The Daily Arena dropped straight into a draft called "The draft"**, nothing saying it was the Daily Arena or a Cup. **Fixed**: the draft's head names the Daily, the Weekly or the arena format in a chip.
12. **An extra-time winner printed as "Silva 90+8'"** in a tie marked "aet". **Fixed**: an extra-time tie's goals read 91' to 120'.
13. **The Season summary's game-by-game list opened scrolled to its foot**, matchweeks 1 and 2 hidden under its header. **Fixed**: a finished season's list opens at matchweek 1 (the list still follows a replay as it plays).
14. **Captain and penalty lists printed "M. Guéhi (63)"** for an 85-rated man (the number is his penalty skill). **Fixed**: "(pens 63)", "(mentality 79)", and the help says what the number is.
15. **Kick-off's tactics had "Simulate season" beside "Simulate with the default tactics".** **Fixed**: "Simulate with these tactics".
16. **The arena hub's "Plays at 75.5 (real 80.5) · you 76.9"** and the draw's "(s)". **Fixed**: "Their rating 75.5 here (real 80.5, calibrated) · yours 76.9" with a tip on calibration, and "(s)" explains seeding on hover.
17. **The same call, two words**: the Cup's "Sim this tie", the Gauntlet's and the Final's "Assistant plays it". **Fixed**: "Sim this tie", "Sim this rung", "Sim the final".
18. **The Run-in's four signings counted as "Pick 19 / 22"** with eighteen bars filled. **Fixed**: "Signing 1 / 4" and four bars.
19. **Half time's "No changes" next to "Play on"** with no difference given. **Fixed**: both buttons say what they keep in a tip.
20. **The summary's Draft again, Challenge a friend, Run it back and New game** with no hint of the difference. **Fixed**: each has a tip; the arena summary's Play again and New game too; "N places higher than the real side" explains which side.

Low: noticed, not changed.

21. Home's row of small tiles cuts its lines at 1280 px ("The Cup of 16 on the Prem…"); each already has the whole line as its tip.
22. The draft recap's tip is dense for a first draft (S5, ticks, "the target").
23. Bayern Munich and FC Barcelona both badge "FCB" in the Continental Cup (club codes from the packs).
24. The January sheet shows a starter's slot rating that can be well under his kick-off disc (Fernandinho 87 at kick-off, "80" in January) with no word on why (form and condition).
25. Head-to-head has no Auto-complete for the whole draft (only the assistant's pick, one at a time).
26. Both keepers wear yellow on the live pitch, and a light-blue user kit sits close to Manchester City's.

## 3. Left for others (bundled or engine files, out of this branch's reach)

- **Auto-complete benches its best man** (E. Haaland, 91, on the bench while M. Phillips, 77, starts at LW) and the recap then grades the assistant's choices as "you put him at CM": `src/engine/draft.ts` (`autoDraft`, `assistantChoice`). The recap's "you" lives in `src/game/logic/draftRecap.ts` and could name the assistant when `autoDraftRest` made the pick, if the draft log recorded that.
- **No way to start a bench man before game 1** of a Quick Draft: the kick-off screen lists the bench but a change can only be made once the playback runs (`quickChangeProblem` in `src/game/logic/quick.ts`, bundled). Pausing at once and bringing him on from matchweek 1 works.
- **An extra-time goal and a stoppage-time goal share minutes 91 and up** in a cup tie's scorers (`playTie` in `src/game/logic/quickCups.ts`, bundled): the display fix prints every minute of an extra-time tie plainly.

## 4. How to rerun

`npm run build`, `npx vite preview --port 4173 --strictPort`, then a Playwright script that clears `localStorage`, sets `touchline-match-speed` to `4` and `touchline-key-moments` to `off`, and drives each mode by its `data-testid`s (CLAUDE.md, "Playwright smokes"). The yes-or-no questions are now in the page: answer them with `[data-testid="confirm-ok"]` or `[data-testid="confirm-cancel"]`, not a `dialog` handler.
