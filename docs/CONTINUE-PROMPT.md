# Prompt to continue TouchLine in ChatGPT / Codex

Paste everything below the line into Codex, with the repository `Minhhh13/Touchline` connected.

---

You are taking over **TouchLine**, a browser football game: a 38-0 spin-the-wheel draft fused with Football Manager depth.

- **Repo:** https://github.com/Minhhh13/Touchline (public).
- **Live site:** https://touchline.quest.
- **Stack:** Vite 6, React 19, TypeScript 5.8 strict, Zustand 5, Immer, Vitest 3. A deterministic seeded engine. An optional online layer on Supabase (project `yvqpmyqomkwtudxmkeou`); Render hosts the site.

The previous agent (Claude) worked through about 15 parallel cloud sessions and local agents. Their work lives on GitHub branches, described below. You will not see those sessions; everything you need is in the repo.

## 1. Read first (in this order)

1. `docs/HANDOVER.md` **section 0, "Where things stand"**. This is the current state and the list of unmerged branches.
2. `CLAUDE.md`. It holds the architecture map, the commands and the numbered **invariants**. Never break them. The important ones:
   - Determinism: no `Math.random` or `Date` in the engine or game simulation; every draw goes through `Rng`.
   - Bump `ENGINE_VERSION` when draws change.
   - Never change the frozen Daily or Weekly mappings.
   - Save compatibility: new fields are optional, read with `??`, and get defaults in `normaliseGame`.
   - The verifier-bundled files: `src/engine/*`, `src/online/server/*`, and `src/game/logic/{managers,endCase,slotSheet,quickCups,arena,h2hRoom,setup,challenge,daily,weekly,quick,youth}.ts`. Changing them changes the edge bundle hash and needs a new loader deploy.
   - Database changes go in new migration files only.
3. `docs/ONLINE.md` section 7, the release runbooks, including "Release engine 7".
4. The rest of `docs/HANDOVER.md`: known issues (section 7) and the change log.

Then run `npm ci`, `npm run typecheck`, `npm test` and `npm run build`.

## 2. Hard rules

- Only the TouchLine repo, the Render workspace `tea-dbeoghbrjlhs738bpcng` and the Supabase project `yvqpmyqomkwtudxmkeou`.
  - The owner has other, unrelated projects (Trade Desk and others). **Never touch them.**
  - The table `public.telegram_market_snapshots` in the Supabase project is not TouchLine's. Leave it.
- No secrets in the repo. Never put the Supabase `service_role` key in the browser or in `VITE_` vars.
- Never push to `main` directly. Use a feature branch and one PR; CI must be green.
- Batch work into few PRs. CI runs on PRs and on pushes to `main` only.
- Never force-push or rewrite shared history.
- When the squash of a PR lands on `main`, record it on your branch with `git merge -s ours` only if your branch already holds a commit with the same tree as that squash. Otherwise do a real merge.
- No real crests, kits, logos or player photos. No UEFA or Champions League marks. Flags are drawn SVGs. Sounds are synthesised. Icons come from lucide-react.
- **Engine bumps go live just before 00:00 UTC:** the site first, then the new loader `touchline-e{N}` (Verify JWT off). That way the next day's Daily pins on the new engine. Keep the previous engine's function deployed for 7 days or more.
- Every user-facing string goes through `t()` (`src/ui/i18n`). Use the design tokens and the motion tokens.
- The one-screen desktop rule: no page scroll at 1100 px wide and up.

## 3. What to do now

