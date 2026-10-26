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

## Next (ranked for round 2)

| # | Item | Kind | Impact | Effort | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dugout crowding on a short window: a pending dressing-room event ("Name your captain") is a full-width panel that leaves the tab body about 190 px at 2000x860 (the squad list shows two rows). Fold it into the briefing strip or a dialog | Bug | High | M | Low | `Dugout.tsx`; owner question 4 |
| 2 | Hindsight XI on the recap: the best XI the same spins could have given (pure from the draft log, as `pickGrades`), and the gap to yours. The 38-0 "what you could have had" moment | Feel | High | M | Low | Extends `draftRecap` |
| 3 | Draft grade in the share text and on the Summary banner ("Draft A") | Feel | Medium | S | Low | Share text is not seeded; owner question 3 |
| 4 | Squad complete's third box is mostly empty with the tactics folded: open them by default on a desktop, or move the bench there | Polish | Medium | S | Low | `KickOff.tsx` |
| 5 | Manager spin and end-of-draft case leave the lower half of a desktop window empty; the idle reel's "?" is cut by the needle | Polish | Medium | S | Low | `ManagerSpin.tsx`, `EndCase.tsx` |
| 6 | A synthesised sting when the recap's grade lands (gold for an A), on the reel's sound settings | Feel | Medium | S | Low | `src/ui/sound/` |
| 7 | The Draft's keeper label sits on the pitch's bottom edge at 2000x860 (the name over the goal line) | Polish | Low | S | Low | `Pitch.tsx` foot slot |
| 8 | The arena giants pass blocks the page about 0.9 s the first time (known issue): run it in idle slices, as the pre-season odds do | Perf | Medium | M | Medium | `giantsOf` memo; must not change the field |
| 9 | Arena hub at 1280x720: the opposition report's title wraps to three lines | Polish | Low | S | Low | Owned elsewhere since 2026-10-26 (Arena.tsx and OppositionReport layout) |
| 10 | Live match data always on (FM26's top complaint is a match day that feels like spectating): a slim momentum and xG strip pinned on the dashboard | Feel | Medium | M | Low | The match-day agent's files |
| 11 | Season playback: the faint "Into the top four" chip, truncated club names in game rows (known U19) | Polish | Low | S | Low | The fit-short agent's files |
| 12 | First Quick Draft coach mark for the recap and pick grades (what A to D mean) | Clarity | Low | S | Low | `tips.ts` |

## Owned by other agents (do not take)

Since 2026-10-26 the main session has given these to other agents: stale draft-turn modals (TL-02: `PowerUps.tsx`, `Upgrader.tsx`, the Draft's modals); rating labels across the card, slot preview and pitch (TL-03: `slotSheet.ts`, `Pitch`, `PlayerRow`); odds rounding (TL-08: `SpinOdds` and the other odds panels); Modal dialog semantics (TL-06: `bits.tsx` Modal, the digest); `Arena.tsx` and the OppositionReport layout; the player highlight on the live pitch (`matchday/SquadStrip`, `LivePitch`); and every engine and logic fix on the ENGINE_VERSION 5 branch (auto-subs, fixtures in `season.ts`, `autoPickLineup` and the assistant's placement, `development.ts`). Round 1 touched `PowerUps.tsx`, `Upgrader.tsx` and `Draft.tsx` (the power-up icons in 8fc9b95, the draft recap in 2b2f41f) and the arena hub's CSS (3890fe1) before that, each in its own commit.

## Research notes (round 1)

- **38-0** (the spin-the-wheel draft): players praise the Monte Carlo verdict and the hidden-ratings Expert mode; the moment that sells it is the reveal of how good the draft was. TouchLine's pick grades already judged each pick; the recap now judges the draft at the moment it ends.
- **Football Manager 26**: the common complaints are a match day without enough live data, and a UI that hides information and wastes screen space; the praise is for the match overview that puts the 2D pitch beside live data and staff advice. TouchLine's one-screen rule answers the second; round 1 fixed boxes where the key thing (the pitch, the main button) was out of view.
- The owner's report of things cut off at about 2000x860 to 930 matched the pitch boxes (Squad complete, Dugout) and the arena's calls.
