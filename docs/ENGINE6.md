# Engine 6: the to-do list

What the gameplay sweep of 2026-10-27 found that needs an engine or draw change, so it waits for the next `ENGINE_VERSION` bump (engine 5 ships tonight and stays `'5'`). Each item has the evidence (seeds and counts), the root cause with file and line on `engine-e5` + `claude/polish-gameplay`, and a proposed patch. Nothing here is applied.

The bugs the sweep found outside the engine were fixed on `claude/polish-gameplay` with a seeded test each (see `docs/HANDOVER.md`'s change log): the Dynasty summer wheel overfilling the 23-man cap (every 22-man squad reached 24), a retired player redrafted as his younger self (a keeper who retired at 34 came back at 28), and the store's stop changes bringing on an injured or suspended substitute when asked (the dashboard hides them; the action did not refuse them).

## How the evidence was gathered

`src/game/__tests__/gameplay/` holds the sweep, skipped unless `GAMEPLAY_SWEEP=1` (`GAMEPLAY_N` scales the seed counts; the report lands in `.gameplay/`, gitignored):

- `recorder.ts` wraps the engine's `beginMatch`, `finishMatch` and `simulateMatch` with `vi.mock('@engine/match')`, so every match any mode plays is checked against its own live sheets (`hLive`/`aLive`): the score against the events, the half-time score, the whistle and the event order, each man once on the sheet and one man per slot, eleven at most, substitutions against `MAX_SUBS` and the events, a keeper-only man in an outfield slot, an unavailable man starting or coming on, every acting event (goal, card, injury, chance, save, assist) by a man on the pitch at that minute, red-carded men acting, stats against events. It reads only what the engine produced and draws nothing.
- `gameChecks.ts` checks whole games: cup rounds (none skipped, each round half the last, its sides the last round's winners), quick cup brackets, venue runs (TL-05) and balance, ratings, attributes, ages and wages in range, contracts and money, awards (winners in the squad, no man twice in the team of the season, the Golden Boot's figure), and ages and contracts across Dynasty summers.
- `quick.sweep.test.ts` (Quick Draft in random mode combinations, the cups after it, the Daily), `season.sweep.test.ts` (Season, and Dynasty five seasons each, a random manager working the store week by week, live matches with stops and in-play changes), `modes.sweep.test.ts` (the arena's final, Cup and Gauntlet, the Run-in, hot-seat head-to-head), `feel.sweep.test.ts` (every league-season with a real table played as an all-AI double round robin on both difficulties, and assistant-drafted Quick Drafts for the 38-0 chase).

Run: `GAMEPLAY_SWEEP=1 GAMEPLAY_N=2 npx vitest run src/game/__tests__/gameplay --maxWorkers=3` (about 25 minutes on four cores).

**The run of 2026-10-27** (`GAMEPLAY_N=2`, plus `feel.sweep.test.ts` at its defaults): 480 random Quick Drafts (every mode combination Setup allows, with the bench, the January window, the case and the cups) and 120 Dailies; 72 managed Seasons and 16 Dynasties of up to five seasons; 80 runs each of the arena's final, Cup and Gauntlet; 80 Run-ins; 80 hot-seat head-to-heads; every league-season with a real table (England, Spain, Italy, Germany, 2008-09 on) three times on each difficulty; and 900 assistant-drafted Quick Drafts. 929,195 matches through the recorder in all (446,543 in the store-driven modes, 140,652 in the all-AI leagues, 342,000 in the assistant's seasons).

## E6-1. A booking after the man has gone off injured

**Evidence.** 7,030 of the 929,195 matches (0.76%, about one in 130) show a booking at a minute after the booked man went off injured; every one is a yellow (a red man is never injured, and goals, chances and assists use `activeAt`). For example `gp-quick-0-0`: "QA XI 2-1 Newcastle United: 25' yellow A. Gordon (on 0, off 14 injured)"; `gp-season-0-0` mw 1: "Aston Villa 0-6 Leeds United: 39' yellow J. Ramsey (off 24 injured)". The match feed and the report show a card for a man already in the treatment room; when the injury falls before a booking in the same segment, `bringOn` also delays his replacement to the card's minute, so the side plays with ten for the minutes between.

**Root cause.** `src/engine/match.ts:1257-1313`, `disciplineAndInjuries`: the bookings are drawn first, each at `rng.int(from, to)` (line 1272), then the injuries at `rng.int(injuryFrom, injuryTo)` (line 1306) without regard to `p.cardAt`. `bringOn` (line 1423) then moves the substitution to `max(minute, off.cardAt)` while `p.offAt` keeps the injury minute.

**Proposed patch.** Draw the injury minute from after the booking, and skip the injury when that range is empty:

```ts
const lo = Math.max(injuryFrom, p.cardAt ?? injuryFrom)
if (lo > injuryTo) continue
if (rng.chance(pInj)) {
  const minute = rng.int(lo, injuryTo)
```

(the `continue` before the `chance` takes one draw fewer for such a man, hence the bump). Pin: `recorder.ts`'s `event-by-man-off-the-pitch` reads zero.

## E6-2. A drafted player still plays for his real club, sometimes against himself

**Evidence.** In 11,122 matches of the store-driven modes and the assistant's seasons, one human played for both sides (the user's pick and his own real club-season, or two seasons of him in the arena). The starkest case, the same player-season on both sides of one match: 1,759 matches. For example `gp-quick-0-0`: "E. Eze (s235794@2025@arsenal) for Arsenal and QA XI"; `gp-h2h-1`: "s245741@2024@everton for Bob and Everton". The user's striker scores for both sides in the feed, the match report lists him twice, and a quick season's Arsenal keeps the star the wheel gave away.

