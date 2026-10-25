#!/usr/bin/env bash
# Run the online layer's SQL on a plain Postgres: the Supabase stand-in (stub.sql), every migration in
# supabase/migrations in order, then the assertion suites in supabase/tests/sql. Prints PHASE 1 ASSERTIONS PASSED.
#
#   npm run sql:test                         a throwaway cluster from $PG_BIN (default /usr/lib/postgresql/16/bin)
#   DATABASE_URL=postgres://... npm run sql:test   an existing, EMPTY database (CI's service container)
#
# Never point DATABASE_URL at the Supabase project: the stand-in creates its own auth and storage schemas.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"

files=("$here/stub.sql")
while IFS= read -r f; do files+=("$f"); done < <(ls "$root"/supabase/migrations/*.sql | sort)
while IFS= read -r f; do files+=("$f"); done < <(ls "$root"/supabase/tests/sql/*.sql | sort)

run_all() {
  for f in "${files[@]}"; do
    echo "== $(basename "$f")"
    # stdin rather than -f: the postgres user may not be able to read the checkout
    "$@" -X -q -v ON_ERROR_STOP=1 < "$f"
  done
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  run_all psql "$DATABASE_URL"
  exit 0
fi

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
[[ -x "$PG_BIN/initdb" ]] || { echo "No Postgres binaries in $PG_BIN (set PG_BIN or DATABASE_URL)"; exit 1; }
tmp="$(mktemp -d)"
# initdb refuses to run as root: hand the cluster to the postgres user when there is one
as=()
if [[ "$(id -u)" == "0" ]]; then
  id postgres >/dev/null 2>&1 || { echo "Running as root needs a postgres user"; exit 1; }
  chown postgres "$tmp"
  as=(runuser -u postgres --)
fi
cleanup() { "${as[@]}" "$PG_BIN/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
# UTF8, as on Supabase: on a SQL_ASCII cluster the Unicode name checks would test bytes, not characters
"${as[@]}" "$PG_BIN/initdb" -D "$tmp/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
port=$(( 20000 + RANDOM % 20000 ))
"${as[@]}" "$PG_BIN/pg_ctl" -D "$tmp/data" -o "-k $tmp -p $port -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
"${as[@]}" "$PG_BIN/createdb" -h "$tmp" -p "$port" -U postgres touchline
run_all "${as[@]}" "$PG_BIN/psql" -h "$tmp" -p "$port" -U postgres -d touchline
