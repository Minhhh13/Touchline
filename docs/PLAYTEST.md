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

# Round 2 (2026-10-30, round 15)

The same exercise on `main` at round 13 (#99, engine 7), branch `claude/r15-playtest`, signed "Claude (r15 playtest)" in
the handover. Every mode played from a cleared save (or from the save a first result leaves, since Home shows the casual
row only after one) with Playwright on the production build: 390x844 touch and 1280x800, Daylight and Floodlit. A
screenshot at every step; no page error and no console error in any run; no desktop shell screen scrolled the page.

## 1. What was played

| Mode | Path | Device and theme |
| --- | --- | --- |
| First run | Home, Play your first draft, a spin, Auto-complete, kick-off, playback, January spin (kept the XI), Skip to the end, summary, Home after it | Phone, Floodlit |
| Quick Draft | Setup read through, bench 2, a spin, Auto-complete, the manager spin, the end case, kick-off's tactics, the playback, January, a bench change | Desktop, Daylight |
| The Daily | Setup and its rule chips, Auto-complete, playback with January, summary | Phone, Daylight |
| The Weekly | Setup (European Nights, W44), draft, season, summary | Desktop, Floodlit |
| Season | Setup, an 18-man draft, the Dugout, Sim to the next big match (stopped on a derby), the match by Sim result, its report, Sim to end, summary | Phone, Floodlit |
| Dynasty | Year 1 by Sim to end, On to year 2, the summer card, the summer draft, year 2's pre-season | Desktop, Daylight |
| Daily Arena | Home tile, draft, the Gauntlet hub, Sim to the end, summary | Phone, Floodlit |
| The Cup (16) | Setup, draft, the draw, Sim to the end, summary | Desktop, Daylight |
| The Gauntlet | Setup, draft, the lifeline's question, Sim this rung | Desktop, Daylight |
| Run-in | Setup (Survival), four signings, the Dugout, Sim to end, summary | Phone, Daylight |
| Head-to-head (one device) | Setup, 22 assistant picks, the season, the result | Desktop, Floodlit |
| Explore | Seasons view, Search, a player card | Phone, Floodlit |
| Trophy Room | Profile read through | Desktop, Daylight |

## 2. Findings and what was done

Fixed on this branch (display only: copy through the `t()` catalogues, a hint, a label; no draw, no save field,
ENGINE_VERSION `'7'`, the edge bundle still `verifier-ecc269657e48639b.js`):

1. **Auto-complete threw away the spin on the wheel without a word.** A first draft spun Brighton 2018-19 (Gyökeres 86 at
   the top of the list); Auto-complete logged it as "Skipped" and started from a fresh spin. The confirm now says so:
   "…and passes on Brighton & Hove Albion 2018-19, the spin showing now: pick from it first if you want one of its
   players." (`autoConfirmShowing`, Draft.tsx.)
2. **The odds panel's five colours meant nothing on a phone** (each tier's name was only in a hover title). A line
   under every odds panel: "Strongest first: Gold is Elite, Blue is Underdog." (`SpinOdds`, `oddsKey`.)
3. **Home's badge nudge read "Next badge: Globetrotter, 1 league won in to go".** Badges whose count reads badly before
   "to go" have their own words now: "a title in 1 more league to go" (Globetrotter, Cup Collector, Ironman;
   `nudgeLeft_*` in the home catalogue; the Trophy Room's counts are unchanged and still equal the engine's English).
4. **The manager spin's colours looked like the manager's quality.** They are the strength of the side he managed; only
   his style moves the XI. The spin's help says so.
5. **The end case said "One case per casual draft"** and the locker "without the power-up tray": neither phrase is used
   anywhere a new player has been. Now "One case for this draft" and "played with the Power-ups mode off".
6. **January spin's "70 v 74 (-4)"** for a DM against a 78-rated starter: the figures are both men's attributes for the
   position, not the overall on their badges. A line under the slots says so (`slotRatingKey`).
7. **The pitch labels' "LB · acc." and "awk."** (and the Dugout slot sheet's chips) are abbreviations nobody is taught.
   Now "cover" and "poor" ("poor fit" on the chip), the key to match.
8. **The Dugout's depth chart printed a different number from the pitch disc** for the same man in the same position
   (Lloris 78 on the chart, 85 on his disc): it showed his attributes for the position, which the design system says
   must be named as such. It now prints the disc's number, best first, and its tip says so.
9. **The Dugout header's "BOARD 60"** had no unit. Now "Board confidence" with a tip (out of 100, the board can sack you
   if it falls too low).
10. **The Daily's setup said "calibrated difficulty"** with no gloss. Now "its clubs calibrated so an average draft
    finishes mid-table".
11. **Setup's "League and season" read as the wheel's seasons.** A line under the leagues: "The season your XI plays,
    against its 19 other clubs. The wheel spins on the seasons under Era." (Season and Dynasty: "The season you manage".)
12. **The Daily Arena drops straight into a draft of 14** with nothing saying what for. Over the first spin of any arena
    draft: "Draft 14: an XI and a bench. Then climb fifteen real sides, each stronger than the last; one defeat ends the
    run." (the Cup and the final have their own line; `arenaSpinHelp`).
