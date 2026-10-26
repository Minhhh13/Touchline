# Contributing to TouchLine

Two people work on this repo in parallel, each with their own AI coding agent. This file is how we avoid stepping on each other. Agents: also read [CLAUDE.md](CLAUDE.md) for the code rules.

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

Rules of thumb: put new code in new files, keep diffs surgical, never reflow long lines, and do not mass-rename (for example "Touchline" to "TouchLine") outside a dedicated PR.

## 5. Checks before pushing

Run all of these locally; CI runs them on every push and PR, then `npm run check:dist-keys`, `npm run build:verifier` and `npm run check:verifier`:

```bash
npm ci                 # after pulling a lockfile change
npm run typecheck      # tsc strict: no any, no unused symbols
npm test               # Vitest, real data packs, about four minutes
npm run build          # what Render runs
```

For UI changes, also run the Playwright smoke against `npx vite preview --port 4173 --strictPort` at desktop (1280) and phone (390) widths with no page errors (see CLAUDE.md).

Also check:
- A Vitest test covers the new behaviour.
- `ENGINE_VERSION` is bumped if random draws changed, with a note in `docs/GAME_DESIGN.md` section 15.
- New save fields are optional; an old save still loads (extend the old-save test in `src/game/__tests__/audit.test.ts`).
- README and `docs/GAME_DESIGN.md` describe the change.
- `docs/HANDOVER.md` is updated in the same PR (in-progress table, what ships, hosting notes, and a dated change-log line), and `CLAUDE.md` too if a command, path or convention changed. This applies to every change an AI agent makes, so the other person's agent always starts from the truth.
- No secrets, `.env.local` or dataset archives are staged.

## 6. Pull requests and review

- Open a PR into `main` early (as a draft if unfinished). The title says what changes; the body says why, what you tested, and screenshots for UI.
- PRs into `main` come either from a feature branch or from `claude/touchline-preview`, where finished branches are merged together and tried on the preview site first. After a squash merge, merge `main` back into `claude/touchline-preview` (the "Record main (#NN squash) as merged" commits) so the two stay level.
- Link the issue (`Closes #N`). Mention any ENGINE_VERSION bump, save-field addition or data rebuild at the top of the body.
- Keep PRs small: under about 400 changed lines of hand-written code where possible.
- Every PR gets a review from the other person (or their agent, with the human approving). The reviewer checks:
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
4. Update the pinned `generatedAt` in `src/engine/__tests__/universe.test.ts`, run `npm test`, and commit the rebuilt packs in one commit ("Rebuild data packs after merging X").

For `tsconfig.node.tsbuildinfo`: take either side and run `npm run build`. `tsconfig.app.tsbuildinfo` is untracked (gitignored); if a branch still carries it, resolve with `git rm --cached tsconfig.app.tsbuildinfo`.

Only one data rebuild should be in flight at a time; say so in the issue.

## 8. Commit messages

- Subject: imperative, specific, under about 72 characters. "Add a stamina attribute to the match engine", not "updates".
- Body (optional): why the change was needed and anything a reviewer must know (ENGINE_VERSION bump, save fields, data rebuild).
- Reference the issue: `Refs #12` or `Closes #12`.
- One logical change per commit. Do not mix a reformat with a feature.
- Agents may add their own trailer lines (for example `Co-Authored-By:`); keep them at the end.