**Root cause.** `src/engine/season.ts:161-176`: `buildAiClubs` and `aiClubOf` give every AI side its whole real squad (`cs.squad`), and none of the callers filters out the humans the user drafted: `beginSeason` (`src/game/logic/setup.ts:386`), `quickLeague` (`src/game/logic/superLeague.ts:24`), the Run-in (`src/game/logic/runin.ts:129`), head-to-head (`src/game/logic/h2h.ts:43`), the quick cups (`src/game/logic/quickCups.ts:37`) and the arena's `arenaClub` (`src/engine/knockout.ts`). Only the transfer market removes a bought player from his old club (`src/game/logic/marketOps.ts:211`).

**Proposed patch.** An optional exclusion set on `aiClubOf`/`buildAiClubs`, by real player id, passed by every caller from the user's squad (and both managers' in head-to-head):

```ts
export function aiClubOf(u: LoadedUniverse, cs: ClubSeason, taken?: ReadonlySet<string>): AiClub {
  const squad = taken ? cs.squad.filter((p) => !taken.has(p.playerId)) : cs.squad
  ...
}
```

`autoPickLineup` already fills from what is left. The data has a smaller cousin of it: in the all-AI leagues 420 matches had one human on both sides, a player listed at two clubs in the same league-season (a January move); `buildLeague` could keep only his later club. Every AI side the user drafted from changes, so every seeded season moves: re-baseline the pins, the Daily's and the weekly's pinned results, and redeploy the function. Decide with the owner whether the arena keeps the old rule (a club-season there is a historical side, and two seasons of one club can meet).

## E6-3. Season, Dynasty and Run-in leagues drift to 3.6 goals a game and 99-point champions

