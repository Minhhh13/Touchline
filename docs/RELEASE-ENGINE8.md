# Releasing engine 8: the checklist

A copy-paste checklist for releasing engine 8 by hand, with no AI. It follows the full runbook, "Release engine 8" in [ONLINE.md](ONLINE.md) section 7. Read that runbook if you need the reasons behind a step.

- **What ships:** the branch `claude/r10-engine8`. It sets `ENGINE_VERSION` to `'8'` for four fixes that change seeded outcomes: the capped assistant's bench money, a simmed week's stream after its event, the Gauntlet's alternates, and the Dynasty board's bar after success. The pins are already re-baselined and there is no database migration.
- **What you deploy:** the site (by merging into `main`; Render deploys it) and one new Supabase Edge Function, `touchline-e8`. Nothing else changes.
- **Projects:** Supabase project `yvqpmyqomkwtudxmkeou` and Render workspace TouchLine (`tea-dbeoghbrjlhs738bpcng`) only. Never touch any other project.
- **Never** paste a secret into the repository, a commit or a chat. The publishable key (`sb_publishable_...`) is public, but the `service_role` key and your access token are not.

Throughout, `PK` stands for the publishable key. That is the value of `VITE_SUPABASE_ANON_KEY` on Render, also shown in the Supabase dashboard under Project Settings, API Keys. Set it once in your terminal:

```sh
export PK='sb_publishable_...'          # the publishable key, never the secret one
export FN=https://yvqpmyqomkwtudxmkeou.supabase.co/functions/v1
```

On macOS use `shasum -a 256` wherever this page says `sha256sum`.

