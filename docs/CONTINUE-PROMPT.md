# Prompt to continue TouchLine in another agent (Codex, Claude or similar)

Paste everything below the line into the agent, with the repository `Minhhh13/Touchline` connected.

---

You are taking over **TouchLine**, a browser football game: 38-0's spin-the-wheel draft fused with Football Manager depth.

- **Repo:** https://github.com/Minhhh13/Touchline (public; all rights reserved, no licence yet).
- **Live site:** https://touchline.quest (Render deploys `main` once CI is green).
- **Stack:** Vite 6, React 19, TypeScript 5.8 strict, Zustand 5, Immer, Vitest 3. A deterministic seeded engine (`ENGINE_VERSION` `'7'`). An optional online layer on Supabase (project `yvqpmyqomkwtudxmkeou`).

The previous agent (Claude) worked through many parallel sessions, each on its own branch. Everything you need is in the repository; you will not see those sessions.

## 1. Read first, in this order

1. `docs/HANDOVER.md` **section 0, "Start here"**: what is live and how to check it, how to release a batch, the engine 8 release, and the owner's to-dos. It is the current state; when it and this prompt disagree, it wins.
2. `CLAUDE.md`: the architecture map, the commands and the numbered **invariants**. Never break them. The ones that bite most:
   - Determinism: no `Math.random`, `Date` or `performance.now` in the engine or the game's simulation; every draw goes through `Rng`.
   - Bump `ENGINE_VERSION` when draws change (and only in an engine release, below).
   - Never change the frozen Daily, Daily Arena, Weekly or Run-in of the week mappings; a new Daily rotation or weekly theme goes in a new dated epoch.
   - Save compatibility: new persisted fields are optional, read with `??`, defaulted in `normaliseGame`.
   - The edge verifier bundle: `src/engine`, `src/online/server` and every game-logic module the season replay reaches (`setup.ts`, `quick.ts`, `quickCups.ts`, `cabinet.ts`, `arena.ts`, `h2hRoom.ts`, `endCase.ts`, `slotSheet.ts`, `week.ts` and more) are bundled into the Edge Function's verifier. Any change there, even display-only, can rename `dist/edge/verifier-<hash>.js` and then needs a new loader deploy. After `npm run build`, compare `dist/build.json`'s `verifier.path` with the live one.
   - Database changes are new migration files only, never an edit to an applied one.
3. `docs/ONLINE.md` section 7, the release runbooks.
4. The rest of `docs/HANDOVER.md`: known issues (section 7) and the change log (section 10, newest at the bottom).

Then run `npm ci`, `npm run typecheck`, `npx vitest run` (about nine minutes on four cores) and `npm run build`.

## 2. Hard rules

- Only the TouchLine repo, the Render workspace `tea-dbeoghbrjlhs738bpcng` and the Supabase project `yvqpmyqomkwtudxmkeou`.
  - The owner has other, unrelated projects (Trade Desk and others). **Never touch them.**
  - The table `public.telegram_market_snapshots` in the Supabase project is not TouchLine's. Leave it.
- No secrets in the repo. The Supabase `service_role` key never goes in the browser or in a `VITE_` variable.
- Never push to `main` directly. Work on a feature branch, open one PR, and get CI green. Batch work into few PRs (CI runs on PRs and on pushes to `main` only).
- Never force-push `main` or rewrite shared history.
- After a squash lands on `main`, record it on your branch with `git merge -s ours origin/main` only when your branch holds a commit with exactly the squash's tree. Otherwise do a real merge.
- Engine bumps go live just before 00:00 UTC, ideally on a Monday: the site first, then the new loader `touchline-e{N}` (Verify JWT off). Keep the previous engine's function deployed for at least 7 days.
- No real crests, kits, logos or player photos; no UEFA or Champions League marks. Flags are drawn SVGs, sounds are synthesised, icons come from `lucide-react`.
- Every user-facing string goes through `t()` (`src/ui/i18n`). Use the design tokens and the motion tokens (`docs/DESIGN_SYSTEM.md`).
- The one-screen desktop rule: no page scroll at 1100 px wide and up on the shell screens.
- Every change updates `docs/HANDOVER.md` (and `CLAUDE.md` when a path, command or convention changes) in the same PR, with one dated change-log line at the bottom. Never delete someone else's change-log lines.

## 3. What to do now

State on 2026-10-30: `main` is live through round 14 (the last PR merges round 14's phones and QA round 11). Open on GitHub: PR #72 (the friend's iOS work) and nothing else. Running when Claude stopped: `claude/r15-playtest` (a new-player playtest, round 2); integrate it like any batch if it has pushed, and read its summary in `docs/PLAYTEST.md` "Round 2".

1. **Engine 8, Monday 2026-11-02 just before 00:00 UTC.** It is ready on `claude/r10-engine8` (level with `main` at #98 on 2026-10-29; merge `main` into it again first). Follow `docs/RELEASE-ENGINE8.md` on that branch (`git show origin/claude/r10-engine8:docs/RELEASE-ENGINE8.md`), a copy-paste checklist with the exact commands, what success looks like and how to roll back; the reasons are in that branch's `docs/ONLINE.md` section 7, "Release engine 8". In short: preflight on Sunday, merge into `main` at about 23:30 UTC, wait for Render, build the `touchline-e8` loader from the deployed commit, deploy it (Verify JWT off), smoke it, then check after midnight that the new day's Daily and the week's Weekly pin on engine 8. If you miss that Monday, wait for the next one.
2. **Retire the old functions** on time (`touchline-e4` from 2026-11-03, `-e5` from 2026-11-04, `-e6` from 2026-11-05, `-e7` from 2026-11-09 once engine 8 is live), each with its `public/edge/` file, `legacyEdge.test.ts` entry and `supabase/config.toml` block.
3. **Then** the next items in `docs/BACKLOG.md` and HANDOVER section 8, one batch and one PR at a time.

## 4. Owner preferences (decided)

- Push in batches, not many small PRs.
- Do not fake leaderboard players. If boards look empty, the approved idea is clearly labelled AI rivals (an "AI" badge), shown only when a board has few real players and never stored.
- Default team names are generated; "Touchline XI" is only the logic's fallback.
- Head-to-head opens on "Play with a friend". Sign-in emails send a six-digit code only, with no link.
- iOS is later and the owner's call: their `ios-native` branch or the friend's PR #72.

## 5. Waiting on the owner

- Deleting the 87 merged branches in `docs/branch-cleanup.txt` (a cloud session cannot delete other branches).
- Deleting the engine 7 release's smoke row ("SMOKE e7 release check") from `private.error_reports`.
- A licence; Google and Apple sign-in; leaked-password protection and the Supabase paid plan before a public launch.
- The iOS app; a data rebuild that strips the 54 ",NN" player names; the first translation languages.

## 6. How to report

After each batch, report:

- what changed, and the PR link;
- the exact checks and their numbers;
- what is left;
- anything that needs the owner: SQL to paste, a function to deploy, a decision.

Be honest about failures. Never claim something is done without verifying it.
