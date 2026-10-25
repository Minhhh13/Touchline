# Touchline: game design

This document describes the game as implemented in `src/engine` and `src/game`. Every number quoted here is taken from the code at the time of writing; where a system is planned but not built it is listed under Roadmap at the end and nowhere else.

## 1. Name

**Touchline** is the product name. It is the manager's domain (the one place a manager is allowed to stand), it is short, it is brandable and it is already the repository name, the `<title>`, the brand mark in the top bar and the default team name ("Touchline XI").

Tagline: **Spin the wheel. Draft the XI. Manage the season.**

Alternatives considered and set aside:

| Name | Why not |
| --- | --- |
| Gaffer | Good voice, but it names the person rather than the game, and it is widely used. |
| Hotseat | Captures job security, but it reads as a quiz format and ignores the draft. |
| Dugout Dynasty | Describes only one of four modes and is long. |
| Centurion | The 100-point season is one achievement among fifteen, not the whole promise. |
| Fortune XI | Leans on the luck of the wheel and undersells the management half. |

## 2. Pillars

1. **The wheel is the only way in.** You never pick from a list. Every player arrives through a spin that lands on a real club in a real season, so every squad is a story of where the wheel took you.
2. **Then you manage for real.** Roles, instructions, condition, morale, injuries, suspensions, a cup, a transfer window, a board with a target. Each system has a bounded, legible effect that the UI explains.
3. **Nostalgia with a spine of data.** Players are tied to a season and rated for how they played that year, from 2008-09 to the current 2026-27 campaign. Your drafted side takes one real club's place and plays the other nineteen clubs' real squads.
4. **Deterministic and shareable.** Every spin and every match flows from one seed, so a Daily Challenge is the same wheel for everyone and a seed can be sent to a friend. Every season ends in a share text.
5. **Legible randomness.** Luck exists (Poisson goals, variance scaled by consistency) but it is explained in match reports and tactical notes, never hidden.

## 3. Modes

| Mode | Draft | Season | Persistence |
| --- | --- | --- | --- |
| Quick Draft | 11 picks, 2 re-spins, each club-season usable once | Simulated instantly, fixed XI, default roles, no injuries carried, no live state | Result to local leaderboard and share text |
| Daily Challenge | As Quick Draft, seed `daily-YYYY-MM-DD` (UTC), no era, club or hard-mode filters | As Quick Draft | Streak, daily result, achievement at seven days running |
| Season | 16 to 22 picks (default 18), 3 re-spins, club-seasons may repeat | 3 friendlies, 38 matchweeks played one at a time, cup, January window, board | Full save in `localStorage` |
| Dynasty | As Season, then a summer draft each year with bonus spins and 1 re-spin | Season mode repeated; players age, contracts run down, league moves on a year | History table per year |

Setup options (`src/ui/screens/Setup.tsx`):

