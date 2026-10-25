# TouchLine online layer

The optional online layer: accounts, cloud saves, the verified Daily board, the world leaderboard (the weekly fixed-seed challenge, all-time Daily totals and best streaks, a country filter on every board), challenge short codes and, in Phase 2, online head-to-head. The full build plan, with every decision and the reasons for it, was written for the implementation agents on 2026-10-25 (the "online build plan"); this page is the short version that lives in the repository, plus the runbooks.

## 1. Shape in one paragraph

The game stays offline-first and unchanged. `src/online` loads only when the build carries both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (`onlineConfig()` is null otherwise, and `main.tsx` never imports `./online/boot`). Clients write only their own private rows (cloud saves, the synced profile, their display name and country, challenge codes). Everything shared or competitive (Daily and weekly entries, all-time totals, head-to-head rooms) is written only by one Edge Function per engine version, `touchline-e{ENGINE_VERSION}`, which replays the posted picks with the game's own engine on the data version they were played on. A posted score is never stored as a score: the server's replay is the official result.

## 2. Where things are

| Path | What |
| --- | --- |
| `src/online/config.ts` | `onlineConfig()`: `{ url, key, functionName: 'touchline-e' + ENGINE_VERSION, region: 'ap-southeast-2' }` or null |
| `src/online/state.ts` | `onlineStore` / `useOnline`: vanilla Zustand store for the layer's UI state; imports no Supabase code |
| `src/online/boot.ts` | the layer's dynamic entry (today it only marks the layer configured) |
| `src/online/buildInfo.ts` | the pure part of the `buildInfo()` Vite plugin that writes `dist/build.json` (`{ engine, data, builtAt }`) |
| `src/online/core/` | pure helpers shared by the client and the verifier: `canonical.ts`, `bytes.ts`, `codes.ts`, `authUrl.ts`, `slots.ts`, `merge.ts` (profile merge), `syncPlan.ts` (cloud-save decision table), `country.ts` |
| `src/online/server/dailyVerify.ts` | the verifier core: `puzzleOf`, `settingsHash`, `strictReplayDraft`, `verifyDaily`, `verifyWeekly` |
| `src/online/daily.ts`, `src/online/weekly.ts` | pure client parts: `dailyStartSettings`, `buildDailySubmission`; the weekly mapping `weeklyGameSettings`, `weekKeyOf` |
| `src/online/__tests__/packHashes.json` | the stamp guard's record of every pack file's SHA-256 per `generatedAt` |
| `supabase/migrations/` | the Phase 1 migrations (section 4) |
| `supabase/tests/sql/phase1.sql` | the Phase 1 assertion suite |
| `scripts/online/sql/stub.sql`, `run-local.sh` | a local stand-in for Supabase and the runner (`npm run sql:test`) |
| `scripts/online/check-dist-keys.mjs` | `npm run check:dist-keys`: fails when `dist/` holds an `sb_secret_` key or a non-anon JWT (CI runs it after the build) |
| `.github/workflows/db-tests.yml` | runs the SQL suite on a Postgres 17 service container, only for commits that touch SQL |
| `.github/workflows/keepalive.yml` | the Free project's daily keep-alive (scheduled; never fails) |

## 3. The project

- Supabase project `yvqpmyqomkwtudxmkeou` ("TouchLine", org Team TouchLine), Sydney `ap-southeast-2`, Postgres 17, **Free plan** (the owner's decision of 2026-10-25: keep it, add a daily keep-alive, upgrade the same project to a paid plan before a public launch). Never touch any other project.
- Free projects pause after about a week without activity. `keepalive.yml` reads one row of `daily_puzzles` through the Data API every day at 04:41 UTC with the publishable key; it needs the repository **variables** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Settings > Secrets and variables > Actions > Variables; both values are public). Without them it does nothing, and it never fails, so it can never block Render.
- Domain `touchline.quest` (Render custom domain; `www` redirects to the bare domain). Supabase Auth: Site URL `https://touchline.quest`; redirect URLs `https://touchline.quest/**`, `https://touchline-16xv.onrender.com/**`, `https://touchline-preview-hfvi.onrender.com/**`, `http://localhost:5173/**`. Custom SMTP through Resend (region Tokyo); Confirm email on; anonymous sign-ins off (accounts only).
- The Data API exposes `public` (and `graphql_public`) only, never `private`.

## 4. Database (Phase 1)

Applied in this order (file names carry the version the project recorded once applied). State on 2026-10-25: `online_core` applied (version `20261025092919`); the others pending, because the Supabase connector asked the owner to confirm the second migration and the question went unanswered. Apply them in file order with the connector's `apply_migration` (or `supabase link --project-ref yvqpmyqomkwtudxmkeou && supabase db push`), rename each local file to the version the project records (`list_migrations`), then run both advisors.

