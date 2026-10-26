# TouchLine: data

TouchLine ships with a static database of English top-flight player-seasons built from public datasets by `scripts/import/build.mjs`. The browser loads two JSON files from `public/data/england/` and never calls a server. This document describes what is in those files, where it came from, how it was derived and how to rebuild it.

## 1. Outputs

### `public/data/<league>/players.json` (1.1 to 1.5 MB)

```json
{ "version": 3, "generatedAt": "2026-10-25", "columns": [...], "rows": [[...], ...] }
```

Format 3 added the five depth columns at the end of every row; the engine derives them when it meets a format 2 pack (section 4, "Depth attributes").

Compact array rows in the order given by `COLUMNS` in `build.mjs`:

| Column | Meaning |
| --- | --- |
| `id` | Stable player id across seasons. `s<sofifa id>` when known, `e<European Soccer DB id>` for 2008-14 players without one, `w<Wikidata id>` for a classic-season player the EA data never met (section 8), `n<hash>` as a last resort. |
| `season` | Season start year (2015 means 2015-16). |
| `club` | Club id from the master list (`arsenal`, `leicester-city`, ...). |
| `name` | Short display name, e.g. `J. Vardy`. |
| `nation` | Three-letter code, `UNK` when unknown. |
| `age` | Age on 1 August of the season start. |
| `pos` | Natural positions, primary first, pipe-separated, up to three (`CM|AM|DM`). |
| `ovr` | Overall rating 1 to 99. |
| `pac` `sho` `pas` `dri` `def` `phy` `men` `gk` | The eight game attributes. |
| `value` | Market value, GBP millions, our own model (section 4). |
| `wage` | Weekly wage, GBP thousands, from value. |
| `cons` `inj` `big` `prof` | Hidden traits as percentages: consistency, injury proneness, big-match temperament, professionalism. |
| `foot` | `L` or `R`. |
| `height` | cm, 0 if unknown. |
| `sta` `str` `agg` `jmp` `wr` | The five depth attributes, 1 to 99 integers: stamina, strength, aggression, jumping, work rate (format 3). |

The engine (`src/engine/universe.ts`) turns each row into a `PlayerSeason` with id `${id}@${season}@${club}`, so a player who moved mid-season appears once per club.

### `public/data/england/players-classic.json` (1.16 MB)

