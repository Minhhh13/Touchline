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

## Pending owner decisions (not taken)

- The draft grade in the share text and on the Summary banner ("Draft A").
- The duplicate "On to kick-off": the Draft's left box and the recap both carry it. Keep both, or drop the recap's?
- Home's waiting-games labels: mode first ("Quick Draft · Touchline XI") or team first.
- The pending decision as a dialog instead of the inline strip (round 1's question 4; round 2 kept it inline).
- Whether the Hindsight XI's gap ("1.7 short") should also go in the share text.

## Next (ranked for round 3)

| # | Item | Kind | Impact | Effort | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 54 player names carry a stray ",NN" from the European Soccer Database, nation UNK: "D. Cousin,20" (Hull 2008-10), "B. McCarthy,27", "P. Kenny,30", in all seven packs (5 England, 16 Portugal). Strip `/,\d+$/` in `scripts/import` and re-match the nation, then rebuild | Data | Medium | S | Medium | A rebuild: new `generatedAt`, `packHashes.json`, pins re-baselined, deploy after 00:00 UTC; the data owner's call |
| 2 | Two rating bases on one screen: pick grades, the recap and the Hindsight XI use `ratingAt` (attributes in the position), the pitch disc and slot picker `discRating` (overall × fit): the recap says "D. Rice 84 at CB" beside 88 on the pitch. Rate the recap with whatever TL-03 settles on | Clarity | Medium | S | Low | Wait for TL-03 (`slotSheet.ts`, Pitch); then `pickGrades.ts`, `hindsight.ts` |
| 3 | A coach mark for the recap: what A to D mean, and how to read the Hindsight XI's ticks and S5 spin tags | Clarity | Low | S | Low | `tips.ts` |
| 4 | Pre-season Dugout at 1280x720 with the coach mark showing: the youth intake shrinks to its head. A one-line intake (candidates as chips with Sign) would keep both whole | Polish | Low | S | Low | `Dugout.tsx` |
| 5 | A synthesised sting when the recap's grade lands (gold for an A), on the reel's sound settings | Feel | Medium | S | Low | `src/ui/sound/` |
| 6 | The arena giants pass blocks the page about 0.9 s the first time: idle slices, as the pre-season odds do | Perf | Medium | M | Medium | `giantsOf` memo; must not change the field |
| 7 | Squad complete: open the tactics by default on a tall desktop window (the third box still has room at 1920x1080 and up) | Polish | Low | S | Low | `KickOff.tsx` |
| 8 | Live match data always on: a slim momentum and xG strip pinned on the dashboard | Feel | Medium | M | Low | The match-day agent's files |
| 9 | Match day on a phone: the crumb ("Matchweek 1 · Derby day") is clipped by 5 px at 390 wide | Polish | Low | S | Low | `matchday/` (match-day agent) |
| 10 | Season playback: the faint "Into the top four" chip, truncated club names in game rows (known U19) | Polish | Low | S | Low | The fit-short agent's files |
| 11 | Arena hub at 1280x720: the opposition report's title wraps to three lines | Polish | Low | S | Low | Owned elsewhere (Arena.tsx, OppositionReport) |

## Owned by other agents (do not take)

Since 2026-10-26 the main session has given these to other agents: stale draft-turn modals (TL-02: `PowerUps.tsx`, `Upgrader.tsx`, the Draft's modals); rating labels across the card, slot preview and pitch (TL-03: `slotSheet.ts`, `Pitch`, `PlayerRow`); odds rounding (TL-08: `SpinOdds` and the other odds panels); Modal dialog semantics (TL-06: `bits.tsx` Modal, the digest); `Arena.tsx` and the OppositionReport layout; the player highlight on the live pitch (`matchday/SquadStrip`, `LivePitch`); and every engine and logic fix on the ENGINE_VERSION 5 branch (auto-subs, fixtures in `season.ts`, `autoPickLineup` and the assistant's placement, `development.ts`). Round 2 touched none of them except two lines of the pitch slot's CSS (the keeper's label, d9ff866) and `DraftRecap.tsx`, which only `Draft.tsx` renders (its call is unchanged). Round 1 touched `PowerUps.tsx`, `Upgrader.tsx` and `Draft.tsx` (the power-up icons in 8fc9b95, the draft recap in 2b2f41f) and the arena hub's CSS (3890fe1) before that, each in its own commit.

## Research notes (round 1)

- **38-0** (the spin-the-wheel draft): players praise the Monte Carlo verdict and the hidden-ratings Expert mode; the moment that sells it is the reveal of how good the draft was. TouchLine's pick grades already judged each pick; the recap now judges the draft at the moment it ends.
- **Football Manager 26**: the common complaints are a match day without enough live data, and a UI that hides information and wastes screen space; the praise is for the match overview that puts the 2D pitch beside live data and staff advice. TouchLine's one-screen rule answers the second; round 1 fixed boxes where the key thing (the pitch, the main button) was out of view.
- The owner's report of things cut off at about 2000x860 to 930 matched the pitch boxes (Squad complete, Dugout) and the arena's calls.

## Research notes (round 2)

- **38-0**: its pages sell the Monte Carlo verdict and the reveal of how good the XI was; the tips page weights the keeper heaviest (1.3×) and says even a flawless XI converts a perfect season about two times in three. The Hindsight XI answers the question every 38-0 player asks after the last spin ("what could I have had?") from the same spins, with no new draw. Sources: [38-0 tips](https://38-0-game.com/tips), [38-0 how to play](https://38-0.app/how-to-play), [Product Hunt](https://www.producthunt.com/p/38-0-pro/38-0-pro).
- **Football Manager**: decisions belong in context, not in front of the game; round 2 kept the dressing-room decision inline and made it small rather than a dialog, until the owner decides.
- The re-audit of https://touchline.quest (main, read only) at 2000x860, 2000x930, 1280x720 and 390x844: Home, Setup, the draft, the manager spin, the case, Squad complete, the playback, January, the summary, Explore, Profile, How it works, Head-to-head, a Dynasty pre-season Dugout and a live match to half time. No page error and no desktop page scroll anywhere; found the youth intake crowding (fixed), the stray ",NN" names (round 3 #1), the keeper's role on the playback's bench pitch at 1280x720 (fixed by #7) and the phone crumb (round 3 #9).