13. **The Run-in's draft said "Easy"** beside "Re-spin · 1 left" (Season's rules carry `difficulty: 'easy'`, the run-in
    keeps one re-spin), and **"Bench · 4 more picks"** with the bench tip beside "Signing 1 / 4". The rules chips now
    compare a run-in with Season's rules (no Easy chip), the box says "4 more signings, any position" and the bench tip
    stays away.
14. **The draft log's twist icons** (a clock, an arrow) had only a hover title, so a phone could not ask what they are.
    They are in the log's tap tips now, like the pick grades.
15. **Explore's 2026-27 table** (Manchester City top on 15 points) read as broken: the season list now marks it
    "(in progress)", as Setup does.
16. **The player card's position map** gave Henry 86 at ST beside his 90 overall with no word. A note under the map:
    "Each figure is his attributes weighed for that position, which can differ from the overall on his badge."

Larger ones, written up as proposals (each needs a change to bundled logic, the engine or a flow):

- **P1. Let Auto-complete pick from the spin on the wheel** (high). Today the store logs it skipped
  (`autoDraftRest` in `store.ts`, then `autoDraft`). Picking from it with `assistantChoice` first draws nothing new, but
  it changes what an Auto-completed draft holds, so it is a `FIX (moves draws):`-class change for the replays and pins
  that drive Auto-complete. Screenshot in words: the draft log on a phone, Brighton's badge at the foot with "Skipped" in
  grey under a list of eleven picks graded A to D.
- **P2. Start a bench man at kick-off** (high, round 7 left it open). The assistant benched David Raya (88) and started
  Dúbravka (83) in goal; the recap called it "A perfect draft" while its own Hindsight XI put Raya in goal. The bench
  can only be used once the playback runs: pause at matchweek 0 and use one of the three changes. A "Start him" on
  Squad complete's bench rows, free before game 1 (`quickChangeProblem` in `quick.ts`, bundled). Screenshot in words:
  Squad complete at 1280 wide, the XI's pitch with an 83 disc in goal, and under it the bench row "88 David Raya GK"
  with no button.
- **P3. The assistant's lineups put men out of position when a natural is free** (medium): Bruno Fernandes at DM
  (acc. −7) while Lukić, a natural DM, played CM (the Daily Arena); Hazard at RW (−5) with David Silva at LW (the Cup).
  `assistantLineup`/`autoPickLineup` in `ratings.ts`; engine 8 material.
- **P4. "Sim this rung" opens a replay from 0-0** (medium): the button reads like a result, the screen plays the match from
  kick-off at 4x, and the header's "Next: Rung 2 →" gives away the win before the replay shows it. Open a simmed rung on
  its Report tab, or hold the Next button's rung number until full time. Screenshot in words: the match day at 1280, a
  0-0 scoreboard at 02:30, "Replay" under Tactics, and a blue "Next: Rung 2 →" button top right; beside the pitch two
  empty boxes, "No league table in this competition" and "No other matches in this round".
- **P5. The 38-0 chase reads like a score** (low, round 7's #3 again): "Still perfect: 2-0", "Perfect run 4-0" sit beside
  real scores (7-1, 2-1). "2 wins from 2" would not. The words come from `perfect.ts` (bundled into the edge verifier
  through the quick season), mirrored on screen, so the change renames the bundle: hold it for a `BUNDLED:` commit.
- **P6. A reload loses the playback's place** (low): paused at matchweek 0 to make a bench change, a reload landed on
  January with nineteen games shown. Keep the watched matchweek per viewer (like the match day's `touchline-match-resume`).
- **P7. A landed spin spins again on a reload** (low): the Quick Draft's and head-to-head's reels replay "Opening…" for a
  club already on the wheel. Show it landed.
- **P8. Head-to-head has no Auto-complete for the whole draft** (round 7's #25): 22 taps of "Let the assistant pick".
- **P9. The scoring is loud for drafted all-star sides on Calibrated** (feel, engine): an auto-drafted Season squad went
  32-4-2 with 165 goals and beat Liverpool 10-0; a Dynasty year 1 ended 105-15. "Calibrated" promises that an average
  draft finishes mid-table, and the assistant's drafts are far above average. For `docs/ENGINE6.md`'s list.
- **P10. Small words** (low): the captain list's number is "mentality" at a Quick Draft's kick-off and "composure" on the
  arena hub; the Weekly's rules line still says "calibrated difficulty" (built in `weekly.ts`, mirrored); the Cup setup's
  line ends "in Chelsea colours" with no word on why; live tables print two-letter codes ("AR", "AV") where every other
  list prints three ("ARS"); a badge earned on one result but closed without "Got it" is shown as new on the next result,
  even a runner-up season; the Dynasty summer's bench tip shows under the summer card; the Run-in's three jobs change on
  every visit to its setup (a new seed each time), so a job seen and left is gone.

## 3. How to rerun

As round 1 (section 4 above). The helper used here kept each mode's save in a Playwright `storageState` file between
steps and printed every visible button with its `data-testid` after each action, so a step that a reload resets (the
January spin's chosen box, a paused playback) has to be driven in one run.