Figures from the dry run on 2026-10-29 (the branch with `main` at #98 merged in): the e8 bundle is `edge/verifier-3253bc81bf95d2ed.js`, SHA-256 `3253bc81bf95d2ed412c9008e787c2be26d41d8106eb841da1442d755c41587e`. Any later merge into the branch or into `main` can change it. **Always trust the live `build.json` over this page.**

---

## 0. When

| When (UTC) | What |
|---|---|
| Sunday 2026-11-01, during the day | Step 1 (preflight) |
| Sunday 2026-11-01, **about 23:30** | Steps 2 and 3 (merge, wait for Render) |
| Sunday 2026-11-01, **before 23:59** | Steps 4 to 6 (loader, deploy, smoke) |
| Monday 2026-11-02, **after 00:00** | Step 7 (after-midnight checks) |
| 2026-11-03 to 2026-11-09 | Step 8 (retire old functions) |

**Why Monday just before midnight:** each day's Daily is pinned by the first ranked request of the UTC day, and each week's Weekly by the first request of its ISO week. Both pin on the engine the live site names. With engine 8 live before 00:00 UTC on Monday, the 2026-11-02 Daily and the W45 Weekly are engine 8 puzzles from their first minute.

**If you miss Monday 2026-11-02, do not release mid-week.** A mid-week release leaves that week's ranked Weekly stuck on `touchline-e7`, and engine 8 posts are refused (`engine_mismatch`) until the next Monday. Wait for Monday 2026-11-09 instead. That moves every retirement date in step 8 by a week for e7 only (e4, e5 and e6 can still retire on their dates).

Allow about 30 minutes: CI takes about 10 minutes, Render's build a few more, and the function caches `build.json` for up to 5 minutes.

---

## 1. Preflight (Sunday, any time before 23:00 UTC)

Run this from a checkout of the repository, using Node 22.13 or later (`node -v`).

```sh
git fetch origin
git checkout claude/r10-engine8
git pull origin claude/r10-engine8
git log --oneline origin/main -1
git merge-base --is-ancestor origin/main HEAD && echo "main is already in the branch" || echo "MAIN MOVED: merge it"
```

- **Success:** the last line says `main is already in the branch`.
- **If it says `MAIN MOVED`:** merge `main` into the branch. Use a merge, never a rebase or a force-push:
  ```sh
  git merge origin/main
  ```
  If the merge conflicts in code, stop and get help. Conflicts only in `docs/*.md` or `CLAUDE.md` are usually safe: keep both sides' text, and keep every change-log line. Then run the checks below and `git push origin claude/r10-engine8`.

Next, check that nothing that moves draws is waiting on another branch:

```sh
git log --oneline --all --grep='FIX (moves draws)' --grep='BUNDLED:' | head
```

- **Success:** every commit listed is already on this branch. To check one, run `git branch --contains <sha>` and look for `claude/r10-engine8`.
- **If one is missing:** do not cherry-pick it on release day without help. Release without it; it can ride the next engine bump.

Check that the live site still serves engine 7's bundle, `ecc26965...`:

```sh
curl -s https://touchline.quest/build.json; echo
curl -s https://touchline.quest/edge/verifier-ecc269657e48639b.js | sha256sum
```

- **Success:** `build.json` shows `"engine":"7"` and `"path":"edge/verifier-ecc269657e48639b.js"`, and the second line prints `ecc269657e48639b6cedd5b60fe6df4b0e877577f9a829611824af01356469de`.
- **If `build.json` names a different e7 file:** stop. An engine 7 bundle update shipped after this page was written, and `public/edge/` must hold the live e7 bytes instead. Follow step 1 of the runbook in ONLINE.md section 7: download the live file into `public/edge/`, delete the old one, update `src/online/__tests__/legacyEdge.test.ts`, and run the checks again.

Then run the checks. They take about 15 minutes in total; the test suite is most of it.

```sh
npm ci
npm run typecheck
npx vitest run
npm run build
BUDGET_DIST=1 npx vitest run src/ui/__tests__/budget.test.ts
npm run check:dist-keys
npm run build:verifier
npm run check:verifier
cat dist/build.json; echo
ls dist/edge
grep -n '^\[functions.touchline-e' supabase/config.toml
```

**Success:**

- typecheck prints nothing after its header;
- vitest ends with `Tests  N passed` and no `failed` line;
- build ends with `built in`;
- budget passes;
- `check:dist-keys` reports no secret;
- `check:verifier` says engine 8 and ends without `FAIL`;
- `dist/build.json` shows `"engine":"8"` and a `verifier.path` such as `edge/verifier-3253bc81bf95d2ed.js`;
- `ls dist/edge` lists five files: this build's bundle plus the four legacy ones (`verifier-ecc269657e48639b.js` for e7, `verifier-f088fc41409257f9.js` for e6, `verifier-603b905d0570f641.js` for e5 and `verifier-37d256f009b3b3e9.js` for e4);
- `config.toml` lists `touchline-e4` to `touchline-e8`.

**If a test fails:** run that one file again (`npx vitest run path/to/file.test.ts`). A test that passes on its own was a timeout under load, and you can carry on. A test that fails again means stop: do not release.

---

## 2. Open the pull request and merge (Sunday about 23:30 UTC)

On GitHub, open a pull request from `claude/r10-engine8` into `main`, titled "Engine 8". Here is a description you can paste:

```
Engine 8 release: ENGINE_VERSION '8' (capped bench assistant, simmed week's stream after the event, Gauntlet alternates, Dynasty board's raised bar). Pins re-baselined on the branch; e7/e6/e5/e4 bundles served from public/edge; supabase/config.toml lists touchline-e8. No migration. Checklist: docs/RELEASE-ENGINE8.md.
```

- Wait for CI. The checks `build` and `test (1/3)` to `test (3/3)` must all be green, which takes about 10 minutes.
- **Success:** all green. Merge with **Squash and merge**, as usual.
- **If a check is red:** open its log. A test that timed out can be re-run once with "Re-run failed jobs". If it fails a second time, do not merge, and do not release tonight: wait for next Monday (section 0).

Write down the merge commit:

```sh
git fetch origin main && git rev-parse origin/main
```

---

## 3. Wait for Render

Render deploys `main` once CI passes on the merge commit, which takes about 5 to 15 minutes. Check it every minute or two:

```sh
curl -s https://touchline.quest/build.json; echo
```

- **Success:** the output shows `"engine":"8"`, a new `builtAt`, and `"verifier":{"path":"edge/verifier-<hash16>.js","sha256":"<64 hex>"}`. Write down the path and the sha256.

Then check that the site serves those exact bytes, and still serves the old engines' bundles:

```sh
P=$(curl -s https://touchline.quest/build.json | node -pe 'JSON.parse(require("fs").readFileSync(0)).verifier.path')
curl -s https://touchline.quest/$P | sha256sum          # must equal build.json's verifier.sha256
for f in ecc269657e48639b f088fc41409257f9 603b905d0570f641 37d256f009b3b3e9; do
  echo "$f $(curl -s https://touchline.quest/edge/verifier-$f.js | sha256sum | cut -c1-16)"
done                                                    # each line: the two values equal
```

- **If `build.json` still says engine 7 after 20 minutes:** open the Render dashboard (static site `Touchline`, Events) and look at the deploy. If it failed, press "Manual Deploy" with "Deploy latest commit". If it is still failing at 23:55 UTC, roll back (section 9, case A).
- **If a hash differs:** you may be reading a cached copy. Run the command again with `?x=$RANDOM` added to the URL. If it still differs, stop and roll back (section 9, case A).

---

## 4. Build the loader from the deployed commit

Build the loader at exactly the commit Render deployed, which is the merge commit from step 2:

```sh
git fetch origin main
git checkout origin/main            # the deployed commit (detached HEAD is fine)
npm ci
node scripts/online/build-loader.mjs
```

- **Success:** it prints `touchline-e8 loader: supabase/functions/touchline-e8-loader/index.ts, about 4 KB; pins edge/verifier-<hash16>.js sha256 <64 hex>`, and that sha256 is **exactly** the one in the live `build.json` from step 3.
- **If the hashes differ:** you are not on the deployed commit. Check `git rev-parse HEAD` against the commit Render shows for the deploy, check it out, and run the script again. Never deploy a loader whose hash differs from the live `build.json`: it would answer 503 `verifier_unavailable` to every request.

The file is gitignored, so it never needs committing.

---

## 5. Deploy `touchline-e8` (before 00:00 UTC)

Deploy it as a **new** function named exactly `touchline-e8`. **Leave `touchline-e7`, `-e6`, `-e5` and `-e4` alone.**

### Option A (recommended): the Supabase dashboard, pasting the loader

This is the same form `touchline-e7` uses today.

1. Go to supabase.com, project `yvqpmyqomkwtudxmkeou`, Edge Functions, then **Deploy a new function**, then **Via Editor**.
2. Name it `touchline-e8`.
3. Replace the editor's contents with the whole of `supabase/functions/touchline-e8-loader/index.ts`. Open it in any text editor, or on macOS run `pbcopy < supabase/functions/touchline-e8-loader/index.ts`.
4. Deploy.
5. Open the function's settings page and switch **Verify JWT** (also called "Enforce JWT verification") **OFF**, then save. Guests have no JWT; the function checks the key itself.

### Option B: the dashboard, pasting the single-file function

Use this if the loader answers 503 in step 6. This form carries the verifier inside itself and does not depend on the site's bundle.

```sh
node scripts/online/build-single-function.mjs
```

This writes `supabase/functions/touchline-e8-single/index.ts` (gitignored, several hundred KB). Paste it as in Option A (redeploying `touchline-e8` if it already exists), with **Verify JWT OFF**.

### Option C: the CLI

You need a Supabase personal access token: supabase.com, Account, Access Tokens. Keep it in your terminal only.

```sh
SUPABASE_ACCESS_TOKEN='sbp_...' npm run deploy:function
```

This deploys `touchline-e8` to `yvqpmyqomkwtudxmkeou` with `--no-verify-jwt`. Afterwards, check in the dashboard that Verify JWT shows off.

- **Success (any option):** the dashboard lists `touchline-e8` as Active, next to `touchline-e7`.
- **If the deploy fails:** try the next option. If none works by 23:59 UTC, roll back (section 9, case A).

---

## 6. Smoke test `touchline-e8` (straight after the deploy)

```sh
curl -s -X POST $FN/touchline-e8 -H "apikey: $PK" -H "Authorization: Bearer $PK" -H 'content-type: application/json' -d '{"op":"status"}'; echo
```

- **Success:** the output shows `"status":"ok"`, `"engine":"8"`, and inside `"live":{...}` also `"engine":"8"`.
- **`503 verifier_unavailable`:** the loader's hash is not the live site's. Wait 5 minutes for the cache, then try again. If it persists, redo step 4 from the right commit, or use Option B.
- **`"live":{"engine":"7"...}`:** the function still holds the old `build.json` in its cache. Wait 5 minutes and try again.
- **401 on `status`:** Verify JWT is still on. Switch it off (step 5, Option A, point 5).

Then check that a guest is refused a ranked operation:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST $FN/touchline-e8 -H "apikey: $PK" -H "Authorization: Bearer $PK" -H 'content-type: application/json' -d '{"op":"daily.pin"}'
```

- **Success:** `401`.

Check that the old functions still answer:

```sh
for e in 7 6 5 4; do curl -s -X POST $FN/touchline-e$e -H "apikey: $PK" -H "Authorization: Bearer $PK" -H 'content-type: application/json' -d '{"op":"status"}' | cut -c1-60; echo; done
```

- **Success:** each line shows `"status":"ok"` with its own `"engine":"7"`, `"6"` and so on. If one says 503, the site is not serving that engine's file. Recheck the loop at the end of step 3.

**Optional, fuller:** if you have the two test accounts, `node scripts/online/smoke-function.mjs` runs the full check (variables at the top of the script; `SMOKE_URL=https://yvqpmyqomkwtudxmkeou.supabase.co`, `SMOKE_KEY=$PK`, `SMOKE_SITE=https://touchline.quest`). Before midnight its Daily step may report `engine_mismatch`, because Sunday's Daily was already pinned on e7. That is expected; run it again after 00:00 UTC.

---

## 7. After 00:00 UTC on Monday

1. Open https://touchline.quest in a fresh private window. Play the Daily to the end while signed in with a test account. The summary should show a ranked place ("1st of N" or similar).
2. Check the new day's pin with a test account's token. Or simply confirm that step 1's Daily ranked, which proves it.
3. In the Supabase dashboard, open Edge Functions, `touchline-e8`, Logs. You should see requests and no repeated `verifier_unavailable` errors.
4. Resume an existing Season save on the live site. It should play on with no error page.

**Write the change-log line.** Add one line at the bottom of `docs/HANDOVER.md` (in the next pull request), naming the deployed commit, the loader's hash and the time `touchline-e8` went live:

```
- 2026-11-02 · <you> · Engine 8 released: main <commit>, touchline-e8 deployed <HH:MM> UTC (loader pinning edge/verifier-<hash16>.js), status ok, Daily 2026-11-02 ranked on e8.
```

---

## 8. What stays deployed, and until when

| Function | Bundle in `public/edge/` | Keep until | Then |
|---|---|---|---|
| `touchline-e8` | (this build's own) | live | keep |
| `touchline-e7` | `verifier-ecc269657e48639b.js` | **2026-11-09** (7 days after release) | retire |
| `touchline-e6` | `verifier-f088fc41409257f9.js` | 2026-11-05 | retire |
| `touchline-e5` | `verifier-603b905d0570f641.js` | 2026-11-04 | retire |
| `touchline-e4` | `verifier-37d256f009b3b3e9.js` | 2026-11-03 | retire |

To retire a function `touchline-eN`, on or after its date:

1. In the Supabase dashboard, delete the function `touchline-eN`.
2. In one pull request, in this order:
   - remove the `[functions.touchline-eN]` block from `supabase/config.toml`;
   - delete its file from `public/edge/`;
   - delete its line in the `LEGACY` table of `src/online/__tests__/legacyEdge.test.ts`;
   - add a change-log line.

   Run `npm run typecheck && npx vitest run src/online && npm run build`, then merge. It is fine to retire several functions in one pull request.

- **Never** delete a file from `public/edge/` while its function is still deployed. That function fetches its bundle from the live site and would start answering 503.

---

## 9. Rolling back

### Case A: before 00:00 UTC (the site, the function or a smoke test failed)

1. On GitHub, open the merged engine 8 pull request and press **Revert**. That opens a revert pull request: merge it once CI is green. Render then redeploys engine 7, which serves `edge/verifier-ecc269657e48639b.js` again (checked in the dry run: `main` at #98 builds exactly those bytes), so `touchline-e7` keeps working throughout.
2. Check that `curl -s https://touchline.quest/build.json` shows `"engine":"7"` and the `ecc26965...` path again.
3. `touchline-e8`, if you deployed it, does no harm: it refuses to pin while the live site says engine 7. Delete it in the dashboard, or leave it for the next attempt.
4. Try again next Monday, after fixing the cause on `claude/r10-engine8`. You will need to run "Merge main" again, since the revert is now in `main`; ask for help with that merge, because it would undo the engine 8 changes unless the revert is reverted first.

### Case B: after 00:00 UTC (engine 8 is live and something is badly wrong)

- **Prefer a fix forward.** Monday's Daily and W45's Weekly are already pinned on engine 8, so they stay engine 8 puzzles whatever the site runs.
- **If you must roll back:** do Case A's steps 1 and 2. Expect players on engine 7 to be refused on Monday's ranked Daily and on W45's ranked Weekly (`engine_mismatch`), until Tuesday's Daily and the next Monday's Weekly pin on e7 again. Keep `touchline-e8` deployed until 2026-11-09, so engine 8 runs already in players' outboxes can still post.
- Do not edit the database to "unpin" a day. Pins are never edited.

### If only the function is wrong (the site is fine)

Redeploy `touchline-e8` from the deployed commit (steps 4 and 5). Option B (the single file) avoids the bundle-hash dependency altogether.
