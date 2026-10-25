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
| `id` | Stable player id across seasons. `s<sofifa id>` when known, `e<European Soccer DB id>` for 2008-14 players without one, `n<hash>` as a last resort. |
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

### `public/data/<league>/meta.json` (about 80 KB)

- `league`: `{ id: "england", name: "English Top Flight", shortName: "England" }`.
- `clubs`: the 51 clubs that appear in any squad or table, with name, short name, three-letter code, city, nickname, founding year, approximate kit colours, an AI playing style and a rivals list (from `scripts/import/clubs-england.mjs`, which holds 58 clubs; only the used ones are emitted). Oldham Athletic, Swindon Town and Barnsley were appended for the 1992-98 tables (club ids are permanent, so new clubs go at the end).
- `nations`: code to `{ name, flag }` for the 117 codes present.
- `seasons`: for each season with player data, the clubs in it, whether the real table is complete, and the table (position, played, won, drawn, lost, goals for and against, points). A row carries `deduction` when the league took points off the club (`pts` is already net of it); a season carries `titleVoid: true` when its title was stripped and not re-awarded (nobody is champion). Both are optional; `titleVoid` is absent from every season shipped today, and the deductions are the ones listed below.
- `historicTables`: tables for seasons without player data (England 1992-93 to 2007-08). `historicTitleVoid` (optional, absent today) lists those whose title was void.
- `sources`: the credit and licence lines shown in the How it works screen.

## 2. Coverage

| Season | Player-seasons | Ratings from | Club membership from |
| --- | --- | --- | --- |
| 2008-09 to 2013-14 | 476 to 506 each | European Soccer Database attribute snapshot dated after the season | ESD match line-ups (league id 1729) |
| 2014-15 to 2023-24 | 603 to 660 each | FIFA 16 to FC 24 editions (one after the season) | FC 24 complete dataset, league id 13 |
| 2024-25 | 597 | FC 26 (borrowed from the following edition) | FC 25 dataset |
| 2025-26 | 540 | FC 27 (borrowed) | FC 26 dataset |
| 2026-27 | 612 | FC 27 (current edition, no later one yet) | FC 27 dataset, clubs filtered to the 2026-27 table |

Totals at the current build: **11,166 player-seasons, 3,647 distinct players, 51 clubs, 19 seasons (2008-09 to 2026-27)**, plus 16 complete Premier League tables without player data (1992-93 to 2007-08: 22 clubs and 462 matches until 1994-95, 20 and 380 since; 40 distinct clubs). The 2026-27 table is partial (five matches played per club at build time) and is flagged `complete: false`; the engine treats that season as "in progress" and awards no Champion accolade for it. Overall ratings range from 46 to 91.

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
| Wikidata | Wikimedia | CC0 | Nationalities for players the EA data never covered, via `scripts/import/enrich-nations.mjs` (see section 6). |

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

- No player data before 2008-09. 38-0 covers 1992-93 onwards; the Premier League tables go back to 1992-93, and squads with estimated ratings for 1992-93 to 2007-08 are in progress (`classic-seasons`).
- 2008-14 positions are inferred from line-up coordinates and may list a player where he was fielded rather than where he was best.
- Nationality is unknown for 228 players (505 rows), mostly 2008-14; the Wikidata enrichment has not yet been run into the committed override file.
- The 2026-27 season uses the current edition's ratings (there is no later one), and its table is partial until the season ends.
- The FC 27 dataset is an unofficial, non-commercial snapshot of a public API.
- Values and wages are a model, not reported figures. Blending with normalised EA values applies only where the FC 24 dataset supplies one (2014-15 to 2023-24).
- Clubs are limited to those that appear in a parsed table or a squad; the master list has 58 entries and 51 are emitted.

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
