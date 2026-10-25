# TouchLine handover

For the people working on TouchLine: what it is, what works today, what is being built, where everything lives and how it is hosted. AI agents should start from [CLAUDE.md](../CLAUDE.md); the way we work together is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. What TouchLine is

A free web football game that fuses the wheel draft of **38-0** with the depth of **Football Manager**. A wheel lands on a real club in a real season, you draft one player from that squad, repeat until your side is built, then either simulate the season instantly or manage it week by week. Your side takes one real club's place in a real league season and plays the other clubs' real squads.

- Seven leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, seasons 2008-09 to 2026-27 (about 69,000 player-seasons).
- Runs entirely in the browser, installable and playable offline. Saves live in the browser (`localStorage`). No account needed.
- Deterministic: one seed always plays out the same way on every device, which is what makes the Daily, challenge links and (soon) online leaderboards fair.

## 2. What it does today

**Modes**
- **Quick Draft** (the 38-0 mode): draft an XI in 11 picks (two re-spins), simulate the whole league season in one click, share the result.
- **Daily Challenge**: the same wheel for everyone each day (UTC), with streaks.
- **Season**: draft 16 to 22 players, then manage every matchweek: friendlies, live matches, a cup, a January window, a board that can sack you.
- **Dynasty**: Season mode that never ends: ageing, contracts, retirements, youth intake, summer draft and summer window.
- **Head-to-head**: two managers on one device draft from the same spins and play the same season.

**Draft systems**: no dead spins, eight formations, era / one-club / one-nation filters, hard mode (hidden ratings), re-spins, wheel twists every third spin (Golden, Basement, Blind, Decade), European Nights (draft from all seven leagues), ghost-draft challenge links (`#c=...`) verified by replay.

**Management systems**: 34 roles and six team instructions, an xG match engine with live stops at half time and the 70th minute (talks, subs, touchline shouts), condition / sharpness / morale / familiarity, injuries and suspensions, training focus, squad status and playing time, player conversations, captain and set-piece takers, backroom staff, man-marking, press conferences and dressing-room events, the assistant's briefing, a domestic cup and an optional Continental Cup, a transfer market with bids, loans and part-exchange, finances, board objectives, in-season development, awards, 19 achievements, record books against real seasons, a share card, save export / import.

Full detail with formulas: [GAME_DESIGN.md](GAME_DESIGN.md). Data method: [DATA.md](DATA.md). Design research: [RESEARCH.md](RESEARCH.md).

## 3. In progress (not shipped yet)