- Team name (28 characters), from which a 2 to 3 letter short code is derived.
- League season to play in (2008-09 to 2026-27, the in-progress season flagged) and the club whose place you take. You inherit their colours, rivals and fixture slot; their real players sit the season out.
- Difficulty: **Calibrated** (default) or **Realistic**. See section 13.
- Seed (shareable, `XXXX-XXXX` from a 32-character alphabet) for all modes except Daily.
- Wheel rules (not Daily): era (all, first season to 2013-14, 2014-15 to 2019-20, 2020-21 onwards, or a custom range), one-club mode (restrict the wheel to one club's history), one-nation mode (every player must share one nationality; section 5), hard mode (ratings hidden while drafting; the engine ignores this flag). One club and one nation are exclusive in the setup form: choosing one clears the other.
- Season and Dynasty only: squad size slider 16 to 22, and a job-security toggle (the board can sack you).
- Formation: one of eight (section 4).

Note on Daily: the wheel, the league season, the host club, the formation and the difficulty are all fixed by the day's seed (see "Two-tap start" below); only the team name is the player's.

### Two-tap start

The setup screen (`src/ui/screens/Setup.tsx`) shows above the fold only what a first game needs: team name, league and formation, plus the squad-size slider and the job-security toggle for Season and Dynasty. Everything else (league season, host club, difficulty, seed, where the wheel draws from, era, one-club and one-nation modes, hard mode, twists, the Continental Cup) sits under a **More options** panel that is collapsed by default. Its state is remembered per browser in `localStorage['touchline-setup-advanced']` (`'1'` open, `'0'` closed, read and written inside try/catch so a private window simply starts closed). The Daily and a challenge link show no fold, since nothing in it is theirs to change.

Directly above the Start button a summary line, built by `summariseSetup` (`src/game/logic/setup.ts`) from the exact settings Start would send, states every choice: `Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A`, followed only by what is off the defaults (a European Nights wheel, an era, one club or nation, hard mode, `twists` or `no twists` when they differ from the mode's default of on for a quick draft and off for a season, the squad size, no sack, the Continental Cup). A `change` link opens the fold and scrolls to it. On screens of 720px or narrower the line and the Start button sit in a fixed bottom bar (`.bottom-bar`, padded for the safe-area inset); the page's bottom padding is the bar's measured height plus 20px (150px until it is measured), so a long summary never covers the last panel and Start is reachable without scrolling past the formation grid.

The default host club is `defaultHostClub`: the club whose position in `u.tables[leagueId][season]` is nearest `DEFAULT_HOST_POSITION` (10), ties to the higher place, among the clubs with a squad that season; where the table is missing it is the alphabetical middle of the list, as before. The help text says why (`A mid-table club (10th in 2025-26), so the board's target is reachable`) until the player picks another club, and the rivals count is the league size minus one rather than a fixed 19, so an 18-club league reads as 17 rivals.

The Daily's fixed settings are `dailySettings(u, seed)`: the digits of `daily-YYYY-MM-DD` form `n`; the season is the complete English seasons in ascending order at `n mod count`, the host club is that season's club ids sorted at `(7n) mod count`, and the formation is `['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond']` at `(3n) mod 5`; the league is England, the wheel England only, the difficulty calibrated. This is the mapping the setup screen always used, now pinned by a test (`daily-2026-10-25` is a 4-3-3 as Swansea City in 2017-18), so a deploy never changes everyone's puzzle. `dailyGameSettings` builds the full `GameSettings` from it, which is what the Home screen's Daily card sends to `startGame` from its **Play today's puzzle** button; the card's body still opens the full setup for a custom team name, and both paths produce identical settings apart from the name. If today's Daily is already under way the button reads **Continue today's puzzle** and reopens it, and when an unfinished Quick Draft or Daily sits in the shared save slot the button asks before dropping it.

## 4. Formations

Eight shapes, each with eleven slots carrying a position and pitch coordinates (`src/engine/formations.ts`):

| Formation | Slots |
| --- | --- |
| 4-3-3 | GK, LB, 2 CB, RB, DM, 2 CM, LW, ST, RW |
| 4-4-2 | GK, LB, 2 CB, RB, LW (as LM), 2 CM, RW (as RM), 2 ST |
| 4-2-3-1 | GK, LB, 2 CB, RB, 2 DM, LW, AM, RW, ST |
| 3-5-2 | GK, 3 CB, LB and RB (as wing-backs), DM, 2 CM, 2 ST |
| 3-4-3 | GK, 3 CB, LB, RB, 2 CM, LW, ST, RW |
| 4-1-4-1 | GK, LB, 2 CB, RB, DM, LW, 2 CM, RW, ST |
| 4-4-2 Diamond | GK, LB, 2 CB, RB, DM, 2 CM, AM, 2 ST |
| 5-3-2 | GK, LB, 3 CB, RB, 2 CM, DM, 2 ST |

Wide midfield slots are typed as LW/RW and wing-back slots as LB/RB, so position eligibility (section 6) decides who can fill them. Changing shape mid-season keeps roles whose position still matches, resets the rest to the default role and knocks 12 points off every player's familiarity.

## 5. The wheel and the draft

Rules (`src/engine/draft.ts`):

- **No dead spins.** The wheel pool is every club-season (within the era and club filters) that still contains at least one usable player. While the XI is being filled, usable means a player who can cover an open slot at the minimum fit (`accomplished`, section 6). Once the XI is full, any un-drafted human is usable for the bench.
- **A human is drafted once.** `takenPlayers` holds player ids (not player-season ids), so the same person cannot be drafted from a different club or season.
- **Quick drafts never repeat a club-season** (`uniqueClubSeasons: true`); season drafts may.
- **Spin weighting.** A season is picked uniformly from those still in the pool, so no era dominates because it has more rows. Within that season a club-season is weighted by `quality × usefulness`, where `quality = 1 + 0.06 × (21 − finishing position)` (1.6 if the season is in progress) and `usefulness = 1 + min(10, usable players) / 10`. A title winner is roughly twice as likely as a relegated side.
- **Re-spins** are a draft-wide budget (2 quick, 3 season, 1 in a dynasty summer). A re-spin logs the skipped club-season in the draft history.
- **Picks** go into an open slot the player can cover, or onto the bench once the XI is full. The UI suggests the first natural slot, then the first eligible one.
- **Auto-complete** lets the assistant finish: on each spin it takes the best `overall × (1 or 0.92 if not a natural fit)` into the scarcest open slot, or the highest-rated player for the bench.
- In Dynasty, agent events (section 10) and the summer grant **bonus spins**, shown as a gold chip and redeemed at the summer draft.

### One-Nation Draft

`DraftRules.onlyNation` holds an ISO3 code as stored in `PlayerSeason.nationality` (`'BRA'`); `'UNK'`, the code for the 1,876 player-seasons whose nationality is not known, is never offered. The rule is one predicate, `nationAllows`, applied in `canUse`, `eligibleSlots` and `pick` (which throws "`{name} is not Brazil`"), so the wheel pool, the spin weighting, the assistant's auto-draft and the head-to-head usable list all inherit it: the wheel still never lands on a club-season without an eligible player, and in the squad list players of another nationality are dimmed with a "not Brazil" chip.

- **Setup.** The one-nation select (`nationDepth`, `src/engine/nations.ts`) lists the nations deep enough for the chosen shape in the chosen wheel leagues and era: for every position in the formation, at least 2 × its slot count in distinct humans who can cover it at `accomplished` fit (the draft's own predicate), and at least `squadSize + 6` distinct humans in all (11 + 6 for a quick draft). It is one pass over the loaded player-seasons (`nationCover`, about 160 ms for all seven leagues, memoised on wheel leagues, era and formation) and a cheap filter per squad size (`nationDepthFrom`), so the squad-size slider never rescans. With the 2026-10-24 data a 4-3-3 across all seven leagues offers 71 of the 161 known nations (68 at squad size 18, 65 at 22); England alone offers 26 (21 at 18). Côte d'Ivoire, with Premier League players in every era but no goalkeeper who can cover the position in the Premier League data (two across the seven leagues), is left out; Brazil counts 1,141 distinct players across the seven leagues and 107 in England. The option label reads `🇧🇷 Brazil · 1141 players`. The Daily ignores the rule.
- **Running dry.** The depth check covers year one; in a Dynasty the rule is copied into every summer draft, so bonus spins can exhaust a thin nation over the years. `canSpin(u, d)` is the pool-not-empty check: the store refuses to spin and toasts "The wheel has run dry for Brazil" instead of surfacing an engine error, `autoDraft` stops instead of throwing, and the Draft screen replaces the spin button with a notice. When the XI is full the draft may close short of the squad size (`finishDraft` accepts `picksMade >= 11` once `canSpin` is false); with slots still open the side cannot start and the notice says to go home and pick another nation.
- **Market and academy.** `MarketContext.onlyNation` travels from `settings.rules` into the January window, the Dynasty summer window, scouting trickle and every approach. `openWindow` samples only club-seasons that hold someone of the nation and takes only that nation's players from each, with a sampling budget of 60 tries per listing instead of 20 because repeats are frequent for a small nation; without the rule its random draws are unchanged. `enquire` answers an approach for anyone else, from the shortlist or the search box, with "The board wants a Brazil squad" and lists nothing. `buildYouthIntake` keeps only youngsters of the nation.
- **Record.** Winning the league with the rule on unlocks `one-nation-champions` ("International"), in both the season and the quick path. The share text gains the line `One nation: 🇧🇷 Brazil` before the seed, the summary shows the same chip, and the leaderboard entry stores `nation` and shows the flag beside the team name.

### Wheel twists

`DraftRules.twists` (on in `QUICK_RULES` and therefore in the Daily, off in `SEASON_RULES`; `startH2H` passes `twists: false`; a saved draft without the field reads as off) makes every third spin a **twist spin**: spins 3, 6 and 9 of a quick draft, so three of its eleven. `Twist = 'golden' | 'basement' | 'blind' | 'decade'`:

| Twist | Wheel | Where it is empty |
|---|---|---|
| 🥇 Golden | title-winning club-seasons only (`cs.champions`) | leagues without a table that season (`position` 0) |
| 🪣 Basement | the bottom three of their league that season: `position >= clubsThatSeason − 2`, with `clubsThatSeason` the row count of `u.tables[league][season]` (20 in England, Spain and Italy, 18 in the Bundesliga) | the same |
| 🙈 Blind | the plain wheel; ratings are hidden in the squad list, on the pitch and in the draft log for that pick (the same hiding as hard mode) | never |
| 📅 Decade | club-seasons from the decade of the last pick (`Math.floor(season / 10)` of the last history row with a `pickedId`) | before the first pick |

Inside `spin()`: `d.twist` is cleared, and when `rules.twists && (d.spins + 1) % 3 === 0` the four twists are tried against `wheelPool(u, { ...d, twist })`, the ones with an empty wheel are dropped, and `rng.pick` chooses among the rest, one extra RNG draw on a twist spin and none on the others. Blind is always possible, so a twist spin always has a twist; in Ligue 1, the Eredivisie and the Primeira Liga, whose club-seasons all have `position` 0 and no `champions` flag, only blind and decade ever come up (tested over 30 seeds). `wheelPool` applies the twist as one more filter beside era, club, nation and league, so the spin weighting, the usefulness count, `canSpin`, the assistant and the wheel segments all see the twisted pool: a golden spin shows only champions' badges. The twist is recorded on the history row (`history[].twist`) and cleared by `pick()` and `respin()`; a re-spin on a twist spin logs the twist on the skipped row and lands on a plain spin number (spin 4 after re-spinning spin 3), which is left as it is rather than carried forward. "Auto-complete" clears a pending spin's twist with the spin it discards. `spin()` builds the rules pool (era, club, nation, league and the `canUse` check over every squad: 380 club-seasons in England, 2,526 across the seven leagues) once per spin and narrows it per twist, so the candidate check costs four cheap filters on a twist spin rather than four more passes over the squads; `wheelPool` returns exactly that narrowed pool.

The twist draw is part of the seed, so `ENGINE_VERSION` moved from `'1'` to `'2'` with this change: a seed drafted with twists on lands on the same first two clubs as before and diverges from the third spin. The Draft screen shows a `TwistCard` above the wheel (icon, name, one-line rule; a dashed "Twist spin next" card before a twist spin), the wheel hub shows the twist's name while the rotor turns, and the Setup screen has a toggle under Wheel rules (default on for Quick Draft, off for Season and Dynasty; the Daily is always on). The share text adds a line with the icons of the twists the picks went through, `Twists 🥇 🙈 📅`.

### Ghost drafts: challenge links and run-it-back

A finished quick draft can be packed into a link and replayed on another device, because the wheel, the picks and the quick season all run on the one seeded `Rng`.

- **Payload** (`src/engine/challenge.ts`, `ChallengePayload`, `v: 1`): the data stamp (`LoadedUniverse.generatedAt`) and `ENGINE_VERSION` it was built on; the challenger's name, cut to `CHALLENGE_NAME_MAX = 24` characters with control characters stripped; `s` = seed, formation, league, wheel leagues, host club, league season, difficulty and the draft rules as a diff against `QUICK_RULES` (`leagues` always travels as `wl`); `p` = one row per draft history row, `[playerId, slotId]` with the real player id (`s200458`) rather than the player-season id, and `[null, null]` for a re-spin or a discarded spin; `c` = the claim (points, won, drawn, lost, tier); `k` = `historyKey`, the cyrb53 hash in base 36 of the club-seasons the wheel landed on, in order. `encodeChallenge` writes it as UTF-8 JSON in base64url after `#c=`: 616 characters for an eleven-pick England quick draft with default rules (a full player-season id per pick would be about twice that). `decodeChallenge` checks every field, the formation id, the tier and the rules diff key by key (only the eleven known rules, each with its type: `squadSize` an integer from 11 to 18, `respins` 0 to 10, `minFit` one of the four fits, the flags booleans, `leagues` never, since it travels as `wl`), and throws "Not a Touchline challenge link" (or "comes from a newer version" when `v` is above 1) rather than returning a partial payload. `openChallenge` then refuses a link naming a league this build does not ship, or a host club that did not play that league season.
- **Replay** (`replayDraft` in the engine, `replayChallenge` in `src/game/logic/challenge.ts`): `createGame` from the link's settings, then for every row one `spin`; a null row decrements `respinsLeft` and logs the row the way `respin` does without spinning again, a pick row rebuilds `${playerId}@${season}@${clubId}` from the club-season the wheel landed on and calls `pick` (which takes no RNG). The replay must end complete (or, on a one-nation wheel that has run dry, with eleven and no spin left), with as many history rows as `p`, and with `historyKey` equal to `k`; then `runQuickSeason` and the result is compared with the claim figure by figure. The outcome is `verified: 'yes'` when it matches, `'no'` with the reason ("Spin 4: no player s000001 in the burnley 2025 squad", "the picks replay to 70 points (20-10-8), not 73", "The wheel did not land on the same club-seasons") when the picks or the claim were tampered with, and `'unverified'` with the reason when the data stamp or the engine version differ, in which case nothing is replayed beyond a best-effort draft so the ghost picks can still show. Nothing throws. A replay costs one quick season, about 300 ms in the test suite.
- **Every spin is in the history.** "Auto-complete" used to drop a pending spin (`draft.current = null`) that had already consumed RNG, so a link built from such a game would drift on replay; it now pushes the spin as `{ pickedId: null, slotId: null, skipped: true }` (with its twist) and the draft log shows it as "skipped". `respin` already logged the spin it discarded.
- **Opening a link.** `App.tsx` reads `location.hash` once the default league is loaded (and on `hashchange`), clears it with `history.replaceState` so a reload does not reopen it, and calls the store's `openChallenge`: decode, refuse a league this build does not have, `ensureLeagues` for the link's league and wheel leagues, replay, then `pendingChallenge` (transient, never saved) and the Setup screen. `sw.js` serves `index.html` for navigations, so the link works offline and under a base path. Setup's daily lock is generalised into a `fixed` object (daily or challenge) that hides the seed, the wheel rules, the league, the host, the season, the difficulty and the formation and shows the banner "Challenge from Minh: 70 pts as Leeds United 2025-26, 4-3-3 (EUROPEAN NIGHTS, 20-10-8). Same seed, same wheel, calibrated difficulty, twists on. Seed …" with the verification line under it; an unverified or unverifiable link still plays. The game starts with `mode: 'quick'` whatever seed the link carries, a daily seed included, so the Daily streak and `dailyResults` are untouched, and `GameSettings.challenge` (`ChallengeSettings`: name, the picks resolved to player-season ids with their club-season, the claim, `verified`, `reason`, data and engine stamps) travels with the save; older saves have no field and read as a plain game.
- **The ghost.** The Draft header reads "vs Minh (70 pts)", and once the wheel settles a chip under it shows the challenger's row for the same spin number: "Last time here: K. De Bruyne" when the wheel landed on the same club-season, "Minh's spin 5: K. De Bruyne (Manchester City 2017-18)" once the drafts have diverged (a different pick changes `takenPlayers` and the pool, so later spins land elsewhere), "Last time here: Minh re-spun" for a null row. The chip is hidden under hard mode and absent when the picks could not be resolved on this data.
- **Summary.** "Head-to-head · vs Minh": both XIs on two pitches with points, tier and record, the verification line, and a verdict, `⚔️ Beat Minh by 4 points: 74 to 70`, `⚔️ Minh wins by 1 point: 90 to 89`, `⚔️ Level with Minh on 90, fewer defeats`, `⚔️ Dead level with Minh: 90 points each`, which also goes into `extraLines` of the share text. "Challenge a friend" (any quick or daily result, since quick mode keeps `game.draft` after the season) packs this game with the manager name from the Record page (the team name when there is none), copies the link and shows it in a field; "Run it back" starts the same wheel at once with this result as the ghost named "your ghost", verified without a replay because it is this device's own record; "Draft again" drops the challenge with the seed. The leaderboard entry stores `challenge: { name, points }` and the Record page shows "vs Minh 70" beside it, green when beaten.
- **Best on this wheel.** The Record page groups the quick and Daily entries of the leaderboard by seed: with two or more runs on one seed the best carries a gold "Best on this wheel · N runs" chip and the others "2nd of N on this wheel". Season and Dynasty entries are never grouped: a dynasty writes one entry per year under one seed, which is not the same wheel twice.

Links break on an engine bump (`ENGINE_VERSION`) or a data rebuild, by design: the stamps make that an "unverified" banner instead of a silent mismatch.

## 6. The player model

A **player-season** is the unit the wheel drafts: one person at one club in one season, with the rating he earned that year (`src/engine/types.ts`, `PlayerSeason`). Its id is `${playerId}@${season}@${clubId}`, so a mid-season move produces two drafts of the same human, of which you may take only one.

Fields: name, nationality, age, club, season, up to three natural positions (primary first), thirteen attributes (eight classic, five depth), four hidden traits, overall, value (GBP millions, today's money), weekly wage (GBP thousands), preferred foot, height, and accolades (`Champion` when his club won that league).

### Positions and attributes

Ten positions: GK, CB, LB, RB, DM, CM, AM, LW, RW, ST, grouped as GK, DEF, MID, ATT.

Eight attributes on 1 to 99: pace, shooting, passing, dribbling, defending, physical, mentality (decision making, composure and leadership rolled together), goalkeeping (only meaningful for keepers). They decide ratings, roles and fit.

Five depth attributes on 1 to 99, the Football Manager layer (`src/engine/depth.ts`): **stamina** (condition lost per match, the fade after the 70th minute, who comes off, the injury roll when tired), **strength** and **jumping** (set pieces and the aerial mismatch between one side's attack and the other's defence), **aggression** (cards, a little bite in the press) and **work rate** (how well pressing and counters run, how fast a player learns the system). They never enter `overall` or a role rating, so a 78 is still a 78; they change what happens to him over ninety minutes and a season. The data packs carry them (docs/DATA.md); an older pack has them derived from the eight: stamina from physical and age, strength from physical and height, aggression from defending and mentality, jumping from height and physical, work rate from mentality.

Four hidden traits in 0 to 1: consistency, injury proneness, big-match temperament, professionalism. They are never shown as numbers: the attribute panel draws big match, consistency and professionalism as a bar with a word (low, average, high) and injury proneness as a 1 to 5 **Injury risk** (`ceil(proneness × 5)`: robust, sturdy, average, fragile, glass). They shape variance, injuries, big games, discipline, morale and development.

The attribute panel (`src/ui/components/AttributePanel.tsx`, in the Dugout's player modal and Explore's career view) groups them FM-style: Technical (shooting, passing, dribbling), Physical (pace, stamina, strength, jumping), Mental (mentality, aggression, work rate, big match, consistency, professionalism), Defending, Goalkeeping, Fitness (injury risk and, for a squad player, condition). The squad list has a per-browser toggle that adds each player's stamina as a chip.

### Position weights and fit

`POSITION_WEIGHTS` gives each position a relative attribute mix (for example ST: shooting 0.38, pace 0.18, physical 0.16, dribbling 0.14, mentality 0.14). `overall` is the weighted mean at the primary position; in the shipped data it is the source rating from the dataset, with the weighted mean only as a fallback.

Out of position, a multiplier applies. Natural is 1.0. Anything not in this table is **unsuited** at 0.62, and any outfield player in goal (or keeper outfield) is 0.35.

| Natural | Related positions and factor |
| --- | --- |
| CB | DM 0.88, LB 0.86, RB 0.86 |
| LB | RB 0.90, CB 0.86, LW 0.84, DM 0.82 |
| RB | LB 0.90, CB 0.86, RW 0.84, DM 0.82 |
| DM | CM 0.93, CB 0.86, LB 0.80, RB 0.80 |
| CM | DM 0.92, AM 0.90, LW 0.80, RW 0.80 |
| AM | CM 0.90, LW 0.88, RW 0.88, ST 0.86 |
| LW | RW 0.94, AM 0.90, ST 0.86, LB 0.78, CM 0.78 |
| RW | LW 0.94, AM 0.90, ST 0.86, RB 0.78, CM 0.78 |
| ST | LW 0.88, RW 0.88, AM 0.86 |

Fit bands: **natural** 1.0, **accomplished** ≥ 0.86, **awkward** ≥ 0.75, **unsuited** below. The draft requires at least accomplished; a player with several natural positions uses the best factor among them.

### Roles and the rating formula

Thirty-four roles (`src/engine/roles.ts`), each with its own attribute weights, a split of the player's quality between the team's units, and flat tactical effects. The rating of a player in a role at a slot is:

```
roleRating = (0.55 × overall + 0.45 × roleWeightedMean) × positionFactor
```

The 55/45 blend anchors to the rating people recognise while letting the role decide who suits the job.

| Position | Role | Unit contribution (GK / DEF / MID / ATT) | Effects |
| --- | --- | --- | --- |
| GK | Shot Stopper (default) | 1 / 0 / 0 / 0 | solidity +2 |
| GK | Sweeper Keeper | 0.85 / 0 / 0.15 / 0 | creativity +2, solidity −1 |
| CB | Stopper | 0.95 / 0.05 / 0 | solidity +2 |
| CB | Covering Defender (default) | 0.95 / 0.05 / 0 | solidity +1 |
| CB | Ball-Playing Defender | 0.80 / 0.20 / 0 | creativity +2, solidity −1 |
| LB, RB | Full-Back (default) | 0.80 / 0.15 / 0.05 | solidity +2 |
| LB, RB | Wing-Back | 0.50 / 0.20 / 0.30 | creativity +3, solidity −2, fatigue +6 |
| LB, RB | Inverted Full-Back | 0.55 / 0.40 / 0.05 | creativity +1, solidity +1 |
| DM | Anchor (default) | 0.60 / 0.40 / 0 | solidity +3, creativity −1 |
| DM | Deep-Lying Playmaker | 0.30 / 0.60 / 0.10 | creativity +3, solidity −1 |
| DM | Ball-Winning Midfielder | 0.50 / 0.50 / 0 | solidity +2, fatigue +6 |
| CM | Box-to-Box (default) | 0.30 / 0.45 / 0.25 | fatigue +5 |
| CM | Central Playmaker | 0.15 / 0.65 / 0.20 | creativity +3, solidity −1 |
| CM | Mezzala | 0.10 / 0.50 / 0.40 | creativity +2, solidity −2 |
| CM | Carrilero | 0.40 / 0.55 / 0.05 | solidity +2 |
| AM | Advanced Playmaker (default) | 0 / 0.50 / 0.50 | creativity +3 |
| AM | Shadow Striker | 0 / 0.25 / 0.75 | creativity +1 |
| AM | Trequartista | −0.05 / 0.45 / 0.60 | creativity +4, solidity −3 |
| LW, RW | Winger (LW default) | 0.05 / 0.30 / 0.65 | creativity +3 |
| LW, RW | Inside Forward (RW default) | 0 / 0.15 / 0.85 | creativity +1 |
| LW, RW | Wide Playmaker | 0.05 / 0.50 / 0.45 | creativity +3, solidity −1 |
| LW, RW | Defensive Winger | 0.30 / 0.45 / 0.25 | solidity +3, creativity −2, fatigue +5 |
| ST | Poacher | 0 / 0 / 1 | creativity +1 |
| ST | Target Man | 0 / 0.20 / 0.80 | solidity +1 |
| ST | Complete Forward (default) | 0 / 0.15 / 0.85 | creativity +2 |
| ST | False Nine | 0 / 0.40 / 0.60 | creativity +3, solidity −1 |
| ST | Pressing Forward | 0.10 / 0.15 / 0.75 | solidity +2, fatigue +6 |

Creativity and solidity are percentages of expected goals (summed over the eleven; see section 8). Fatigue is extra condition lost per 90 minutes, averaged over the eleven.

### Live modifiers

In Season and Dynasty each squad player carries live state (`SquadPlayer`): condition, morale, sharpness, familiarity (all 0 to 100), the last six match ratings, injury, suspension, yellow cards and season statistics. The effective rating in a slot is `roleRating` multiplied by:

| Modifier | Formula | Range |
| --- | --- | --- |
| Condition | 1 at ≥ 85; `1 − (85 − c) × 0.003` down to 70; `0.955 − (70 − c) × 0.0045` below | about 0.66 at 5, 1.0 at 85+ |
| Morale | `1 + ((m − 65) / 35) × 0.04` | 0.937 to 1.04 |
| Sharpness | 1 at ≥ 75; `1 − (75 − s) × 0.0012` below | 0.934 to 1.0 |
| Familiarity | `0.95 + (f / 100) × 0.07` | 0.95 to 1.02 |
| Form | `1 + clamp((avg of last 5 ratings − 7) × 0.02, −0.03, +0.03)` | 0.97 to 1.03 |

Quick Draft and Daily pass no state, so all five are 1.

Starting state: drafted players begin at condition 96, morale 70, sharpness 70, familiarity 35. Signings arrive at familiarity 20 and sharpness 65. AI squads start at familiarity 70 and sharpness 85.

## 7. Team strength, chemistry and balance

`computeTeamStrength` (`src/engine/ratings.ts`) turns the eleven into four unit ratings.

1. Each slot's effective rating is split into GK, defence, midfield and attack by its role's contribution. Each unit's rating is the contribution-weighted mean of what flows into it.
2. **Numbers.** Defence, midfield and attack are each scaled by `0.88 + 0.12 × clamp(share / baseline, 0.5, 1.5)` against baselines of 4.0, 3.2 and 2.8 contribution shares, so a shape that starves a unit pays for it and one that floods it gains a little.
3. **Fill.** Units are multiplied by `filled slots / 11`; a missing goalkeeper multiplies goalkeeping by 0.4.
4. **Chemistry** is added to every unit. Over the 55 pairs in the eleven: +1 for two players from the same club-season, +0.4 for the same club within two seasons, +0.2 for a shared nationality (unknown nationality excluded). `linkPoints = min(1.5, score / 55 × 5)`. Average familiarity with the system adds `((avgFam − 50) / 50) × 1.2`, so chemistry runs from −1.2 to +2.7 rating points. The Dugout lists the top three club-season links.
5. **Balance** is `1 − (max unit − min unit) / 35`, clamped to 0 to 1.
6. **Overall** is `(0.18 GK + 0.30 DEF + 0.26 MID + 0.26 ATT) × (0.96 + 0.04 × balance)`.

`autoPickLineup` fills the hardest slots first (GK, then by scarcity of natural players), in two passes (fit ≥ 0.86, then anything), scoring `roleRating × condition × sharpness`, and benches the next nine by overall. It drives AI clubs, the Auto-pick button, the start of each season (the strongest eleven regardless of where the draft put people) and lineup repair before kick-off.

## 8. The match engine

`simulateMatch` (`src/engine/match.ts`) produces expected goals per side, draws goals from a Poisson distribution and then dresses the result with a minute-by-minute report. It is played in three segments with two stops (1-45, 46-70, 71-90): `beginMatch` plays the first, `advanceMatch` the next two, `finishMatch` whatever is left plus the report, and `simulateMatch` is exactly `beginMatch → advanceMatch(70) → finishMatch`, so a week the assistant sims and a week played by hand run one path (a test holds them identical event for event, through a JSON round trip of the paused state). See "The 70th-minute window" below for the segment shares.

### Expected goals

```
BASE_XG = 1.32
K       = 0.055
stretch(x)      = x + max(0, x − 80) × 0.8
attackPower(s)  = stretch(0.62 × attack + 0.38 × midfield)
defencePower(s) = stretch(0.55 × defence + 0.28 × goalkeeping + 0.17 × midfield)

λ_home = BASE_XG × exp(K × (attackPower(home) − defencePower(away)))
         × home.tactical.attack × away.tactical.defence × 1.12 × homeTeamTalk
λ_away = BASE_XG × exp(K × (attackPower(away) − defencePower(home)))
         × away.tactical.attack × home.tactical.defence × 0.90 × awayTeamTalk
```

Neutral venues (cup final, friendlies) use 1.0 for both. The stretch means the gap between a 90 and an 87 counts for far more than the gap between a 72 and a 69, so an all-time XI feels like one. Training and one-off event boosts multiply λ next (section 10).

Then:

- **Big matches.** When importance > 1, each side's λ is multiplied by `1 + (avgBigMatch − 0.5) × 0.14 × (importance − 1) × 2.5`. Importance is 1.4 for a cup final, 1.3 for a title decider (matchweek 28 onwards, you in the top two, them in the top three), 1.25 for a derby or cup semi-final, 1.1 for any other cup tie, 0.9 for a friendly.
- **Variance.** `λ × exp(N(0, σ))` with `σ = 0.06 + 0.12 × (1 − avgConsistency)`. A metronomic side swings about 6 per cent; a flaky one about 18.
- **In the air.** A player's aerial power is `(strength + jumping) / 2`. Each side's λ is multiplied by `1 + 0.04 × clamp((attackAerial − oppDefenceAerial) / 8, −1, 1)`: the attacking side's power weighted by each man's attack share (plus 0.3 so everyone counts) against the defending side's weighted by defence share, so a mismatch of eight points or more moves expected goals by 4 per cent each way (`aerialOf`, `mismatchFactor`). On top, every side gets a set-piece term from its three most powerful outfielders on the pitch: `((top3 aerial − 72) / 100) × 0.04`, clamped −0.03..+0.04 (`aerialBonus`), beside the designated takers' bonus below. Measured on a mid-table XI with the same seed: all men at 90 strength and jumping against all at 55 gives ×1.0475 and ×0.9535.
- **Legs.** After the 70th minute every starter still on has his effective rating cut by `0.10 × legs(stamina)`, `legs = clamp((75 − stamina) / 50, 0, 1)` (nothing at 75 and above, 5 per cent at 50, 10 at 25); the side's fade is the mean cut over the eleven on the pitch, substitutes and the goalkeeper counting as fresh, and the 71-90 segment's λ is multiplied by `(1 − ownFade) × (1 + oppFade)` for each side (`applyLateFade`). Over 600 seeded matches a side at stamina 35 scores 23.7 per cent of its goals after 70 against 24.0 for the same men at 90. Keepers are exempt from every legs effect (the fade, the stamina factor on condition loss and the tired-legs injury term) because their stamina in the data reads low by convention (36 on average in the Premier League pack against 67 for outfielders): he does not run, so the number says nothing about his last twenty minutes.
- **Short-handed.** Minutes played with fewer than eleven (red cards, injuries with no replacement) reduce own attack by up to 30 per cent and lift the opponent's by the same.
- λ is clamped to 0.12 to 5.8. Goals are `poisson(λ)`. Shots are `max(goals, poisson(7.5 λ))`, on target `max(goals, min(shots, poisson(3 λ)))`.
- Possession: `50 + 1.1 × (home midfield − away midfield) ± 4 per short or direct passing side + 2 for home + N(0, 3)`, clamped 28 to 72.

### Team talks

Chosen before each match (default Encourage). Effects are a multiplier on your own λ with a line in the report:

| Talk | Outcome |
| --- | --- |
| Calm | ×1.02 if you are underdogs by more than 3 rating points or on a 55% roll, else ×0.99 |
| Encourage | ×1.025 on a 60% roll, else ×1.0 |
| Demand | Favourites by more than 4: ×1.03 (60%) or ×0.985. Otherwise ×1.02 (35%) or ×0.975 |
| Fire up | Professional squad (avg professionalism > 0.6): ×1.035 (50%) or ×0.98. Otherwise ×1.03 (60%) or ×0.97 |

### Discipline

Per outfield player, probability of a yellow card over the match: `(0.07 + 0.09 × defensive share + 0.02 if physical > 82) × pressing (1.25 high, 0.9 low) × 1.2 if derby (importance ≥ 1.2) × (1.15 − 0.3 × professionalism) × (0.7 + 0.6 × aggression / 100)`, rolled once per segment at the segment's share of the match (`(to − from + 1) / 90`: 0.5, 0.278, 0.222). A booked player has a `0.09 × share × aggression factor` chance of a second yellow in each later segment. Straight red: `(0.004 + 0.004 × defensive share) × derby factor × share × aggression factor`. The aggression factor runs from 0.7 for the meekest to 1.3 for the most combative; over 500 seeded matches a side with every man at 99 collects 1.65 times the cards of the same side at 10 (737 against 447), and because outfield aggression averages about 68 the engine's card rate rose 15 per cent when it arrived (2.81 a match over the pinned 2,000-match rotation, from 2.45). A booking is stamped with its minute, so a second yellow, a straight red or a substitution for that player never comes earlier than the booking. A sent-off player stays in his slot for the second-half numbers (the man disadvantage is costed once, by the short-handed factor) and still counts as having been on the pitch before his dismissal. Suspensions count down one match for every match the player's side plays without him, for your squad and for every AI club.

### Injuries

Per player not sent off: `0.021 × (0.5 + injuryProneness) × conditionFactor × fatigueFactor × share` per segment, where condition below 55 doubles the risk, below 70 is ×1.45 and below 80 is ×1.1, and `fatigueFactor = 1 + 0.3 × clamp((70 − stamina) / 40, 0, 1) × clamp((80 − condition) / 40, 0, 1)`: tired legs on an outfielder with little stamina add up to 30 per cent (stamina 30 or less at condition 40 or less), fresh legs, a durable player or a keeper add nothing. Over 1,500 seeded matches at condition 40 a side at stamina 30 suffered 636 injuries to 490 for the same men at 90; at condition 95 the two are level (245 to 249). Injury proneness is shown as the 1 to 5 Injury risk. Severity:

| Roll | Injury | Weeks out |
| --- | --- | --- |
| 55% | Knock, dead leg, tight hamstring, bruised ribs, twisted ankle | 1 to 2 |
| 30% | Hamstring, calf or groin strain, sprained ankle, hip problem | 3 to 5 |
| 12% | Torn hamstring, knee ligament damage, broken foot, shoulder dislocation | 6 to 10 |
| 3% | Ruptured ACL, broken leg, Achilles rupture | 12 to 24 |

Injured players are replaced from the bench if a fit, unsuspended substitute exists (scored by `overall × positionFactor × (condition / 100 + 0.5)`), otherwise the side finishes short.

### Substitutions, goals and ratings

- Up to five substitutions; up to three routine changes around the 68th minute (σ 9, between 50 and 88), drawn once at the restart and tiredness-driven: a starter wants off if `condition − 8 (when tactical fatigue > 4) − 8 (if aged 33+) + 0.3 × (stamina − 65) + N(0, 6)` is below 72, or on falling odds of 75, 55 and 30 per cent for the first three candidates, the candidates ordered by that score so the low-stamina men go first (over 300 seeded matches with half the XI at stamina 40 and half at 90, the 40s came off 631 times to the 90s' 246). A change due after the 70th minute is decided then (the replacement is chosen and reserved) but parked in `pendingSubs` and made when the last segment is played, so the pitch at the 70' stop is the one the manager sees; a red card or injury to the man coming off, or a used substitute, cancels it.
- Each goal picks a minute (bias to late in each segment; a fifth of the last segment's goals fall in stoppage time, about 4.7 per cent of all goals, as 9 per cent of a whole second half's did), then: 2.5 per cent own goal by a defender; 9 per cent penalty, taken by the best shooting plus mentality; otherwise a scorer weighted by `(attack share × 1.6 + 0.08) × (shooting / 100)^2.2`, with an assist 78 per cent of the time weighted by midfield and attack share, passing squared and role creativity.
- Keepers are credited with a save only for a chance the log records as saved; a summary match without a log tallies saves at three of every eight chances, so AI keepers' ratings are comparable.
- Player match ratings start at 6.6, move 0.22 per goal of margin (capped ±0.8), +0.9 per goal, +0.5 per assist, +0.5 for a clean sheet or up to −0.6 for goals conceded (defenders, DM and GK), GK saves +0.12 each (max +0.9), `(effective rating − 75) / 100 × 1.2` for quality, Gaussian noise scaled by `0.45 × (1.1 − 0.7 × consistency)`, −1.2 for a red, −0.15 for a yellow, damped for cameos under 30 minutes, clamped 4.5 to 10. Man of the match is the highest rating with at least 20 minutes.
- Condition lost per player: `(26 + tactical fatigue + 5 if 33+ or 2 if 30+ + (100 − physical) / 10 + 2 if fast tempo) × (1.25 − 0.5 × stamina / 100) × minutes / 90`: the stamina factor is 1.0 at 50, 0.8 at 90 and 1.1 at 30 (a keeper always takes 1.0), so a side at stamina 35 loses nearly a third more than the same men at 90 (365 against 283 points over the XI per match in the seeded test).

The match screen replays the events as a live ticker under the live pitch, the momentum bar and the xG race (see "Match detail and the pitch views" below), then shows the report: scoreboard, goals, the momentum and xG charts, the shot map, possession and territory, xG, possession, shots, team ratings, tactical notes with the attack and defence multipliers, the half-time talk and the shout as they landed, player ratings with rating bars for both sides, substitutions, both sides' shapes with their instructions and the opponent's unit ratings.

### Watch, Auto-play and Sim result

`GameSettings.matchPlay` (optional; unset reads as `'watch'`, so every save written before it plays as before; Season and Dynasty only: `matchPlayOf` returns `'watch'` for Quick Draft and the Daily) is how the Dugout's play button plays the next match, changed in one tap on the Dugout's "Match:" chips. The store's `playWeek` calls `playMatchweekAs` (`src/game/logic/assistant.ts`):

- **Watch**: today's flow. The match stops at half time and at 70 minutes and the stop opens as a pop-up (`DecisionSheet`: a dialog low on a wide screen so the scoreboard stays in view, a bottom sheet on a phone, over a light scrim, scrolling inside itself with its action row always visible; focus moves in and back; Escape or ✕ minimises it to a "Decisions" pill and the match stays paused). It holds the talk or shout, the four instructions and the substitutions, and five actions: Play on (your changes), No changes, Let the assistant decide (`assistantCall`), Finish the match (your changes now, the assistant takes the later stop and the match plays on the pitch to the whistle) and Full sim (your changes now, then straight to the whistle and the report). While watching, "Auto from here" hands the stops still to come to the assistant and "Skip to full time" finishes the match with him at once.
- **Auto-play**: the whole match is watched, and each stop is answered by the assistant 0.7 s after it is reached, with no pop-up. A match reloaded mid-way under Auto-play carries on with the assistant (`assistantTakesStops`, read when the save loads); a cup tie that follows the league match goes back to the saved preference, whatever "Finish the match" or "Auto from here" asked for the league match.
- **Sim result**: the match is played to the whistle at once with the assistant at both stops (`simLiveMatches`, the user's cup or European tie that follows too) and the screen opens on the report.

`assistantCall(game, u)` is pure and draws nothing. At half time: a talk from the score and the XI's mean morale (calm when ahead, encourage when level, fire up when behind with morale at 65 or more, encourage otherwise), and a change only for a man whose estimated condition is below 50 (a man injured in play has already been replaced by the engine when a fit substitute was free, so the assistant never sees him on the pitch). At 70: a shout from the score (all-out attack when behind, shut up shop one or two goals up, keep shape when level or three up) and changes for the injured and the tired, estimated condition below 65 (his kick-off condition less the engine's own cost per ninety for his minutes: age, physique, tempo, the side's fatigue and stamina), the most tired first; a keeper is never taken off for tiredness. Each is replaced by the best man on the bench for the slot: fit and unsuspended, not yet used in the match or this call, a natural fit before anyone else, then by rating in the slot times condition; never more than the changes left (three at the break, five in all). Instructions are left alone, because a change there would be written into the saved tactics. The calls go through `advanceLiveMatch`, the path a human's take, so the engine sees nothing new: Sim result and Auto-play give the same result, squad and generator state for the same save (tested over 35 matchweeks), and Watch with "No changes" at both stops reproduces results pinned before this change (six seeds, eight matchweeks, the final generator state included). `ENGINE_VERSION` did not change. Switching to a parked game, or starting a new one, sets the assistant switch from that game's own preference, never from the last game's. A live league match followed by a cup tie now shows the league result (the 71-95 replay) before the tie, which it skipped before.

### The 70th-minute window and touchline shouts

A live match stops twice: at half time and at the 70th minute. `MatchInProgress.clock` is 45, 70 or 90 (a paused match saved before the window existed has no clock and reads as 45, so it resumes at half time). `advanceMatch(mp, lookups, changes, to)` plays from the stop to 70 or to 90:

- **Segment shares.** Each segment takes `(to − from + 1) / 90 × (0.94 in the first half, 1.06 in the second)` of the match's expected goals: 0.47 for 1-45, 0.294 for 46-70 and 0.236 for 71-90 (0.53 for the second half, as before; Poisson additivity keeps the full-match goal distribution exact). Cards and injuries take the plain minute share (0.5, 0.278, 0.222); the two-half engine hard-coded 0.5 per segment, which three segments would have inflated by half. Pinned on the old engine over 2,000 seeded matches (seed `window-baseline`): 3.982 goals, 2.449 cards and 0.3745 injuries a match; the three-segment engine measures 4.027, 2.446 and 0.3755, within 3 per cent, and the last twenty minutes carry 19 to 26 per cent of the cards.
- **At half time** (clock 45): the human side's talk, instructions and up to three substitutions, as before; the AI side two goals down goes attacking (pressing low → mid), two up drops from attacking to balanced.
- **At 70** (clock 70): the human side's instructions, whatever is left of the five substitutions (minute 70, reason `70th minute`) and one shout for the last twenty minutes. All-out attack multiplies own expected goals by 1.3 and the opponent's by 1.35 and adds 4 to the side's fatigue modifier; shut up shop is ×0.55 own and ×0.72 opponent; keep shape is ×1 both ways. The shout is read at 70 only, the talk at 45 only, and the multipliers apply to the 71-90 segment alone. The AI side trailing at 70 goes attacking with a fast tempo; one goal up it goes defensive with a deep line; level or two or more up it keeps what it has. Both rules live in `advanceMatch`, never in the UI, so a simmed match reacts the same way. If the manager makes a substitution at 70, his side's parked routine changes are dropped; the AI's always go ahead.
- Strengths, modifiers and man-marking are recomputed at both stops, and the substitutions the engine made at a stop are written back into the lineup and the bench (only those: a man who has already played cannot come back on, so the panel at 70 does not offer the men taken off at the break, and a change the engine refuses never reaches the lineup). The report's `halfTimeEffect` and `lateEffect` carry the two interventions' text.
- The store action is `advanceLive(changes)`; `advanceLiveMatch` in `week.ts` plays to 70 and returns with `game.live` intact, or finishes the match and carries the week on. `finishLiveMatch` remains as "play to the whistle": the changes apply at the current stop and the side plays on unchanged. Because every match now consumes the stream differently, `ENGINE_VERSION` became `'3'`: challenge links built on `'2'` verify as unverified rather than failing. The depth attributes moved it to `'4'` (every λ change moves how many draws a Poisson takes), and the pinned means over the same 2,000-match rotation are now 4.122 goals, 2.812 cards and 0.3935 injuries a match (from 4.027, 2.446 and 0.3755); a seeded elite-against-mid match (`depth-pin`) is pinned at 1-0 with 25 events and 5 cards so any later change to the draws is noticed.

### Match detail and the pitch views

Each segment, once its goals, chances, cards and substitutions are decided, forks a stream off a copy of the generator (`Rng.fromState(rng.getState()).fork('detail-<from>')`) and fills in the detail the pitch views need (`src/engine/matchDetail.ts`). Because the fork is taken from a copy, the match's own stream, and the week's fixtures after it, never move: a pinned test (seed `detail-chances`, 100 matches) holds the goals, the chances and saves and the caller's final generator state to the engine without the detail, and the detail never moved `ENGINE_VERSION`. The pin was taken at 404 goals and 774 chances and saves on engine `'3'`; the depth attributes (engine `'4'`) moved it to 432 and 769, the same with the detail calls switched off, so it was re-pinned at those values.

- **Shot positions.** Every goal, penalty, own goal, chance and save carries `position: { x, y }`: x 0 to 100 along the pitch towards the goal the side attacks, y 0 to 100 across (105 by 68 metres, so the box edge is x 84.3 and the box spans y 20.4 to 79.6). Penalties are at the spot (89.5, 50). Own goals are at x N(96, 1.5) clamped 92 to 99. Headers, corners, tap-ins, six-yard and on-the-line efforts (read from the event text) are at x N(95, 2) clamped 90 to 99, y N(50, 7) clamped 30 to 70. Otherwise one effort in five (and every "edge of the box" one) is from outside the box, x N(79, 3.5) clamped 68 to 84, y N(50, 11) clamped 25 to 75; the rest are in the box, x N(90, 3.5) clamped 84.3 to 98.5, y N(50, 11) clamped 22 to 78. Over 150 seeded matches more than 60 per cent of shots are in the box and 10 to 30 per cent outside it.
- **Momentum.** `momentum` holds eighteen values, one per five-minute bin (1-5 to 86-90, stoppage time in the last), each the home side's share of the pressure, 0.08 to 0.92. A bin starts from `λh / (λh + λa)` for its segment (the expected goals the engine used, so tactical modifiers, shouts and a man down are already in it), adds the mentality and pressing lean (attacking +0.03, defensive −0.03, high press +0.015, low −0.015, home minus away), a chase term for the side behind (`0.05 × min(2, goal difference)`, ×1.2 from the 46th minute and ×1.6 from the 71st), ±0.12 for a goal in the bin and ±0.05 for one in the bin before, ±0.04 per chance or save in the bin and an N(0, 0.06) wobble, and then carries 35 per cent of the bin before. A match paused before the detail existed fills its missing bins with the base share.
- Both live in `MatchInProgress` (so a paused match carries the segments played) and in `FullMatchResult`. The team report adds `appearances` (each man's slot, minutes on and off, a red or an injury) and the final `tactics`, for the shape views. All fields are optional; older results simply show no shot map or pitch. Only a full-detail match (the user's league, cup, European and friendly matches) carries them: a summary match (the other fixtures of a week, every match of a quick season or a head-to-head) skips the detail, since nothing draws its pitch and every one is kept in the save's fixtures. With the detail on all 380 fixtures a season's save grew from about 9.8 to 14.2 KB per played fixture and passed the browser's 5 MB storage quota before the last matchweek; skipping it moves no result, because the detail never draws from the match stream.

The pitch views are pure UI (`src/ui/match/` and `src/ui/components/LivePitch.tsx`, `MatchCharts.tsx`):

- **Placement.** A slot's point is its formation coordinate, +4 along the pitch for an attacking mentality and −4 for a defensive one, the back line (slots below y 36) +7 for a high line and −6 for a deep one, wide slots (more than 22 from the centre) spread ×1.14 for wide and ×0.8 for narrow; the keeper never moves. The away side is mirrored through the centre spot. Opposing slots closer than six metres are pushed apart, and a substitute takes the point of the slot he fills.
- **The ball.** `buildBallPath` (`src/ui/match/possession.ts`) lays out keyframes on one continuous timeline from a seed of its own (`ball-<seed>-<from>`, never the game's generator): a kick-off from the centre spot at 0 and 46 (a replay from 71 starts where the 46-70 path ended, `startAt`), then cycles of a carry (the man on the ball runs 1.5 to 5 units with it, mostly forwards, over 0.16 to 0.34 of a minute) and a pass, most passes 10 to 25 units (weight `exp(-((d - 16) / 13)^2)`, forward ×1.5, within 48 units), or an interception by the nearest opponent with probability `0.06 + 0.4 × (1 - share)` from the momentum bin. Every hop lasts its length over `PASS_SPEED` = 46 units a minute (at least 0.22), shots fly at 120, and nothing may land after the next shot's run-up, so the ball never covers half the pitch in a frame. Passes over 34 units are lofted (peak 0.55 to 0.8), a quarter of the 24-to-34 ones too, every hop bends by up to 8 per cent of its length, crosses into the box by 12 per cent and a keeper's kick after a save is a high ball. The k shots of a minute m start at m + (i + 0.55) / k and are then spread apart within their minutes (never before m + 0.05 or after m + 0.95; `strikeTimes`) so that the ball has time to get from one strike to the next: 0.35 of a minute for the restart plus the distance between the two shots at 70 units a minute, 0.3 plus the distance from the centre spot after a goal, and the first strike of a range leaves time for its kick-off. After a goal, when the scorers strike again within a minute and a half, the side kicking off does not play it about first; after a save or a miss the restart leaves the next move the time it needs; a hop squeezed to fit before the next strike may be at most 1.8 times its own speed or it does not happen, and a last ball into the shooter that still has to be quick goes long and in the air. Over 30 real matches no more than one hop in four matches is faster than 3.5 times the pass speed (the worst about 6×, against 15× before; tested). Then: a build-up of up to 1.8 minutes before, a turnover if needed, a pass towards the box when there is time, then the ball into the shooter's stride at the event position (he runs onto it); after it the net and a kick-off by the other side, the keeper's hands and a long kick, or wide of the post, fetched and a goal kick. `ballAt` moves the ball along the quadratic curve of each hop with a smoothstep ease (a carry with smootherstep), so it eases in and out of every pass and never changes direction at speed, and reports its height `4·loft·f(1-f)` and the man in control (the carrier through a carry, the receiver as a pass arrives: someone is on the ball about 42 per cent of the time, against 3 before).
- **The football.** `BallArt` in `LivePitch.tsx`: a white sphere with a radial shading gradient, a gloss overlay and black pentagon patches drawn as a repeating tile inside a circular clip; the loop slides the tile the way the ball travels (55 per cent of the distance, at most 28 per cent of a tile a frame so it never strobes), so it rolls. In the air it rises (up to 4.2 SVG units) and grows (up to 1.4×) while its ground shadow shrinks and fades. Radius 1.5 SVG units lying down, 1.75 standing up on a phone, where bigger, fewer patches keep it reading as a football.
- **Motion.** One `requestAnimationFrame` loop reads the continuous clock (`timeline` in `src/ui/match/clockStore.ts`) and eases everything on screen towards its target, frame-rate independently (`approach`): the ball by 14 ms at 1x (38 at 2x, 85 at 4x, where a hop lasts a few frames and the ball rounds the path's corners instead), the players by 150 ms (up to 300 at 4x), so a change of possession, a kick-off, a substitution or a skip never makes anyone jump. The man on the ball stands 2.3 units behind it, the man a pass is going to runs to meet it, the blocks lean with a 700 ms-smoothed ball and the nearest men drift towards a 260 ms-smoothed one, so nobody twitches with each pass. A substitute walks on from the touchline by the halfway line (eased three times slower for his first 1.5 s). Dots are keyed by side and player-season (`dotKey`), because the same player-season can turn out for both sides when you drafted him from today's opponent: before, one of the two dots stood frozen all match and the other ran as your scorer. Where everything stood on the last frame drawn is kept per match (`frameFor`, the pitch seed), so the next segment (46, 71 and the replay from 71) and any re-render of the pitch carry on from there rather than snapping back to the formation; a pitch that starts earlier than the last one (watching again from the kick-off) starts afresh. A new segment that finds the ball far from its kick-off rolls it to the spot over 0.9 s (eased by 160 ms) rather than snapping it there. Time moves things only while the clock runs: stood at a stop or paused, a redraw moves nobody, and the first frame after a sleep takes no time step. Just past a goal's hold the ball is held on the centre spot for the kick-off. React renders only when the whole minute changes, a goal is revealed or a celebration starts (the ticker's 40 ms timer sets the store only when one of them changes), never inside the loop; markings and nets are memoised and each dot keeps one ref callback. With prefers-reduced-motion the loop is off: the dots are still and the ball jumps from keyframe to keyframe.
- **The clock.** The ticker owns an anchor (`at` minute at real time `since`, speed, period) and the pitch reads a fractional minute from it every frame, so the ball never waits on a late timer at a minute boundary. A segment ends at the end of its stop minute (46, 71, 95). Pause, resume and speed changes re-anchor where the picture stands (`reanchor`); "Skip to half time" jumps the anchor to the end. The speed is a per-viewer convenience kept in `localStorage` (`touchline-ticker-speed`). When the tab is hidden the ticker pauses the clock (it runs on real time, so it would otherwise play on unseen, goals and stops included) and resumes it when the tab is back, unless you had paused it yourself.
- **The goal.** When the clock reaches a goal's strike moment it holds (`goalHolds`): 2,800 ms for the user's goal, 1,700 ms for one against him, 2,600 when neither side is the user's, 1,500 ms with reduced motion. In real time during the hold: the ball flies from the shooter's foot into the net (520 ms, `GOAL_FLIGHT_MS`, a slight lift and curl); as it crosses the line the score changes (the scoreboard number pops, the ticker's goal line lights up and the charts get the goal: nothing shows the goal before the ball goes in), the net bulges with a damped wobble (`netBulge`), the pitch flashes white (0.42 opacity decaying over 170 ms, 0.16 for a goal against) and, for a goal of ours, shakes for 380 ms; the "GOAL!" banner (GOAL! (PEN) and OWN GOAL! with the defender's name and "(og)") bursts out with the scorer, the minute and the new score in the scoring club's colour, with 42 pieces of confetti in that colour, white and a contrast colour; the scorer runs towards the corner flag with a pulsing ring in his colour and his team-mates converge on him (`celebrationEnvelope` rises over half a second and is back to nothing 150 ms before the end, so nobody jumps at the restart); the ball fades out of the net and back in on the centre spot, and play resumes with the kick-off. A goal against is short and subdued: a smaller, dimmer banner, a smaller bulge and flash, no shake and no confetti. Reduced motion: no flight, no shake, no confetti, a still banner for the 1,500 ms hold. All of it is presentation of events the engine already produced; nothing draws from any game generator.
- **Charts.** The momentum bar draws each bin up (home) or down (away) as the clock reaches it, with goal markers. The xG race shares each side's match expected goals over the ninety minutes by its share of the pressure in each bin, so it climbs faster in a side's spells on top and ends exactly on the match xG. Territory on the report is the mean of the momentum series. The match card (`renderMatchCard` in `src/ui/shareCard.ts`) draws the score, the shot map and the xG race on a 1080 by 1350 canvas.

## 9. Tactics and instructions

Six instructions plus a role per slot (`src/engine/tactics.ts`). `attack` multiplies your λ; `defence` multiplies the opponent's λ against you (lower is better); `fatigue` is extra condition lost per 90.

| Instruction | Setting | Attack | Defence | Fatigue | Depends on |
| --- | --- | --- | --- | --- | --- |
| Mentality | Attacking | ×1.12 | ×1.10 | | |
| | Defensive | ×0.86 | ×0.86 | | |
| Pressing | High | ×(1.05 + edge + bite + 0.1 × wr) | ×(1.03 − edge / 2 − 0.05 × wr) | 7 at outfield stamina ≤ 60 down to 4 at ≥ 80 | `edge = clamp((78 − opponent composure) / 100, −0.06, 0.08)`; `bite = clamp((avg aggression − 60) / 1000, −0.015, 0.015)`; `wr = clamp((avg work rate − 55) / 100, −0.2, 0.25)` |
| | Low | ×0.96 | ×0.95 | −2 | |
| Tempo | Fast | ×(1.04 + 0.08 × wr) | ×1.03 | +2 | quick counters need runners: `wr` as above, so ±2 points |
| | Slow | ×0.97 | ×0.96 | | |
| Width | Wide | ×1.04 with two wide forwards, else ×0.98 | | | formation has ≥ 2 LW/RW slots |
| | Narrow | ×1.04 with at most one wide forward, else ×0.98 | ×1.03 if opponent is wide | | |
| Defensive line | High | ×1.03 | ×0.98 if CB pace ≥ min(84, opponent forward pace − 2), else ×1.08 | | centre-back pace |
| | Deep | ×0.96 | ×0.95, ×1.02 more if opponent plays direct | | |
| Passing | Short | ×1.04 if midfield passing ≥ 80, ×1.0 if ≥ 72, else ×0.96 | | | DM/CM/AM passing |
| | Direct | ×1.04 if striker physical ≥ 80, ×1.0 if ≥ 72, else ×0.96 | | | ST physical |

Role effects: `attack × (1 + Σ creativity / 100)`, `defence × (1 − Σ solidity / 100)`, `fatigue + Σ fatigue / 11`.

Work rate and aggression are bounded on purpose: a pressing, fast side with every man at work rate 80, aggression 80 and stamina 85 gets ×1.471 attack against ×1.328 for the same men at 35, 40 and 55 (the press and the counters each take their share, 1.074 and 1.035), with the notes "A hard-working side makes the press stick" and "Low work rate: the press is half-hearted" written into the report.

Match-ups against the opponent's instructions: a low block with a defensive mentality cuts your attack ×0.92 ("parking the bus"); fast direct play against your high line raises their chances ×1.05; slow short passing when you do not press high cuts your attack ×0.97. Every triggered rule writes a note into the match report.

AI clubs play a fixed style from the club master list:

| Style | Formation | Instructions |
| --- | --- | --- |
| Possession | 4-3-3 | balanced, mid press, slow, standard width, high line, short |
| Counter-attack | 4-2-3-1 | balanced, low press, fast, standard, deep, direct |
| Direct | 4-4-2 | balanced, mid, fast, wide, standard, direct |
| High press | 4-3-3 | attacking, high, fast, standard, high, mixed |
| Defensive | 5-3-2 | defensive, low, slow, narrow, deep, direct |
| Balanced | 4-2-3-1 | all defaults |

## 10. Season systems

### Setup

Your club replaces the host club in the chosen real season. The other nineteen are built from their real squads, each with live state so they too suffer injuries and suspensions. Fixtures are a double round robin (circle method, rounds shuffled by the seed): 38 matchweeks, 380 matches. Board confidence starts at 60.

### Pre-season

Up to three friendlies against a random club-season that finished 8th or lower (or is in progress), at a neutral venue with importance 0.9. Each friendly costs 60 per cent of normal condition, adds 9 sharpness and 8 familiarity to those who played, then everybody recovers 14 condition. Statistics are not counted; injuries are.

### The weekly loop

`playMatchweek` (`src/game/logic/week.ts`) runs in this order:

1. If the assistant is managing (Sim 5, Sim to end), any pending event is resolved with its second option and the team is re-picked; otherwise the lineup is repaired only if it has problems (empty slot, duplicate, injured or suspended starter).
2. Your match, with the training focus and any one-off boost applied to λ, then the other nine fixtures.
3. Any cup tie scheduled after this matchweek.
4. Training injuries, weekly recovery, wages paid out of the budget.
5. Board confidence update and, with job security on, a possible sacking.
6. Transfer window open, advance or close.
7. A 42 per cent chance of a dressing-room event (not after matchweek 38).

When the last match of the season is played live, the match screen keeps the final whistle until you continue; the season closes (`seasonEnding`) when you leave it, or when the assistant plays on. Substitutions made at half time and at the 70th minute are written back into the lineup, so the kick-off XI is snapshotted (`onAt === 0`) before the result is applied, for the appearance and promise bookkeeping.

### The assistant's briefing

`weeklyBriefing(game, u)` (`src/game/logic/briefing.ts`) is a pure, RNG-free function that turns the game state into at most `BRIEFING_CAP` (6) lines, each a `BriefingItem` with a level (`block`, `warn`, `info`, `ok`), a sentence and an optional action (a dugout tab to open and, where needed, an op: repair the lineup, open a player, scroll to the pending decision, play a friendly). The dugout renders it inside the next-match panel in place of the old chip row; it is empty once the season is over or the manager is sacked.

In season the lines come in this priority order: the pending decision (`block`); each `lineupProblems` entry by name with an Auto-pick button, collapsed into one `n lineup issues: ...` line when there are three or more; starters below `BRIEFING_CONDITION` (60) condition or, failing that, below `BRIEFING_SHARPNESS` (50) sharpness, opening the player (injured and suspended starters are left to the lineup line); a starter whose yellow cards stand one short of a multiple of `YELLOWS_PER_BAN` (5); a promised start who is not in the XI; the window as `info` (`January window open, day 3 of 7 · 2 offers for your players`, or `Deadline day ...` on the last day) opening the Market tab; the midweek tie (`Fourth round v Luton midweek. Rotate, you play again Thursday`) opening the Cup or Europe tab; each board objective at risk by `objectiveRisk` (home form one defeat before the limit or past it, a derby lost, a cup exit short of the round, and from `PACE_FROM_MATCHWEEK` (8) a goals or youth-starts projection, `(goals so far / matchweek) × matchweeks` rounded, below the target); and finally one `ok` line, `Training Balanced, team talk Encourage for Arsenal (1st)`, opening the Tactics tab so those knobs are seen to exist. `ok` lines are dropped as soon as any `warn` or `block` line exists, then the cap is applied, so the briefing can only grow with real problems.

In pre-season the same function returns a checklist with `done` marks: three friendlies played (with a Play friendly action), a captain named (the action opens the suggested leader, `suggestedCaptain`: the highest `(mentality − 75) × (0.6 + 0.8 × professionalism)`, plus 10 for a starter, which is the engine's `leadership` modifier with its pivot at `LEADER_MENTALITY` (75), so a man under 75 mentality is never suggested over one above it), roles reviewed (any `tactics.roles[slot]` differing from `DEFAULT_ROLE`), staff hired (the line states the wage room under the cap and that the cheapest hire, a senior physio, costs £15k a week), set-piece takers named, and in Dynasty the youth intake answered. Done lines are `ok`, undone lines `info`, so nothing hides them.

On screens of 720px or narrower the panel's Play, Sim 5 and Sim to end buttons (and Play friendly in pre-season) move into a fixed bottom bar (`.cta-bar`, padded for the safe-area inset) with the briefing's headline (`briefingHeadline`: the first undone line) beside them, so the reason a disabled Play button is disabled is next to it. The page carries `has-bottom-bar` and its bottom padding is the bar's measured height plus 20px, so the last panel and the event card's choice buttons are never under the bar; the bar renders only in the dugout (phases `preseason` and `week`) while the season is live, never on the match screen.

### Condition, sharpness, familiarity, morale

| System | Rule |
| --- | --- |
| Condition recovery | `(31 + (physical − 70) × 0.12 + training recovery) × 0.93 if 30+ or 0.85 if 33+` per week, capped at 100. A week's rest covers one match for a fit player; two matches in a week do not |
| Sharpness | +12 for a start, +6 for a substitute appearance, −6 for a week without a match (floor 30), −10 on return from injury (floor 40), plus the weekly training delta (clamped 20 to 100) |
| Familiarity | +4 for a start, +2 as a sub, each multiplied by `clamp(1 − (55 − work rate) / 100, 0.8, 1)` and rounded (a start is +3 at work rate 35, +4 from 55 up; a sub stays +2), plus the training delta; −12 for everyone on a formation change mid-season |
| Morale after a match | +5 win, 0 draw, −5 defeat, plus `(match rating − 6.8) × 2`, clamped 10 to 100 |
| Playing-time morale | Weekly drift against the squad status (next section): short of the expected share by more than 0.15, `(gap + 0.15) × 12 × (1.3 − 0.6 × professionalism)`; above it by more than 0.15, `(gap − 0.15) × 4`; clamped ±5 a week. This replaced the flat bench penalty |
| Promises | A promised start kept: +5; broken: −16 and an inbox item |
| Suspensions | Every fifth yellow card: one match. Red card: three matches if the match rating was under 5.5, otherwise two. Served one match at a time while he sits out |
| Injuries | Countdown one week per matchweek; cup weeks do not count extra |

### Squad status and playing time

`src/engine/status.ts`. Every contract carries a status, and a player's morale follows the minutes he gets against what the status promised.

| Status | Expected share of minutes | Wage multiplier on signing |
| --- | --- | --- |
| Key player | 0.85 | ×1.25 |
| First team | 0.65 | ×1.10 |
| Rotation | 0.35 | ×1.00 |
| Backup | 0.15 | ×0.90 |
| Prospect | 0.10 | ×0.80 |

- **Defaults.** When a season begins (`beginSeason`, after the opening eleven is auto-picked) every contract without a status gets one by rank in the squad: the top four by overall are key players, the next seven first team, the next six rotation, the rest backup; anyone aged 21 or under who rates below the squad median is a prospect. A player outside the opening eleven starts one step lower than his rank says (a second striker rated fourth in the squad is first team, not a key player), because the shape, not his rating, decides how much he can play. A contract written before statuses existed reads as rotation.
- **Minutes.** `SquadPlayer.recentMinutes` keeps the last six matchweeks for the user's squad only (AI clubs do not track it). League and cup minutes in the same week add to one entry, so a two-match week can exceed 90; a week without an appearance records 0; a bye week records nothing. The share is `min(1, total / (90 × weeks recorded))`.
- **Drift.** In the weekly recovery, with at least one week recorded: `gap = share − expected`. Below −0.15 the player loses `(gap + 0.15) × 12 × (1.3 − 0.6 × professionalism)` morale; above +0.15 he gains `(gap − 0.15) × 4`; the weekly change is clamped to ±5. A key player who does not play loses 5 a week; a backup who starts every match gains 2.8; a rotation player on anything from 20 to 50 per cent is left alone. The flat bench penalty this replaced is gone, not stacked under it. On seed `status-flow` (Burnley 2025-26, 4-3-3, 20 auto-managed weeks) the mean squad morale is 94.7 against 92.2 before; the drain now lands on the one 85-rated striker stuck behind a 90 rather than on whoever last missed two matches.
- **Events.** The wants-to-talk event also fires for a key or first-team player whose share over the last three recorded matchweeks is more than 0.25 under his expectation, at weight 6 instead of 3, with the shortfall spelled out in the text and a fourth choice, "tell him he can leave": +6 morale and the transfer list. The contract event now offers three answers: renew as first team (a key player stays key) on +10 per cent wages (+10 morale), renew as rotation on the same money (+8 morale for a rotation or lower player; a key or first-team player refuses with probability `0.7 − 0.5 × professionalism` and runs his contract down, otherwise signs at −6), or let him go.
- **Market.** A bid carries a status (the market suggests the one his rating would earn in your squad). The player refuses rotation or lower when he would be among your four best, backup or lower when he is at or above your median, and prospect past the age of 21; the refusal names the lowest status he would take (`counterStatus`). His wage is the listed wage times the multiplier, and the wage-cap check uses that figure. A signing's wage is written into `customPlayers`, the pattern renewals already used; loans keep the parent club's wage and sign as rotation. The Club tab changes a status at any time: a promotion is +6 morale and the wage scaled by the ratio of the two multipliers, a demotion −6 morale with the wage kept.
- **Dynasty and academy.** Statuses travel through the summer in all three contract branches; after ageing recomputes the wage from the new value the status multiplier is applied again. Academy signings arrive as prospects.

### Training

One focus per week, applied to the next match and to the week's recovery (`src/engine/training.ts`):

| Focus | Attack λ | Opp. λ | Recovery | Sharpness | Familiarity | Injury risk |
| --- | --- | --- | --- | --- | --- | --- |
| Balanced | ×1.00 | ×1.00 | 0 | +2 | +1 | ×1.0 |
| Attacking | ×1.04 | ×1.01 | −2 | +3 | +1 | ×1.0 |
| Defensive | ×0.99 | ×0.96 | −2 | +2 | +1 | ×1.0 |
| Set pieces | ×1.03 | ×0.98 | 0 | +1 | 0 | ×0.9 |
| Fitness | ×1.00 | ×1.00 | −4 | +4 | 0 | ×1.35 |
| Recovery | ×0.99 | ×1.00 | +9 | −3 | 0 | ×0.6 |
| Tactical | ×1.01 | ×0.99 | 0 | 0 | +5 | ×0.8 |

Training injury per player per week: `0.006 × injury risk × (0.5 + injuryProneness)`, out for one to three weeks.

### The cup

Sixteen of the twenty clubs are drawn (you are always in). Rounds are played midweek after matchweeks 6 (labelled Fourth round), 14 (quarter-final), 24 (semi-final) and 36 (final, neutral venue). Drawn ties go to penalties: each kick scores with probability `0.72 + (team overall − 70) × 0.003`, five each then sudden death. Cup matches use your current lineup, so rotation is on you; knocked-out teams get free midweeks.

### The Continental Cup

Optional at setup for Season and Dynasty (`settings.continental`), and earned by right in later Dynasty seasons by finishing in the top four or lifting the trophy (`game.qualifiedContinental`). `buildContinentalClubs` takes up to four clubs per other loaded league in the same season (nearest season if that league lacks it), ordered by final position then the average of their top fourteen ratings, tops up from the strongest remaining clubs when fewer leagues are loaded, and keeps the fifteen strongest. You are the sixteenth entrant. Rounds fall on the midweeks the domestic cup leaves free: after matchweeks 10, 19, 29 and 33 (scaled for 34-matchweek leagues). Ties are single-leg with penalties, the final is neutral, and importance runs 1.15 (European night), 1.35 (semi-final) and 1.5 (final). Prize money by round reached: £4M, £8M, £15M, £25M, £45M for winners. Winning unlocks Kings of the Continent; league, cup and Europe together unlock The Treble. The knockout flow in `week.ts` is shared by both competitions (`Competition = 'cup' | 'continental'`), with `clubOf` resolving an opponent from the league or the continental field.

### Man-marking

`markTarget` on the user's match input (set from the opposition report, cleared after the match). At kick-off the target is flagged as marked and his effective rating drops by three; while the flag holds, his weight as a scorer and as a creator from attack is multiplied by 0.6 and from midfield by 0.85 (the shares themselves are untouched, so a substitute who takes his slot inherits a clean copy), the opponent's expected goals are multiplied by 0.93 and the marking side's attack modifier by 0.97. The report notes it, and the modifier is re-applied after the half-time recompute.

### Press conferences

Three media events join the deck, rolled like any other after a matchweek: a post-match conference after a league win (single out the man of the match or scorer: +7 for him, −3 for up to two unprofessional stars; credit the squad: +2 all; promise more: +2 board confidence) or defeat (take the blame: +3 morale, −2 confidence; call it unacceptable: +2 for professionals, −5 for the rest, +2 confidence; blame the referee: 40 per cent chance of a £0.5M fine), and the job question from matchweek 12 when you sit more than four places below the board's target with confidence under 45 (claim the board's backing: a coin flip between +6 and −6 confidence).

### Captain and set pieces

`captainId` is passed into the match engine. A captain on the pitch contributes `leadership = clamp((mentality − 75) / 100 × (0.6 + professionalism × 0.8), −0.25, 0.25)`: his side's expected goals are multiplied by `1 + 0.06 × leadership` and the opponent's by `1 − 0.04 × leadership`. Off the pitch, a captain with professionalism ≥ 0.6 and mentality ≥ 72 lifts every squad player below 70 morale by one a week (two below 50).

`tactics.setPieces` names a penalty taker (he takes every penalty while on the pitch), a free-kick taker and a corner taker. The specialists add `((passing − 72) / 100) × 0.06` for corners and `((shooting − 72) / 100) × 0.05` for free kicks to the side's expected-goal multiplier, clamped to −0.04..+0.07, only while they are on the pitch. AI clubs use the automatic choice.

### Player conversations

`src/game/logic/talks.ts`. One conversation per player per matchweek. Form is the mean of the last three ratings (needs two).

| Talk | Condition | Effect |
| --- | --- | --- |
| Praise | form ≥ 7.2 | +8 morale (+10 for a maverick) |
| Praise | form < 6.5 | −4: he thinks you are being sarcastic |
| Demand more | form ≤ 6.6, professional | −2 morale, +6 sharpness, +2 familiarity |
| Demand more | form ≤ 6.6, maverick | −8 |
| Demand more | form ≥ 7.2 | −10: he has been one of your best |
| Promise a start | one promise at a time | +6 now; +5 if kept, −16 if broken (`promisedStart`) |
| Reassure | on the bench, morale < 60 | +7 |

Negative swings are scaled by `1.2 − 0.5 × professionalism`.

### In-season development

`src/game/logic/development.ts`, run after matchweeks 5, 10, 15 and so on (never the last). Growth per block for a player who played every minute: +0.9 at 20 or under, +0.55 to 23, +0.2 to 26, 0 to 29, −0.15 to 32, −0.3 from 33. Positive growth is scaled by the square root of the share of available minutes he played, by `1 + 0.25 × coach tier`, and capped at `potential − overall` with `potential = overall + max(0, 27 − age) × 1.3`. Each attribute moves by the probabilistically rounded delta, the five depth attributes with the rest (keepers: goalkeeping, mentality, passing, physical, stamina, strength, jumping); pace, physical and stamina lose an extra point sometimes when fading. The overall is recomputed and value scales by 1.21 per point. The developed player is stored in `customPlayers` under the same id, so lineups and saves stay valid, and the modal shows the change since the start of the season. A development report lands in the inbox.

### Youth intake

`src/game/logic/youth.ts`, Dynasty only, built in `beginSeason`. Candidates are real player-seasons aged 20 or under rated 58 to 76 within the era filter and not already owned: up to two from any of the host club's real squads across the seasons (tagged Homegrown), topped up to three from the wheel leagues. Signing one costs nothing and gives a three-year contract; passing records the decision. The offer lasts through pre-season.

### Club legends

`finishSeason` accumulates every squad player's appearances, goals, assists, man-of-the-match awards, seasons and titles into `game.careerStats` keyed by the real player id, so a player who ages through several dynasty seasons keeps one record. The Club tab lists the top twelve.

### Backroom staff

`src/engine/staff.ts`. Four roles, three tiers (none, good, elite), wages in £k/week counted in `squadWages` and therefore against the cap.

| Role | Good | Elite |
| --- | --- | --- |
| Assistant (£25k / £60k) | +1 familiarity a week, team talks ×1.15 | +2, ×1.30 |
| Coach (£20k / £50k) | +1 sharpness a week, training boosts +1% | +2, +2% |
| Physio (£15k / £40k) | training injuries ×0.75, +2 condition a week, injuries of 3+ weeks heal a week sooner | ×0.55, +4, every injury a week sooner |
| Scout (£15k / £40k) | +1 scouted listing a market day, hidden traits tagged on the market | +2 a day, and the opponent's weak link in the report |

### Board objectives

`src/engine/objectives.ts`. Two per season, drawn at kick-off from a pool shaped by the board target: a cup quarter-final (semi-final for a top-four target), a league goals tally (1.5 × matchweeks, 1.9 for the ambitious), at most four home defeats (two), ten league starts for a player aged 21 or under, a Continental Cup quarter-final when entered, and no derby defeats when the host has rivals in the league. Progress shows live in the Club tab; at the end of the season each one met adds £5M to the budget and +8 confidence, each one missed costs 6 confidence, and the inbox gets the verdict.

### Board, confidence and the sack

- **Target.** Count the AI clubs whose (calibrated) overall exceeds yours minus 1.5, add one, clamp to 1 to 17. The inbox welcome message states it.
- **Confidence** per matchweek: +2.5 for a win, −3 for a defeat, 0 for a draw; from matchweek 6, +1.5 if you are at or above the target, else `−min(4, (position − target) × 0.8)`. Clamped 0 to 100.
- **Sacked** if job security is on, matchweek ≥ 10, confidence < 12 and the season is not over. The season ends immediately with tier RELEGATED and no prize money.
- Dropping below 20 at any point and surviving unlocks the Survivor achievement.

### Dressing-room events

Rolled from a weighted deck when conditions are met (`src/engine/events.ts`). The Play button is disabled until you answer.

| Event | Trigger | Choices and effects |
| --- | --- | --- |
| A star wants to talk | A player rated 78+ has missed 3+ matches, or a key or first-team player is 0.25 under his expected share of minutes over the last three matchweeks (weight 6 instead of 3) | Promise a start (+12 morale, promise tracked); tell him to earn it (40% + 0.4 × professionalism: +4 morale, +3 condition; else −10 and team −1); hear him out (+4); tell him he can leave (+6, transfer-listed) |
| Contract running down | Matchweek ≥ 24, a contract in its last season not yet answered | Renew as first team or key (+10% wages, +10 morale, signing-on fee 8% of value); renew as rotation (same money: +8 for a rotation or lower player, a senior player refuses with probability 0.7 − 0.5 × professionalism, else −6); let him go (−8, leaves in the summer) |
| Press: can you go unbeaten? | Unbeaten, matchweek ≥ 10, 8+ wins | Embrace (team +5); one game at a time (nothing); laugh it off (team −2, confidence +1) |
| Training-ground bust-up | Squad ≥ 14, 50% | Fine both (−5 each, team +2); back one (+6 / −9); ignore (50%: team +1 or team −4) |
| Derby week | Next opponent is a rival | Feed the fire (attack +5% next match, team +2); treat it normally (defence +4% next match) |
| The board wants a word | Matchweek ≥ 12, more than 3 places below target, confidence < 50 | Ask for backing (50%: +£20M budget, confidence −3; else −6); ask for time (+4); blame the players (confidence +5, team morale −6) |
| An agent calls | 50%, Dynasty only | Take the meeting (+1 bonus spin at the summer draft); pass |
| Physio warning | 3+ players below 65 condition | Two days off (+8 condition all, team +2, sharpness unchanged in code); push through |
| Name your captain | Matchweek 1, or matchweek 20 on a coin flip | Pick one of the three leaders by mentality + age (+8 morale, team +1) |

### Finances

- Starting budget is `clamp(0.3 × host club's real squad value, 30, 250)` GBP millions.
- Wage cap is the larger of the club's natural bill, `clamp(5 × squad value, 900, 4500)` GBP thousands a week, and your drafted squad's wages with 15 per cent headroom, so the board always underwrites the squad you drafted. In Dynasty the cap is recomputed each summer; the budget carries over and the season's income, spending and wages-paid counters reset.
- Weekly cash flow: match-day and broadcast income is assumed to cover the wage cap, so `(wage cap − wage bill) / 1000` GBP millions is added to the budget every matchweek. Under the cap the budget grows; over it the budget drains.
- Prize money at season end: `100 − 3.2 × (position − 1)` GBP millions, plus 12 for the cup. Nothing if sacked.
- Squad cap 23. Releasing a player is free and returns nothing.

### Inbox

A rolling feed of up to 120 items: results, injuries, suspensions, board, transfers, awards, events, cup, info.

## 11. The transfer market

`src/engine/market.ts` and `src/game/logic/marketOps.ts`.

**Windows.** The January window opens after matchweek 19 with 36 listings and 7 market days at price level 1.05. Two days pass automatically with each matchweek you play, and you can advance a day at a time from the Market tab; left alone it shuts after matchweek 23. Dynasty summers open a 40-listing, 10-day window at price level 1.0 that stays open through pre-season and closes at kick-off. Listings respect your era filters.

**Listings** are sampled from club-seasons across the eras, one to three players each, biased to the top of each squad, never a human you already own, and in a one-nation game (section 5) only players of that nation from club-seasons that hold one. Suitors: 1 to 3 for an 85+, 0 to 2 for a 78+, else 0 to 1.

**Asking price** starts from value × price level, then:

| Rule | Multiplier | Tag |
| --- | --- | --- |
| Overall 88+ | ×1.35 | World class premium |
| Overall 84 to 87 | ×1.15 | Star premium |
| Age ≤ 22 and overall ≥ 75 | ×1.15 | High potential |
| Age 33+ | ×0.70 | Veteran discount |
| Won the league that season | ×1.08 | Title winner |
| Last five ratings average ≥ 7.6 (own players) | ×1.15 | In form |
| Average ≤ 6.3 over 3+ games | ×0.85 | Out of form |
| Injured 6+ weeks | ×0.60 | Long-term injury |
| Injured | ×0.90 | Injured |

Prices round to the nearest £1M above 20, £0.5M above 5, else £0.1M.

**Each market day:**

- A listing with suitors has a 35 per cent chance of rising by `4% × suitors` (Bidding war).
- An 80+ player gains a suitor 8 per cent of the time.
- With two or more suitors and no bid from you, 12 per cent chance he signs for a league rival (Gone).
- On the last day, unwanted players (no suitors) drop 15 per cent 60 per cent of the time (Deadline discount).
- 60 per cent chance of one to three new listings.
- For each of your players, `desirability = (overall − 72) / 20 + 0.2 if aged ≤ 25 + 0.3 if morale < 45`; if positive, a `5% × desirability` chance of an offer at 75 to 110 per cent of his asking price from a league club. Accepting banks the fee and releases him; other open offers for him are withdrawn.

**AI signings are real.** When a listing goes to a league rival (two or more suitors, 12 per cent a day; one suitor, 4 per cent), the player-season joins that club's squad and state for the rest of the season, as does any player you sell to them.

**Loans.** Fringe players and youngsters (`loanable`: age ≤ 23 and overall ≤ 83, or overall ≤ 76) are listed with a loan fee of 12 per cent of asking (minimum £0.2M) about half the time. A loan signing pays the fee and full wages, carries `contract.loan`, and goes back to his club in the Dynasty summer.

**Part-exchange.** A bid may include one of your players. The selling club takes him only if he is within eight rating points of the man they lose, under 34 and not injured for four weeks or more, and credits 80 per cent of his asking price (60 per cent past thirty) towards theirs. The bid is judged on cash plus credit.

**Approaches.** Any player in the loaded database can be approached from the market tab (or the shortlist). The club quotes asking × premium by his standing in their squad: ×1.6 for a top-three player, ×1.4 top eight, ×1.25 top fourteen, else ×1.1, tagged Unsolicited approach; one of their top three rated 86+ is refused outright 30 per cent of the time (50 if they won the league). Approached players never sign elsewhere, and fringe ones may be loaned.

**Bidding.** You must have the fee in the budget and room under the wage cap, and fewer than 23 players. Contract length is your choice (one to four years; two at most for a 33-year-old), and so is the squad status he signs on, which sets his wage demand and which he may refuse (section 10, Squad status and playing time). At 97 per cent of asking or more: accepted. Between 85 and 97: accepted with probability `(ratio − 0.85) / 0.12 × 0.7` (+0.15 if nobody else is interested), otherwise a counter at 94 to 100 per cent of asking. Below 85: laughed out, asking +5 per cent, tagged Annoyed. Signings join the bench at familiarity 20, sharpness 65 on a three-year deal (one year at 32+). Signing for under 70 per cent of the opening price unlocks Dealmaker.

## 12. Awards, tiers, achievements and the share text

**Season tiers** (`seasonTier`): PERFECT (38 wins), INVINCIBLE (first, unbeaten), CHAMPIONS (first), TITLE RACE (second), EUROPEAN NIGHTS (3rd to 6th), MID-TABLE (7th to 15th), RELEGATION BATTLE (16th to 17th), RELEGATED (18th to 20th, or sacked). A perfect season shows as "38-0: THE PERFECT SEASON".

**Awards** (`computeAwards`, Season and Dynasty): Player of the Season (best average rating with 15+ appearances), Golden Boot (most goals), Playmaker (most assists), Golden Glove (goalkeeper with most clean sheets; a clean sheet needs 60 minutes), Young Player (23 or under, 15+ apps), and a Team of the Season laid out in a 4-3-3 by average rating. Quick modes report the top scorer and the best average over 15+ apps.

**Achievements** (19, stored with the unlock date in the profile):

| Id | Title | Condition |
| --- | --- | --- |
| perfect | 38-0 | Win every league match |
| invincible | Invincibles | Unbeaten champions |
| champions | Champions | Win the league |
| centurions | Centurions | 100 points |
| double | The Double | League and cup in one season |
| cup | Cup Winners | Lift the cup |
| continental | Kings of the Continent | Win the Continental Cup |
| treble | The Treble | League, cup and Continental Cup in one season |
| boot30 | Thirty Goals | A player scores 30 |
| glove20 | Wall | 20 clean sheets |
| hard-champions | Blindfolded | Win the league after a hard-mode draft |
| one-club-champions | Loyalty | Win the league with a one-club draft |
| one-nation-champions | International | Win the league with a one-nation draft |
| quick-perfect | Quick 38-0 | Perfect season in a quick draft |
| daily-streak-7 | Regular | Seven daily challenges running |
| dynasty-3 | Dynasty | Three titles in a row |
| survivor | Survivor | Keep the job after confidence fell under 20 |
| dealmaker | Dealmaker | Sign a player under 70% of his opening price |
| record-points | Record Books | Set an outright league points record on Realistic over a full season |

**Share text** (`shareText`), copied to the clipboard from the summary screen:

```
Touchline · Quick Draft
Touchline XI as Burnley, 2025-26
CHAMPIONS
29W 6D 3L · 93 pts · 1st
🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟨🟨🟨🟨🟨🟨🟥🟥🟥
⚽ E. Haaland 27
⭐ K. De Bruyne
Seed K7Q2-MX9A
```

Line two names the host club and season; line three is the tier plus "+ CUP" where it applies; the block row is one square per win, draw and defeat; the daily variant labels the mode "Daily 2026-10-24" and omits the seed line; Dynasty labels it "Dynasty Y2".

### In the record books

`src/engine/records.ts` is pure lookups over the real league tables already shipped in `u.tables` (the season tables of each pack plus England's historic 2000-01 to 2007-08 tables); nothing in it touches the RNG.

- **Complete seasons only.** `historicRows(u, leagueId)` returns every row of every complete real season, oldest first. `LeagueSeasonRow` carries no `played`, so a row's matches are `won + drawn + lost`; a season counts when every row adds up to `2 × (clubs − 1)`, which skips the season in progress (`u.currentSeason`, 2026-27 with four to seven matches played); seasons that ship without a table (the Bundesliga's 2008-09 and 2009-10, La Liga before 2012-13, Serie A before 2013-14) never reach `u.tables` (`buildLeague` drops empty tables), and an empty table would be skipped too. With the 2026-10-24 data that is 26 Premier League seasons (520 club-seasons of 38 matches), 14 La Liga, 13 Serie A and 16 Bundesliga seasons (288 club-seasons of 34 matches); Ligue 1, the Eredivisie and the Primeira Liga ship without tables and return nothing.
- **Same length only.** `benchmarkSeason(u, leagueId, row)` compares the user's season with the historic rows of the same `played`, so a 34-game Bundesliga campaign is never measured against a 38-game one and a sacked or otherwise unfinished season matches nothing. Five metrics: points, wins and goals scored (more is better), goals conceded and defeats (fewer is better). Each reports `rank` (1 + the historic rows strictly better), `of` (historic rows compared), `equal` (rows level with it) and `better` (the top three ahead of it, best first, ties broken by season then club id). `records` lists the metrics where the season stands alone at the top (`rank === 1` and `equal === 0`): Manchester City's real 2017-18 ranks first on points but ties itself, so it is not an outright record, while 101 points is. `seasons` is the number of distinct seasons compared and a league has a record book only from `RECORD_BOOK_MIN_SEASONS = 10` of them (`hasRecordBook`).
- **Real champions.** `realChampion(u, leagueId, season)` is the position-one row of a complete table, null for a missing table or the season in progress.
- **Summary panel.** "In the record books" sits under the tier banner when the league has a record book and the season was not cut short: one row per metric with the figure, its all-time standing ("5th best of 521", "Joint best", or a gold "📜 League record" chip), the three seasons ahead of it, and the real champions of the season you played in. Under Calibrated difficulty a muted caveat says these are benchmarks, not records, because the AI clubs were handicapped (section 13). It is distinct from the Stats tab's within-season "Season records" (streaks, biggest win).
- **Share text.** `recordShareLine` adds `📜 New Premier League points record: 101`, `📜 Joint-best points total in Premier League history` or `📜 5th-best points total in Premier League history` to `extraLines` for a top-ten points total; a mid-table season adds nothing.
- **Achievement.** `record-points` ("Record Books") unlocks in both `finishSeason` and `runQuickSeason` through `earnsPointsRecord` (`src/game/logic/records.ts`): Realistic difficulty, not sacked, `won + drawn + lost` equal to the season's matchweeks, and an outright points record in a league with a record book. Calibrated hundred-point seasons stay benchmarks.
- **Dynasty history** gains a "Real champions" column from each `SeasonRecord`'s `leagueId` and `leagueSeason`, a dash where no complete table exists.

### Season, game by game

`src/game/logic/gameByGame.ts`. The quick season has always played all 380 fixtures with the real match engine; `recordUserGames` now keeps the user's 38 (34 in an 18-club league) as `QuickResult.results`, one `QuickGameResult` per matchweek in the order they were played: `matchweek`, `opponentId`, `home`, `gf`, `ga`, the user's `scorers` (every `goal`, `penalty` or `own_goal` event on the user's side, ordered by minute, with the player-season id and name; an opponent's own goal is credited as "OG" with no id) and `position`, the user's league place after that matchweek.

- **Pure bookkeeping.** It runs after the fixture loop over fixtures that already carry their results, so it draws no random numbers: the final table, the RNG state and the top scorer of seed `game-by-game` (Burnley 2025-26, 4-3-3, auto-drafted) are pinned in a test against the values the engine produced before the recording existed (Arsenal 80 points, the user second on 79 with 24W 7D 7L and 87-44). The position is computed once per matchweek, not per fixture: 38 calls to `computeTable` over at most 380 fixtures.
- **The field is optional** and read with `?? []`, so a save or a leaderboard entry written before it existed still opens; nothing about the replay is stored.
- **The panel.** "Season, game by game" sits directly under the tier banner on the summary of a quick draft or the Daily: a strip with P W D L GF GA, points and position, then one row per game with the opponent's badge, "v Arsenal (H)" or "at Arsenal", the score as `gf-ga`, a W, D or L chip, the position after the game and the scorers as "Haaland 12', 67' · OG 80'" (minutes grouped per scorer in order of his first goal, initials dropped). The row is a grid of 44 / 22 / 1fr / auto / auto / 42 px with the scorers on a second line, so it holds at 390 px wide.
- **The replay** (`useSeasonReplay`) is UI state only. Everything is shown on arrival; "Play the season" empties the list and reveals one game every `REPLAY_STEP_MS = 220` ms (8.4 s for 38 games), the strip and the position update as games land, the banner shows "Season in play…" with the running strip in place of the tier and record, and the tier pops in after the last game. "Skip" shows the rest at once; `prefers-reduced-motion` offers no replay button and animates nothing. The head-to-head result shows both managers' lists (`H2HResult.results`, the two derbies against the other manager included) without the replay.
- **Share text.** `bestWinLine` adds `Best win: 5-0 v Chelsea (MW 23)` (or `3-0 at Chelsea`) to `extraLines`: the widest margin, then the most goals scored, then the earliest matchweek; a season without a win adds nothing.

**Profile** (local only): best 50 seasons by points then fewest defeats, daily streak and per-day results, games started, seasons simulated, manager name, theme (Auto, Floodlit, Daylight).

## 13. Difficulty calibration

This exists in code. `GameSettings.difficulty` is `'calibrated'` (default) or `'realistic'`.

- `aiRatingOffset` (`src/engine/season.ts`) auto-picks every AI club's best eleven, averages their overall team strength and subtracts `CALIBRATED_LEAGUE_AVERAGE = 75`, floored at 0 and rounded to 0.1. Realistic returns 0.
- The offset is subtracted from every unit (and the overall) of every AI club in every match, including quick seasons and pre-season friendly opponents. The board target is computed against the offset strengths. The Club tab shows "rivals play N rating points below their real strength".
- Rationale: a wheel draft rarely assembles eleven 85s, while a modern top club fields exactly that, and the engine stretches ratings above 80. Observed in the test suite at the time of writing, with no offset (realistic): an auto-drafted squad averaging 81.8 overall finished 19th with 32 points in 2025-26, and an elite XI beats a mid-table XI at home 88.8 per cent of the time, with equal sides splitting 42.8 / 28.0 / 29.2 home-draw-away.

## 14. Dynasty

`advanceToNextSeason` (`src/game/logic/dynasty.ts`) runs when you continue from the summary:

1. **Ageing.** Each player gets a new player-season (`${playerId}@dyn${year}`) one year older. A potential is estimated as `overall + max(0, 27 − age) × 1.3 + N(0, 1.5)`, then the common attribute delta by new age is:

| New age | Delta |
| --- | --- |
| ≤ 23 | min(growth room, N(2.2, 1.2)) |
| 24 to 27 | min(growth room, N(0.8, 1.0)) |
| 28 to 30 | N(−0.2, 0.8) |
| 31 to 32 | N(−1.4, 1.0) |
| 33 to 34 | N(−2.6, 1.2) |
| 35+ | N(−4.0, 1.5) |

   Physical attributes lead: at 30+ pace takes an extra −1.6, physical −0.8, dribbling −0.6; at 22 and under pace +0.8, physical +0.4, dribbling +0.3. Passing gains +0.6 and mentality +1.0 at 30+ (+0.3 otherwise). Goalkeeping gains +0.5 until 33, then −0.5. The depth attributes: stamina takes an extra −1.2 and jumping −1.0 at 30+ (+0.6 and +0.5 at 22 and under); strength follows the delta until 29, holds from 30 to 32 (the delta is cancelled, only the noise moves it) and falls with an extra −0.8 from 33; aggression and work rate are character, so the delta is cancelled at every age and only the noise moves them. Measured over 400 seeded summers on a 70-rated set: ageing to 31 moves stamina −2.5, jumping −2.4, strength 0.0, aggression and work rate 0.0; to 33 strength −3.4; to 21 stamina +2.9, strength +2.3, jumping +2.8. Each attribute also gets N(0, 0.6) noise and is clamped 1 to 99. Overall is recomputed from the primary position weights; value is `0.25 × 1.21^(overall − 60)` times an age factor (1.3 at ≤ 21, 1.15 to 26, 1.0 to 29, 0.72 to 31, 0.45 to 33, else 0.25); wage is `5 × value^0.85`.

2. **Retirements.** From 34: 30 per cent; from 36: 60; from 37: 90.
3. **Contracts** lose a year. At zero a player leaves if morale is under 50 or on a 25 per cent roll, otherwise renews for two to three years (one at 32+). Drafted players start on one to three years, signings on three. The squad status carries over, and the wage the new player-season computes from its value is multiplied by the status again.
4. State resets to condition 95, sharpness 60, morale at least 50, familiarity +10, no injury or cards.
5. **Bonus spins** `min(6, 2 + players lost)`. A summer draft opens with squad size = remaining squad + bonus spins and one re-spin. The surviving squad is seeded into it, best eleven on the pitch and the rest on the bench, so every bonus spin adds depth wherever the wheel lands; existing players are marked taken so the uniqueness rule holds.
6. **League.** The league season advances by one real year (after 2026-27 it wraps to 2008-09). You keep the same host club if it was in that division, otherwise a random club from that season. Budget and achievements carry over, the wage cap is recomputed for the new squad, and a new board target is set.
7. A summer window (section 11) is open until kick-off. The offseason modal lists who retired, who left, who improved and who declined.

## 15. Determinism and saves

All randomness runs through one `Rng` (xoshiro128** seeded by a cyrb53 hash) whose state is stored in the save after every action, so a seed replays identically and a daily seed is identical for everyone. A match paused at half time or at the 70th minute stores a forked stream for the rest of the match, so the week's other fixtures never share its numbers. A daily result is filed under the day its seed was set, not the day it was finished. The game is persisted with Zustand `persist` under the `localStorage` key `touchline-save-v1` (the active game, parked games, the shortlist, the head-to-head game, the profile and whether you were in a game). Quick drafts and dailies share one save slot; Season and Dynasty each have their own, so starting a quick draft parks a running dynasty on the home screen instead of replacing it. On load, `normaliseGame` (`src/game/logic/save.ts`) fills in every field added since a save was written, for the active game and the parked ones, and the same path covers an imported file; the players a game created (`customPlayers`: dynasty ageing, development, wage changes) that predate the depth attributes get stamina, strength, aggression, jumping and work rate derived from their eight core attributes, age and height with the same `withDepth` the engine uses for an older data pack, so a dynasty saved before format 3 plays on without a `NaN` in its condition or its tactics. The default league must load; a saved game whose other leagues fail to load is parked with a toast rather than rendered against a half-loaded universe, league loads are serialised so two callers never overwrite each other, and a failed fetch is not cached. There is no backend.

### Cross-league seeds, the data stamp and the engine version

`spin()` chooses a season uniformly, then a club-season from that season by weighted index over `u.clubSeasons`, so the order of that array is part of the seed's meaning. `mergeUniverses` (`src/engine/universe.ts`) therefore concatenates league packs in the order of the data index `leagues.json` (England, Spain, Italy, Germany, France, the Netherlands, Portugal), never in the order they happened to be loaded; a pack missing from the index goes last, in load order. Before this, opening Spain before Germany or the other way round gave the same European Nights seed different clubs on nine of eleven quick-draft spins (seed `K7Q2-MX9A`, same eleven seasons). England-only wheels, the Daily included, were never affected; cross-league seeds changed once, with this fix. `h2hSpin` draws from the same pool and inherits the order.

Every `LoadedUniverse` carries `generatedAt`, the `YYYY-MM-DD` stamp of the data packs read from `leagues.json` (`2026-10-25` today, the format 3 packs with the depth columns; a single pack built offline falls back to its own `players.json` stamp). `ENGINE_VERSION` (`src/engine/version.ts`, currently `'4'`: `'1'` was before the wheel twists added a draw to every third spin, `'2'` before the 70th-minute window split every match into three segments, `'3'` before the depth attributes changed every match's expected goals and card rolls) names the engine's random-number consumption and is bumped whenever a change alters how many draws a spin, a pick, a match or a season takes or the order it takes them in. Anything that replays a seed on another device stores both stamps beside the result so a mismatch is reported as unverified rather than failing silently. The share text (`shareText`, section 12) takes an optional `extraLines` list, printed after the awards and before the seed line, so a mode can add one line without a new field each time.

### Offline

The site is hosted as a Render static site (build `npm ci && npm run build`, publish `dist`, auto-deployed from the repository); the GitHub Pages workflow was retired when the repository went private. `public/sw.js` is registered on production builds relative to the deploy path. The shell (`index.html`, the manifest) is served network-first and cached as a fallback; hashed assets, icons and league packs are cached on first use and served cache-first. A new build changes the asset names, so it is picked up on the next online visit; stale assets stay in the single cache until its version string is bumped.

## 16. Roadmap

Not in the code today:

- 1992-93 to 2007-08 seasons; tables exist for 2000-01 to 2007-08 but no player data.
- Online leaderboards, shared daily results and online multiplayer; the leaderboard is per browser and head-to-head is hot-seat only.
- 38-0 modes not reproduced: Last One Standing, Teammate Chain, Tournaments, Multiplayer leagues.
- FM systems not reproduced: separate in-possession and out-of-possession shapes, scouting with attribute ranges, individual training, youth intake and regens, mentoring, press conferences beyond the events deck, finances beyond budget, wages, staff and prize money.
- A group stage and two-legged ties for the Continental Cup.
