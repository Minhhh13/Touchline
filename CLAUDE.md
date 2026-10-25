# CLAUDE.md

Guide for AI coding agents working in this repository. Humans: see `docs/HANDOVER.md` and `CONTRIBUTING.md`.

## Keep the handover current (every change)

TouchLine is built by two people, the owner and a friend, each working with their own AI coding agent. These documents are the shared memory between those agents, so they are only useful if every change keeps them true.

- **Before you start:** read `docs/HANDOVER.md` (the in-progress table and the change log) and the open GitHub issues, and pick or claim an issue so the other person's agent does not build the same thing.
- **In the same pull request as your change**, update:
  - `docs/HANDOVER.md`: the in-progress table when work starts, moves branch or finishes; "What it does today" when a feature ships; hosting and backend notes when a service, environment variable or setting changes; known issues when you find or fix one; and one dated line in the change log at the bottom (date, who or which agent, what changed, PR or issue link).
  - `CLAUDE.md`: whenever a command, path, invariant or convention changes (for example a new module, a renamed script, a new `ENGINE_VERSION` value).
  - `CONTRIBUTING.md`: whenever the way the two of you work together changes.
- A pull request that changes behaviour without touching `docs/HANDOVER.md` says why in its description. The pull-request template has a checkbox for this.
- Never delete another person's change-log lines; add your own below them.

## What this is

- **TouchLine** (written with a capital L) is a browser football game: 38-0's spin-the-wheel draft fused with Football Manager depth.
- A wheel lands on a real club in a real season (seven leagues, 2008-09 to 2026-27); you draft one player per spin, then simulate or manage the season.
- Stack: Vite 6 + React 19 + TypeScript 5.8 strict + Zustand 5 (persist) + Immer 11. Tests: Vitest 3 (node environment).
- A deterministic seeded engine (`src/engine`) is the core: one seed replays identically on every device (the Daily, challenge links, leaderboards).
- No server at runtime: static JSON league packs in `public/data`, saves in `localStorage`. An online layer on Supabase is in progress and must stay optional.

## Architecture map

Path aliases: `@engine/*` -> `src/engine`, `@game/*` -> `src/game`, `@ui/*` -> `src/ui` (vite.config.ts, vitest.config.ts, tsconfig.app.json).