Each item lives on its own branch until it is merged into the working branch and then `main`. On GitHub today there are only `main` (PR #1 merged), the working branch (draft PR #2 into `main`) and `claude/touchline-preview`; the feature branches below are pushed when ready, so ask before starting overlapping work.

| Work | Branch | State |
| --- | --- | --- |
| Case-opening reel instead of the wheel; game-by-game quick season | `reel-ui` | Built, waiting to merge; on the preview site |
| Football Manager depth attributes (stamina, strength, aggression, jumping, work rate) through data, engine and UI | `fm-depth` | In progress; rebuilds the data packs, ENGINE_VERSION `'4'`; on the preview site |
| Live match visuals: 2D pitch, momentum, shot map, xG race | `match-visuals` | In progress |
| Redesign: blue palette, a proper TouchLine logo, cleaner Setup | `redesign` | In progress |
| 38-0 style setup: difficulty tiers, ratings toggle, squad-first vs position-first, season vs prime ratings, era presets and slider, formation pitch preview; Position First on the Draft screen | `replica-setup` (main merged in) | Rules, setup screen, the quick-season tactics step, game-by-game playback, January window and Continental Cup run built; not pushed yet |
| The preview branch (reel, FM depth, match visuals) plus the 38-0 setup and quick season | `replica-plus` (local, cut from `claude/touchline-preview` at `3e9a594`) | `replica-setup` merged in; Quick Draft bench and season changes built; not pushed yet |
| 38-0 season presentation: plain tier names, newest-first game list with a counting tally | `season-show` (local, cut from `replica-plus`) | Built; pre-season odds and managers still to come; not pushed yet |
| "While you were away" digest | working branch `claude/youthful-mccarthy-a57idu` | Shipped on the working branch (live site) |
| Coach marks, slot picker | working branch `claude/youthful-mccarthy-a57idu` | In progress |
| Online layer: accounts, cloud saves, daily leaderboard, challenge codes, online head-to-head rooms (Supabase) | not started in code | Designed |
| Casual modes | not started in code | Designed |

## 4. Where things live

| Path | What |
| --- | --- |
| `src/engine/` | The deterministic game engine: RNG, draft and wheel, ratings, match engine, season, cups, market, events. Pure TypeScript. |
| `src/game/` | The save format (`types.ts`), the Zustand store (`store.ts`) and the game rules on top of the engine (`logic/`). |
| `src/ui/` | React screens and components, one global stylesheet. |
| `public/data/` | Generated league packs (committed). |
| `scripts/import/` | The offline pipeline that builds the packs from public datasets. |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` | Offline support and app install. |
| `docs/` | Design, data and research docs, this file. |
| `.github/workflows/ci.yml` | CI: typecheck, test, build on every push and PR. |

## 5. Run it

Needs Node 22.13 or later.

```bash
git clone https://github.com/Minhhh13/Touchline.git   # private: you need collaborator access
cd Touchline
npm ci
npm run dev          # http://localhost:5173
npm test             # all Vitest suites
npm run typecheck
npm run build        # production build into dist/
npx vite preview --port 4173 --strictPort   # serve the build
```

Rebuilding the player data is rarely needed and downloads several large archives the first time: `node scripts/import/build.mjs`, with `DATA_CACHE=/path/to/datasets` to reuse a cache (default `.cache/datasets`; see [DATA.md](DATA.md)).

## 6. Hosting and backend

### Render (hosting)

Both sites are static sites in the Render project **TouchLine**. That Render workspace also holds an unrelated project; never change anything outside the TouchLine project.

| Service | URL | Tracks | Use |
| --- | --- | --- | --- |
| `touchline` | https://touchline-o5ot.onrender.com | `claude/youthful-mccarthy-a57idu` (the working branch) | The live game |
| `touchline-preview` | https://touchline-preview.onrender.com | `claude/touchline-preview` | Previews of in-progress branches (today `reel-ui` and `fm-depth` merged) |

- Build command `npm ci && npm run build`, publish directory `dist`, no `BASE_PATH`.
- Auto-deploy on every push to the tracked branch (Render's GitHub app is installed on the repo).
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. These are the public publishable keys; Vite bakes them into the build, so changing them needs a redeploy.
- To deploy from `main` instead, change the tracked branch in the Render dashboard once `main` is the integration branch.
- Optional: rename the service to drop the `-o5ot` suffix, and add a custom domain.
- The GitHub Pages workflow (`.github/workflows/pages.yml`) is obsolete and is being removed.

### Supabase (backend for the online layer)

- Organisation **Team TouchLine**, project **TouchLine**, id `yvqpmyqomkwtudxmkeou`, region Sydney (ap-southeast-2), Free plan.
- Status: provisioned and healthy, **no schema yet**. Nothing in the code uses it yet.
- Still to configure:
  - Auth providers: email magic link, Google (optional; needs a Google OAuth client id and secret).
  - Auth URL configuration: Site URL set to the Render URL (or the custom domain), plus redirect URLs for `http://localhost:5173` and the preview site.
  - Schema via migrations in `supabase/migrations/` (profiles, cloud saves, daily scores, challenge codes, head-to-head rooms), with row-level security on every table.
  - A keep-alive: free projects **pause after about a week without activity**.
- Keys: the publishable (anon) key may go in the browser. The `service_role` key must never appear in the repo, in a `VITE_` variable or in browser code; it belongs only in Supabase secrets for Edge Functions.

## 7. Known issues and limits

- **Data licensing.** Ratings come from community Kaggle datasets derived from EA Sports FC ratings (FC 24 CC0, FC 25 Apache 2.0, FC 26 CC0, FC 27 an unofficial non-commercial snapshot), the European Soccer Database (ODbL), openfootball results (public domain) and Wikidata (CC0). The ratings themselves originate with EA. Treat TouchLine as a non-commercial fan project; going commercial would need a different ratings source. Full credits in [DATA.md](DATA.md).
- **No real crests, kits, logos or photos.** Clubs are shown as colours plus a letter code. Keep it that way.
- **Free Supabase projects pause** after about a week idle; the online layer needs a keep-alive or a paid plan.
- No player data before 2008-09; Ligue 1, the Eredivisie and the Primeira Liga have no real tables (no record books there).
- About 230 players have an unknown nationality.
- Values and wages are our own model, not real figures.
- The product name is TouchLine, but many screens, the manifest and the share card still say "Touchline" until the redesign lands.
- Theme "Auto" always shows the dark theme.
- Some docs are partly stale (README's Node version, player-season count and roadmap line; DATA.md's England-only intro and totals; RESEARCH.md section 7).
- Saves are per browser; clearing site data loses them unless exported from the Record page (cloud saves will fix this).
- Quick Draft bench (`replica-plus`): with a bench, the match engine's injury rate means an injured starter is covered in roughly 2 to 17 of 38 games; tune the quick season's injury lengths if that feels too busy. Injury cover only uses bench players who can play the slot, so a thin bench often leaves an injured man playing on.

## 8. Roadmap at a glance

Tracked as GitHub issues #3 to #20, labelled by area (`area:engine`, `area:game`, `area:ui`, `area:data`, `area:online`, `area:ops`) and size (`size:S/M/L`); work already being built carries `status:in-progress` and names its branch: https://github.com/Minhhh13/Touchline/issues

1. Merge the finished branches (reel, FM depth, match visuals) and ship them.
2. Redesign: blue palette, logo, cleaner Setup.
3. Quick Draft as a faithful 38-0 replica (difficulty tiers, ratings toggle, squad-first / position-first, era presets, game-by-game playback).
4. Online layer: accounts, cloud saves for every mode, a verified daily leaderboard, challenge codes, online head-to-head rooms.
5. Casual modes.
6. Later: seasons before 2008-09, a Continental Cup group stage and two-legged ties.

## 9. Keeping this document current

This page is only useful while it is true. Every change, by either of us or by either of our AI agents, updates it in the same pull request: the in-progress table when work starts, moves or finishes; section 2 when a feature ships; section 6 when hosting or the backend changes; section 7 when an issue is found or fixed; and one line in the change log below. Agents find the same rule at the top of [CLAUDE.md](../CLAUDE.md) and in [AGENTS.md](../AGENTS.md). Add your line at the bottom of the log and never edit someone else's.

## 10. Change log

Newest at the bottom. Format: date (UTC) · who · what changed · link.

- 2026-10-25 · owner's agent · Handover written: CLAUDE.md, AGENTS.md, CONTRIBUTING.md, this page, a pull-request template, and roadmap issues #3 to #20 with area, size and status labels.
- 2026-10-25 · owner's agent · "While you were away" digest shipped on the working branch; the preview site (`claude/touchline-preview`) carries the case-opening reel, the game-by-game quick season and the Football Manager depth attributes merged together (`ENGINE_VERSION` `'4'` there).
- 2026-10-25 · owner's agent · `replica-setup`: merged `main` in (the Daily's `dailySettings` now lives in `src/game/logic/daily.ts` with `DAILY_RULES`, re-exported from `setup.ts`); the Setup screen follows 38-0's order (formation grid with pitch preview, Difficulty, Show ratings, Draft mode, Player ratings, Era chips and a two-handle slider, an Advanced fold) through the pure `setupRules`; the Draft screen reads "Spin for CB" under Position First and highlights who fits. Not pushed yet.
- 2026-10-25 · owner's agent · `replica-setup` review: the era slider steps through the seasons held (`seasonStop`), so a gap in older data is never a stop; the setup's formation preview is `inert`.
- 2026-10-25 · owner's agent · `replica-setup` season step: Quick Draft and the Daily stop at a Kick-off tactics screen, play the season back game by game (700 ms a game, 2x, 4x, pause, skip), pause after matchweek 19 for a January window (one signing or swap from three to five offers, or pass; on by default, pinned on for the Daily) and can end with a Continental Cup run after a top-four finish; passing replays the instant season exactly, `ENGINE_VERSION` stays `'3'`; challenge links carry the tactics and the deal (`x`). Not pushed yet.
- 2026-10-25 · owner's agent · `replica-setup` season review: the January window never offers a man already on the bench (a substitute could have met himself on the pitch), shortlists one season per player (Prime no longer fills an offer list with one man), and is drawn again instead of sticking when its deal no longer replays; a save paused in `january` without its window goes back to the Kick-off step; the playback counts games, not matchweeks (`quickSeasonGames`, a bye week in an odd-sized league). Not pushed yet.
- 2026-10-25 · owner's agent · `replica-plus`: merged `replica-setup` into the preview branch (reel, FM depth `ENGINE_VERSION` `'4'` with format 3 packs, live match visuals). Conflicts only in GAME_DESIGN section 15 (both notes kept, version `'4'`), `save.ts` (`normaliseRules` beside the depth back-fill) and the Dugout (the stamina column toggle beside the Inbox divider); `tsconfig.app.tsbuildinfo` stays untracked. One game-by-game module: `replica-setup`'s, which already extends `reel-ui`'s (the summary replay plus the paced playback and January pause). The packs are unchanged (format 3; `replica-setup` did not touch the pipeline), and no seeded test needed re-baselining: `replica-setup`'s tests check properties, not pinned outcomes. Not pushed.
- 2026-10-25 · owner's agent · `replica-plus`: a Quick Draft bench (Setup's Bench option, up to 5 places, optional: any pick can go to the bench, the draft can stop at eleven; `DraftRules.benchPicks`, bench spins on their own `benchRng` fork) and, in the game-by-game season, three voluntary changes between games plus automatic injury cover from the bench (`src/game/logic/quickBench.ts`, `Game.quickChanges`, `quickOpen`, `quickStartRng`); a change replays the season from kick-off so the games shown stay the same; the result is recorded when the playback closes; challenge links carry the changes (`x.s`). `ENGINE_VERSION` stays `'4'`: nothing without a bench draws differently. Not pushed.
- 2026-10-25 · owner's agent · `replica-plus` bench review: a bench season held open for its playback is now recorded when the manager starts or resumes another game or abandons it (before, it was dropped from the leaderboard, achievements and the season count); `quickXI` takes a bench player out of the bench when the fill puts him into a short XI (he could hold two places); a test ties the season's injury covers game for game to the playback panel. `ENGINE_VERSION` stays `'4'`. Not pushed.
- 2026-10-25 · owner's agent · `replica-plus`: Highlights for any game of the quick season: a ▶ Highlights button on every game-by-game row (playback and summary) and on the playback card opens a reel of that game's goals, big chances, saves and cards on the live pitch with the score and a commentary line (Pause, Next moment, Skip to full time, Close; a bottom sheet on a phone). The game is rebuilt from the season's start state (new optional `QuickResult.startRng`; `replayUserMatch` in `quick.ts`, `src/game/logic/highlights.ts`, `src/engine/highlights.ts`), proved in `highlights.test.ts` to give exactly the score shown; the extra chances and saves are drawn from a fork, so `ENGINE_VERSION` stays `'4'`. Saves from before it show no button. Not pushed.
- 2026-10-25 · owner's agent · `season-show` (cut from `replica-plus`): the season tiers read as plain outcomes (TOP-FOUR FINISH for 3rd or 4th, TOP-SIX FINISH for 5th or 6th instead of "European nights"; PERFECT SEASON) with a one-line explanation under the summary headline (`tierLabel`, `tierBlurb` in `src/engine/season.ts`); the saved tier ids are unchanged. The quick season's game-by-game list now puts the newest game at the top with a drop-in animation, rows tinted by result with a W/D/L badge, opponent with H/A, score, scorers with minutes, a "Matchweek n / 38" header and a running Won/Drawn/Lost/Points tally that counts up, with GF, GA and GD; the playback's big game card is gone. The summary list is newest first with a switch to matchweek order. Reduced motion respected. No draws change; `ENGINE_VERSION` stays `'4'`. Not pushed.
- 2026-10-25 · owner's agent · `season-show` review: fixed the row a new game pushed down fading in a second time (it lost `.newest` and its animation restarted; every newest-first row now shares one drop animation), the summary's Newest/Oldest switch stacking on a phone, the light theme's drawn count (gold on white) and W badge ink, the summary's "Play the season" now scrolling the banner and its tally into view, and the playback list counting "6 of 19" before January instead of "6 of 38". Added share-text tests for the plain tier names. Display only; `ENGINE_VERSION` stays `'4'`. Not pushed.
