# Contributing to TouchLine

Two people work on this repo in parallel, the owner and a friend, each with their own AI coding agent (often several agent sessions at once). This file is how we avoid stepping on each other. Agents: also read [CLAUDE.md](CLAUDE.md) for the code rules.

## 0. A public repository

The repository has been public since 2026-10-27. That changes a few habits:

- **Everything is visible**: commits, branch names, issues, pull-request text, review comments and CI logs. Never paste a key, a token, a `.env.local`, a database dump, a player's email or a log line carrying any of them, in code or in prose. The publishable Supabase key is public by design; the `service_role` key, access tokens and the Render and Supabase dashboards stay private ([CLAUDE.md](CLAUDE.md), "Deployment and services").
- **No licence yet.** The owner has not chosen one, so the code is all rights reserved (README, "Licence"). Do not add a `LICENSE` file or a licence header without the owner's say. The datasets keep their own licences ([docs/DATA.md](docs/DATA.md), [docs/CREDITS.md](docs/CREDITS.md)); never add data or art whose licence forbids redistribution.
- **Outside contributions.** Issues from anyone are welcome and get triaged like our own. A pull request from someone else is reviewed by the owner before anything else happens; ask them to open an issue first for anything bigger than a fix. CI runs on a fork's pull request with no secrets, which is fine: the build needs none.
- **Real names.** No real crests, kits, logos, photos or competition marks ([docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) sections 3 and 7); the disclaimer in the README covers names used descriptively.

## 1. Pick work

- All work starts from a GitHub issue: https://github.com/Minhhh13/Touchline/issues
- Labels:
  - Type (these exist): `enhancement`, `bug`, `documentation`.
  - Area (these exist): `area:engine`, `area:game`, `area:ui`, `area:data`, `area:online`, `area:ops`; size `size:S`, `size:M`, `size:L`; `status:in-progress` on work being built; `accessibility`.
  - `roadmap` for planned features (not created yet), `good first issue` for small self-contained tasks, `help wanted` when the owner of an area wants a second pair of hands (both exist).
- Prefer issues in an area nobody else is working in this week (see section 4).
- No issue for what you want to do? Open one first with a short description and the files you expect to touch.

## 2. Claim it

- Assign the issue to yourself and leave a comment: "Taking this, branch `feat/...`, expect to touch X, Y, Z."
- One person per issue. If you stop, unassign yourself and say where you got to.
- Tell your agent the issue number so it can reference it in commits and the PR (`Closes #12`).

## 3. Branches

- Branch from an up-to-date `main`: `git switch main && git pull && git switch -c feat/<short-name>`.
- Naming: `feat/<thing>`, `fix/<thing>`, `docs/<thing>`, `data/<thing>`, `chore/<thing>`. Agent-created branches may use `claude/<thing>`.
- Keep branches short-lived: a few days at most, one feature each. Split big features into several PRs (engine first, then UI).
- Bring `main` in at least daily: `git fetch && git rebase origin/main` for a branch only you push to, or `git merge origin/main` once the branch is shared or under review.
- Never force-push `main`. Force-push your own feature branch only after a rebase, and never once someone else has pushed to it.

## 4. Avoid overlapping files

These files conflict constantly. Before touching one, check open PRs and say so in the issue:

| File | Why it conflicts | How to stay out of trouble |
| --- | --- | --- |
| `src/ui/styles.css` | One global stylesheet; tokens and components follow `docs/DESIGN_SYSTEM.md` | Use the tokens; add new rules in a new section at the end; do not reformat |
| `src/game/store.ts` | Every feature adds an action | Add actions at the end of their group; keep logic in `src/game/logic` |
| `src/game/types.ts` | Every feature adds a save field | Append optional fields with a doc comment; never reorder |
| `src/ui/screens/Dugout.tsx` | The season hub; 1,200+ lines of long JSX lines | Put new tabs and panels in their own file under `screens/` |
| `src/ui/screens/Setup.tsx` | The one-page setup for every mode; each new rule or mode adds a card | Coordinate first |
| `src/engine/match.ts` | Touched by match depth and visuals; ENGINE_VERSION | One match change in flight at a time |
| `src/game/logic/week.ts`, `quick.ts` | The season loop | Small, surgical hooks |
| `public/data/**`, `tsconfig.*.tsbuildinfo` | Generated | See section 7 |
| `docs/HANDOVER.md`, `CLAUDE.md` | Every change updates them, often from several agent sessions at once | Edit a few whole sections rather than many scattered lines; add change-log lines only at the very bottom; never delete or edit someone else's line |