**Evidence.** The same league-seasons played fresh (`feel.sweep.test.ts`, every England season on Calibrated) average 2.72 goals a game with champions on 85.2 points (real: 2.78 and 85.3). Managed through a season by the store they average 3.67 goals a game (Dynasty 3.78, Run-in 3.48), 11.9% of matches have seven goals or more (3.3% in a quick season, about 1.5% in the Premier League), draws fall to 16.9% (real about 25%) and champions finish on 100.4 on average over 98 managed seasons (median 101, highest 112) points. Measured on seeds `t1` and `t2` (2018 and 2012, Realistic): the mean expected goals of every AI pairing is 2.76 at kick-off of the season, 3.56 to 4.01 after five matchweeks and 3.88 to 4.25 at the end; Arsenal's strength climbs from 82.3 to 86.7 by matchweek 15.

**Root cause.** The AI sides' live state feeds back into their strength with nothing pulling it back:

- `src/engine/season.ts:416-418` (`applyMatchToState`): morale moves ±5 a result plus `(rating − 6.8) × 2`, clamped 10 to 100, and nothing returns an AI side's morale to the middle. `src/engine/ratings.ts:51` turns morale into ±4% on every unit and `ratings.ts:56` form into ±3%, so winners climb about 7% and losers fall about 9%.
- `src/engine/season.ts:174` starts every AI player at familiarity 70; matches take it to 95 within a few weeks (`ratings.ts:53`: +2.5%), on top of the calibration offset computed from the fresh sides at the start (`aiRatingOffset`).
- `src/engine/match.ts:1061-1069`: expected goals are `exp(K × (attack − defence))` with the top of the scale stretched above 80, so a wider spread of strengths raises the average (the function is convex) and the top sides' gains count 1.8 times.

The user's side has the same mechanics, but a manager rotates and talks; the AI never does.

**Proposed patch.** Three small changes, measured together with `feel.sweep.test.ts` and the season sweep until a managed season's goals per game, draws and champions' points sit within the real range (2.6 to 2.9, 23 to 27%, 80 to 92):

