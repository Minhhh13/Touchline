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
- Stack: Vite 6 + React 19 + TypeScript 5.8 strict + Zustand 5 (persist) + Immer 11, icons from `lucide-react` (pinned). Tests: Vitest 3 (node environment).
- A deterministic seeded engine (`src/engine`) is the core: one seed replays identically on every device (the Daily, challenge links, leaderboards).
- No server at runtime: static JSON league packs in `public/data`, saves in `localStorage`. An online layer on Supabase is in progress and must stay optional.

## Architecture map

Path aliases: `@engine/*` -> `src/engine`, `@game/*` -> `src/game`, `@ui/*` -> `src/ui` (vite.config.ts, vitest.config.ts, tsconfig.app.json).

- `src/engine/` pure TypeScript, no React, no DOM (only `universe.ts` uses `fetch`).
  - `rng.ts` xoshiro128** `Rng`, `fork`, `getState`/`fromState`, `dailySeed`, `randomSeed`.
  - `version.ts` `ENGINE_VERSION` (currently `'4'`: the depth attributes in the match engine).
  - `types.ts` domain types (Position, Attributes, PlayerSeason, Tactics, MatchEvent...).
  - `universe.ts` pack shapes, `buildLeague`, `mergeUniverses` (leagues.json order), loaders.
  - `depth.ts` (stamina, strength, aggression, jumping, work rate; `withDepth` fills them for older packs and saves), `matchDetail.ts` (shot positions and the momentum series, from a forked stream), `positions.ts`, `roles.ts` (34 roles), `ratings.ts` (role rating, live modifiers, chemistry, team strength, `autoPickLineup`), `formations.ts` (8 shapes), `tactics.ts`.
  - `draft.ts` wheel, `DraftRules` (difficulty, show ratings, Position First, Prime ratings, the Quick Draft bench `benchPicks`), twists; `era.ts` era presets and seasons held; `prime.ts` Prime ratings (pure, cached per league set); `h2h.ts` hot-seat draft; `challenge.ts` ghost-draft links (`RULE_CHECKS`).
  - `match.ts` xG engine, three segments 1-45 / 46-70 / 71-90 (`beginMatch`, `advanceMatch`, `finishMatch`, `simulateMatch`), and in-play changes at any minute (`changeInPlay`: roll the segment in play back to k and replay from a forked stream; `canChangeInPlay`, `onPitchAtMinute`, `benchAt`, `MAX_SUBS`, `MAX_WINDOWS`). `highlights.ts` (`summaryHighlights`) the key moments of a summary match for the quick-season highlights reel, its extra chances and saves from a fork.
  - `matchFeed.ts` (one feed for a live or finished match, `tacticsAt`, `scoreAt`), `matchStats.ts` (team stats minute by minute, `shotXg`, `xgStory`, `addedTime`), `liveRatings.ts` (`ratingsAt`, `liveCondition`).
  - `season.ts` fixtures, table, cups, Continental Cup, recovery, board; `market.ts`; `events.ts`; `status.ts`; `staff.ts`; `training.ts`; `objectives.ts`; `awards.ts`; `records.ts`; `nations.ts`.
  - `__tests__/helpers.ts` `loadTestUniverse(leagues = ['england'])` reads packs from disk.
