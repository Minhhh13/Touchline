# Touchline: research

Why Touchline exists, which two games it borrows from, what each does well, and what we chose to take and to leave. Figures quoted for 38-0 and 38-0-0 are as the sites claimed them when this research was done (October 2026).

## 1. 38-0

**What it is.** A free web football draft game and squad builder at 38-0.app. It describes itself as a nostalgia and history game, not fantasy football.

**The loop.** Choose a formation. Spin a wheel that lands on a real English top-flight club from a specific season (1992-93 to the present: 51 clubs, 18,000+ player-seasons). Draft one player from that squad into a formation slot. Repeat until all eleven slots are filled. Simulate a full 38-game season instantly. The dream is a perfect 38-0 record: 38 wins, no draws, no defeats.

**Rules (from the how-to-play page).**

- You choose the formation first.
- The wheel only lands on squads that can fill a position you still need, "so you never get a dead spin".
- Each player is tied to one season, with a rating for that year's performance.
- A real player can be drafted only once, even from a different club or season.
- The engine "weighs the strength and balance of your eleven across a full fixture list"; results include randomness.
- Three points for a win, one for a draw, a maximum of 114.
- Ratings are "an independent interpretation based on publicly available data".

**Modes.** Classic, One-Club XI, Daily Challenge (the same starting conditions for everyone), Last One Standing, Multiplayer leagues and live draft, European Nights draft, Teammate Chain, Tournaments. Hard Mode hides ratings.

**Reach.** The site claims 5.4M+ players, 10.9M+ seasons simulated and 46M+ impressions on X. Shareable results drove the virality.

**The sibling.** 38-0-0 (38-0-0.com, by Deniz Sancar, built with Claude Code and inspired by the NBA game 82-0) runs the same idea with Classic and Expert modes (ratings hidden), seven formations, position eligibility rules ("wing-backs cover full-back, wide midfielders cover the wings"), tiered results from Relegation Battle up to 38-0-0 and "The Quadruple", ad-funded re-spins, and reached number one on the UK iOS charts.

**Why it works.**

- A complete emotional arc in five minutes: hope on the spin, tension on the pick, verdict on the simulation.
- Luck you can argue with. The wheel is random but the pick is yours, so every bad season is partly your fault and every good one is partly your genius.
- Nostalgia as the content. Landing on a 1995 club and seeing that squad again is the product; the ratings only exist to settle the argument.
- A result that fits in a tweet. A record, a tier and a row of coloured squares.
- Scarcity rules (one season per player, no repeats) make each draft a puzzle rather than a lottery.

## 2. Football Manager

**What it is.** Sports Interactive's management simulation; FM26 is the current edition. It is the depth benchmark for the genre.

**Systems.**

- Tactics with separate in-possession and out-of-possession shapes, player roles (35+ attacking roles plus defensive roles; FM26 dropped the attack/support/defend duty system) and team instructions.
- A match engine with highlights and xG-based analysis.
- Training with team and individual focus; overtraining raises injury risk.
- Scouting with attribute ranges that narrow as you scout.
- A Recruitment hub covering transfers, requirements and pitching surplus players.
- Staff dynamics.
- Player pathways and youth development with loans and mentoring.
- Board confidence and expectations.
- Morale and dressing-room dynamics.
- Finances and Financial Fair Play.
- Press conferences and team talks.
- A Portal inbox replacing the old inbox.
- Multi-season careers with ageing, contracts and regenerated players.

**Why it works.**

- Ownership. The squad is yours because you built it over seasons, not because a wheel gave it to you.
- Consequences over time. A tired midfielder in October is an injury in November is a lost title in May.
- Legible systems with hidden depth. Every number has a tooltip; every tooltip leads to another system.
- The inbox as narrative engine. News, requests and complaints turn a simulation into a story about you.

## 3. Comparison

| Dimension | 38-0 | Football Manager | Touchline |
| --- | --- | --- | --- |
| Core loop length | Eleven spins and picks, then one click | A match day or an in-game week per step, for hours | Eleven to twenty-two spins, then one matchweek per click (Quick: one click) |
| Luck vs skill | Luck-heavy; skill is slot planning and eligibility | Skill-heavy; variance is slow and smoothed | Luck in the draft, skill in management; variance scaled by squad consistency |
| Nostalgia | Core: real squads from specific seasons since 1992-93 | Low: the current database, with the past only in your own saves | Core: real squads 2008-09 to 2026-27, drafted across eras |
| Depth | Deliberately shallow | Very deep | Medium: roles, instructions, condition, morale, injuries, cup, market, board, dynasty |
| Shareability | Very high: a record, a tier and a grid of squares | Low: screenshots and forum stories | High: a share text per season, plus seeds that replay |
| Session length | About five minutes | Hours per sitting, hundreds per save | Five minutes (Quick, Daily); about 45 minutes (Season); open-ended (Dynasty) |
| Opponents | Abstract schedule strength | Full AI clubs | The real squads of the chosen season, with their own injuries and form |
| Cost | Free, ad-funded extras | Paid | Free, no ads, no backend |

## 4. What each does well

