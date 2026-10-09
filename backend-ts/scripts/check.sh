#!/usr/bin/env bash
# Fast regression suite for the schema v2 work.
#
#   ./scripts/check.sh                      # verify whatever fixtures exist
#   ./scripts/check.sh <v1.sqlite> <v2.sqlite>   # also run the money + contract diffs
#
# The money and contract layers take the isolated copies under
# /tmp/prod-fixtures (built by setup_prod_staging.py), never the database a
# human is clicking through in /tmp/prod-staging/persist.
#
# Every layer is skipped, not failed, when its fixture is absent — production
# exports and database copies are gitignored, so a fresh clone legitimately has
# none. What is checked is reported per layer.
#
# Layers:
#   1. typecheck                  always
#   2. migration invariants       on each available prod export and on the
#                                 repaired staging database if present
#   3. write paths (POST/PUT/DELETE/409/isolation)   against a v2 database,
#                                 and again against a fresh install
#   4. money arithmetic           v1 vs v2 database
#   5. API response contract      v1 capture vs v2 capture
#
# The layers overlap on purpose: 2 guards the data migration, 3 guards the write
# handlers, 4 guards the arithmetic, 5 guards the wire format the UI consumes.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

PASS=0
FAIL=0
SKIP=0
note()  { printf '\n=== %s ===\n' "$1"; }
ok()    { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad()   { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
skip()  { SKIP=$((SKIP + 1)); printf '  skip  %s\n' "$1"; }

run_layer() { # name, command...
  local name="$1"; shift
  note "$name"
  if "$@"; then ok "$name"; else bad "$name"; fi
}

# ---------------------------------------------------------------- 1. typecheck
note "typecheck"
if OUT=$(npx tsc --noEmit 2>&1); then
  ok "tsc --noEmit"
else
  # src/api/proxy.ts fails on a pre-existing RequestInit typing issue unrelated
  # to this work; anything else is a real error.
  REAL=$(printf '%s\n' "$OUT" | grep 'error TS' | grep -v 'src/api/proxy.ts' || true)
  if [ -z "$REAL" ]; then
    ok "tsc --noEmit (only the pre-existing proxy.ts error)"
  else
    printf '%s\n' "$REAL"
    bad "tsc --noEmit"
  fi
fi

# ------------------------------------------------------- 2. migration invariants
shopt -s nullglob
EXPORTS=(prod-backup-*.sql)
if [ ${#EXPORTS[@]} -eq 0 ]; then
  skip "migration invariants (no prod-backup-*.sql present)"
else
  for f in "${EXPORTS[@]}"; do
    note "migration invariants: $f"
    # A raw export is expected to FAIL the pre-flight check until
    # migrations/001 has been applied, so report the result rather than assert.
    python3 -I scripts/verify_migration.py "$f" 2>&1 | tail -6
  done
fi

# Explicit fixtures for the money and contract layers. These are NOT taken from
# the staging directory on purpose: that database is the one a human is clicking
# through, so transactions appear and disappear in it and every comparison
# against a stored baseline would show spurious differences.
#
# They are DERIVED, not kept: `prod-backup-*.sql` is the single source of real
# data in the repo and everything else is rebuilt from it, which is why they live
# in /tmp. When they are absent this rebuilds them from the newest export, using
# `setup_prod_staging.py` — the same script a human runs, and importantly one
# that applies migrations/001 first. Building straight from the raw export
# instead produces a database that is subtly wrong (the five unlinked priced rows
# stay unlinked) and the money layer then reports four differences that look like
# regressions. One definition of how the migrated database is produced, reused.
V1="${1:-}"
V2="${2:-}"
STAGING_V1=/tmp/prod-staging/preflight-v1.sqlite

if [ -z "$V1" ] && [ -z "$V2" ] && [ ! -f /tmp/prod-fixtures/prod-v2.sqlite ]; then
  EXPORT=$(ls -t prod-backup-*.sql 2>/dev/null | head -1)
  if [ -n "$EXPORT" ]; then
    note "fixtures absent — rebuilding from $EXPORT"
    if python3 -I scripts/setup_prod_staging.py "$EXPORT" >/tmp/check-fixtures.log 2>&1; then
      ok "fixtures rebuilt"
    else
      bad "fixtures could not be rebuilt (see /tmp/check-fixtures.log)"
    fi
  fi
fi

# Adopt whatever fixtures exist. Setting V1/V2 here (rather than only at the
# rebuild site) is what keeps the layers below running on every invocation
# instead of only on the one that happened to rebuild.
if [ -z "$V1" ] && [ -z "$V2" ] && [ -f /tmp/prod-fixtures/prod-v2.sqlite ]; then
  V1=/tmp/prod-fixtures/prod-v1.sqlite
  V2=/tmp/prod-fixtures/prod-v2.sqlite
fi

if [ -f "$STAGING_V1" ]; then
  run_layer "migration invariants: repaired staging database" \
    python3 -I scripts/verify_migration.py "$STAGING_V1"
else
  skip "migration invariants on a repaired database (rebuild with scripts/setup_prod_staging.py)"
fi

# --------------------------------------------------------------- 3. write paths
if [ -n "$V2" ] && [ -f "$V2" ]; then
  note "write paths"
  npx esbuild scripts/api_write_test.ts --bundle --platform=node --format=esm \
      --outfile=scripts/.build/api_write_test.mjs --log-level=warning || bad "esbuild"
  if node scripts/.build/api_write_test.mjs "$V2" 2>&1 | grep -v Experimental | grep -v trace-warnings | tail -40; then
    ok "write paths"
  else
    bad "write paths"
  fi
else
  skip "write paths (no v2 database)"
fi

# A fresh install takes a different path from a migrated database: db/schema.sql
# instead of migrations/002. It has no data at all, so the handlers have to cope
# with empty tables and the test has to create its own category. This runs
# unconditionally, since it needs no fixtures.
note "write paths against a fresh install (db/schema.sql, no data)"
FRESH=/tmp/check-fresh.sqlite
rm -f "$FRESH"
if python3 - "$FRESH" <<'PYEOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript(open("db/schema.sql", encoding="utf-8").read())
db.execute("INSERT INTO users (email, password_hash, username) VALUES ('fresh@local','x','fresh')")
db.commit()
db.close()
PYEOF
then
  npx esbuild scripts/api_write_test.ts --bundle --platform=node --format=esm \
      --outfile=scripts/.build/api_write_test.mjs --log-level=warning || bad "esbuild"
  if node scripts/.build/api_write_test.mjs "$FRESH" 2>&1 | grep -v Experimental | grep -v trace-warnings | tail -20; then
    ok "write paths on a fresh install"
  else
    bad "write paths on a fresh install"
  fi
else
  bad "could not build a fresh database from db/schema.sql"
fi

# ------------------------------------------------------- 3b. service layer
#
# The handlers are thin adapters over src/services/, which is also what the AI
# tools call. This suite drives the services directly, so it can assert things
# the HTTP contract does not expose — notably `transactions.source` (the AI path
# must record 'ai'; nothing checked that column before) and the merchant being
# carried onto the price observation. It needs no fixtures, so it reuses $FRESH.
note "service layer (src/services, the code the AI tools call)"
if npx esbuild scripts/services_test.ts --bundle --platform=node --format=esm \
    --outfile=scripts/.build/services_test.mjs --log-level=warning; then
  if node scripts/.build/services_test.mjs "$FRESH" 2>&1 | grep -v Experimental | grep -v trace-warnings | tail -20; then
    ok "service layer"
  else
    bad "service layer"
  fi
else
  bad "service layer (esbuild)"
fi

# ------------------------------------------------------- 3c. AI endpoints over HTTP
#
# services_test.ts drives the service functions directly, so it cannot catch a
# route that was never mounted, a path shadowed by another route, or an endpoint
# reachable without a token. Those are precisely the failure modes of the
# `api.route(...)` wiring, and the stored API-contract capture predates these
# routes. This suite goes through the real app and auth middleware.
note "AI support endpoints over HTTP (routing + auth)"
if npx esbuild scripts/ai_endpoints_test.ts --bundle --platform=node --format=esm \
    --outfile=scripts/.build/ai_endpoints_test.mjs --log-level=warning; then
  if node scripts/.build/ai_endpoints_test.mjs "$FRESH" 2>&1 | grep -v Experimental | grep -v trace-warnings | tail -20; then
    ok "AI support endpoints"
  else
    bad "AI support endpoints"
  fi
else
  bad "AI support endpoints (esbuild)"
fi

# --------------------------------------------------- 3d. one unit vocabulary
#
# The unit vocabulary is written down in four files, and they had drifted apart
# in both directions: the form offered "gallon" and "lb" (not in `units`, so
# saving hit the FOREIGN KEY and surfaced as a 500) while neither locale file
# labelled "g", "ml" or "bag". `item_prices.unit` cannot hold anything outside
# the table, so the lists have to agree. Needs no fixtures.
run_layer "unit vocabulary (schema = form = locales)" \
  python3 -I scripts/check_unit_vocabulary.py

# ------------------------------------------------------------ 4. money arithmetic
if [ -n "$V1" ] && [ -f "$V1" ] && [ -n "$V2" ] && [ -f "$V2" ]; then
  run_layer "money arithmetic (v1 vs v2)" \
    python3 -I scripts/compare_money.py "$V1" "$V2"
else
  skip "money arithmetic (pass a v1 and a v2 database as arguments)"
fi

# ----------------------------------------------------------- 5. API contract
#
# Two different comparisons need two different baselines:
#
#   a) The one-time migration check: OLD (v1) code against the v1 database
#      versus the new code against the migrated database. The old code no
#      longer exists on disk, so its side has to be a stored capture. Only
#      meaningful while the migration is being prepared; it can no longer be
#      regenerated because the old code is gone, so the stored capture is the
#      only copy. See README.md ("Verifying a schema change").
#
#   b) The ongoing regression check: this code against the migrated database,
#      compared with the stored capture. This is what catches a later edit
#      changing a response by accident.
#
# The stored baseline is a gitignored capture (it embeds real descriptions and
# emails), so this layer skips cleanly on a fresh checkout.
BASELINE=scripts/baseline/api-contract-baseline.json
if [ -n "$V2" ] && [ -f "$V2" ]; then
  note "API contract"
  npx esbuild scripts/api_capture.ts --bundle --platform=node --format=esm \
      --outfile=scripts/.build/api_capture.mjs --log-level=warning || bad "esbuild"
  if [ -f "$BASELINE" ]; then
    if node scripts/.build/api_capture.mjs "$V2" > /tmp/check-cand.json 2>/dev/null; then
      if python3 -I scripts/api_diff.py "$BASELINE" /tmp/check-cand.json; then
        ok "API contract (vs $BASELINE)"
      else
        bad "API contract (vs $BASELINE)"
      fi
    else
      bad "API contract (capture failed)"
    fi
  else
    skip "API contract (no stored baseline at $BASELINE)"
    printf '        it is created from the pre-migration code and cannot be\n'
    printf '        regenerated now — see README.md\n'
  fi
else
  skip "API contract (pass a v2 database as the second argument)"
fi

printf '\n%s\n' "$(printf '=%.0s' {1..60})"
printf 'RESULT: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
