# Engine 9: playtest round 2's proposals that move draws

Branch `claude/r16-engine9`, prepared on 2026-10-30 (round 16). It stacks on engine 8: branched from `claude/r10-engine8` at 5e04f67, with `main` at #101 (05e0c05, round 15) merged in so the fixes are built on today's code. `ENGINE_VERSION` `'9'`. Not released; the release notes are at the end and in [ONLINE.md](ONLINE.md) section 7, "Release engine 9".

The candidates were the proposals of [PLAYTEST.md](PLAYTEST.md) round 2 that move seeded outcomes: P1, P2, P3 (built) and P9 (measured; a calibration is proposed below, not built).

| | What | Where | Commit |
|---|---|---|---|
| bump | `ENGINE_VERSION` `'8'` to `'9'`, engine 8's bundle served for `touchline-e8` | `src/engine/version.ts`, `public/edge/verifier-3253bc81bf95d2ed.js` | `Engine 9: ENGINE_VERSION '9'…` |
| P1 | Auto-complete picks from the spin on the wheel | `autoDraft`, `discardSpin` in `src/engine/draft.ts`; the store's `autoDraftRest` | `FIX (moves draws), BUNDLED: Auto-complete picks…` |
| P2 | A bench man who outrates a starter starts at kick-off | `startBetterBench` in `src/game/logic/quickBench.ts`, called by `quickXI` | `FIX (moves draws), BUNDLED: a bench man who outrates…` |
| P3 | The assistant's lineups swap naturals into place | `assistantLineup` in `src/engine/ratings.ts` | `FIX (moves draws), BUNDLED: the assistant's lineups swap…` |
| P9 | Measured: the scoring of drafted all-star sides | `src/game/__tests__/gameplay/scoring.sweep.test.ts` | `P9: the scoring sweep…` |

The engine pins (`pins.test.ts`, the quick wheels, the head-to-head log and the assistant's `flow-test` season) held through all three. The bump alone moved nothing (the pins, `gameByGame`'s table and the Super League pins held with only their version literals changed). Each fix commit re-baselines what it moves.

## P1. Auto-complete picks from the spin on the wheel

**What it fixes.** Auto-complete logged the spin showing as skipped and the assistant spun again, so the club the player had just landed was thrown away (the playtest: Brighton's badge at the foot of the draft log with "Skipped" in grey). `autoDraft` now makes the spin showing the assistant's first pick through `assistantChoice`, which draws nothing, and discards it (the old skipped row, now `discardSpin`) only when nobody on it is usable. The store's `autoDraftRest` no longer discards it first.

**Measured** (`src/engine/__tests__/autoDraftShowing.test.ts`): over 160 drafts in four rule sets (Quick Draft, Position First, a bench of 3, Season) with a spin showing, every draft equals picking the assistant's man by hand and then auto-completing, game state and stream alike; the spin showing was picked in all but a handful (engine 8 discarded every one). Over 200 drafts the XI's mean in-slot rating was 81.97 on engine 8 and 82.04 on engine 9: one pick from a given spin instead of a fresh one leaves the side as strong.

**What it moves.** Re-baselined in its commit: `challenge.test.ts` and `rules38.test.ts` (their Auto-complete now drafts from the spin showing). Every Auto-complete started with a spin showing: one spin fewer, so every later spin of that draft lands elsewhere. A draft auto-completed from nothing showing, the Speedrun's assistant turn (which already picked from the spin showing), the quick wheel pins and the Daily's puzzle hold. A challenge link of such a draft carries a pick row where it carried a skipped row; replays are exact either way.

## P2. A bench man who outrates a starter starts at kick-off

**What it fixes.** The assistant benched David Raya (88) and started Dúbravka (83) in goal: a Quick Draft's bench is drafted once the XI is full, so a better man drafted later sat on the bench, and the recap's own Hindsight XI put Raya in goal. `quickXI` now ends with `startBetterBench` (pure): a bench man starts in a slot where his rating at its position (`ratingAt`) beats the starter's, under the injury cover's rules (the draft's position rule; never a keeper-only man outfield), the largest gain first, until none does; the starter takes his place on the bench. Kick-off, the season, the pre-season odds and the playback all read `quickXI`, so they agree. The player can still bring the benched man back with one of the season's three changes.

**Measured** (`src/game/__tests__/startBench.test.ts` and a 150-season run, England 2025-26, Calibrated, the assistant's drafts with a bench of 3, managers off): a bench man starts in 116 of 120 assistant bench drafts, the XI's total in-slot rating up 13.8 when he does. Over 150 seasons: 72.2 points on engine 8, 76.5 on engine 9; goals 72.2 to 78.9 for, 39.1 to 38.0 against; titles 60 to 77 of 150; no 38-0 either way. After the change no bench man outrates a starter where the rules let him play (checked over 120 drafts in three shapes, one with natural fits only).

**What it moves.** Re-baselined in its commit: `managers.test.ts`'s `mgr-pin-4` (a bench of 3: 84 points to 67 on that one seed) and `quickBench.test.ts` (it reads the kick-off XI through `quickXI`). Every Quick Draft season with a bench (the season, its January window, cups, odds and highlights). A quick season without a bench is untouched: the Daily (squad of 11), the Weekly, the chase and every pinned quick season hold. A bench season kicked off on engine 8 in a save is played again by its own engine check (`quickSeasonStale`), as for any engine bump.

## P3. The assistant's lineups put naturals in their positions

**What it fixes.** Bruno Fernandes at DM (acc. −7) while Lukić, a natural DM, played CM (the Daily Arena); Hazard at RW (−5) with David Silva at LW (the Cup). Round 6's repair in `assistantLineup` tried only the men left out of the XI. It now also swaps a cover with a natural for his slot who plays elsewhere in the XI, when the swap raises the XI's total (the same score as the greedy: role rating at the slot times condition and sharpness). Every move still strictly raises the total, so it ends; the rounds' bound is doubled for the extra moves.

**Measured** (`src/game/__tests__/naturalSwap.test.ts`, 200 assistant-drafted squads over five shapes, Season squads and Quick Draft squads with a bench of 5): the greedy left a swap that helps in 24 XIs; engine 8's repair still left one in 14; engine 9 leaves none. Two covers each standing in the other's natural slot: 13 greedy, 3 on engine 8, 0 on engine 9. The XI's total never falls below the greedy's.

**What it moves.** Re-baselined in its commit: `assistant.test.ts`'s `nochange-0` (the other five hold), `marketPin.test.ts`'s game window, `noMove.test.ts`'s Season hash (its Quick Drafts and Dailies hold), and `officeView.test.ts`'s promise clock now benches the weakest reserve (the week's auto-pick put the old choice back). Every lineup the assistant picks: Season and Dynasty hubs (`autoPick`), Auto-play and Sim result, simmed arena steps, the Run-in's assistant (the Run-in of the week's replay included), Auto-pick on the Squad tab. AI clubs keep `autoPickLineup`, so the AI leagues and their calibration do not move. A Quick Draft's drafted placement is the player's and stays (only P2 touches it).

## P9. The scoring of drafted all-star sides on Calibrated: measured, calibration proposed

The playtest saw an auto-drafted Season squad go 32-4-2 with 165 goals and a Dynasty year 1 end 105-15. Measured before deciding, with the gameplay sweep and a sweep written for this (`scoring.sweep.test.ts`, `GAMEPLAY_SWEEP=1 GAMEPLAY_N=2 npx vitest run src/game/__tests__/gameplay/scoring.sweep.test.ts`; report in `.gameplay/scoring.txt`).

**The engine against real tables** (2,532 club-seasons of England, Spain, Italy and Germany from 2008, each played fresh at full strength twice; gap = the club's team strength minus its league's mean):

| gap | clubs | engine goals/game | real goals/game | engine points/game | real points/game |
|---|---|---|---|---|---|
| below −4 | 254 | 0.80 | 0.98 | 0.87 | 0.86 |
| −4 to 0 | 1,180 | 1.12 | 1.17 | 1.12 | 1.13 |
| 0 to 3 | 598 | 1.57 | 1.53 | 1.52 | 1.51 |
| 3 to 6 | 366 | 2.00 | 1.88 | 1.97 | 1.95 |
| 6 to 9 | 134 | 2.73 | 2.46 | 2.40 | 2.34 |

Fitted lines: goals for a game, engine 1.41 + 0.146 × gap against real 1.41 + 0.113 × gap; points a game, engine 1.38 + 0.126 × gap against real 1.38 + 0.121 × gap. The 20 strongest real sides (gap 8.3): engine 3.08 goals a game and 96.9 points over 38, real 2.48 and 88.4. The gameplay sweep's league-wide figures are right (2.83 goals a game on Realistic against 2.83 real, 2.78 on Calibrated; draws 23.5 to 24.6% against 24.8%), but a fresh Realistic league's champion finishes on 90.3 points against a real 83.5.

**The drafted sides:**

- The assistant's Season (England 2025-26, 24 seasons each, managed by the assistant): on Calibrated a kick-off gap of 4.3 over the AI's calibrated mean, 3.28 goals a game (125 a season), 0.71 against, 97.8 points; on Realistic a gap of −1.8 and still 1.96 goals a game and 68.8 points. A probe of six Calibrated seasons: the side's team strength rises from about 79 at kick-off to about 85 by matchweek 20 (morale, form and familiarity grow for the user's side), while engine 6 froze the AI's (about 80.7 less the calibration's 6.0, so 74.7). The effective gap in mid-season is about 10, beyond any real side's.
- The assistant's Quick Draft (no bench, Calibrated, 80 seasons): gap 5.0, 1.78 goals a game, 70.2 points; no live state, so its scoring sits on the engine's line. The gameplay sweep's assistant quick seasons: 68 to 69 points, a title in 23 to 27% (engine 8).

**What the numbers say.** Two causes, both real: (1) the engine's goals rise with strength about 30% faster than reality's (0.146 against 0.113 a gap point), while its points rise at the right rate, so a dominant side wins as often as a real one but by more; (2) in Season and Dynasty the user's side grows by about 5 strength points through the season while the AI sides are held, and Calibrated takes 6 points off the AI, so a strong draft plays at a gap no real side reached. P9's 165 goals is (1) applied to (2).

**Proposal, not built here** (each moves every match, so it needs its own measured round and the owner's call on how dominant a great draft should feel):

1. **Flatten the goal curve at the top, not the win curve.** In `match.ts` the expected goals are `base × exp(K × (attack − defence))`; bend the exponent above a gap of about 3 (for example `K × d` for d ≤ 3 and `K × (3 + 0.75 × (d − 3))` above) or lower `XG_KNEE` from 3.5 towards 3.0. Target, measured with `scoring.sweep.test.ts`: the goals slope near 0.113, the 6-to-9 bin near 2.46 goals a game, the points slope unchanged (0.12 to 0.13), league goals a game 2.7 to 2.9 and draws 23 to 26% (`feel.sweep.test.ts`), the fresh champion's points nearer 85.
2. **Hold the user's live-state edge the way the AI's is held** (engine 6's E6-3 did it for the AI): halve the familiarity and morale terms for the user's side too, or let Calibrated measure the user's side after its first ten matchweeks rather than only the AI's at kick-off. Target: a Season side's goals a game within 0.3 of the engine's real-side line at its kick-off gap (today 3.28 against 2.03).

Either changes the Daily's and the Weekly's seasons (every match), so it ships only with an engine bump just before a Monday, as this one does. Engine 9 leaves the match engine as engine 8 had it: P2 makes bench seasons about 4 points stronger, which the proposal would also temper.

## The gameplay sweep before and after

`GAMEPLAY_SWEEP=1 GAMEPLAY_N=2 npx vitest run src/game/__tests__/gameplay --maxWorkers=3`, run on engine 8 (this branch's base) and on engine 9:

Both runs passed (17 tests on engine 8; 18 on engine 9, the scoring sweep included). Goals a game and draws by mode, every match each mode played:

| mode | matches (e8 / e9) | goals a game e8 | e9 | draws e8 | e9 |
|---|---|---|---|---|---|
| Quick Draft (random mode combinations) | 297,095 / 295,195 | 2.67 | 2.67 | 24.4% | 24.3% |
| Daily | 68,400 / 68,400 | 2.64 | 2.64 | 24.4% | 24.4% |
| Season (store-driven) | 27,394 / 27,486 | 2.85 | 2.84 | 23.2% | 23.3% |
| Dynasty | 7,303 / 8,093 | 2.86 | 2.85 | 22.3% | 23.7% |
| Arena Cup | 1,536 / 1,536 | 2.89 | 2.89 | 22.8% | 22.9% |
| Arena Gauntlet | 183 / 191 | 2.87 | 2.95 | 26.8% | 24.1% |
| Run-in | 7,990 / 7,990 | 2.92 | 2.92 | 21.8% | 21.7% |
| Head-to-head | 30,400 / 30,400 | 2.78 | 2.78 | 23.4% | 23.4% |

The feel against the real tables is identical (AI leagues do not move: Realistic 2.83 goals a game, draws 23.5%, champion 90.3 points; Calibrated 2.78, 24.6%, 85.1; real 2.83, 24.8%, 83.5), as is the assistant's 38-0 chase (no bench: titles 138, 160 and 162 of 600 on easy, normal and hard, 68.0 to 69.1 points). The Daily is the same match for match. The sweep's flags barely move (summed over every report, engine 8 then engine 9): a booked or scoring man off the pitch never; `outfielder-in-goal-with-keeper-on-bench` 75 to 62 (P3 keeps a keeper in his own slot more often); `keeper-outfield-by-hand` 169 to 182 and `impossible-score` 8 to 12 (the random manager's own choices; both runs pick different men once P3 changes the XI); `same-person-both-sides` 1,680 both (the data's January moves, known since engine 6); `seven-plus-detail` 14,928 to 14,914.

## Release notes

- **Order:** engine 8 first (Monday 2026-11-02, `docs/RELEASE-ENGINE8.md`). Engine 9 goes live just before 00:00 UTC on a Monday after engine 8 has run its 7 days: Monday 2026-11-09 at the earliest (merge on Sunday 2026-11-08 about 23:30 UTC). A mid-week release would leave that week's ranked Weekly on `touchline-e8`.
- **Its own loader `touchline-e9`** (Verify JWT off), built with `node scripts/online/build-loader.mjs` from `main` at exactly the deployed commit; the SHA-256 it pins must equal the live `build.json`'s `verifier.sha256`. This branch's bundle: `edge/verifier-33784d656754443f.js`, SHA-256 `33784d656754443fdbc5a891f3d15cbe2196cb3d5b9dddf412b92b9af8bab78f` (any merge before the release can rename it; trust the live `build.json`).
- **The e8 bundle served from `public/edge/`**: `verifier-3253bc81bf95d2ed.js` (SHA-256 `3253bc81bf95d2ed412c9008e787c2be26d41d8106eb841da1442d755c41587e`), pinned in `legacyEdge.test.ts`. Check it against the live engine 8 `build.json` before the merge; if engine 8 shipped with another bundle, replace the file and its entry. By then e4, e5 and e6 (and e7 from 2026-11-09) are retired: remove their files, entries and `config.toml` blocks.
- `supabase/config.toml` lists `[functions.touchline-e9]` and keeps `touchline-e8`; keep `touchline-e8` deployed at least 7 days after engine 9's release, then delete it with its block, its `public/edge` file and its test entry.
- No migration. Challenge links made on engine 8 read as unverified (`engineBump.test.ts`). The step-by-step runbook is [ONLINE.md](ONLINE.md) section 7, "Release engine 9".