The classic seasons, 1992-93 to 2007-08 (section 8): the same `{ version, generatedAt, columns, rows }` and the same 29 columns as `players.json`, kept in its own file so `players.json` keeps its rows and order. The browser loads it only for a league whose `leagues.json` entry has `classicFrom` (England, 1992), and only when something asks for classic seasons (`src/game/packs.ts`: a game with `rules.classic`, the Setup's Classic toggle, Explore); a plain start loads the standard seasons alone, and fetches this file without parsing it some seconds later so the service worker has it for an offline visit. A classic load whose fetch fails fails (the toggle switches back off with a toast; a saved classic game is parked). The engine's own loader (`fetchLeague`, used by the tests and the server) still loads it with every league that has one, and a failed fetch there loads the standard seasons alone.

### `public/data/<league>/meta.json` (about 80 KB)

- `league`: `{ id: "england", name: "English Top Flight", shortName: "England" }`.
- `clubs`: the 51 clubs that appear in any squad or table, with name, short name, three-letter code, city, nickname, founding year, approximate kit colours, an AI playing style and a rivals list (from `scripts/import/clubs-england.mjs`, which holds 58 clubs; only the used ones are emitted). Oldham Athletic, Swindon Town and Barnsley were appended for the 1992-98 tables (club ids are permanent, so new clubs go at the end).
- `nations`: code to `{ name, flag }` for the 117 codes present.
- `seasons`: for each season with player data, the clubs in it, whether the real table is complete, and the table (position, played, won, drawn, lost, goals for and against, points). A row carries `deduction` when the league took points off the club (`pts` is already net of it); a season carries `titleVoid: true` when its title was stripped and not re-awarded (nobody is champion). Both are optional; `titleVoid` is absent from every season shipped today, and the deductions are the ones listed below.
- Classic seasons (England 1992-93 to 2007-08) are `seasons` entries after every standard one, with `classic: true`, `ratingsSource: 'estimated'` and `appsSource` (the share of the season's club-seasons whose appearances come from a validated table, 0.36 to 1). `ratingsSource` is `'ea'` when missing.
- `historicTables`: tables for seasons with no player data at all (none in England now; the field stays for the other leagues' later classic phases). `historicTitleVoid` (optional, absent today) lists those whose title was void.
- `sources`: the credit and licence lines shown in the How it works screen.

## 2. Coverage

| Season | Player-seasons | Ratings from | Club membership from |
| --- | --- | --- | --- |
| 2008-09 to 2013-14 | 476 to 506 each | European Soccer Database attribute snapshot dated after the season | ESD match line-ups (league id 1729) |
| 2014-15 to 2023-24 | 603 to 660 each | FIFA 16 to FC 24 editions (one after the season) | FC 24 complete dataset, league id 13 |
| 2024-25 | 597 | FC 26 (borrowed from the following edition) | FC 25 dataset |
| 2025-26 | 540 | FC 27 (borrowed) | FC 26 dataset |
| 2026-27 | 612 | FC 27 (current edition, no later one yet) | FC 27 dataset, clubs filtered to the 2026-27 table |

Totals at the current build: **11,166 player-seasons, 3,647 distinct players, 51 clubs, 19 seasons (2008-09 to 2026-27)**, plus the classic seasons: **8,903 player-seasons, 2,582 players, 16 seasons (1992-93 to 2007-08)** with complete Premier League tables (22 clubs and 462 matches until 1994-95, 20 and 380 since; 40 distinct clubs) and estimated ratings (section 8). The 2026-27 table is partial (five matches played per club at build time) and is flagged `complete: false`; the engine treats that season as "in progress" and awards no Champion accolade for it. Overall ratings range from 46 to 91.

## 3. Sources

| Source | Author | Licence | Used for |
| --- | --- | --- | --- |
| EA Sports FC 24 complete player dataset (Kaggle) | Stefano Leone | CC0 1.0 | Every FIFA 15 to FC 24 edition: attributes, positions, club, nationality, date of birth, value, work rate, international reputation. Also the master index of sofifa ids. |
| EA SPORTS FC 25 database, ratings and stats (Kaggle) | nyagami | Apache 2.0 | The FC 25 edition (2024-25 season membership and attributes). |
| EA Sports FC 26 Player Ratings (Kaggle) | justdhia | CC0 1.0 | The FC 26 edition (2025-26 membership; ratings for 2024-25). |
| EA SPORTS FC 27 Player Ratings (Kaggle) | mikedpad | Unofficial non-commercial snapshot of EA's public ratings API (see the dataset README) | The FC 27 edition, men's football only (2026-27 membership and ratings; ratings for 2025-26). |
| European Soccer Database (Kaggle) | Hugo Mathien | ODbL | 2008-09 to 2013-14: Premier League line-ups with pitch coordinates, player attributes over time, birthdays and heights. |
| openfootball/england (GitHub) | openfootball | CC0 / public domain | Results text files, 1992-93 to 2026-27 (`archive/1990s/<season>/` before 2000-01), parsed into league tables. |
| English Wikipedia season articles | Wikipedia contributors | CC BY-SA 4.0 (facts only, no text reproduced) | Points deductions and stripped titles in `scripts/import/historic/overrides.mjs`, one cited article per entry. |
| Wikidata | Wikimedia | CC0 | Nationalities for players the EA data never covered, via `scripts/import/enrich-nations.mjs` (see section 6). Classic seasons: the id of every player, birth date, height, positions, nationality, club and national-team spells with appearances, caps, sitelink count and FIFA id. The Quick Draft's managers: head coach statements (P286) with their start and end dates, via `scripts/import/managers.mjs` (see "Managers" below). |
| English Wikipedia club-season and player articles | Wikipedia contributors | CC BY-SA 4.0 (facts only, no text reproduced) | Classic seasons: who was in each squad, league appearances (starts and substitute appearances), league goals and their dates, dated transfers, the infobox position and height. Only facts are kept, in `scripts/import/historic/facts-england.json`. |

Download URLs and file names are in `scripts/import/config.mjs`. Kaggle datasets are fetched through the unauthenticated download redirect and unpacked with `unzip`.

## 4. Method

### Season to edition mapping

A player's rating for season S is taken from the edition published after S, so it reflects how he played that year rather than how he was expected to play. In `build.mjs` every edition record is indexed by `(season, id)`; when a player-season is finalised it borrows `overall`, attributes and trait inputs from the record at `season + 1` if one exists, otherwise it keeps its own. FIFA 15 is treated as season 2014-15 (`season = 2000 + version − 1`), so FC 24 covers 2023-24 and borrows from FC 25, and so on. Club membership, age, positions and nationality always come from the season's own edition. For 2008-14 the European Soccer Database already provides time-stamped attribute rows, so the build picks the row closest to 15 September of the following year, preferring rows between February of that year and January of the year after, and marks it post-season so no borrowing happens.

### Attributes

Eight attributes are derived from the detailed EA stats with fixed weights, then overwritten by EA's six summary "face" stats (pace, shooting, passing, dribbling, defending, physical) where the dataset has them and the player is not a goalkeeper:

| Attribute | Derivation when no face stat is available |
| --- | --- |
| pace | acceleration 0.45, sprint speed 0.55 |
| shooting | finishing 0.45, shot power 0.2, long shots 0.2, positioning 0.05, volleys 0.05, penalties 0.05 |
| passing | short passing 0.35, vision 0.2, crossing 0.2, long passing 0.15, curve 0.05, free kicks 0.05 (goalkeepers: kicking 0.6, short passing 0.4) |
| dribbling | dribbling 0.4, ball control 0.35, agility 0.1, balance 0.1, reactions 0.05 |
| defending | marking 0.3, standing tackle 0.3, interceptions 0.2, heading 0.1, sliding tackle 0.1 |
| physical | strength 0.5, stamina 0.25, aggression 0.2, jumping 0.05 |
| mentality | reactions 0.4, composure 0.35, vision 0.25 (goalkeepers: reactions 0.55, composure 0.45) |
| goalkeeping | reflexes 0.3, diving 0.25, handling 0.25, positioning 0.2 |

Missing inputs fall back to position-neutral defaults (goalkeeping 10 for outfielders, 60 for keepers). Everything is rounded and clamped to 1 to 99.

### Depth attributes

Five more attributes carry the Football Manager depth: stamina, strength, aggression, jumping and work rate. They are taken from the detailed stats directly, never from a face stat, and borrowed from the following edition with the rest of the attributes:

| Column | Source | Fallback when the source lacks it |
| --- | --- | --- |
| `sta` stamina | `power_stamina` (FC 24 editions, FC 27), `Stamina` (FC 25), `stamina` (FC 26, European Soccer Database) | `physical + 3 − 2 × max(0, age − 29)` |
| `str` strength | `power_strength`, `Strength`, `strength` | `physical + 0.35 × (height − 180)` (unknown height reads as 180) |
| `agg` aggression | `mentality_aggression`, `Aggression`, `aggression` | `0.5 × defending + 0.5 × mentality + 1` |
| `jmp` jumping | `power_jumping`, `Jumping`, `jumping` | `0.6 × physical + 26 + 0.9 × (height − 180)` |
| `wr` work rate | `work_rate` text in the FC 24 editions ("High/Medium"), `attacking_work_rate` and `defensive_work_rate` in the European Soccer Database: High 80, Medium 55, Low 35, averaged over the two sides | `25 + 0.5 × mentality`, clamped to 35..80 (so 55 at mentality 60, 75 at 99) |

Goalkeepers keep their own (low) stamina and aggression from the source. The FC 25, FC 26 and FC 27 files carry no work-rate text and the European Soccer Database's text is sometimes garbage (`None`, `norm`, `_0`), so those rows take the mentality fallback. At the current build 69,120 finalised rows read stamina, strength and aggression from the source every time; jumping is derived for 381 database rows that lack it and work rate for 14,776 rows (the three latest editions plus the unusable database text), the other 54,344 from the text. `src/engine/depth.ts` holds the same five formulas, so a format 2 pack loaded by the engine gets the same derived values the builder would have written. Means in the Premier League pack: stamina 67, strength 69, aggression 65, jumping 69, work rate 61; keepers average 36 stamina.
### Positions

EA position strings map to the game's ten: LWB to LB, RWB to RB, CDM to DM, CAM to AM, LM and LF to LW, RM and RF to RW, CF to ST; up to three kept in order. For 2008-14, positions are inferred from each line-up's X and Y pitch coordinates (`inferPosition`): the keeper line, then full-backs and centre-backs, defensive midfield, wide and central midfield, attacking midfield and the forward line by column. The database's X runs from the team's right touchline (1) to its left (9), so `inferPosition` mirrors it (`10 − X`) before applying the left-to-right rules. Builds before 2026-10-25 read it unmirrored and swapped every left and right position in 2008-14: the left-foot share of left backs was 0.04 and of right backs 0.86 in the Premier League, against 0.86 and 0.00 in the EA seasons. Now it is 0.86 and 0.04 (every league: left backs 0.67 to 0.91, right backs 0.02 to 0.08), and A. Cole and P. Evra are left backs again. A player's observed positions (any used in at least 25 per cent of appearances) are merged with his EA position list where a sofifa id links them; a goalkeeper on either side is a goalkeeper only.

### Hidden traits

Deterministic from the player id (a cyrb53 hash provides repeatable noise), so a rebuild gives the same traits:

- consistency: 0.5 + 0.004 × (composure − 60) + 0.003 × (reactions − 60) + noise ±0.15
- injury proneness: 0.3 + noise ±0.25, +0.07 at 30, +0.15 at 32, −0.002 × (physical − 60)
- big match: 0.45 + 0.1 × (international reputation − 1) + 0.003 × (composure − 60) + noise ±0.15 (reputation is inferred from overall where the dataset lacks it: 88+ is 4, 84+ is 3, 80+ is 2)
- professionalism: 0.55 + 0.15 × work-rate score (high/medium/low on both sides) + noise ±0.15

All clamped to 0.05 to 0.98 and stored as percentages. A missing input (composure, reactions, physical, reputation) takes the neutral value shown (60, or 1 for reputation): `num()` reads a blank cell as NaN, and builds before 2026-10-25 let NaN through `?? 60`, so 23,725 rows of 2008-15 (every league) shipped `null` consistency and big-match values, which the engine then read as 0.5. Every row now carries all four traits.

### Value and wage

Values are our own model in today's GBP millions: `0.25 × 1.21^(overall − 60)`, times an age factor (1.3 at 21 or under, 1.15 to 26, 1.0 to 29, 0.72 to 31, 0.45 to 33, 0.25 beyond), times a position factor (GK 0.75, CB 0.9, full-backs 0.85, DM and CM 1.0, AM and wingers 1.1, ST 1.15). Where the FC 24 dataset provides an EA value, it is normalised so the most valuable player of that edition is 170 and blended 50/50 with the model. Wages are `5 × value^0.85` GBP thousands a week. Values are never below 0.1.

### Names, ages, deduplication

Names are the dataset's short or common name, or "F. Surname" (keeping particles such as van, de, da). Age is computed on 1 August of the season start from the date of birth where present. Within a club-season, duplicates by id keep the record with the most appearances, then duplicates by name and age collapse to one.

### League tables

Each openfootball results file is parsed (both the "Home 1-2 (0-1) Away" and "Home v Away 1-2 (0-1)" layouts), club names are resolved through the alias table in `clubs-england.mjs`, and a table is built with 3-1-0 points, goal difference, goals scored and name as tie-breakers. A season is complete when every club has played every other home and away (`clubs × (clubs − 1)` matches, at least 16 clubs); a league can also declare its size per season (`openfootball.clubs` in `leagues.mjs`: the Premier League had 22 clubs until 1994-95, 20 since), and a table with a different club count is incomplete and warned about. The fetched seasons are per league (`openfootball.from`, 1992 for England, 2000 otherwise; `openfootballSeasons` and `openfootballPath` in `config.mjs`). Seasons with a table but no player data go to `historicTables`.

Then `scripts/import/historic/overrides.mjs` corrects what results alone cannot know: points deductions (subtracted from `pts`, recorded as `deduction`), clubs placed last by the league whatever their points (`placedLast`), and void titles (`titleVoid`), re-ranking the table by the same order. Each entry cites the English Wikipedia season article it was checked against. Applied today: Middlesbrough 1996-97 (−3 for calling off the December 1996 fixture at Blackburn: 19th on 39 points, relegated), and in the seasons with players Portsmouth 2009-10 (−9, administration: 20th on 19), Everton 2023-24 (−8: 15th on 40), Nottingham Forest 2023-24 (−4: 17th on 32), Almería 2014-15 (−3: 19th on 29), Parma 2014-15 (−7: 20th on 19), Chievo 2018-19 (−3: 20th on 17) and Juventus 2022-23 (−10: 7th on 62). These seven were found by reading every `adjust_points_*` in the league-table templates of the Premier League 1992-93 to 2025-26, La Liga 2012-13 on, Serie A 2013-14 on and the Bundesliga 2010-11 on (none in the Bundesliga). The others wait for the classic seasons of other leagues: Ligue 1 1992-93 (Marseille's title void; Marseille and Valenciennes −1), Serie A 2004-05 (title void), 2005-06 (Juventus placed last, Milan, Fiorentina and Lazio −30, title to Inter) and 2006-07 (Milan −8, Fiorentina −15, Lazio −3, Reggina −11, Siena −1), Primeira Liga 2007-08 (Porto −6, Belenenses −3). An override naming a club missing from its table is printed as a warning.

### Nationalities

Dataset country names are normalised to codes and flags in `scripts/import/nations.mjs`. Players from the European Soccer Database only have a nationality if their sofifa id appears in a later EA edition. `scripts/import/enrich-nations.mjs` looks the rest up on Wikidata by name and date of birth (preferring country for sport, P1532, over citizenship, P27) and writes `scripts/import/nations-override.json`, which `build.mjs` applies to `UNK` rows. The override file is committed so normal builds need no network access. `enrich-nations.mjs` scans every built league pack; at the current build it holds 1,097 players, and the rows still carrying `UNK` are mostly 2008-14 Primeira Liga players whose Wikidata labels differ from the database spelling (578 rows there, 145 in the Eredivisie, 121 in the Premier League).

## 5. Rebuilding

Requirements: Node 22.13 or later (the build reads the European Soccer Database through `node:sqlite`, which is unflagged from 22.13), `unzip` on the PATH, and network access to Kaggle and GitHub on the first run. The Kaggle archives are large.

```bash
node scripts/import/download.mjs    # optional: fetch and unpack everything into the cache
node scripts/import/build.mjs       # downloads anything missing, then writes public/data/england/*.json
node scripts/import/enrich-nations.mjs   # optional: query Wikidata and refresh nations-override.json, then rebuild
```

Downloads are cached in `.cache/datasets` under the repository root, or wherever the `DATA_CACHE` environment variable points. The cache is not committed; add `.cache` to `.gitignore` if you build locally (it is not listed there today). The build prints per-season counts, totals, file size, unknown nations and any unmatched club names.

The Vitest suite (`npm test`) loads the generated files and checks: every season from 2008-09 has 20 clubs; every player-season has a valid overall, positions, age, value and club; J. Vardy 2015-16 is a Leicester City champion rated 80 or more (with stamina above 80 and work rate 80); the 2015-16 table is complete with Leicester first; every pack carries the five depth columns as integers in 1 to 99, keepers read far lower than outfielders on stamina and aggression, and a format 2 pack with the columns stripped still loads with the fallbacks (`src/engine/__tests__/fmdepth.test.ts`); every row of every pack has four finite traits from 0 to 100; left backs are mostly left-footed and right backs almost never, in the 2008-14 seasons as in the EA ones; the 16 Premier League tables of 1992-93 to 2007-08 are complete (match counts, 40 resolved clubs, the champions, Manchester United 1992-93 at 24-12-6 and 84 points, Arsenal 2003-04 at 26-12-0 and 90) and Middlesbrough 1996-97 is 19th on 39 after its deduction (`universe.test.ts`); a void title makes nobody champion (`titleVoid.test.ts`).

## 6. Known limits

- Classic seasons (1992-93 to 2007-08) cover the Premier League only, and their ratings are estimates (section 8). Other leagues start in 2008-09.
- 2008-14 positions are inferred from line-up coordinates and may list a player where he was fielded rather than where he was best.
- Nationality is unknown for 228 players (505 rows), mostly 2008-14; the Wikidata enrichment has not yet been run into the committed override file.
- The 2026-27 season uses the current edition's ratings (there is no later one), and its table is partial until the season ends.
- The FC 27 dataset is an unofficial, non-commercial snapshot of a public API.
- Values and wages are a model, not reported figures. Blending with normalised EA values applies only where the FC 24 dataset supplies one (2014-15 to 2023-24).
- Clubs are limited to those that appear in a parsed table or a squad; the master list has 58 entries and 51 are emitted.
- **Stray ",NN" in 54 names (53 distinct: J. Inamoto is in two packs), every pack, 16 in Portugal's**: "D. Cousin,20" (Hull 2008-10), "B. McCarthy,27", "P. Kenny,30", "P. da Silva Moutinho,28". Root cause: the European Soccer Database's `Player.player_name` itself carries the suffix for those players ("Bennedict McCarthy,27"), and `build.mjs`'s ESD loader passes it to `shortName` as it is; `enrich-nations.mjs` then searches Wikidata for "Bennedict McCarthy,27", finds nobody, and most of them stay nation `UNK`. Today the game cleans them when the store loads the universe (`tidyUniverseNames`, `src/game/logic/playerNames.ts`), display text only, packs, stamps and the edge verifier unchanged. **Fix at the next real rebuild**: strip `/\s*,\s*\d+\s*$/` from `player_name` where the ESD rows are read (`build.mjs`, the `select ... from Player` loop, before `shortName`, and the same in `enrich-nations.mjs` before the Wikidata search), rerun the enrichment so the nations re-match, rebuild (new `generatedAt`, `packHashes.json`, pins re-baselined, deploy after 00:00 UTC), then `tidyUniverseNames` can go (its test's count of 53 fails and says so).

## 7. Legal

TouchLine is an independent fan project. It is not affiliated with, endorsed by or sponsored by any league, club, governing body, game publisher or ratings provider. Club and player names are used descriptively to identify real teams and seasons. No official crests, logos, kits or likenesses are used; badges are generated from approximate colours and letter codes. Player ratings are an independent interpretation derived from publicly available datasets and may differ from any official source. The datasets above are credited to their authors and used under the licences they were published with; the openfootball results are public domain; Wikidata content is CC0. Please respect the terms of each source if you redistribute the generated files.


## Leagues (added later)

The builder now produces one data pack per league under `public/data/<league>/` and an index at `public/data/leagues.json`:

| League | Player-seasons | Players | Clubs | Seasons |
| --- | ---: | ---: | ---: | --- |
| Premier League (england) | 11,166 | 3,647 | 46 | 2008-09 to 2026-27 |
| La Liga (spain) | 10,632 | 3,503 | 39 | 2008-09 to 2026-27 |
| Serie A (italy) | 10,610 | 3,258 | 42 | 2008-09 to 2026-27 |
| Bundesliga (germany) | 9,497 | 3,006 | 35 | 2008-09 to 2026-27 |
| Ligue 1 (france) | 10,084 | 3,516 | 40 | 2008-09 to 2026-27 |
| Eredivisie (netherlands) | 8,571 | 3,101 | 29 | 2008-09 to 2026-27 |
| Primeira Liga (portugal) | 8,595 | 3,387 | 39 | 2008-09 to 2026-27 |

69,155 player-seasons in all (the format 3 rebuild of 2026-10-25; Serie A and the Eredivisie gained a few rows from the cached dataset snapshots). The packs run from 1.09 MB (Eredivisie) to 1.46 MB (Premier League), about 13 per cent more than format 2 for the five integer columns. The same sources cover every league: EA FC league ids 13, 53, 31, 19, 16, 10 and 308 for 2014-15 onwards, the European Soccer Database leagues 1729, 21518, 10257, 7809, 4769, 13274 and 17642 for 2008-09 to 2013-14, and openfootball repositories `england`, `espana`, `italy` and `deutschland` for league tables (no results files exist for Ligue 1, the Eredivisie or the Primeira Liga, so those club-seasons carry no final position and the Continental Cup field is picked by squad strength there). The Primeira Liga had 16 clubs until 2013-14, so those seasons run to 30 matchweeks. A club with only 8 to 11 rows in an edition (Telstar in FC 26, for instance), or any club in that season's results table with fewer than 12 rows, is topped up with its own players from the adjacent season rather than dropped, so every shipped league season keeps its real entrants; the engine still handles odd counts with bye weeks. Only seasons the player data covers are built: a historic table on its own never becomes a playable season. Leagues without result tables mark their newest season as in progress and every earlier one as complete. Club master tables with dataset aliases live in `scripts/import/clubs-england.mjs` and `scripts/import/clubs-europe.mjs`; the registry is `scripts/import/leagues.mjs`.

## 8. Classic seasons (1992-93 to 2007-08): estimated ratings

The Premier League's sixteen seasons before the EA data starts ship with real squads, real tables and **ratings TouchLine estimates**, because no openly licensed rating source exists for them. They are opt-in in the game (`docs/GAME_DESIGN.md`, section 5).

### Pipeline: fetch once, commit facts, build offline

```
node scripts/import/historic/fetch.mjs     # network, by hand: fills $DATA_CACHE/historic (resumable)
node scripts/import/historic/facts.mjs     # cache -> scripts/import/historic/facts-england.json (committed)
node scripts/import/historic/check.mjs     # facts checks, no network (--rerun: rebuild from the cache, byte-identical)
node scripts/import/build.mjs              # reads the committed facts; writes players-classic.json
node scripts/import/historic/validate-ratings.mjs   # accuracy and feel checks, by hand
```

`fetch.mjs` reads the 326 club-season articles ("1992–93 Manchester United F.C. season", an A.F.C./F.C. variant tried when the first is not an article), every player they link (4,222 titles), and the Wikidata entity of every player (3,773) and of every club, national team, country and position in their claims (3,686). Wikipedia's api.php is rate-limited much harder than the rest of the site from a shared address, so page text comes through Special:Export (25 pages a request), Wikidata entities through Wikidata's Special:Export (40 a request), and the Wikidata id of a page from api.php pageprops when it answers, otherwise Wikidata's Special:ItemByTitle one title at a time. Requests are serial, 2 to 4 s apart per host with the User-Agent in `historic/config.mjs`, and a refused request is retried after 15 s growing to a minute. A cold run took about three hours on 2026-10-25; a warm one makes no request. The research prototype's 1,294 title-to-id pairs seeded the id step (`$DATA_CACHE/historic/seed-ids.json`). `build.mjs` and CI never touch the network: the committed facts file (about 3 MB, one club-season per line) is the input of record.

### Squads and appearances (`facts.mjs`, `parse-season.mjs`)

- **Validated appearances table** (231 of 326 club-seasons: 46 of 106 in 1992-93 to 1996-97, 41% of clubs in 1992-93, 75% in 1999-2000, 75-100% from 2000-01): a table in the article (`{{Efs player}}` rows, a wikitable, or `{{football season player stats}}`) whose league columns pass both checks: appearances add up to 10.8x to (11 + substitutes allowed)x the games, nobody above the games played, and goals within 5 of the club's goals for (own goals are nobody's). Cells read as "30 (2)" are 30 starts and 2 off the bench, or 32 appearances of which 2 off the bench when the table counts them so; a column further right costs as much as a goal off the target, so league columns win over cup ones. A table with appearances but no goals column counts when the article's league results lines give every goal.
- **Otherwise the squad list** (`{{Fs player}}`, or a hand-made squad table with a position on most rows), gated by a Wikidata P54 club spell that overlaps the season (or an infobox spell), with the league scorers the list misses. Appearances come from the spell's league appearances per season, cut for players who left or arrived (a dated transfer row, the first or last goal at either club, or the year a spell ends), then scaled so the club total is 12x the games; starts are scaled to 11x the games. Goals come from the results lines when they add up, else the spell's scoring rate scaled to the club's goals.
- Every shipped row has a Wikidata id and a birth date; a birth date that gives an age outside 15-42 means the link found a namesake and the row is dropped (one: Oliver Bernard 2004-05). A club-season holds at most 30 men (lowest share out first) and two keepers: a club whose first choice played every game gets its listed reserve, and seven club-seasons with no listed reserve borrow the club's keeper of the season before (Leeds United 1994-95, 1997-98, 1999-2000, 2001-02 and 2002-03, Liverpool 2000-01, Middlesbrough 2002-03). Squads run from 20 to 30.
- Positions: the infobox position and the article's "played as a ..." phrase, then Wikidata P413, then a heuristic that makes the shortest generic defenders full-backs and midfielders wingers until a squad has its share; sides follow the ESD foot where known. A guessed position (no infobox, phrase or Wikidata one: 835 rows) gives way to the same man's positions in his first standard season when that is at most two seasons on (`LATER_POSITION_GAP` in `index.mjs`; a listed defender keeps a defensive primary). 18 rows of 2006-07 and 2007-08 take it, among them C. Ronaldo (CM|DM to RW|ST), G. Bale (CB to LB|RW) and G. Cahill (CM|DM to CB). Nationality: the contemporary code on the squad template (91.6% of rows), then Wikidata P1532 and P27; 13 rows are `UNK`.

### Ids

A classic player keeps the id he has in the standard packs when one can be proved: the European Soccer Database player with the same birth date and a shared name token gives `s<FIFA id>` (or `e<ESD id>`), a Wikidata FIFA id (P1469) found in the sofifa index gives `s<id>`; anyone else is `w<Wikidata id>`. A tie between two ESD candidates is never guessed (one case). Today: 724 players on `s` ids (2,645 rows), 1,858 on `w` ids, so Explore careers join up across 2007-08 and 2008-09 for everyone the ESD rated.

### Ratings (`ratings.mjs`, `ratings-coef.json`)

```
ovr = c0 + c1 share + c2 share^2 + c3 ln(min(startRank, 30)) + c4 GD/g + c5 rankFrac + c6 share x PPG
      + c7 G/g + c8 (age - 27) + c9 (age - 27)^2 + c10 ln(1 + sitelinks) + c11 notMatched + c12 ln(1 + caps) + c13 international that season
```

fitted per position group (GK, DEF, MID, FWD) with ridge regression on the ESD's England 2008-09 to 2013-14 EA ratings. Held out (fitted on 2008-12, rated 2012-14): MAE 2.40, Spearman 0.780, within-team Spearman 0.684. A player with a later EA rating within six seasons (the ESD snapshots run from February 2007, so 2000-01 onwards; 2,131 rows) uses the PWB variant, which adds that rating projected back season by season with the ESD-fitted age curve `x(age - 1) = x + a(age) + b(age)(x - 65)`.

Then, per season (`CALIBRATION`):

- **Star adjustment.** With the team terms (c4-c6) at full weight the prototype gave 9 of 1992-93's top 15 to Manchester United and rated Beckham 90 in 1999-2000. A club's three best men by the model keep the team terms; below them the terms fade out over 2 rating points, so a champion's regulars stop outranking everyone else's stars; at a weak club the negative team terms spare its three best and weigh on the rest. The order inside a club never changes. (A capped prominence term from caps and sitelinks is implemented but off: it pushed champions above 89.)
- **Spread.** Model-only rows are stretched 1.2 around their season and position group's mean and moved 0.3 down; rows rated through a later EA rating 0.95 (they already have EA's spread).

Results (`validate-ratings.mjs`, 2026-10-25): in every classic season no club holds more than 6 of the top 15 (at most 6, from 9 before the adjustment), the champion's three best average 85.3 to 89.0, the bottom club's best is 74 to 78, and no attribute is above 94 under an 85 overall. The 1999-2000 ratings against the same men's first ESD rating projected back seven seasons: n 101, MAE 3.10, bias +1.35, Spearman 0.76. The star adjustment is deliberately unlike EA: applied to the held-out 2012-14 rows it costs accuracy (MAE 2.69, Spearman 0.73), because EA does rate a modern champion's regulars highly; in the classic inputs the same lift is an artefact of retrospective fame (sitelinks) and full seasons for a champion's regulars.

Known biases: the 1990s absolute level is a convention anchored on the 2008-13 EA scale; midfielders' order inside a club is the weakest part of the model; 60 of the 106 club-seasons of 1992-93 to 1996-97 have estimated appearances; feet are mostly guessed before 2007 (2,448 of 8,903 rows have an ESD foot; the rest draw from the 2014+ left-foot share by position); a player who moved mid-season appears for both clubs.

Attributes: a player with a later ESD profile keeps its shape shifted by the overall gap; anyone else gets the per-position templates (`templates.json`, fitted on the 2008-13 rows) plus deterministic noise from his id; every attribute is clamped to the 2008-13 England range for his primary position and to 94 under an 85 overall. Traits, value and wage use the standard packs' formulas, so a classic Beckham costs what a modern player of his rating does.

Determinism: two builds on the same cache give byte-identical `players-classic.json` and `meta.json` (checked 2026-10-25), and `check.mjs --rerun` rebuilds the committed facts byte for byte.

Not used: the Kaggle "Premier League Player Statistics 1992/93-2022/23" set (labelled CC0, upstream unstated; the owner chose to keep it off), football-data.co.uk (its terms exclude this use), Transfermarkt, sofifa or fifaindex scrapes, engsoccerdata and StatsBomb (validation only, not shipped).

## Flags

The packs keep each nation's flag as an emoji (`nations.<code>.flag`), but the game never prints it: Windows draws emoji flags as two letters. `scripts/brand/flags.mjs` derives a flag code from that emoji (a regional-indicator pair gives the ISO 3166-1 alpha-2 code, a black flag with a tag sequence gives the subdivision, so England, Scotland and Wales are `gb-eng`, `gb-sct` and `gb-wls`; Northern Ireland, whose emoji is the UK's, is mapped to `gb-nir` by hand) and copies the matching 4:3 SVG from [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 by Panayiotis Lipiridis (MIT licence, notice in [CREDITS.md](CREDITS.md) and `public/flags/LICENSE.txt`) into `public/flags/<code>.svg`, plus `eu.svg` for European Nights and the all-leagues wheel. The UI resolves the same codes with `nationFlagCode` and `leagueFlagCode` in `src/ui/format.ts` and draws them with `src/ui/components/Flag.tsx`.

At the current build the seven packs hold 164 nation codes (the classic seasons added Pakistan and Saint Lucia); 163 map to a flag-icons SVG and one, `UNK` (Unknown), has none and shows `public/flags/unknown.svg`, a neutral grey flag of our own. `public/flags` holds 164 flag-icons SVGs, the fallback and the licence: 1,125,482 bytes (1.07 MiB; about 0.37 MB gzipped), almost all of it in a few flags with detailed coats of arms (Serbia 182 KB, Bolivia 103 KB, Mexico 85 KB, Spain 81 KB). Flags load lazily, one small file per flag on screen, and the service worker caches them cache-first. Rerun the script after a rebuild that adds nations; `src/ui/__tests__/flags.test.ts` fails if a nation has no SVG or an SVG is no longer needed.

## Managers

`scripts/import/managers.mjs` builds `src/engine/data/managers.json` (about 60 KB, bundled with the game, committed) for the Quick Draft's manager pick. Run it after a pack rebuild: `node scripts/import/managers.mjs` (network, Wikidata's SPARQL endpoint only).

