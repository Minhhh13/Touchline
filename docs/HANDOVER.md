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

**Lineups**: tap a pitch slot in the Dugout for a picker (a bottom sheet on a phone) of everyone who can play there, rated there, with the occupant and To bench on top; in the Draft a player with several open slots shows one chip per slot.

**Help on the page**: seven one-time coach marks (draft reveal, bench picks, Squad and Tactics tabs, half time, match report, market), each gone after Got it and brought back by Show tips again on the Record page; a Key chip on the Squad panel labels the condition, morale and sharpness bars and adds a pitch legend.

Full detail with formulas: [GAME_DESIGN.md](GAME_DESIGN.md). Data method: [DATA.md](DATA.md). Design research: [RESEARCH.md](RESEARCH.md).

## 3. In progress (not shipped yet)

Each item lives on its own branch until it is merged into the working branch and then `main`. On GitHub today: `main` (the live site; PRs #1, #2, #21 and #22 merged), the working branch `claude/youthful-mccarthy-a57idu`, `claude/touchline-preview` (the preview site) and `redesign`; the other feature branches below are pushed when ready, so ask before starting overlapping work.

| Work | Branch | State |
| --- | --- | --- |
| Case-opening reel instead of the wheel; game-by-game quick season | `reel-ui` | Merged into `integration` (local), with the working branch |
| Football Manager depth attributes (stamina, strength, aggression, jumping, work rate) through data, engine and UI | `fm-depth` | Merged into `integration` (local); data packs format 3, ENGINE_VERSION `'4'` |
| Live match visuals: 2D pitch, momentum, shot map, xG race | `match-visuals` | Merged into `integration` (local) |
| Redesign: blue palette, a proper TouchLine logo, the design system (`docs/DESIGN_SYSTEM.md`) | `redesign` | Foundation merged into `integration` (local), with the later screens moved to its tokens; the screen-by-screen pass and the cleaner Setup are still to do |
| 38-0 style setup: difficulty tiers, ratings toggle, squad-first vs position-first, season vs prime ratings, era presets | `replica-setup` | In progress |
| "While you were away" digest | working branch `claude/youthful-mccarthy-a57idu` | Shipped on `main` (PR #2); merged into `integration` |
| Coach marks and the Key | working branch `claude/youthful-mccarthy-a57idu` | Shipped on `main` (PR #21); merged into `integration` |
| Slot picker | working branch `claude/youthful-mccarthy-a57idu` | Shipped on `main` (PR #22); merged into `integration` |
| Football Manager style match-day dashboard | `matchday` | In progress; rebuilds the live match view |
| Save compaction: compacted results, lz-string compression, a toast when the browser's storage is full | `save-compaction` (from `integration`) | Built, waiting to merge into `integration` |
| The new logo: corner flag standing on a thin touchline, classic ball resting on it; the open lockup (short line, no underline) with the shine, the fluttering pennant, the line drawing itself and the ball rolling in; new favicon, app icons and share-card lockup | `logo-v2` (from the redesign foundation commit) | Built, not pushed; merges into `redesign` |
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

Both sites are static sites in their own Render workspace **TouchLine** (workspace id `tea-dbeoghbrjlhs738bpcng`). Nothing else lives there. The owner's other projects are in a different Render workspace; never touch them.

| Service | URL | Tracks | Deploys | Use |
| --- | --- | --- | --- | --- |
| `Touchline` (`srv-dbeoi38m7kps73ei85dg`) | https://touchline-16xv.onrender.com | `main` | after CI passes on the commit | The live game |
| `touchline-preview` (`srv-dbeoj9tg1s2s7388iei0`) | https://touchline-preview-hfvi.onrender.com | `claude/touchline-preview` | on every push | Previews of in-progress branches merged together (the `integration` branch) |

- Build command `npm ci && npm run build`, publish directory `dist`, no `BASE_PATH`, `NODE_VERSION=22`.
- Render's GitHub app is installed on the repo, so both sites deploy on their own. A merge into `main` goes live a few minutes after CI turns green; a red CI run never deploys.
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. These are the public publishable keys; Vite bakes them into the build, so changing them needs a redeploy.
- Optional: add a custom domain (also needed before Supabase can send sign-up emails through Resend, see below). The `-16xv` and `-hfvi` suffixes are Render's and stay unless a custom domain is added.
- The old GitHub Pages workflow is removed. It failed on every push to `main` (Pages is unavailable on a private repo), and because Render waits for every check to pass, it blocked the live deploy.

### Supabase (backend for the online layer)

- Organisation **Team TouchLine**, project **TouchLine**, id `yvqpmyqomkwtudxmkeou`, region Sydney (ap-southeast-2), Free plan.
- Status: provisioned and healthy, **no schema yet**. Nothing in the code uses it yet.
- Still to configure:
  - Auth providers: email magic link, Google (optional; needs a Google OAuth client id and secret).
  - Sign-up email through Resend (the owner has an account): Supabase's built-in mailer only reaches the project's team and is rate-limited, so real users need custom SMTP. Needs a domain verified in Resend first, then Auth > SMTP: host `smtp.resend.com`, port 465, user `resend`, password a Resend API key typed straight into the dashboard (never into the repo or a chat), sender `no-reply@<domain>`, name TouchLine; then turn on Confirm email.
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
- The default team name is still "Touchline XI" (set in the game logic and pinned by tests).
- In the Daylight theme a side in white kit draws near-white momentum bars and xG line on the light chart panel; the match-day dashboard work is rebuilding that view.
- Theme "Auto" always shows the dark theme.
- Some docs are partly stale (README's Node version, player-season count and roadmap line; DATA.md's England-only intro and totals; RESEARCH.md section 7).
- Saves are per browser; clearing site data loses them unless exported from the Record page (cloud saves will fix this).
- A season's full match detail passed the browser's 5 MB `localStorage` quota (4.4 MB for one Season at full time, and a parked game on top failed every write silently). Fixed on `save-compaction`: the save is compacted and compressed (about 50 K characters for a Season, under 100 K for a two-season Dynasty with a parked Season), and a refused write shows a toast instead of failing silently.
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
6. Later: seasons before 2008-09, a Continental Cup group stage and two-legged ties.

## 9. Keeping this document current

This page is only useful while it is true. Every change, by either of us or by either of our AI agents, updates it in the same pull request: the in-progress table when work starts, moves or finishes; section 2 when a feature ships; section 6 when hosting or the backend changes; section 7 when an issue is found or fixed; and one line in the change log below. Agents find the same rule at the top of [CLAUDE.md](../CLAUDE.md) and in [AGENTS.md](../AGENTS.md). Add your line at the bottom of the log and never edit someone else's.

## 10. Change log

Newest at the bottom. Format: date (UTC) · who · what changed · link.

- 2026-10-25 · owner's agent · Handover written: CLAUDE.md, AGENTS.md, CONTRIBUTING.md, this page, a pull-request template, and roadmap issues #3 to #20 with area, size and status labels.
- 2026-10-25 · owner's agent · "While you were away" digest shipped on the working branch; the preview site (`claude/touchline-preview`) carries the case-opening reel, the game-by-game quick season and the Football Manager depth attributes merged together (`ENGINE_VERSION` `'4'` there).
- 2026-10-25 · owner's agent · Coach marks and the Key shipped on the working branch: seven first-time tips saved on the profile (`seenTips`), Show tips again on the Record page, and a Key chip that labels the state bars and draws a pitch legend; an injured or suspended player's red ring now wins over the fit colour on the pitch.
- 2026-10-25 · owner's agent · Slot picker shipped on the working branch: tapping a Dugout pitch slot opens a sheet of everyone who can cover it (the same `canCover`/`isAvailable` line auto-pick and `lineupProblems` use; `ACCOMPLISHED_FACTOR` replaces the literal 0.86), replacing the two-tap swap; Draft slot chips, the phone scroll to the landed squad, and the squad list's Out chip renamed Unused.
- 2026-10-25 · owner's agent · Working branch merged into `integration` (with `reel-ui`, `fm-depth`, `match-visuals`): the Draft keeps the case-opening reel and gains the slot chips; the Dugout squad panel carries both the Key chip and the Stamina column toggle, the slot sheet replaces the two-tap swap and the player card uses the attribute panel; coach marks sit on the live match and report. No seeded test moved. `tsconfig.app.tsbuildinfo` untracked.
- 2026-10-25 · owner's agent · `redesign` merged into `integration`: blue tokens in both themes, the TouchLine logo and icons, mixed-case headings and the `Info` tooltip, now also covering the screens that arrived after it (the reel window and placeholder badge, game by game, the attribute panel, the pitch frame and the scoreboard flash, the match card, the digest's confidence bar, coach marks, the Inbox badge and the slot sheet, which now uses the shared phone bottom sheet). Starter, Key and depth-chart chips are `.chip.info`; the tier banner uses `tierName()`. No behaviour change; no seeded test moved.
- 2026-10-25 · owner's agent · Hosting notes corrected: both Render sites now live in their own TouchLine workspace; the live site deploys `main` after CI passes (https://touchline-16xv.onrender.com), the preview deploys `claude/touchline-preview` (https://touchline-preview-hfvi.onrender.com); the old `-o5ot` and `touchline-preview.onrender.com` sites are gone.
- 2026-10-25 · owner's agent · Removed `.github/workflows/pages.yml`: its failing run on every push to `main` stopped Render's checks-pass deploy, so merges were not reaching the live site on their own.
- 2026-10-25 · owner's agent · The working branch's latest commits merged into `integration` again (after `redesign`): the slot-picker review (a real Unused case in the tests, timeouts for two slow sweeps), the corrected hosting notes and the Pages workflow removal (already gone on `integration`). Docs only plus tests; no seeded test moved.
- 2026-10-25 · owner's agent · `save-compaction` (from `integration`): saves are compacted (a played fixture or tie older than the user's last two league matches and last tie keeps its score, xG and penalties only, since nothing reads more) and compressed with lz-string `compressToUTF16` through a custom persist storage that still reads the plain JSON every earlier build wrote; writes are coalesced (250 ms, flushed on page hide); a full storage shows a toast and the game carries on; Record export is plain JSON from memory and import takes plain or compressed files. A Season at full time drops from 4.4 MB to about 49 K characters stored; a two-season Dynasty with a parked Season from about 8 MB to about 83 K. Window logs capped at 80 lines. No result moved (tested by playing on from a compacted save). New dependency `lz-string` 1.5.0.
- 2026-10-25 · owner's agent (review) · `save-compaction` reviewed: every reader of the fields compaction drops checked (only scores, penalties and `winnerId` are read back; the match screen uses `lastMatch`/`lastCupMatch`); real saves from `3e9a594` (a Season at matchweek 10 parked with a Dynasty in its second season, 2.1 M characters) load, render identically and play on, and an old export imports; stored sizes 81 K and 84 K at the two Dynasty season ends with a Season parked. Docs and comments now describe the write delay as it works (one write 250 ms after a change, carrying the latest state), not as a quiet-period debounce.
- 2026-10-25 · owner's agent · Hosting notes corrected: both Render sites now live in their own TouchLine workspace; the live site deploys `main` after CI passes (https://touchline-16xv.onrender.com), the preview deploys `claude/touchline-preview` (https://touchline-preview-hfvi.onrender.com); the old `-o5ot` and `touchline-preview.onrender.com` sites are gone.
- 2026-10-25 · owner's agent · Removed `.github/workflows/pages.yml`: its failing run on every push to `main` stopped Render's checks-pass deploy, so merges were not reaching the live site on their own.
- 2026-10-25 · owner's agent · New logo on `logo-v2` (local, not pushed): the owner's sketch as the mark (a corner flag with a red pennant, a black-and-white ball on the white touchline, the blue tile kept) in three size tiers, an open `Lockup` with the touchline under the name that shines, draws its line and rolls the ball out from the flag once per load on the Home hero and on hover in the top bar (CSS only, off under reduced motion); favicon, app icons and the share card redrawn; geometry in `src/ui/brand.ts`, rules in docs/DESIGN_SYSTEM.md section 2.
- 2026-10-25 · owner's agent · Logo review on `logo-v2`: the 16 px tier's ball (the favicon) draws real pentagon panels (the front one and the lower rim, so the top stays white at 16 px), since one centred patch read as an eye at 32 device px; the lockup's glint copy of the name is generated content, so the Home h1 and the top bar read "TouchLine" once instead of twice. `logo-v2` is based on the redesign foundation commit and is one commit behind `redesign` (2077340, no logo files; merges cleanly).
- 2026-10-25 · owner's agent · Logo v3 on `logo-v2`, from the owner's review: the touchline is much thinner (full tier 3.6 to 1.6, mid 4.8 to 2.4, the 16 px tier one device pixel, the lockup 4u to 2u); the pole stands on the line instead of crossing it; the lockup's line is short (under the flag and the ball, 4u past the ball) and no longer runs under the name, which now stands on the same baseline; the ball fades in and rolls 5u along it; the lockup's pennant flutters in a light wind (SMIL path keyframes, off under reduced motion; the mark, icons and share card stay still); favicon and app icons regenerated (`scripts/brand/icons.mjs` now also loads a CommonJS Playwright entry through `PLAYWRIGHT_MODULE`).