1. AI morale returns a third of the way to 70 each week (in `week.ts`'s weekly recovery for AI clubs, or a `recoverAi` beside `recoverWeek`).
2. AI sides start at familiarity 90 (real squads know their system) in `aiClubOf`.
3. Clamp the AI side's form term to ±1.5% (`liveModifiers` with an `ai` flag, or a separate `aiModifiers`).

## E6-4. Scores of 14-0 and 2-17

**Evidence.** 37 matches with a side scoring 13 or more (34 in the store-driven modes, two in the fresh leagues on Realistic, one in an assistant's quick season), 5,504 more with seven or more goals in all. Examples: `gp-season-0-17` mw 11 "Brighton & Hove Albion 2-17 Liverpool", `gp-season-0-4` "Brighton 0-14 Tottenham", `gp-runin-51` "Aston Villa 1-15 Liverpool", `gp-h2h-48` "Liverpool 14-0 Ann"; the fresh-league sweep's single largest tally on Realistic was 20 goals by one side. The Premier League record is 9.

**Root cause.** `src/engine/match.ts:1092` clamps a side's expected goals at 5.8 for the match, and `match.ts:1112` each segment's at 3.5, so the three segments allow up to 10.5 expected goals; E6-3's drift and E6-5's outfield keepers push sides there.

**Proposed patch.** A soft ceiling instead of the hard clamp, `lam = 4.2 × tanh(lam / 4.2)` (1.0 stays 0.99, 3.0 becomes 2.57, 5.8 becomes 3.70), with the segment clamp at `share × 4.2`. Check the elite XI's 38-0 rate (`perfectChase.test.ts`, 1.3% today) after it: the ceiling takes the most from mismatches.

## E6-5. An outfielder in goal for weeks when a one-keeper squad loses its keeper

**Evidence.** 775 matches in the store-driven modes started with an outfielder in goal for an AI side (176 of them in quick seasons, the rest in Season, Dynasty and the Run-in, where injuries carry over). For example `gp-season-0-2` mw 10 "Aston Villa: S. Petrov (CM)" in goal; `gp-runin-5` "Everton: S. Pienaar (LW)". The packs hold 188 club-seasons with a single keeper and two with none (`public/data/*/players.json`: England 31 with one, Spain 19, Italy 10, Germany 26, France 31, the Netherlands 33 and one with none, Portugal 38 and one with none). When that keeper is injured (keepers are never suspended, E6-6), `autoPickLineup` (`src/engine/ratings.ts:192`) puts the best remaining man in goal, his goalkeeping about 20, and the side concedes six or seven a week until the keeper is back.

**Root cause.** Data depth plus `aiTeamInput` (`src/engine/season.ts:184-193`), which fields only the real squad.

**Proposed patch.** In `aiTeamInput`, when no available keeper is left, field a generated reserve keeper (a fixed `PlayerSeason` per club-season, rated at the squad's fifth percentile, id `${clubId}@${season}@reserve-gk`, never in the universe's index so no draft or market sees him). Alternatively fix it in the data: `scripts/import/build.mjs` adds a reserve keeper row to every squad with fewer than two (a data rebuild, a new stamp).

## E6-6. Keepers are never booked; red cards are twice the real rate

**Evidence.** Across 446,543 matches: keeper cards 0; yellows 2.47 to 2.54 a match (Premier League about 3.5 to 4.2 since 2019, La Liga about 5), reds 0.20 to 0.21 a match (Premier League about 0.12 to 0.15).

**Root cause.** `src/engine/match.ts:1264` skips the keeper (`p.position === 'GK'`) in the discipline loop. The second yellow is `0.09 × halfF × aggF` per segment for a booked man (`match.ts:1277`) and the straight red `0.004 + 0.004 × defence share` (`match.ts:1284`), against a yellow base of about 0.07 + 0.09 × defence share per match.

**Proposed patch.** Book keepers at a fifth of an outfielder's rate (time-wasting, a late challenge); raise the yellow base to `0.10 + 0.11 × defence share`; halve the straight red to `0.002 + 0.002 × defence share`; keep the second yellow. Target 3.5 to 4 yellows and 0.12 to 0.15 reds a match on the feel sweep.

## E6-7. Every league scores like the Premier League's mean, and La Liga, Serie A and the Bundesliga fall short

**Evidence.** The fresh-league sweep (three runs of every league-season with a real table, Calibrated): 

| League | Goals a game (sim, real) | Draws (sim, real) | Champions' points (sim, real) | Bottom side's points (sim, real) | Rank correlation with the real table |
| --- | --- | --- | --- | --- | --- |
| Premier League | 2.72, 2.78 | 24.0%, 24.8% | 85.2, 85.3 | 26.8, 22.3 | 0.67 |
| La Liga | 2.30, 2.68 | 27.9%, 25.3% | 89.0, 86.2 | 29.1, 24.2 | 0.64 |
| Serie A | 2.28, 2.74 | 27.6%, 25.2% | 84.0, 84.4 | 27.8, 19.1 | 0.71 |
| Bundesliga (34 games) | 2.58, 3.07 | 25.7%, 24.2% | 79.0, 78.2 | 26.0, 21.8 | 0.57 |

On Realistic the champions run higher (91.7 in England, 94.3 in Spain) and a single match reached 20 goals for one side. Every league's bottom side is too comfortable by four to nine points: the bottom of each pack is rated closer to the middle than its results were.

**Root cause.** `src/engine/match.ts:302-303` `BASE_XG = 1.32` and `K = 0.055` are one constant for every league, and the Bundesliga's real 3.07 goals a game (2008-09 on) sits well above the Premier League's 2.78 while the sim's strengths in those packs have a wider spread.

**Proposed patch.** A per-league base in `leagues.json` or `meta.json` (`baseXg`, default 1.32), set from the real tables: about 1.32 England, 1.50 Spain, 1.52 Italy, 1.55 Germany (the packs without tables keep the default). The quick season, the Season and the arena (neutral, mixed leagues: the mean of the two sides' bases) read it through `MatchOptions`.

## E6-8. Game-logic draws that move Dynasty seeds (not engine files, same rule)

- **Contracts renew themselves.** `src/game/logic/dynasty.ts:122-128`: at zero years a player leaves only on morale under 50 or a 25% roll, otherwise he renews for two or three years without a word from the manager, so most contracts never really expire (59 times in the Dynasty sweep: a contract on one year reading three the next summer with no talks). Proposal: an expiring contract asks the manager (the Club tab's renewal list) and the player leaves unless renewed; or keep the roll but post an Inbox item before it. Changes the summer's draws.
- **The summer wheel's pool** now leaves out retired men (fixed here, `Game.retiredPlayers`); a man who left on an expired contract can still come back younger. Proposal: keep the age he left at and bar any season of him in which he is younger.

## The feel, measured (engine 5, for reference)

| | Quick Draft and Daily | Season | Dynasty | Run-in | Head-to-head | Arena Cup | Real (Premier League, 2008-09 on) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Goals a game | 2.75 | 3.67 | 3.78 | 3.48 | 2.87 | 3.06 | 2.78 |
| Home, draw, away | 44.1, 23.8, 32.1% | 45.9, 16.9, 37.2% | 46.2, 17.0, 36.8% | 46.3, 17.7, 36.1% | 44.7, 22.3, 33.0% | 45.6, 21.7, 32.7% | about 45, 25, 30% |
| Home and away goals | 1.53, 1.23 | 2.01, 1.66 | 2.08, 1.70 | 1.91, 1.57 | 1.59, 1.28 | 1.69, 1.34 | about 1.55, 1.23 |
| The weaker side wins (5+ overall apart) | 16.0% | 7.9% | 8.2% | 8.0% | 12.6% | 12.0% | |
| 0-0, 7+ goals | 7.6%, 3.3% | 5.0%, 11.9% | 4.5%, 13.0% | 5.4%, 9.8% | 6.6%, 3.9% | 5.7%, 5.6% | about 7%, 1.5% |

- **Title points.** A quick season's champions (whoever wins the league around the user) score 80 at the median (10th to 90th percentile 73 to 89); a managed Season's 100.4 on average (E6-3); the all-AI Premier League 85.2 on Calibrated against the real 85.3.
- **38-0.** 900 assistant-drafted Quick Drafts (300 each on Easy, Normal and Hard, 2025-26, Calibrated): no 38-0 and no unbeaten season; the league won in 223 (24.8%); wins 20 at the median, 25 at the 90th percentile, 34 at most; points 68 at the median, 105 at most. 480 random-play drafts: no 38-0, 28 wins at most. The elite XI of `perfectChase.test.ts` goes 38-0 in 1.3% of seasons. So the chase is reachable only with a near-perfect wheel: rare as designed, maybe too rare for a draft a player can actually make (a target for the E6-4 ceiling's retune, not a bug).
- **Discipline and injuries.** 2.5 yellows and 0.21 reds a match (E6-6), 0.36 injuries, 0.24 penalties scored, 0.07 own goals, 4.7% of goals in stoppage time, 5.8 to 6.1 substitutions a match.

## What the sweep found clean on engine 5

Over the same runs, none of these fired once: an impossible score below zero, a score that does not match its events, a half-time score that does not match, an event after full time or out of order, a red-carded man acting, a man twice on a sheet or two in one slot, more than eleven on the pitch, substitutions beyond `MAX_SUBS` or not matching their events, a keeper brought on outfield by an automatic change (TL-01), an unavailable man starting or coming on automatically (once by hand at a stop, now refused by the store), a home or away run longer than two (TL-05) or an unbalanced fixture list, a cup or bracket skipping a round or advancing a side that lost, a rating, attribute, age or wage out of range, negative money, a duplicated award, a Golden Boot figure that does not match the goals. Only the stops' own changes were made by hand (the sweep's random manager put a keeper up front on purpose; `keeper-outfield-by-hand` and `keeper-starts-outfield` on the user's side count those).