- **Clubs.** Each club in the packs is matched to its Wikidata item by label or alias (our names, short names and dataset aliases, each also with `F.C.`, `FC`, `A.F.C.`, `CF`, `C.F.`), among items that are an association football club (Q476028) in the league's country, the one with the most Wikipedia articles winning. A few clubs the labels miss are pinned by hand in `CLUB_QID`; SPAL and Carpi are still unmatched.
- **Managers.** Every head coach statement (P286) of each club with its start time (P580), end time (P582) and any role qualifier (P2868, a caretaker counted at half weight). For a club-season (July to June) the man in charge longest comes first; a second is kept only when he had at least 90 days. Under 30 days in all, or no dated statement, and the club-season is left out: the game offers archetypes instead.
- **Styles** are ours, not Wikidata's: about sixty well-known managers are given one by hand in `KNOWN_STYLES`; anyone else takes the commonest style of the club-seasons he ran in the packs (the club's playing style in `meta.json` mapped to a manager style, or youth when the best sixteen averaged under 24.6).
- **Coverage** (2026-10-25): 1,600 of 2,526 club-seasons, 551 managers. Wikidata often holds only a club's recent coaches, so older and smaller club-seasons are the gaps.
- **Politeness.** One POST at a time with a 1.5 s pause, a retry that honours `Retry-After`, a descriptive `User-Agent`, and every response cached by query hash under `.cache/managers/` (gitignored), so a second run sends nothing.
- **Licence.** Wikidata is CC0. Managers are public figures named as facts; nothing else about them is used.

