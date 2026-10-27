# TouchLine: research

Why TouchLine exists, which two games it borrows from, what each does well, and what we chose to take and to leave. Figures quoted for 38-0 and 38-0-0 are as the sites claimed them when this research was done (October 2026).

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

| Dimension | 38-0 | Football Manager | TouchLine |
| --- | --- | --- | --- |
| Core loop length | Eleven spins and picks, then one click | A match day or an in-game week per step, for hours | Eleven to twenty-two spins, then one matchweek per click (Quick: one click) |
| Luck vs skill | Luck-heavy; skill is slot planning and eligibility | Skill-heavy; variance is slow and smoothed | Luck in the draft, skill in management; variance scaled by squad consistency |
| Nostalgia | Core: real squads from specific seasons since 1992-93 | Low: the current database, with the past only in your own saves | Core: real squads of seven leagues 2008-09 to 2026-27, plus England's 1992-93 to 2007-08 (opt-in, estimated ratings), drafted across eras |
| Depth | Deliberately shallow | Very deep | Medium: roles, instructions, condition, morale, injuries, cup, market and loans, scouting, contracts, staff, board, dynasty with youth intake |
| Shareability | Very high: a record, a tier and a grid of squares | Low: screenshots and forum stories | High: a share text per season, plus seeds that replay |
| Session length | About five minutes | Hours per sitting, hundreds per save | Five minutes (Quick, Daily); about 45 minutes (Season); open-ended (Dynasty) |
| Opponents | Abstract schedule strength | Full AI clubs | The real squads of the chosen season, with their own injuries and form |
| Cost | Free, ad-funded extras | Paid | Free, no ads; no server needed to play (an optional online layer adds accounts, boards and rooms) |

## 4. What each does well

**38-0** proves that a wheel plus a pick is a better draft than a list, that scarcity rules create puzzles, that an instant simulation is a satisfying verdict, and that a result which fits in a tweet is marketing. It also proves that history is content: people play to see the squads.

**Football Manager** proves that the week-to-week grind is where attachment forms: condition, rotation, a knock before a derby, a sulking star, a board that counts. It proves roles and instructions can be understood by anyone if the game explains them, and that a multi-season horizon turns a squad into a dynasty.

## 5. The fusion thesis

38-0's genius is a fast, luck-tinged, shareable draft loop with nostalgia at its heart. FM's genius is ownership and consequences over time. They are not opposites; one is a way to acquire players and the other is what you do with them.

TouchLine keeps the wheel-draft as the only way you acquire players (cross-era legends, one human once, no dead spins) and then makes you actually manage them:

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
| Wheel that lands on a real club-season; one pick per spin | `src/engine/draft.ts`, `src/ui/components/CaseReel.tsx` (the wheel is drawn as a case-opening reel) |
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

## 7. What we took later, what we adapted, and what is still left out

The first version of this section (October 2026) listed scouting ranges, youth intake, loans, staff, press conferences, a backend, the 1992-2008 squads and most of 38-0's modes as not taken. Most have shipped since, each cut down to TouchLine's rule that a system has one decision and one bounded, explained effect, and every recruitment addition leaves a seeded result unchanged until the manager uses it (CLAUDE.md, invariant 21). Checked against the code on 2026-10-27.

### Taken since, from Football Manager

| System | What TouchLine does | Where it lives |
| --- | --- | --- |
| Scouting with attribute ranges | The club knows each league from 0 to 100; a player from a league it knows less than perfectly shows every attribute and his overall as a range (a pure hash of the player and the attribute, `maskRange`) until a full scout (`fullScout`) reveals him and his hidden traits. Scouting assignments raise a league's knowledge, which fades back when nobody watches; a recruitment focus narrows the market and brings graded scout reports from a fork of a copy of the stream. | `src/game/logic/scouting.ts` |
| Recruitment hub: transfers and pitching surplus players | Bids, counters, part-exchange, sell-on shares and incoming offers in the windows; an agent who shops a player round the clubs and takes a cut when he is sold (`setShopped`, `agentView`). | `src/engine/market.ts`, `src/game/logic/marketOps.ts`, `src/game/logic/contracts.ts` |
| Loans | Incoming season-long loans: a club lends fringe men and youngsters (`loanable`: 23 or under and rated 83 or less, or anyone rated 76 or less), for a fee of 12 per cent of the price (at least £0.2M) and full wages; he goes back in the summer and his parent club will not sell him to you mid-loan (`signOnLoan`, `loanFor`). | `src/engine/market.ts`, `src/game/logic/marketOps.ts` |
| Contracts and agents | Contract talks with any squad player: the demand is a fixed function of value, status, age, morale and the agent's mood (greedy, fair or loyal, a hash of the player); terms can be negotiable, locked or excluded; a signing fee, a release clause AI clubs may pay (`releaseClauses`) and appearance and goal bonuses. No dice. | `src/game/logic/contracts.ts` |
| Staff | Four backroom roles (assistant manager, head coach, physio, chief scout), three tiers each, whose wages count against the wage cap. | `src/engine/staff.ts` |
| Youth intake | Dynasty only: every pre-season the academy presents three real youngsters (20 or under, rated 58 to 76), preferably ones who came through at the replaced club; sign one for nothing on a three-year prospect deal, or pass. Board-granted youth facilities add up to two more candidates. | `src/game/logic/youth.ts` (called from `beginSeason` in `setup.ts`), `src/game/logic/board.ts` |
| Player development | Young players who play grow a little every five matchweeks, veterans fade, a good coach speeds the young; the Dynasty summer does the yearly step. | `src/game/logic/development.ts`, `src/game/logic/dynasty.ts` |
| Press conferences | Not a separate screen but cards in the events deck: after a win or a loss, when the job is in doubt, when an unbeaten season is on, and when the press turn; each choice is a small, printed change to morale or confidence. | `src/engine/events.ts` (`press-win`, `press-loss`, `press-job`, `press-unbeaten`, `media`) |
| One-to-one talks | Praise, demand more, promise a start, reassure, once a player a week. | `src/game/logic/talks.ts` |
| Board requests | Ask for funds, a backroom budget or (Dynasty) youth facilities: granted at board confidence 60 or more when the finances allow, refused for 2 confidence otherwise, one request per eight matchweeks; the wage-to-transfer slider turns £10k a week of wage room into £2M of budget, or back. | `src/game/logic/board.ts` |
| Dressing-room dynamics, happiness and personality | The hierarchy, the groups and the atmosphere; a morale log of why each man's morale moved; FM-style personality labels read off the hidden traits. All three are views: they name what the existing systems do and change no result. | `src/game/logic/dynamics.ts`, `happiness.ts`, `personality.ts` |
| Squad planner and medical centre | Depth and needs by position, a contracts overview, and each fit player's injury risk with its reasons, mirroring the engine's own injury terms. Read-only. | `src/game/logic/planner.ts`, `medical.ts` |
| Data analysis | xG and xA per player across the season and an analyst's note in the inbox every five matchweeks. | `src/game/logic/dataHub.ts` |
| An inbox you act on | News items that carry a player get buttons that open the right action. | `src/game/logic/news.ts`, `inboxActions.ts` |