Rules of thumb: put new code in new files, keep diffs surgical, never reflow long lines, and do not mass-rename (for example "Touchline" to "TouchLine") outside a dedicated PR.

## 5. Checks before pushing

CI (`.github/workflows/ci.yml`) runs only on pull requests and on pushes to `main`: a branch without a pull request is not built at all, a newer push to a pull request cancels the run still going, and the full test suite runs on the pull request only (three shards beside the build job), since it tests the merged tree; the push to `main` that merging makes runs the rest (typecheck, build, the first-download budget, `check:dist-keys`, `build:verifier`, `check:verifier`), which Render waits for. So:

- **Run the checks locally first** and treat CI as the confirmation, not the test runner.
- **Push in batches.** Commit as often as you like, but push a pull request's branch when a batch is ready, not after every commit: each push to an open pull request starts a full run. A release is one pull request (from the round's batch branch, or `claude/touchline-preview`) with one full run, plus one short run on `main` after the merge.
- **Run tests fast while you work, all of them before you push.** `npm run test:fast` skips the long seeded sweeps (`SLOW_FILES` in `vitest.config.ts`) and gives a verdict in about four minutes on 4 cores; `npx vitest run src/game/__tests__/thatFile.test.ts` runs one file; `npm test` (about eight minutes) is the gate and what CI runs, in three shards (`npx vitest run --shard=1/3` reproduces one). Every test has 60 s unless it names its own timeout; a seeded sweep that runs for more than about ten seconds yields with `await breathe()` (`src/engine/__tests__/helpers.ts`) every few seeds and goes in `SLOW_FILES`. `loadTestUniverse` is shared within a file: never change the universe it returns; take `freshTestUniverse` for that (`TL_FREEZE_UNIVERSE=1 npm test` finds a test that does).

Run all of these locally before you push:

```bash
npm ci                 # after pulling a lockfile change
npm run typecheck      # tsc strict: no any, no unused symbols
npm test               # Vitest, real data packs, about eight minutes (npm run test:fast while you work)
npm run build          # what Render runs
```