- `src/engine/` pure TypeScript, no React, no DOM (only `universe.ts` uses `fetch`).
  - `rng.ts` xoshiro128** `Rng`, `fork`, `getState`/`fromState`, `dailySeed`, `randomSeed`.
  - `version.ts` `ENGINE_VERSION` (currently `'4'` once fm-depth is in; `'3'` before).
  - `types.ts` domain types (Position, Attributes, PlayerSeason, Tactics, MatchEvent...).
  - `universe.ts` pack shapes, `buildLeague`, `mergeUniverses` (leagues.json order), loaders.
  - `positions.ts`, `roles.ts` (34 roles), `ratings.ts` (role rating, live modifiers, chemistry, team strength, `autoPickLineup`), `formations.ts` (8 shapes), `tactics.ts`.
  - `draft.ts` wheel, `DraftRules`, twists, the salary cap (`capPrice`, `affordable`, `capRoom`, `capForSquad`, `BUDGET_FLOOR`, the assistant's `CAP_AUTO_STRETCH`); `h2h.ts` hot-seat draft; `challenge.ts` ghost-draft links (`RULE_CHECKS`; payload `v: 1 | 2`, `V1_RULE_KEYS`, `payloadVersionFor`, the `isArenaLink` gate).
  - `match.ts` xG engine, three segments 1-45 / 46-70 / 71-90 (`beginMatch`, `advanceMatch`, `finishMatch`, `simulateMatch`).
  - `season.ts` fixtures, table, cups, Continental Cup, recovery, board; `market.ts`; `events.ts`; `status.ts`; `staff.ts`; `training.ts`; `objectives.ts`; `awards.ts`; `records.ts`; `nations.ts`; `story.ts` (`clinchMatchweeks`: the week the title was sealed or relegation certain, pure); `badges.ts` (Trophy Room `BADGES`, `badgeTier`, `badgeProgress`, `topBadges`, over a structural `BadgeCabinet`, pure); `knockout.ts` (the arena's knockout engine: `arenaClub` keyed `clubId@season`, `clubIdOfKey`, `teamStrengthOf` (memoised, never saved), `arenaPool` (sorted by key), `finalOpponent`, `giantsOf`, `KO_FIELD_TARGET`/`knockoutOffset`, the kick-by-kick `penaltyShootout` and `defaultTakers`; the Season cups keep `season.ts`'s `shootout`); `gauntlet.ts` (the Gauntlet's ladder: `gauntletBands`, `buildLadder` from the field stream, top rungs first, `GAUNTLET_CEILING`/`gauntletOffset`, `gauntletHome` (away on odd rungs), `gauntletImportance`, `rungLabels`, `rungBandLabel`); `cup.ts` (the Cup: `cupField` (the five fields from the field stream), `cupSeeds`, `drawFirstRound`/`drawNextRound`, `cupRoundName`, `cupImportance`, `CUP_FIELD_TARGET`, `playAiTie` (summary detail, the team-overall shoot-out), `applyArenaResult` (the arena's card rules on an AI side), `CupBracket` with `states` kept only where they differ from a fresh side's and only for clubs alive).
  - `__tests__/helpers.ts` `loadTestUniverse(leagues = ['england'])` reads packs from disk.
- `src/game/` the save and the game rules on top of the engine.
  - `types.ts` the persisted `Game`, `GameSettings`, `Profile`, `LiveMatch`, `QuickResult`.
  - `store.ts` Zustand store `useStore`, `SAVE_KEY = 'touchline-save-v1'`, persist `version: 1`, `partialize`, `merge` -> `normaliseGame`, the `mutate(fn)` Immer helper, every UI action.
  - `logic/setup.ts` `createGame`, `beginSeason`, Daily mapping (frozen); `quick.ts` `runQuickSeason`; `week.ts` matchweek loop, live matches, cups, events, `finishSeason`; `dynasty.ts`; `marketOps.ts`; `squad.ts`; `players.ts` (`playerLookup`); `talks.ts`; `development.ts`; `youth.ts`; `briefing.ts` (pure); `slotSheet.ts` (the Dugout slot picker and Draft slot chips, pure); `modes.ts` (every mode label: `MODE_TITLE`, `modeLabel`, `shareCardFooter`, `yearLabel`, `finishDraftLabel`, `isQuickLike`, exhaustive over `Mode`); `streaks.ts` (`advanceStreak`, `streakDay`: daily and weekly streak bookkeeping, pure); `story.ts` (Season Story: `seasonStory`, `storyForGame`, `realSeasonRow`, `realityLine`, pure, no RNG); `highlights.ts` (Season Highlights: `nextStop`, `stopAfterWeek`, `simToNextStop` (Sim 5's step until a stop, no RNG of its own), `foreseeStop`, `stopLine`); `arena.ts` (the arena: `finalGameSettings`, `beginArena`, `playArenaStep`, `advanceArenaMatch`, `resolveArenaStep`, `takePenalties`, `arenaRecovery`, `closeArenaMatch` (opens the Gauntlet's bonus spins), `finishArena`, `arenaRunEntry`, the Gauntlet's `gauntletGameSettings`, `changeTheDraw` (the lifeline), `simArenaToEnd`, `rungMark`, `gauntletLines`, the Cup's `cupGameSettings`, `isBigCup`, `fieldLabel`, `cupWinnerName` and the bracket (built in `beginArena`, AI ties on forks of `streams.ties` when the user's tie settles, redrawn on forks of `streams.draw`); mode `arena`, its own save slot, state in `Game.arena`, never inside `SeasonState`); `cabinet.ts` (Trophy Room: `creditGame`, `creditArena`, `creditH2H`, `alreadyCredited`, `rebuildCabinet`, `normaliseCabinet`, `reconcileTrophies`, `leaguesWon`, `filterBoard`; `countsAsLeagueSeason` is exhaustive over `Mode`, so a new mode must say whether its first place is a league title); `cap.ts` (the Moneyball wheel's presets, `capBudget`, `capOfGame`, `capLine`, `capFooter`, `grownBudget`, `earnsMoneyball`, pure); `challenge.ts`; `records.ts`; `save.ts` (`normaliseGame`); `h2h.ts`.
- `src/ui/` React screens, no game decisions.
  - `App.tsx` screen switch on `screen` + `game.phase` (no router), challenge hash `#c=`, theme, toast.
  - `screens/` Home, Setup, Draft, Dugout (season hub; exports `TacticsTab`), MatchScreen, Summary, H2H, Explore, ProfileScreen, HowTo, StatsTab, OppositionReport (optional `club`, `aiOffset`, `neutral` for an arena opponent); the arena's own ArenaSetup (`setupMode === 'arena'`, opened on a format by `openArenaSetup`), Arena (the hub, phase `week` with `game.arena`) and ArenaSummary.
  - `components/` Wheel, Pitch, PlayerRow, TableView, MatchTicker, TwistCard, GameByGame, SeasonStory, ShootoutPanel (the arena's penalty order, keeper and kick reveal), GauntletLadder (the fifteen rungs as chips), Bracket (the Cup's rounds and ties), CapControl (the salary cap setting, the Draft's cap chip and price chips), bits (Rating, Modal, Tabs, Toast...), leagueSegments.
  - `styles.css` one global stylesheet with tokens on `:root`; `format.ts` display helpers; `shareCard.ts` canvas PNG.
- `src/main.tsx` React root; registers `public/sw.js` on production builds only.
- `public/data/` generated league packs: `leagues.json`, `<league>/players.json`, `<league>/meta.json`. Committed; they are also the test fixtures.
- `scripts/import/` offline data pipeline (`build.mjs`, `download.mjs`, `config.mjs`, `leagues.mjs`, club tables, `nations*.{mjs,json}`, `enrich-nations.mjs`).
- `docs/` `GAME_DESIGN.md` (every system as implemented), `DATA.md` (pipeline, sources, licences), `RESEARCH.md`, `HANDOVER.md`.
- `.github/workflows/ci.yml` npm ci, typecheck, test, build on Node 22 for every push and PR.

## Commands

Node >= 22.13 (`package.json` engines; CI uses 22).

- `npm ci` install exactly from the lockfile.
- `npm run dev` Vite dev server (no service worker in dev).
- `npm test` Vitest over `src/**/*.test.ts` (about 25 s locally, 174 tests); `npx vitest run src/engine` or `src/game` for one area.
- `npm run typecheck` `tsc -b --noEmit`. `npm run lint` is the same command; there is no ESLint or Prettier.
- `npm run build` `tsc -b && vite build` into `dist/` (what Render runs).
- `npx vite preview --port 4173 --strictPort` serve `dist/` for Playwright smokes and service-worker checks.
- Rebuild data: `node scripts/import/build.mjs` (optionally `DATA_CACHE=/path/to/datasets node scripts/import/build.mjs`).
  - The cache directory is `DATA_CACHE` if set, otherwise `.cache/datasets` (gitignored) (`scripts/import/config.mjs`). `ensureDatasets()` (`download.mjs`) downloads only what is missing there: several large Kaggle archives (EA FC 24/25/26/27 ratings, the European Soccer Database sqlite), unpacked with `unzip`, plus openfootball results files. Needs `unzip` on PATH and Node >= 22.13 for `node:sqlite`.
  - Writes `public/data/**` with a new `generatedAt` stamp (today's date) and prints per-season counts, unknown nations and warnings.
  - Nationality enrichment (optional, network): after a build, `node scripts/import/enrich-nations.mjs` reads the built packs, queries Wikidata and writes `scripts/import/nations-override.json`; then rebuild so `build.mjs` applies it.
  - If the build runs out of memory, raise the heap with `NODE_OPTIONS=--max-old-space-size=4096`.

Before every push: `npm run typecheck && npm test && npm run build`, plus the Playwright smokes for UI changes.

## Invariants (do not break)

1. **Determinism.** No `Math.random`, `Date`, `Date.now` or `performance.now` in `src/engine` or in `src/game/logic` simulation paths. Every random draw goes through an `Rng`: `const rng = Rng.fromState(game.rngState); ...; game.rngState = rng.getState()`. Never `new Rng(...)` mid-game (only `createGame` and `startH2H` seed; `createGame` also seeds an arena game's three streams, `${seed}#field`, `#ties` and `#draw`, in `Game.arena.streams`, which draw the field so it never depends on the draft). Allowed exceptions: `randomSeed()`, `dailySeed()` with no argument, game ids/`createdAt`, achievement and leaderboard dates. UI randomness (Wheel cosmetics) never feeds the game.
2. **ENGINE_VERSION.** Bump `src/engine/version.ts` in the same commit whenever a change alters how many draws, or in what order, a spin, pick, match, season, cup draw, market day or event takes, or retunes a constant that changes a replayed outcome. Add a line to `docs/GAME_DESIGN.md` section 15 naming what the previous value meant. Re-baseline seeded tests in that commit.
3. **Data order is seed meaning.** `mergeUniverses` concatenates packs in `leagues.json` order. Append new leagues at the end; never reorder. Club ids and player-season ids (`${playerId}@${season}@${clubId}`) are permanent.
4. **Never change the Daily mapping** (`dailySettings`, `DAILY_FORMATIONS` order, `dailyGameSettings` rules in `src/game/logic/setup.ts`).
5. **Save compatibility.** New fields on anything persisted (`Game`, `GameSettings`, `Profile`, `Contract`, `DraftRules`, `DraftState`, `SeasonState`, `SquadPlayer`, `MatchInProgress`, `Tactics`, market types) are optional and read with `??` / `??=`. Defaults that must exist go in `normaliseGame` (`src/game/logic/save.ts`). Do not rename or retype fields. Do not change `SAVE_KEY` or persist `version: 1` without a `migrate`; doing so wipes every save. Keep `Game` JSON-serialisable (no Map, Set, class instances, functions).
6. **Immer.** A `produce` recipe that mutates its draft must not also return a value (Immer throws). `mutate(fn)` in `store.ts` already wraps `fn` in a block body, so its return value is discarded; direct `produce` calls (the head-to-head actions) need a block body or `void`, as `h2hPick`/`h2hAuto` do. Engine functions that mutate and return (`spin`, `respin`, `h2hSpin` return a `ClubSeason`; `placeBid` a `BidOutcome`) are called as statements inside recipes. Return results through an outer `let out`. Never mutate state read from `useStore()` (it is frozen).
7. **The universe is read-only.** Never mutate `LoadedUniverse` or a `PlayerSeason` in it. Player changes go into `game.customPlayers`; resolve squad players with `playerLookup(game, u)`, not `u.index`.
8. **TypeScript strict.** No `any` (none today), no `@ts-ignore`, no unused locals, parameters or imports (`noUnusedLocals`/`noUnusedParameters` fail CI).
9. **Every behaviour gets a Vitest test**, seeded with a literal string, using real packs via `loadTestUniverse()` (no mocks, no `fetch` in tests). Assert statistical properties over many seeds rather than one outcome.
10. **Docs move with code.** Each feature updates `README.md` (features) and the matching section of `docs/GAME_DESIGN.md`; data changes update `docs/DATA.md`.
11. **Playwright smokes stay green** for UI changes (see below). Prefer `data-testid` selectors.
12. **The UI decides nothing.** Screens call store actions; logic lives in `src/game/logic` or `src/engine` where it can be tested.
13. **Offline-first.** The game must work logged out and offline. Online features degrade to local-only when `VITE_SUPABASE_*` are missing.
14. **Pins stay green.** `src/engine/__tests__/pins.test.ts` and `src/game/__tests__/pins.test.ts` hold literal outcomes of fixed seeds (the quick wheel, the head-to-head log, the assistant's `flow-test` season). A feature must leave them unchanged; re-baseline them only in the commit that bumps `ENGINE_VERSION` or rebuilds the data, recomputing the literals there.

## Conventions

- Style: 2 spaces, LF, no semicolons, single quotes, long single-line JSX is normal. Do not reflow existing lines (it creates huge conflicts).
- Hooks above early returns in new components (Dugout, Summary and Explore currently break this; hoist when you touch them).
- Display names and numbers go through `src/ui/format.ts` (money in millions, wages in thousands per week).
- No real crests, kits, logos or photos: club identity is colours plus a code (`ClubBadge`).
- Persist only what must survive reload; per-viewer UI conveniences get their own `localStorage` key inside try/catch.
- Every finished result credits the Trophy Room's cabinet once, through `recordResult` -> `creditGame` (`src/game/logic/cabinet.ts`). A new mode's trophies go on their own shelf (the arena's and run-in's counters), never into the league and cup totals; `profile.trophies` stays a mirror of the cabinet's five counts for older builds.
- New draft rules need an entry in `RULE_CHECKS` (`src/engine/challenge.ts`); the type forces it. Never add one to `V1_RULE_KEYS`: a link using it travels as payload v2, so older builds say "newer version".
- The arena files a run on `profile.arenaRuns` and the cabinet's arena shelf (`creditArena`) from `recordResult`'s arena branch, before the league code: no leaderboard row, no daily streak, no season counted. Every store action that is a manager's decision during a run (tactics, roles, formation, assign, team talk, captain, man-marking, a live step, a custom penalty order) sets `arena.handManaged` through `byHand`; only assistant-managed runs will verify as challenges.
- The salary cap is one predicate, `affordable(d, p)` in `src/engine/draft.ts`, called from `canUse`, `eligibleSlots` and `pick`; every cap check runs only when `rules.budget` is set, so cap-less seeds never move. A new usability rule goes beside it the same way, and anything that grows a capped squad (a bonus spin) grows the cap with it (`grownBudget`). A rule that narrows the pool (one club, one nation) cannot share a draft with the cap (`capFits`), because the floor assumes a £0.5M man in every position.
- A new `Mode` starts in `src/game/logic/modes.ts` (the compiler then lists every label to word); screens never chain `mode === ...` for labels.
- New fields holding player-season ids must be remapped in `advanceToNextSeason` (dynasty) and cleared in `releasePlayer`.
- Write the product name as TouchLine in new text. Existing strings still say "Touchline"; leave mass renames to the redesign branch.

## Adding a feature end to end

1. **Engine** (`src/engine`): pure function over plain data plus an `Rng`. New persisted fields optional. Bump `ENGINE_VERSION` if draws change.
2. **Game logic** (`src/game/logic/*.ts`): `fn(game, u, ...)` mutating `game` in place, RNG rehydrated and written back. Weekly behaviour hooks into `afterMatchweek` in `week.ts`; check both the live path and `playMatchweek(..., true)`.
3. **Store action** (`src/game/store.ts`): declare it on the `Store` interface, implement as `mutate((g, u) => { logicFn(g, u, args) })`. If it can end a season, call `unlockFromGame()` and `recordResult()` after, as `playWeek` does.
4. **UI** (`src/ui`): render and call the action. Keep diffs local; add `data-testid` hooks for smokes.
5. **Tests**: Vitest in `src/engine/__tests__` or `src/game/__tests__`; extend the old-save test in `src/game/__tests__/audit.test.ts` for new save fields.
6. **Docs**: README feature line, `docs/GAME_DESIGN.md` section, ENGINE_VERSION history if bumped.
7. **Verify**: typecheck, test, build, smoke.

Specific recipes: a draft rule (optional `DraftRules` field, apply in `rulesPool`/`canUse`, `RULE_CHECKS`, thread through `GameSettings` and Setup, a 200-seed no-dry-wheel test); a twist (extend `Twist`/`TWISTS`, `twistAllows`, bump); an event (candidate in `rollEvent`, case in `resolveEvent`, apply in `applyEventChoice`, bump); a Dugout tab (`DugoutTab` in `briefing.ts`, `Tabs` array in `Dugout.tsx`).

## Adding a league

1. Add a club array and a `LEAGUES` entry in `scripts/import/clubs-europe.mjs` (spread into the registry in `scripts/import/leagues.mjs` after England) (id, names, `fc24LeagueId`, every `eaNames` spelling, `euroLeagueId`, openfootball repo/file or `null`). Keep it **last** so existing seeds do not shift.
2. Rebuild with `node scripts/import/build.mjs` (optionally with `DATA_CACHE=...`); read the report (per-season club counts, Unknown nations, Warnings) and fix unknown club names by adding aliases in the club tables.
3. Update the pinned stamp in `src/engine/__tests__/universe.test.ts`, add a check for the league, run all tests.
4. Check odd club counts (bye weeks), record books (need tables) and the Continental Cup.
5. Commit `public/data/**` with `docs/DATA.md` and README counts. Note that existing cross-league challenge links become "unverified".

## Branches and PRs

- One feature branch per change, from an up-to-date `main` (`feat/...`, `fix/...`, `docs/...`, `data/...`). Agent branches may use `claude/...`.
- Open a PR into `main`. CI (`.github/workflows/ci.yml`) must be green. Keep PRs small and get the other person (or their agent) to review.
- Merge or rebase from `main` often; never force-push `main`, never rewrite shared history.
- Commit messages: imperative, specific subject; body explains why. See `CONTRIBUTING.md`.
- Data packs: never hand-merge `public/data/*.json`; rebuild on the merged `scripts/import` and commit the result.

## Deployment and services

- **Render** static site `touchline` (https://touchline-o5ot.onrender.com) auto-deploys the working branch `claude/youthful-mccarthy-a57idu` on every push (not `main`): build `npm ci && npm run build`, publish `dist`, `BASE_PATH` unset (base `/`). A second site, `touchline-preview` (https://touchline-preview.onrender.com), tracks `claude/touchline-preview` for previews of in-progress branches. Both are in the Render project "TouchLine"; touch nothing else in that workspace.
- Env vars on Render: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public publishable keys). Vite inlines `VITE_*` at build time, so a change needs a redeploy and anything `VITE_*` is public. Locally put them in `.env.local` (gitignored via `*.local`).
- **Supabase** project id `yvqpmyqomkwtudxmkeou` (org Team TouchLine, Sydney, Free plan), schema empty today. Migrations will go in `supabase/migrations/` (the folder does not exist yet) and are applied to that project only. RLS on every table; run the security advisors after each change.
- **No secrets in the repo.** The Supabase `service_role` key is never used in the browser, never in a `VITE_` var, never committed. Server-side work (Edge Functions) reads it from Supabase secrets.
- `.github/workflows/pages.yml` is obsolete (private repo, Render hosts); the reel-ui branch removes it.

## Playwright smokes

Playwright is not a dependency. Install it outside the repo or with `npm i -D playwright && npx playwright install chromium` locally without committing. Then:

1. `npm run build` and `npx vite preview --port 4173 --strictPort` in the background.
2. A `.cjs` script outside the repo: launch chromium, collect `pageerror` and console errors, `localStorage.clear()`, then drive Home -> Quick Draft -> Setup -> Spin/Auto-complete -> Summary, and Season -> a live match through 45' and 70'. Screenshot at 1280 and 390 wide.
3. Read state with `JSON.parse(localStorage.getItem('touchline-save-v1')).state.game`.
4. Fail on any page error. Use `data-testid` selectors (`daily-card`, `cta`, `half-time-panel`, `late-panel`, `challenge-friend`...).

## Gotchas

- Rebuilding data changes `leagues.json` `generatedAt`: update the pinned stamp in `universe.test.ts`; old challenge links read as unverified. `universe.test.ts` and `records.test.ts` assert real facts and can break on a rebuild with no code change.
- Nested RNG in cup ties: `completeUserCupTie` rebuilds from a stale `game.rngState` inside `afterLeagueMatch`. Deterministic, just correlated; fixing it needs an ENGINE_VERSION bump. Pass `rng` down rather than adding more `Rng.fromState` calls.
- A sent-off or injured man stays in his slot inside `advanceMatch`; `shortHandedFactor` costs it. Do not "fix" it.
- `simulateMatch` must equal `beginMatch` -> `advanceMatch(70)` -> `finishMatch` event for event (tested).
- Formation slot ids are keys of saved lineups, roles and challenge picks; never rename them. Role contributions sum to 1.
- `store.merge` spreads persisted state over defaults, so removing a persisted key needs handling in `merge`.
- `go()` clears `pendingChallenge`; navigating away from Setup drops an opened challenge link.
- Theme "auto" is not OS-aware (no `prefers-color-scheme` block); auto renders dark.
- `Rating` (`bits.tsx`) renders the number as a bare text node inside `.rating`, and `.hidden-ratings` only hides `.rating > span`, so the CSS alone does not hide it; always pass `hideRatings`/`hidden`.
- Wheel timing: the `.wheel-wrap .rotor` transition is 2.3 s in `styles.css`; the reveal (2400 ms) and `onSettled` (2500 ms) timers are in `Wheel.tsx`; change them together.
- `public/sw.js` must keep the literal `__BUILD__` (stamped at build) and relative paths. Packs are unhashed and served stale-while-revalidate, so pack-shape changes must tolerate one old visit.
- `tsconfig.*.tsbuildinfo` are committed and rewritten by `tsc -b`: expect noise and conflicts; take either side and rebuild.
- `signYouth` hardcodes 23 instead of `SQUAD_CAP`; change both.
- `finishSeason` parses `awards.goldenBoot.value` as `"<n> goals"`; changing award strings breaks achievements.
- France, the Netherlands and Portugal have no tables (no record book, flat wheel weight).
- Some docs are stale (README: "Node 20 or later", the 69,118 player-season count (69,155 today) and the roadmap line listing Portugal and the Netherlands as future; DATA.md: the England-only intro and totals, and the note that `.cache` is not in `.gitignore`; RESEARCH section 7 lists youth intake, loans, staff and press conferences as not taken). Fix what you touch.

## Work in progress (not shipped; check branches before overlapping)

On GitHub today: `main` (PR #1 merged), the working branch `claude/youthful-mccarthy-a57idu` (draft PR #2 into `main`) and `claude/touchline-preview`. The feature branches below are not on GitHub until they are pushed; ask the owner before overlapping them.


- `reel-ui`: case-opening reel and game-by-game quick season (adds `logic/gameByGame.ts`), retires `pages.yml`.
- `fm-depth`: stamina, strength, aggression, jumping, work rate (`src/engine/depth.ts`); rebuilt packs with players.json `version: 3`; bumps ENGINE_VERSION to `'4'`.
- `match-visuals`: live 2D pitch, momentum, shot map, xG race (MatchScreen, MatchTicker).
- `redesign`: blue palette, TouchLine logo (styles.css tokens, App brand, manifest, shareCard).
- `replica-setup`: 38-0 style setup (difficulty tiers, ratings toggle, squad-first vs position-first, season vs prime ratings, era presets); expected to rewrite Setup.tsx and add `DraftRules` fields.
- Working branch: "while you were away" digest, coach marks, slot picker (all shipped there).
- Planned: online layer on Supabase (accounts, cloud saves, daily leaderboard, challenge codes, online head-to-head rooms) and casual modes.
