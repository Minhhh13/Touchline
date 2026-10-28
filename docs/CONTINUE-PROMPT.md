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

**A. Finish the engine 7 release** (PR #86 "Engine 7: Continental Cup groups...", merged or about to merge).

1. Check whether https://touchline.quest/build.json says `"engine":"7"`.
2. If it does, and the Edge Function `touchline-e7` is not yet deployed:
   1. Check out `main` at the deployed commit.
   2. Run `npm ci && node scripts/online/build-loader.mjs`.
   3. Check that the SHA-256 it prints equals `verifier.sha256` in `build.json`.
   4. The owner deploys `supabase/functions/touchline-e7-loader/index.ts` as the function **`touchline-e7`**, with **Verify JWT off**, in the Supabase dashboard (or via the CLI with a scoped token).
3. Smoke-test it by posting `{"op":"status"}` to `https://yvqpmyqomkwtudxmkeou.supabase.co/functions/v1/touchline-e7`, with an `apikey` header set to the publishable key. It should answer `engine: "7"`. Keep `touchline-e6` (to at least 2026-11-05), `touchline-e5` (to 2026-11-04) and `touchline-e4` (to 2026-11-03).

**B. Integrate the waiting branches** (all based on `release-e7`).

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
  - `claude/e7-daily`, if it exists: the Daily rotating through the seven leagues from a future start date as a dated epoch, and a slightly easier Super League. It changes the e7 bundle, so ship it with a new `touchline-e7` loader deploy, or fold it into engine 8.

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