The other workflows: `db-tests.yml` runs the SQL suite (`npm run sql:test`'s files) on Postgres 17 only for commits touching `supabase/**` or `scripts/online/sql/**`; `supabase-deploy.yml` is manual only (migrations and the function, environment `production`); `keepalive.yml` pings the Supabase project daily and never fails. Do not add a workflow that can fail on `main`: Render deploys only a commit whose every check passed.

For UI changes, also run the Playwright smoke against `npx vite preview --port 4173 --strictPort` at desktop (1280) and phone (390) widths with no page errors (see CLAUDE.md).

Also check:
- A Vitest test covers the new behaviour.
- `ENGINE_VERSION` is bumped if random draws changed, with a note in `docs/GAME_DESIGN.md` section 15.
- New save fields are optional; an old save still loads (extend the old-save test in `src/game/__tests__/audit.test.ts`).
- `docs/FEATURES.md` (the full feature list) and `docs/GAME_DESIGN.md` describe the change; the README's short summary changes only for a new mode or a headline feature.
- `docs/HANDOVER.md` is updated in the same PR (in-progress table, what ships, hosting notes, and a dated change-log line), and `CLAUDE.md` too if a command, path or convention changed. This applies to every change an AI agent makes, so the other person's agent always starts from the truth.
- No secrets, `.env.local` or dataset archives are staged.

## 6. Pull requests and review

- Open a PR into `main` early (as a draft if unfinished). The title says what changes; the body says why, what you tested, and screenshots for UI.
- PRs into `main` come from a feature branch, a round's batch branch, or `claude/touchline-preview`, where finished branches are merged together and tried on the preview site first. After a squash merge, bring the squash back into `claude/touchline-preview` and every branch still in flight so the two stay level. Record it with `git merge -s ours origin/main` (the "Record the squash of #NN on the branch" commits) **only when the branch already holds a commit with exactly the squash's tree** (the commit the pull request was made from); otherwise do a real `git merge origin/main`, or `-s ours` silently drops whatever `main` has that the branch lacks.
- Work is batched: commit as often as you like, push in batches, and release in rounds. Many branches (often one per agent session, `claude/rNN-*`, each from `main`, pushed without a pull request of its own) are merged by the main session into one batch or release branch (for example `release-e6`, `batch5`), which goes to `main` in one pull request that only the session running the release opens and merges: one release, one pull request, one CI run. A session working on a branch of its own never pushes to `main`, `claude/touchline-preview` or a release branch.
- An `ENGINE_VERSION` bump or a data rebuild is released just before or just after 00:00 UTC (best on a Monday) so the day's Daily and the week's Weekly are pinned on one engine ([docs/ONLINE.md](docs/ONLINE.md) section 7).
- Link the issue (`Closes #N`). Mention any ENGINE_VERSION bump, save-field addition or data rebuild at the top of the body.
- Keep PRs small: under about 400 changed lines of hand-written code where possible.
- Every PR gets a review from the other person (or their agent, with the human approving). Review text is public: keep it about the code. The reviewer checks:
  - CI is green and the PR does what the issue asked.
  - Determinism: no `Math.random`/`Date` in engine or logic; RNG written back; ENGINE_VERSION bumped when needed.
  - Saves: optional fields, `??` reads, `normaliseGame` defaults.
  - Immer: no recipe returns a value.
  - Tests exist and assert behaviour, not one lucky seed.
  - UI: phone width, both themes, hidden ratings stay hidden.
- Pull the branch and play the feature on `npm run dev` for anything visible.
- Merge with "Squash and merge" or "Create a merge commit" once approved and green. Delete the branch afterwards.
- Render deploys `main` to the live site (https://touchline.quest) a few minutes after CI passes on the merge, so a merge is a release: play the feature on the preview first. The testing site (https://touchline-newfeature-preview.onrender.com) deploys `claude/touchline-preview` on every push (see docs/HANDOVER.md). Check the live site after each merge.

## 7. Data-pack conflicts

`public/data/**` is generated by `scripts/import/build.mjs`. **Never hand-merge the JSON.**

1. Resolve conflicts in `scripts/import/*` (the source of truth) and in code.
2. Take either side of the JSON (`git checkout --theirs public/data`) just to finish the merge.
3. Rebuild on the merged pipeline: `node scripts/import/build.mjs` (set `DATA_CACHE=/path/to/datasets` to reuse a download cache; otherwise it uses `.cache/datasets`).
4. Update the pinned `generatedAt` in `src/engine/__tests__/universe.test.ts`, record the stamp with `UPDATE_PACK_HASHES=1 npx vitest run src/online/__tests__/stamps.test.ts`, run `npm test`, and commit the rebuilt packs with `packHashes.json` in one commit ("Rebuild data packs after merging X").

For `tsconfig.node.tsbuildinfo`: take either side and run `npm run build`. `tsconfig.app.tsbuildinfo` is untracked (gitignored); if a branch still carries it, resolve with `git rm --cached tsconfig.app.tsbuildinfo`.

Only one data rebuild should be in flight at a time; say so in the issue.

## 8. Commit messages

- Subject: imperative, specific, under about 72 characters. "Add a stamina attribute to the match engine", not "updates".
- Body (optional): why the change was needed and anything a reviewer must know (ENGINE_VERSION bump, save fields, data rebuild).
- Reference the issue: `Refs #12` or `Closes #12`.
- One logical change per commit. Do not mix a reformat with a feature.
- Agents may add their own trailer lines (for example `Co-Authored-By:`); keep them at the end.