1. `online_core`: the `private` schema, helpers, rate limits, the data-pack registry and its private `packs` bucket, `profiles` (one display name per account, unique ignoring case, and an optional `country`, both readable only by the owner).
2. `cloud_saves`: the private `saves` bucket with owner-folder policies and a 16-object cap, `cloud_saves` (compare-and-set rows with one previous copy), `cloud_profile`, and the client writers `save_claim`, `save_delete`, `save_orphans`, `cloud_delete_all`, `profile_put`.
3. `daily_board`: `daily_puzzles` (the pinned Daily of each UTC day), `private.daily_entries` (written only by `svc_daily_submit`), `private.daily_totals` (all-time points, dailies played, best and current streak per account, kept by the same writer), and the anon readers `daily_board`, `daily_summary`, `daily_rank`, `daily_alltime_board`, plus `daily_my_entries`.
4. `weekly_board`: `weekly_puzzles` (one fixed seed per ISO week, Monday 00:00 UTC), `private.weekly_entries` (written only by `svc_weekly_submit`) and the anon readers `weekly_board`, `weekly_summary`, `weekly_rank`, plus `weekly_my_entries`.
5. `challenge_codes`: `challenges`, `create_challenge`, `get_challenge`.
6. `online_housekeeping`: pg_cron, daily clean-up of spent rate-limit windows and expired codes.
7. `service_only_policies`: an explicit deny-all policy for the client roles on the five service-only tables in `private` (answers the Security Advisor's INFO lint 0008; no behaviour change).

This project's default privileges grant every new table, sequence and function in `public` to `anon` and `authenticated` (read from `pg_default_acl` on 2026-10-25). Every migration therefore revokes table privileges and EXECUTE before granting, the stand-in mirrors those defaults, and the suite asserts that `anon` can read only `daily_puzzles` and `weekly_puzzles` and execute only the eight readers.

Every board function takes an optional country (`p_country`, ISO 3166-1 alpha-2 such as `GB`, `VN`); with it the board, the positions and the counts are those of that country only. The country, like the display name, is copied onto each board row when it is posted, so the public never reads a profile and a later change never rewrites history.

Rules that hold across all of them: RLS on every table in `public` and `private`; no SECURITY DEFINER function in `public`; `search_path` pinned everywhere; `svc_*` functions executable by `service_role` only; `anon` can execute exactly `daily_board`, `daily_summary`, `daily_rank`, `daily_alltime_board`, `weekly_board`, `weekly_summary`, `weekly_rank` and `get_challenge`. Picks, XIs and payloads on a board stay hidden until nobody can post that day or week any more.

Run the SQL suite locally with `npm run sql:test` (needs PostgreSQL 16 or 17 binaries; `PG_BIN=/usr/lib/postgresql/16/bin` by default, or `DATABASE_URL` for an existing empty database). It prints `PHASE 1 ASSERTIONS PASSED`.

## 5. The weekly challenge

- One puzzle per ISO week (Monday 00:00 UTC to the next Monday), seed `weekly-YYYY-Www` (`weekKeyOf(date)`), settings from `weeklyGameSettings(u, key)` in `src/online/weekly.ts`: an England wheel (the Daily's), a complete English season, host club and formation chosen by hashing the week key, Quick rules with twists and two re-spins. It is played as a Quick game; changing the mapping changes that week's puzzle for everyone, so treat it like the Daily mapping.
- Verified exactly like the Daily (`verifyWeekly`): the strict draft replay, then the quick season, figures from the replay only.
- First post stands (like the Daily): one entry per account per week; posts accepted until 00:00 UTC on the Tuesday after the week (a one-day grace for a run started late on Sunday), picks revealed after that. 2026-W43 is a 4-4-2 diamond as Southampton in 2018-19.

## 6. Checks only the real project can confirm

Recorded with their dates as they are done.

| Check | Status |
| --- | --- |
| PostgREST answers `PT401`/`PT403`/`PT429`/`PT503` with those HTTP statuses | pending (needs the Edge Function and a signed-in client) |
| SECURITY DEFINER functions can read `storage.objects` | pending (`cloud_saves` not applied yet) |
| Storage refuses a 17th upload under the uploader's JWT | pending (needs a signed-in client) |
| pg_cron lists `touchline-housekeeping` | pending (`online_housekeeping` not applied yet; pg_cron is available, not installed) |
| Security and performance advisors clean | after `online_core` (2026-10-25): performance clean; security one INFO (lint 0008 on `private.rate_limits` and `private.data_packs`), fixed by `service_only_policies` once applied |
| The project's default privileges | read 2026-10-25: new public tables and functions are granted to anon and authenticated; handled in every migration |
| `private` not in the Data API's exposed schemas | the default; confirm in Settings > API |

## 7. Runbooks

### Release order
1. Migrations (connector `apply_migration` or `supabase db push`), then both advisors. 2. The Edge Function. 3. Merge the client PR to `main`; Render deploys after CI. 4. Smoke on the live site. 5. A `docs/HANDOVER.md` change-log line.

### Engine bump
To be written with the Edge Function (item 8).

### Data rebuild
A rebuild needs a new `generatedAt` (the stamp guard fails CI otherwise): rebuild, run `UPDATE_PACK_HASHES=1 npx vitest run src/online/__tests__/stamps.test.ts`, commit `public/data/**` with `packHashes.json`. Deploy right after 00:00 UTC.

### Hide an entry
`update private.daily_entries set hidden = true where id = ...;` then `select private.daily_totals_refresh(user_id) from private.daily_entries where id = ...;` (same for `private.weekly_entries`, which has no totals).

### Rename an abusive display name
`update public.profiles set display_name = 'Manager ' || private.random_code(5) where user_id = ...;` Board rows keep the name they were posted under; hide them if needed.