### Taken since, from 38-0

- **One-Club XI**: the `onlyClub` draft rule (and `onlyNation` for a one-nation XI), `src/engine/draft.ts`.
- **European Nights**: the all-leagues wheel over the seven packs (`rules.leagues`; the EU flag is `leagueId="europe"`).
- **Teammate Chain**: a wheel rule, `src/engine/draft.ts` (`chainAllows`) and `src/engine/teammates.ts`.
- **Last One Standing and Tournaments**: the arena's Gauntlet (`src/engine/gauntlet.ts`) and Cup (`src/engine/cup.ts`), `src/game/logic/arena.ts`.
- **Live drafts against a friend**: head-to-head on one device (`src/engine/h2h.ts`, `src/game/logic/h2h.ts`) and online rooms where the server holds the seed and replays every pick (`src/game/logic/h2hRoom.ts`, `src/online/rooms.ts`, `docs/GAME_DESIGN.md` section 18).
- **1992-93 onwards**: England's classic seasons 1992-93 to 2007-08 shipped, opt-in, with real squads and tables and ratings TouchLine estimates because no openly licensed rating source exists for them (`docs/DATA.md` section 8).
- **Online leaderboards**: an optional Supabase layer (`src/online`, `docs/ONLINE.md`) with the Daily and weekly boards and the 38-0 chase, every ranked run replayed by the Edge Function; the game still plays logged out and offline, with saves in `localStorage`.

### Adapted rather than copied

- **The match view.** No 3D engine: the match is decided as xG events first, then drawn as a live 2D pitch after Football Manager's 2D view (`src/ui/components/LivePitch.tsx`, `src/ui/match/`: ball flight, goal replays, the camera on key moments) with a quick-season highlights reel (`src/game/logic/highlights.ts`, `src/ui/components/Highlights.tsx`). All of it is decoration over the decided events and never touches the generator.
- **Training.** One weekly team focus with a bounded effect and an injury-risk trade-off (`src/engine/training.ts`), not individual schedules.
- **Finances.** A transfer budget, a wage cap, prize money (`prizeMoney`) and the board's slider; no club-level accounts.

### Still left out

- **Ads and ad-funded re-spins.** Re-spins are a fixed budget per draft. There is no monetisation.
- **Licensing.** No crests, kits or likenesses. Badges are generated from colours and letter codes; names are used descriptively.
- **Separate in- and out-of-possession shapes.** One shape with roles (34) and six team instructions carry the rest (`src/engine/tactics.ts`).
- **Individual training and mentoring.** Training is the team's weekly focus only; nothing pairs a veteran with a youngster.
- **Regenerated players.** The youth intake brings through real youngsters from the packs; nobody is generated.
- **Outgoing loans.** You can take a man on loan, but not lend one of yours to another club.
- **Financial Fair Play.** No FFP rules; the wage cap and the budget are the only limits.
- **Staff dynamics.** Staff are hired by role and tier; they have no relationships, opinions or personalities of their own.
- **Dressing-room effects.** The hierarchy, groups and atmosphere are shown but change no result yet (planned as Batch 3 of the FM-depth plan, `dynamics.ts`).
- **38-0's multiplayer leagues.** Head-to-head is one opponent per draft; there are no standing multiplayer leagues, and the casual modes (arena, Weekly, Run-in) have no online boards yet.
- **Classic seasons outside England.** The other six leagues start in 2008-09.

## 8. Sources

- 38-0: https://38-0.app (home and how-to-play pages).
- 38-0-0: https://38-0-0.com.
- Football Manager 26: Sports Interactive's published feature descriptions for FM26.
- Dataset credits and licences: see `docs/DATA.md`.