**A. Engine 7 is live** (PR #86, squash f51eca0, live on touchline.quest from 2026-10-28 17:29 UTC). The Edge Function `touchline-e7` was deployed at 17:30 UTC as the loader pinning `verifier-5e7764386729eb13.js` (Verify JWT off) and answers `status` with `engine: "7"`; `touchline-e6`, `-e5` and `-e4` still answer. Keep `touchline-e6` (to at least 2026-11-05), `touchline-e5` (to 2026-11-04) and `touchline-e4` (to 2026-11-03).

**A2. The Daily rotation is live too** (PR #87, squash 1df6a32): `touchline-e7` was redeployed at 17:56 UTC pinning `verifier-533df0bd10128be8.js`. Nothing left to do for it.

**B0. Round 8 is integrated in PR #88** (`claude/youthful-mccarthy-a57idu`, batch5): every `claude/r8-*` branch except `r8-a11y` (still running when this was written; merge it next), with `45f5754` reverted and held for engine 8. It renames the edge bundle to `verifier-ecc269657e48639b.js`: after #88 is live, rebuild the loader from `main` at the deployed commit and redeploy `touchline-e7` (Verify JWT off), as in A2. The first-download budget was raised to 330 KB JS and 56 KB CSS (`budget.test.ts`, docs/PERFORMANCE.md); splitting `week.ts` and this round's styles out of the first download would win it back.

**B. Integrate the waiting branches** (done for all but `r8-a11y`; kept for reference) (all based on `release-e7`).

Make one batch branch from the latest `main` and real-merge the branches in this order. Look for commits titled `SEVERE:` first and ship those soonest.

- **Bug fixes first:**
  - `claude/r8-qa`: QA on engine 7.
  - `claude/r8-audit-logic-a`, `claude/r8-audit-logic-b`, `claude/r8-audit-screens`, `claude/r8-audit-ui`, `claude/r8-audit-online`: file-by-file code audits.
- **Interface and polish:**
  - `claude/r8-ui-front`: Home, Setup, the draft, and the Home de-cluttering.
  - `claude/r8-ui-season`, `claude/r8-ui-phone`, `claude/r8-ui-modes`.
  - `claude/r8-anim`: season and match motion, ball and kick sounds, the redesigned stadium sounds.
  - `claude/r8-copy`: translations and wording.
  - `claude/r8-a11y`, `claude/r8-onboarding`, `claude/r8-share`, `claude/r8-trophies`, `claude/r8-explore`, `claude/r8-tests`.
- **Bigger features:**
  - `claude/r8-season-play`: Season and Dynasty usability.
  - `claude/r8-fm-depth`: Football Manager depth. That means club transfer negotiations with counters, transfer requests from unhappy players, promises, player talks and squad status. Every roll runs on a forked copy, so untouched games are unchanged.
  - **`claude/e7-daily` (released in #87; skip it):** the Daily rotating through the seven leagues from 2026-10-30 as a dated epoch (every earlier Daily unchanged), plus a slightly easier Super League behind the new optional `superEase` rule (old Super League games replay unchanged). It changes the e7 bundle (`verifier-533df0bd10128be8.js`), so after merging, redeploy the `touchline-e7` loader with the new hash. It must be live **before 2026-10-31 00:00 UTC** (the first La Liga day; 2026-10-30 is a Premier League day and identical on both builds). If that slips, move `DAILY_EPOCHS`' start to a later day. Runbook in its ONLINE.md.

Resolve conflicts by keeping both sides' intent. For `docs/HANDOVER.md`, keep both change-log lines; never delete others' lines.

After each merge, run typecheck and the affected tests. At the end, run:

- the full suite: `npx vitest run --testTimeout=180000`; rerun any file that times out on its own;
- `rm -rf dist && npm run build`, then check `dist/edge`;
- `BUDGET_DIST=1 npx vitest run src/ui/__tests__/budget.test.ts`;
- `npm run check:dist-keys`;
- `npm run build:verifier && npm run check:verifier`;
- `npm run sql:test` if anything under `supabase/` changed;
- a Playwright smoke at 1280x720 and 390x844.

Then open one PR.

**C. Engine 8.** Commits marked `FIX (moves draws):` or `BUNDLED:` in the audit branches change outcomes or the edge bundle. Collect them into an engine 8 release:

- bump `ENGINE_VERSION` to `'8'`;
- re-baseline the pins, explaining each change;
- add a GAME_DESIGN section 15 line;
- ship the e7 bundle as a static file in `public/edge/` and pin it in `legacyEdge.test.ts`;
- add `[functions.touchline-e8]`;
- follow a "Release engine 8" runbook in ONLINE.md;
- release just before 00:00 UTC.

## 4. Owner preferences (decided)

- Push in batches, not many small PRs. The repo is public, so Actions are free.
- Do not fake leaderboard players. If boards look empty, the approved idea is clearly labelled AI rivals ("AI" badge), shown only when a board has few real players and never stored.
- Default team names are generated; "Touchline XI" is only the logic fallback.
- Head-to-head opens on "Play with a friend". Sign-in emails send a 6-digit code only, with no link.
- iOS is later and the owner's call: their `ios-native` branch versus the friend's PR #72.

## 5. Waiting on the owner

- The iOS app.
- A data rebuild for the 54 ",NN" player names.
- A licence.
- Google and Apple sign-in.
- Leaked-password protection and the Supabase paid plan before a public launch.

## 6. How to report

After each batch, report:

- what changed, and the PR link;
- the exact checks and their numbers;
- what is left;
- anything that needs the owner: SQL to paste, a function to deploy, a decision.

Be honest about failures. Never claim something is done without verifying it.