- `src/game/` the save and the game rules on top of the engine.
  - `types.ts` the persisted `Game`, `GameSettings`, `Profile`, `LiveMatch`, `QuickResult`.
  - `store.ts` Zustand store `useStore`, `SAVE_KEY = 'touchline-save-v1'`, persist `version: 1`, `partialize` (`persistedState`, which runs `compactGame`), `merge` -> `normaliseGame`, the `mutate(fn)` Immer helper, every UI action (the quick season's `kickOff`, `closeJanuary`, `makeQuickChange`, `closeQuickSeason` and the `playback` flag among them), `exportSaveJson`/`readSaveFile`/`storeImportedSave`/`wipeSave` for the Profile page.
  - `saveStorage.ts` the persist storage: lz-string `compressToUTF16` on write, plain JSON or compressed on read, coalesced writes (`flush`, `freeze`), the quota error.
  - `logic/setup.ts` `createGame`, `beginSeason`, `setupRules` (setup cards to `DraftRules`), `summariseSetup`; `daily.ts` the Daily mapping, `DAILY_RULES` and `DAILY_SEASON` (frozen, re-exported from `setup.ts`); `quick.ts` `runQuickSeason`, the tactics step (`toKickoff`, `kickOff`), the January split (`openJanuary`, `closeJanuary`), the bench changes (`makeQuickChange`, `quickSquadAt`, `quickChangeProblem`) and the Continental Cup run; `quickBench.ts` (the Quick Draft bench in the season: `fieldXI` injury cover, `applyChange`, `QUICK_CHANGES = 3`, pure); `january.ts` (window budget and listings, pure); `gameByGame.ts` (game-by-game results and playback helpers, pure); `highlights.ts` (`quickHighlights`: any quick-season game rebuilt from `QuickResult.startRng` via `replayUserMatch` in `quick.ts`, pure); `week.ts` matchweek loop, live matches (`advanceLiveMatch(..., hold)`, `completeLiveMatch`, `changeLiveMatch`), cups, events, `finishSeason`; `matchday.ts` (`latestScores`, `liveTable`, `roundRefOf`, pure); `dynasty.ts`; `marketOps.ts`; `squad.ts`; `players.ts` (`playerLookup`); `talks.ts`; `development.ts`; `youth.ts`; `briefing.ts` (pure); `slotSheet.ts` (the Dugout slot picker and Draft slot chips, pure); `digest.ts` and `news.ts` (the "while you were away" digest and unread counts, pure); `tips.ts` (coach-mark ids); `formationThumb.ts` (the mini pitch on every formation tile, from the slot coordinates, pure); `challenge.ts`; `records.ts`; `save.ts` (`normaliseGame`); `compact.ts` (`compactGame`, what a saved result keeps); `h2h.ts`.
- `src/ui/` React screens, no game decisions.
  - `App.tsx` screen switch on `screen` + `game.phase` (no router; phases `kickoff` and `january` too), challenge hash `#c=`, theme (sets `data-theme` from `theme.ts`'s `useResolvedTheme`; the top bar's `theme-switch`), toast.
  - `screens/` Home, Setup, Draft, KickOff (quick tactics step), SeasonPlayback (game by game, January window, bench changes, highlights), Dugout (season hub), MatchScreen, Summary, H2H, Explore, ProfileScreen, HowTo, StatsTab, OppositionReport.
  - `components/` CaseReel (the draft's case-opening reel), GameByGame, FormationPicker (the one formation chooser: a tile per shape with its mini pitch; Setup, Head-to-head and the Tactics tab), Highlights (the quick-season highlights modal), SetupBits (ChoiceCards, SeasonRange), TacticsControls, Pitch (+ PitchLegend), LivePitch and MatchCharts (the live 2D pitch, momentum, shot map), AttributePanel, PlayerRow, TableView, TwistCard, bits (Rating, Modal, Tabs, Toast, Tip...), leagueSegments, `Flag.tsx` (`Flag`, `NationFlag`, `LeagueFlag`: drawn SVG flags from `public/flags`, never emoji), `Art.tsx` (`HeroArt`, `ModeArt`, `NeonFlow`: our own cartoon and neon SVG, coloured by the `--art-*`, `--cyan`, `--magenta` tokens).
  - `matchday/` the match-day dashboard, which replaced `MatchTicker` (`MatchDashboard.tsx` shell and clock, `widgets.tsx` registry, `TopBar.tsx` and `drawers/`, `StopPanel.tsx`, `SquadStrip.tsx`, `CompactLayout.tsx`/`PhoneTabs.tsx` under 1200 px, `panels/`, pure `controls.ts`/`model.ts`); its CSS is `matchday*.css`, scoped under `.matchday` and built on the `styles.css` tokens.
  - `match/` pure helpers for the match visuals (`pitchGeometry.ts`, `possession.ts`, `charts.ts`, `clockStore.ts`, `movement.ts`, `epochs.ts`, `heat.ts`, `commentary.ts`, `shirts.ts` with `kitColours`, shared by the match-day dashboard and the quick-season highlights).
  - `styles.css` one global stylesheet: design tokens on `:root` (Floodlit, dark) and `[data-theme='light']` (Daylight), then every shared component; `brand.ts` (`APP_NAME`, the mark's geometry, `BRAND_COLOURS` for canvas drawing) and `components/Logo.tsx`; `format.ts` display helpers (`tierName`, `conditionColour`, `fitRingColour`); `shareCard.ts` canvas PNGs (the result card and the match card).
  - The look is specified in `docs/DESIGN_SYSTEM.md`: use its tokens and components, no raw colours (the pitch's fixed whites and club kit colours excepted).
- `src/main.tsx` React root; registers `public/sw.js` on production builds only.
- `public/data/` generated league packs: `leagues.json`, `<league>/players.json`, `<league>/meta.json`. Committed; they are also the test fixtures.
- `public/flags/` 4:3 SVG flags (`<code>.svg`: ISO alpha-2, `gb-eng`/`gb-sct`/`gb-wls`/`gb-nir`, `eu`, and our own `unknown.svg`) copied from flag-icons 7.6.0 (MIT, `LICENSE.txt` beside them) by `scripts/brand/flags.mjs`; committed, served cache-first by `public/sw.js`.
- `scripts/import/` offline data pipeline (`build.mjs`, `download.mjs`, `config.mjs`, `leagues.mjs`, club tables, `nations*.{mjs,json}`, `enrich-nations.mjs`).
- `scripts/brand/flags.mjs` copies the flags the packs need from an extracted flag-icons package into `public/flags` (how to rerun at its top).
- `docs/` `GAME_DESIGN.md` (every system as implemented), `DATA.md` (pipeline, sources, licences, flags), `RESEARCH.md`, `HANDOVER.md`, `DESIGN_SYSTEM.md`, `CREDITS.md` (third-party notices, one self-contained section each: flags, icons).
- `.github/workflows/ci.yml` npm ci, typecheck, test, build on Node 22 for every push and PR.

## Commands

Node >= 22.13 (`package.json` engines; CI uses 22).

- `npm ci` install exactly from the lockfile.
- `npm run dev` Vite dev server (no service worker in dev).
- `npm test` Vitest over `src/**/*.test.ts` (about two minutes locally, 481 tests; on a loaded machine a slow seeded sweep can hit the 5 s timeout, so rerun that file alone before suspecting it); `npx vitest run src/engine` or `src/game` for one area.
- `npm run typecheck` `tsc -b --noEmit`. `npm run lint` is the same command; there is no ESLint or Prettier.
- `npm run build` `tsc -b && vite build` into `dist/` (what Render runs).
- `npx vite preview --port 4173 --strictPort` serve `dist/` for Playwright smokes and service-worker checks.
- Rebuild data: `node scripts/import/build.mjs` (optionally `DATA_CACHE=/path/to/datasets node scripts/import/build.mjs`).
  - The cache directory is `DATA_CACHE` if set, otherwise `.cache/datasets` (gitignored) (`scripts/import/config.mjs`). `ensureDatasets()` (`download.mjs`) downloads only what is missing there: several large Kaggle archives (EA FC 24/25/26/27 ratings, the European Soccer Database sqlite), unpacked with `unzip`, plus openfootball results files. Needs `unzip` on PATH and Node >= 22.13 for `node:sqlite`.
  - Writes `public/data/**` with a new `generatedAt` stamp (today's date) and prints per-season counts, unknown nations and warnings.
  - Nationality enrichment (optional, network): after a build, `node scripts/import/enrich-nations.mjs` reads the built packs, queries Wikidata and writes `scripts/import/nations-override.json`; then rebuild so `build.mjs` applies it.
  - If the build runs out of memory, raise the heap with `NODE_OPTIONS=--max-old-space-size=4096`.
- Refresh flags (after a rebuild that adds nations): `npm pack flag-icons@7.6.0` and `tar -xzf` it in an empty folder outside the repo (do not install it), then `node scripts/brand/flags.mjs /that/folder/package`. It rewrites `public/flags` and reports nations without a flag.

Before every push: `npm run typecheck && npm test && npm run build`, plus the Playwright smokes for UI changes.

## Invariants (do not break)

1. **Determinism.** No `Math.random`, `Date`, `Date.now` or `performance.now` in `src/engine` or in `src/game/logic` simulation paths. Every random draw goes through an `Rng`: `const rng = Rng.fromState(game.rngState); ...; game.rngState = rng.getState()`. Never `new Rng(...)` mid-game (only `createGame` and `startH2H` seed). Allowed exceptions: `randomSeed()`, `dailySeed()` with no argument, game ids/`createdAt`, achievement and leaderboard dates. UI randomness (reel cosmetics) never feeds the game.
2. **ENGINE_VERSION.** Bump `src/engine/version.ts` in the same commit whenever a change alters how many draws, or in what order, a spin, pick, match, season, cup draw, market day or event takes, or retunes a constant that changes a replayed outcome. Add a line to `docs/GAME_DESIGN.md` section 15 naming what the previous value meant. Re-baseline seeded tests in that commit.
3. **Data order is seed meaning.** `mergeUniverses` concatenates packs in `leagues.json` order. Append new leagues at the end; never reorder. Club ids and player-season ids (`${playerId}@${season}@${clubId}`) are permanent.
4. **Never change the Daily mapping** (`dailySettings`, `DAILY_FORMATIONS` order, `DAILY_RULES` and `DAILY_SEASON` in `src/game/logic/daily.ts`, `dailyGameSettings` in `src/game/logic/setup.ts`). A new draft rule gets a literal value in `DAILY_RULES` (a test fails until it does).
5. **Save compatibility.** New fields on anything persisted (`Game`, `GameSettings`, `Profile`, `Contract`, `DraftRules`, `DraftState`, `SeasonState`, `SquadPlayer`, `MatchInProgress`, `Tactics`, market types) are optional and read with `??` / `??=`. Defaults that must exist go in `normaliseGame` (`src/game/logic/save.ts`). Do not rename or retype fields. Do not change `SAVE_KEY` or persist `version: 1` without a `migrate`; doing so wipes every save. Keep `Game` JSON-serialisable (no Map, Set, class instances, functions). The stored string is lz-string `compressToUTF16` of the persisted JSON; the storage must keep reading plain JSON (a value starting with `{`: every save before compression, and every export). `compactGame` strips a stored fixture or tie result down to its score, xG and penalties, except the user's league matches of the current and previous matchweek and the user's last tie per knockout: logic and screens may read only `homeGoals`, `awayGoals`, `penalties` and `winnerId` from an older result (the match screen reads `game.lastMatch`/`lastCupMatch`, statistics come from squad and AI states). Reading more needs a change to `compact.ts` and its tests. It touches only `game.season`: the quick season (`quickResult`, `quickJanuary`, `quickOpen`, `quickChanges`, `quickStartRng`) is kept whole, and its highlights are replayed from `startRng`, not read from stored events (tested through the compacted, compressed save in `highlights.test.ts`). Unbounded lists get a cap at the source (news 120, window log `WINDOW_LOG_CAP`).
6. **Immer.** A `produce` recipe that mutates its draft must not also return a value (Immer throws). `mutate(fn)` in `store.ts` already wraps `fn` in a block body, so its return value is discarded; direct `produce` calls (the head-to-head actions) need a block body or `void`, as `h2hPick`/`h2hAuto` do. Engine functions that mutate and return (`spin`, `respin`, `h2hSpin` return a `ClubSeason`; `placeBid` a `BidOutcome`) are called as statements inside recipes. Return results through an outer `let out`. Never mutate state read from `useStore()` (it is frozen).
7. **The universe is read-only.** Never mutate `LoadedUniverse` or a `PlayerSeason` in it. Player changes go into `game.customPlayers`; resolve squad players with `playerLookup(game, u)`, not `u.index`.
8. **TypeScript strict.** No `any` (none today), no `@ts-ignore`, no unused locals, parameters or imports (`noUnusedLocals`/`noUnusedParameters` fail CI).
9. **Every behaviour gets a Vitest test**, seeded with a literal string, using real packs via `loadTestUniverse()` (no mocks, no `fetch` in tests). Assert statistical properties over many seeds rather than one outcome.
10. **Docs move with code.** Each feature updates `README.md` (features) and the matching section of `docs/GAME_DESIGN.md`; data changes update `docs/DATA.md`.
11. **Playwright smokes stay green** for UI changes (see below). Prefer `data-testid` selectors.
12. **The UI decides nothing.** Screens call store actions; logic lives in `src/game/logic` or `src/engine` where it can be tested.
13. **Offline-first.** The game must work logged out and offline. Online features degrade to local-only when `VITE_SUPABASE_*` are missing.

## Conventions

- Style: 2 spaces, LF, no semicolons, single quotes, long single-line JSX is normal. Do not reflow existing lines (it creates huge conflicts).
- Hooks above early returns in new components (Dugout, Summary and Explore currently break this; hoist when you touch them).
- Display names and numbers go through `src/ui/format.ts` (money in millions, wages in thousands per week).
- Flags are drawn, never emoji (Windows shows emoji flags as letter pairs): render `NationFlag`/`LeagueFlag` from `src/ui/components/Flag.tsx` (`leagueId="europe"` is the EU flag), never a nation's `.flag` string or `flag()`. Pass `label` only when no name is printed beside the flag.
- No real crests, kits, logos or player photos: club identity is colours plus a code (`ClubBadge`). The Home pictures are our own cartoon SVG (`src/ui/components/Art.tsx`: `HeroArt`, `ModeArt`, `NeonFlow`), no photos. Never UEFA or Champions League marks or trade dress (no starball, no star shapes or patterns, no such text); rules in `docs/DESIGN_SYSTEM.md` sections 3 and 7.
- Icons come from `lucide-react`, one import per icon; emoji only as status glyphs inside text or share text, never as the picture of a card, button or heading.
- Persist only what must survive reload; per-viewer UI conveniences get their own `localStorage` key inside try/catch.
- New draft rules need an entry in `RULE_CHECKS` (`src/engine/challenge.ts`); the type forces it.
- New fields holding player-season ids must be remapped in `advanceToNextSeason` (dynasty) and cleared in `releasePlayer`.
- Write the product name as TouchLine (`APP_NAME`); the default team name "Touchline XI" and lower-case slugs (`touchline-save-v1`, file names) stay as they are. Titles and buttons in sentence case; tiers through `tierName()`.
- Colours: `--good` for good outcomes, `--primary` for actions and selection, `--accent` for highlights and info, `--meter-mid` (never `--gold`) for the middle band of a bar, `.chip.info` for a state such as "in the XI".

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

- **Render** (workspace TouchLine, `tea-dbeoghbrjlhs738bpcng`; touch nothing in any other workspace): static site `Touchline` serves the live game at **https://touchline.quest** (custom domain, `www` redirects to it; Render's own address https://touchline-16xv.onrender.com still works) and deploys `main` once CI passes on the commit; static site `touchline-newfeature-preview` (https://touchline-newfeature-preview.onrender.com) is the testing site and deploys `claude/touchline-preview` on every push, for previews of in-progress branches merged together. Both build `npm ci && npm run build`, publish `dist`, `BASE_PATH` unset (base `/`), `NODE_VERSION=22`.
- Env vars on Render: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public publishable keys). Vite inlines `VITE_*` at build time, so a change needs a redeploy and anything `VITE_*` is public. Locally put them in `.env.local` (gitignored via `*.local`).
- **Supabase** project id `yvqpmyqomkwtudxmkeou` (org Team TouchLine, Sydney, Free plan), schema empty today. Migrations will go in `supabase/migrations/` (the folder does not exist yet) and are applied to that project only. RLS on every table; run the security advisors after each change.
- **No secrets in the repo.** The Supabase `service_role` key is never used in the browser, never in a `VITE_` var, never committed. Server-side work (Edge Functions) reads it from Supabase secrets.
- There is no GitHub Pages workflow any more (the repo is private and Render hosts). Do not add one: Render deploys `main` only when every check on the commit passes, so a failing extra workflow blocks the live deploy.

## Playwright smokes

Playwright is not a dependency. Install it outside the repo or with `npm i -D playwright && npx playwright install chromium` locally without committing. Then:

1. `npm run build` and `npx vite preview --port 4173 --strictPort` in the background.
2. A `.cjs` script outside the repo: launch chromium, collect `pageerror` and console errors, `localStorage.clear()`, then drive Home -> Quick Draft -> Setup -> Spin/Auto-complete -> Summary, and Season -> a live match through 45' and 70'. Screenshot at 1280 and 390 wide.
3. Read state from the compressed save: `page.addScriptTag({ path: 'node_modules/lz-string/libs/lz-string.js' })`, then `JSON.parse(LZString.decompressFromUTF16(localStorage.getItem('touchline-save-v1'))).state.game` (an old plain save starts with `{` and parses directly). Writes are coalesced, so wait about 300 ms after an action before reading.
4. Sim 5 and Sim to end open the "while you were away" digest over the dugout: close it with `[data-testid="digest-close"]` before the next click.
5. Fail on any page error. Use `data-testid` selectors (`daily-card`, `cta`, `half-time-panel`, `late-panel`, `challenge-friend`...).

## Gotchas

- A quick season with a bench (`DraftRules.benchPicks`) is played again on every bench change, from `Game.quickStartRng` (where it kicked off), never from `game.rngState`, which `runQuickSeason` leaves at the end of the season. Its result is recorded on `endPlayback`, not at kick-off (`Game.quickOpen`). Bench spins after the XI draw from `DraftState.benchRng`, not the game's stream; keep both so a bench changes nothing until it is used.
- Rebuilding data changes `leagues.json` `generatedAt`: update the pinned stamp in `universe.test.ts`; old challenge links read as unverified. `universe.test.ts` and `records.test.ts` assert real facts and can break on a rebuild with no code change.
- Nested RNG in cup ties: `completeUserCupTie` rebuilds from a stale `game.rngState` inside `afterLeagueMatch`. Deterministic, just correlated; fixing it needs an ENGINE_VERSION bump. Pass `rng` down rather than adding more `Rng.fromState` calls.
- A sent-off or injured man stays in his slot inside `advanceMatch`; `shortHandedFactor` costs it. Do not "fix" it.
- The late fade (`applyLateFade`) is applied once, when `advanceMatch` plays 71-90, and stored as `TeamSnapshot.lateFadeAt70`; `changeInPlay` after 70 re-applies the stored value to the expected goals only. Never call `applyLateFade` again in a cut.
- An untouched match must equal `simulateMatch` event for event however the dashboard pauses it: `changeInPlay` refuses a change that changes nothing before touching `mp` (tested over 40 seeds × 10 minutes).
- `simulateMatch` must equal `beginMatch` -> `advanceMatch(70)` -> `finishMatch` event for event (tested).
- Formation slot ids are keys of saved lineups, roles and challenge picks; never rename them. Role contributions sum to 1.
- `store.merge` spreads persisted state over defaults, so removing a persisted key needs handling in `merge`.
- `go()` clears `pendingChallenge`; navigating away from Setup drops an opened challenge link.
- Theme: `data-theme` is always set (`light` or `dark`), by the inline script in `index.html` before load and by `App.tsx` after; Auto follows `prefers-color-scheme` live. Headless Chromium reports light, so smokes on Auto run in Daylight unless the context sets `colorScheme: 'dark'`.
- `Rating` (`bits.tsx`) renders the number as a bare text node inside `.rating`, and `.hidden-ratings` only hides `.rating > span`, so the CSS alone does not hide it; always pass `hideRatings`/`hidden`.
- Reel timing: `SPIN_MS` (2300 ms, the strip's slide) and `SETTLE_MS` (2500 ms, `onSettled`) are in `CaseReel.tsx`; change them together.
- `public/sw.js` must keep the literal `__BUILD__` (stamped at build) and relative paths. Packs are unhashed and served stale-while-revalidate, so pack-shape changes must tolerate one old visit.
- `*.tsbuildinfo` is gitignored and `tsconfig.app.tsbuildinfo` is no longer tracked (`tsconfig.node.tsbuildinfo` still is): a branch that still commits the app file conflicts as modify/delete; resolve with `git rm --cached tsconfig.app.tsbuildinfo` and rebuild.
- `signYouth` hardcodes 23 instead of `SQUAD_CAP`; change both.
- `finishSeason` parses `awards.goldenBoot.value` as `"<n> goals"`; changing award strings breaks achievements.
- France, the Netherlands and Portugal have no tables (no record book, flat wheel weight).
- Some docs are stale (README: "Node 20 or later", the 69,118 player-season count (69,155 today) and the roadmap line listing Portugal and the Netherlands as future; DATA.md: the England-only intro and totals, and the note that `.cache` is not in `.gitignore`; RESEARCH section 7 lists youth intake, loans, staff and press conferences as not taken). Fix what you touch.

## Work in progress (not shipped; check branches before overlapping)

On GitHub today: `main` (the live site), the working branch `claude/youthful-mccarthy-a57idu`, `claude/touchline-preview` (the preview site) and `redesign`. The feature branches below are not on GitHub until they are pushed; ask the owner before overlapping them.

- `replica-release` (local, not pushed): `main` with `replica-plus` (the 38-0 setup from `replica-setup`, the Quick Draft bench, quick-season highlights, mini formation pictures) and then `claude/touchline-preview` (the `matchday` dashboard) merged; it replaces `replica-setup`, `replica-plus` and `matchday-release`.
- Planned: online layer on Supabase (accounts, cloud saves, daily leaderboard, challenge codes, online head-to-head rooms) and casual modes.
