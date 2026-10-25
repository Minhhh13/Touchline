# TouchLine handover

For the people working on TouchLine: what it is, what works today, what is being built, where everything lives and how it is hosted. AI agents should start from [CLAUDE.md](../CLAUDE.md); the way we work together is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. What TouchLine is

A free web football game that fuses the wheel draft of **38-0** with the depth of **Football Manager**. A wheel lands on a real club in a real season, you draft one player from that squad, repeat until your side is built, then either simulate the season instantly or manage it week by week. Your side takes one real club's place in a real league season and plays the other clubs' real squads.

- Seven leagues, named by country in the game (English, Spanish, Italian, German, French, Dutch and Portuguese League, each built from that country's top flight; the mapping is in [DATA.md](DATA.md)), seasons 2008-09 to 2026-27 (about 69,000 player-seasons).
- Runs entirely in the browser, installable and playable offline. Saves live in the browser (`localStorage`). No account needed.
- Deterministic: one seed always plays out the same way on every device, which is what makes the Daily, challenge links and (soon) online leaderboards fair.

## 2. What it does today

**Modes**
- **Quick Draft** (the 38-0 mode): draft an XI in 11 picks (two re-spins), simulate the whole league season in one click, share the result.
- **Daily Challenge**: the same wheel for everyone each day (UTC), with streaks.
- **Season**: draft 16 to 22 players, then manage every matchweek: friendlies, live matches, a cup, a January window, a board that can sack you.
- **Dynasty**: Season mode that never ends: ageing, contracts, retirements, youth intake, summer draft and summer window.
- **Head-to-head**: two managers on one device draft from the same spins and play the same season.

**Draft systems**: no dead spins, eight formations, era / one-club / one-nation filters, hard mode (hidden ratings), re-spins, wheel twists every third spin (Golden, Basement, Blind, Decade), All of Europe (draft from all seven leagues), ghost-draft challenge links (`#c=...`) verified by replay.

**Management systems**: 34 roles and six team instructions, an xG match engine with live stops at half time and the 70th minute (talks, subs, touchline shouts), condition / sharpness / morale / familiarity, injuries and suspensions, training focus, squad status and playing time, player conversations, captain and set-piece takers, backroom staff, man-marking, press conferences and dressing-room events, the assistant's briefing, a domestic cup and an optional European Nights midweek knockout (the old Continental Cup), a transfer market with bids, loans and part-exchange, finances, board objectives, in-season development, awards, 19 achievements, record books against real seasons, a share card, save export / import.

**Lineups**: tap a pitch slot in the Dugout for a picker (a bottom sheet on a phone) of everyone who can play there, rated there, with the occupant and To bench on top; in the Draft a player with several open slots shows one chip per slot.

**Help on the page**: seven one-time coach marks (draft reveal, bench picks, Squad and Tactics tabs, half time, match report, market), each gone after Got it and brought back by Show tips again on the Record page; a Key chip on the Squad panel labels the condition, morale and sharpness bars and adds a pitch legend.

**Names and flags**: no real competition, award, game or brand name anywhere a player can read it (a source-scan test enforces it); player and club names stay real. Every nationality and league shows a drawn SVG flag (flag-icons, MIT; [CREDITS.md](CREDITS.md)), European Nights and All of Europe the EU flag, never an emoji.

Full detail with formulas: [GAME_DESIGN.md](GAME_DESIGN.md). Data method: [DATA.md](DATA.md). Design research: [RESEARCH.md](RESEARCH.md).

## 3. In progress (not shipped yet)

Each item lives on its own branch until it is merged into the working branch and then `main`. On GitHub today there are only `main` (PR #1 merged), the working branch (draft PR #2 into `main`) and `claude/touchline-preview`; the feature branches below are pushed when ready, so ask before starting overlapping work.

| Work | Branch | State |
| --- | --- | --- |
| Case-opening reel instead of the wheel; game-by-game quick season | `reel-ui` | Built, waiting to merge; on the preview site |
| Football Manager depth attributes (stamina, strength, aggression, jumping, work rate) through data, engine and UI | `fm-depth` | In progress; rebuilds the data packs, ENGINE_VERSION `'4'`; on the preview site |
| Live match visuals: 2D pitch, momentum, shot map, xG race | `match-visuals` | In progress |
| Redesign: blue palette, a proper TouchLine logo, cleaner Setup | `redesign` | In progress |
| 38-0 style setup: difficulty tiers, ratings toggle, squad-first vs position-first, season vs prime ratings, era presets | `replica-setup` | In progress |
| "While you were away" digest | working branch `claude/youthful-mccarthy-a57idu` | Shipped on the working branch (live site) |
| Coach marks and the Key | working branch `claude/youthful-mccarthy-a57idu` | Shipped on the working branch |
| Slot picker | working branch `claude/youthful-mccarthy-a57idu` | Shipped on the working branch |
| Neutral league and competition names, drawn SVG flags, Continental Cup renamed European Nights | `neutral-names` | Built, waiting to merge |
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
- No player data before 2008-09; the French, Dutch and Portuguese leagues have no real tables (no record books there).
- Emoji flags showed as letter pairs ("BE", "AR") on Windows. Fixed on `neutral-names`: flags are SVG images from `public/flags`; the packs still carry the emoji, which the UI only uses to look up the SVG.
- `public/flags` adds about 1.1 MB to the deploy (0.37 MB gzipped), almost all in a few detailed coats of arms; each flag loads lazily and only when shown.
- News written by an older save keeps its old wording ("Continental Cup draw"); everything generated from now on says European Nights.
- About 230 players have an unknown nationality.
- Values and wages are our own model, not real figures.
- The product name is TouchLine, but many screens, the manifest and the share card still say "Touchline" until the redesign lands.
- Theme "Auto" always shows the dark theme.
- Some docs are partly stale (README's Node version, player-season count and roadmap line; DATA.md's England-only intro and totals; RESEARCH.md section 7).
- Saves are per browser; clearing site data loses them unless exported from the Record page (cloud saves will fix this).

## 8. Roadmap at a glance

Tracked as GitHub issues #3 to #20, labelled by area (`area:engine`, `area:game`, `area:ui`, `area:data`, `area:online`, `area:ops`) and size (`size:S/M/L`); work already being built carries `status:in-progress` and names its branch: https://github.com/Minhhh13/Touchline/issues

1. Merge the finished branches (reel, FM depth, match visuals) and ship them.
2. Redesign: blue palette, logo, cleaner Setup.
3. Quick Draft as a faithful 38-0 replica (difficulty tiers, ratings toggle, squad-first / position-first, era presets, game-by-game playback).
4. Online layer: accounts, cloud saves for every mode, a verified daily leaderboard, challenge codes, online head-to-head rooms.
5. Casual modes.
6. Later: seasons before 2008-09, a European Nights group stage and two-legged ties.

## 9. Keeping this document current

This page is only useful while it is true. Every change, by either of us or by either of our AI agents, updates it in the same pull request: the in-progress table when work starts, moves or finishes; section 2 when a feature ships; section 6 when hosting or the backend changes; section 7 when an issue is found or fixed; and one line in the change log below. Agents find the same rule at the top of [CLAUDE.md](../CLAUDE.md) and in [AGENTS.md](../AGENTS.md). Add your line at the bottom of the log and never edit someone else's.

## 10. Change log

Newest at the bottom. Format: date (UTC) · who · what changed · link.

- 2026-10-25 · owner's agent · Handover written: CLAUDE.md, AGENTS.md, CONTRIBUTING.md, this page, a pull-request template, and roadmap issues #3 to #20 with area, size and status labels.
- 2026-10-25 · owner's agent · "While you were away" digest shipped on the working branch; the preview site (`claude/touchline-preview`) carries the case-opening reel, the game-by-game quick season and the Football Manager depth attributes merged together (`ENGINE_VERSION` `'4'` there).
- 2026-10-25 · owner's agent · Coach marks and the Key shipped on the working branch: seven first-time tips saved on the profile (`seenTips`), Show tips again on the Record page, and a Key chip that labels the state bars and draws a pitch legend; an injured or suspended player's red ring now wins over the fit colour on the pitch.
- 2026-10-25 · owner's agent · Slot picker shipped on the working branch: tapping a Dugout pitch slot opens a sheet of everyone who can cover it (the same `canCover`/`isAvailable` line auto-pick and `lineupProblems` use; `ACCOMPLISHED_FACTOR` replaces the literal 0.86), replacing the two-tap swap; Draft slot chips, the phone scroll to the landed squad, and the squad list's Out chip renamed Unused.
- 2026-10-25 · owner's agent · Neutral names on `neutral-names`: the packs name the leagues by country (English League to Portuguese League; data diff: only the 14 league-name fields changed, players.json byte-identical, generatedAt 2026-10-25), flags are drawn SVGs from flag-icons 7.6.0 (`public/flags`, `scripts/brand/flags.mjs`, `src/ui/components/Flag.tsx`) instead of emoji, the Continental Cup is European Nights and the all-leagues wheel All of Europe (saved fields unchanged), the 5th-6th tier reads EUROPEAN PLACES, and no real competition or brand name is left in player-facing text (`trademarks.test.ts`).