**38-0** proves that a wheel plus a pick is a better draft than a list, that scarcity rules create puzzles, that an instant simulation is a satisfying verdict, and that a result which fits in a tweet is marketing. It also proves that history is content: people play to see the squads.

**Football Manager** proves that the week-to-week grind is where attachment forms: condition, rotation, a knock before a derby, a sulking star, a board that counts. It proves roles and instructions can be understood by anyone if the game explains them, and that a multi-season horizon turns a squad into a dynasty.

## 5. The fusion thesis

38-0's genius is a fast, luck-tinged, shareable draft loop with nostalgia at its heart. FM's genius is ownership and consequences over time. They are not opposites; one is a way to acquire players and the other is what you do with them.

Touchline keeps the wheel-draft as the only way you acquire players (cross-era legends, one human once, no dead spins) and then makes you actually manage them:

- a 38-match season played week by week, with roles and team instructions whose effects are printed in the match report;
- condition and rotation, injuries and suspensions;
- morale and dressing-room events, team talks and a weekly training focus;
- a 16-team cup played midweek;
- a January transfer window with dynamic prices (form, age, rival suitors and bidding wars, deadline-day discounts) and AI clubs bidding for your players;
- board expectations and job security;
- end-of-season awards and achievements;
- Dynasty mode, where players age, contracts expire, some retire, you get summer bonus spins and the league moves to the next real season.

Quick Draft and Daily Challenge keep the pure 38-0 loop for people who want five minutes. In every mode the drafted side takes one real club's place in a chosen real league season and plays the other nineteen clubs' real squads of that season, so the opposition is history too.

## 6. What we took

| From 38-0 | Where it lives |
| --- | --- |
| Wheel that lands on a real club-season; one pick per spin | `src/engine/draft.ts`, `src/ui/components/Wheel.tsx` |
| Formation first; no dead spins; one human drafted once | `draft.ts` (`wheelPool`, `canUse`, `takenPlayers`) |
| Position eligibility (wing-backs cover full-back, wide midfielders cover the wings) | `src/engine/positions.ts` (fit table, `canCover`) |
| Ratings tied to one season, from the edition after it | `scripts/import/build.mjs` |
| Instant 38-game simulation, 3-1-0 points | `src/game/logic/quick.ts`, `src/engine/season.ts` |
| Hard mode hides ratings; one-club mode; daily challenge with a shared seed; re-spins | `DraftRules`, `src/engine/rng.ts` (`dailySeed`) |
| Tiered results from Relegation Battle up to the perfect season | `seasonTier`, `TIER_LABEL` |
| Shareable result text with a grid of squares | `src/engine/awards.ts` (`shareText`) |
| Independent ratings interpretation, descriptive use of names | `docs/DATA.md`, How it works screen |

| From Football Manager | Where it lives |
| --- | --- |
| Player roles with attribute weights and unit contributions | `src/engine/roles.ts` |
| Team instructions that interact with the opponent and with your own players | `src/engine/tactics.ts` |
| xG-based match engine with a readable timeline and post-match analysis | `src/engine/match.ts`, `MatchScreen.tsx` |
| Condition, sharpness, familiarity, morale, form | `SquadPlayer`, `src/engine/ratings.ts`, `season.ts` |
| Injuries, suspensions, substitutions | `match.ts`, `season.ts` |
| Weekly training focus with injury-risk trade-offs | `src/engine/training.ts` |
| Team talks | `match.ts` (`teamTalkEffect`) |
| Board confidence, expectations and the sack | `season.ts` (`boardTargetFor`, `updateConfidence`), `week.ts` |
| Dressing-room events, promises, captaincy, an inbox | `src/engine/events.ts`, `SeasonState.news` |
| Transfer windows with asking prices, counters and incoming offers; wage cap and budget | `src/engine/market.ts` |
| Multi-season careers with ageing, contracts and retirements | `src/game/logic/dynasty.ts` |
| Awards and a team of the season | `awards.ts` |

## 7. What we deliberately did not take

- **Ads and ad-funded re-spins.** Re-spins are a fixed budget per draft. There is no monetisation.
- **A 3D match engine or highlights.** The match is a ticker and a report. Depth goes into the numbers, not the rendering.
- **Licensing.** No crests, kits or likenesses. Badges are generated from colours and letter codes; names are used descriptively.
- **FM's full scope.** No scouting ranges, individual training, youth intake, loans, staff, press conferences as a system, or FFP. Each system in Touchline has one decision and one bounded, explained effect.
- **Separate in- and out-of-possession shapes.** One shape with roles; the instructions carry the rest.
- **A backend.** Saves live in `localStorage`; the daily challenge is shared by seed, not by server. Online leaderboards and multiplayer are roadmap items.
- **1992-2008 squads.** The open datasets we rely on start at 2008-09. Earlier seasons are a roadmap item, not a promise.
- **38-0's full mode list.** Live multiplayer drafts are not built. (Since written: European Nights, Teammate Chain as a wheel rule, Last One Standing as the Gauntlet and Tournaments as the Cup are.)

## 8. Sources

- 38-0: https://38-0.app (home and how-to-play pages).
- 38-0-0: https://38-0-0.com.
- Football Manager 26: Sports Interactive's published feature descriptions for FM26.
- Dataset credits and licences: see `docs/DATA.md`.
