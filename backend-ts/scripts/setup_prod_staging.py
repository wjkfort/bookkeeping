#!/usr/bin/env python3
"""
Prepare a local, throwaway D1 database carrying REAL production data on the
new schema, so the v2 code can be exercised in a browser without touching
production.

    python3 -I scripts/setup_prod_staging.py prod-backup-<date>.sql

An optional second argument sets where the migrated database is placed. The
default is the throwaway staging directory, served with an explicit
`--persist-to`. Passing `.wrangler/state` instead puts it exactly where
`wrangler dev` and `wrangler d1 execute --local` look by DEFAULT, so no flags are
needed anywhere:

    python3 -I scripts/setup_prod_staging.py prod-backup-<date>.sql .wrangler/state
    npx wrangler dev

Then open http://localhost:8787 and sign in with your real account.

What it does, in the order migration 002 documents:
  1. load the export into a fresh v1 database
  2. apply migrations/000_add_archived_at_to_subscriptions.sql if needed
  3. apply migrations/001_link_priced_rows_to_items.sql   (pre-flight repair)
  4. apply migrations/002_schema_v2.sql                   (the migration)
  4b. apply any later migrations (003 …), in order
  5. place the result where `--persist-to` expects it

Outputs, deliberately in two separate directories:

  /tmp/prod-staging/          what you click through. Contains the pre-migration
                              snapshot and the persisted v2 database.
  /tmp/prod-fixtures/         identical copies for the automated checks. The
                              checks compare against a stored baseline, so
                              pointing them at the directory a human is editing
                              reports that human's own changes as regressions.

This is a copy. Production is never contacted.
"""

import os
import shutil
import sqlite3
import sys

STAGING = "/tmp/prod-staging"

# Where the migrated database is placed.
#
# The value is the *persist root* — the directory that will contain `v3/d1/...`.
# With no second argument it is `/tmp/prod-staging/persist`, served with an
# explicit `--persist-to`; passed `.wrangler/state` it is exactly the directory
# `wrangler dev` and `wrangler d1 execute --local` use by DEFAULT, so no flags are
# needed anywhere. Overridable so one script builds the migrated database for both
# the test harness and a developer, instead of two definitions drifting apart.
PERSIST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(STAGING, "persist")
FIXTURES = "/tmp/prod-fixtures"
# wrangler derives this filename from a hash of the database id in
# wrangler.toml; it is stable for this project.
DB_OBJECT = os.path.join(
    PERSIST, "v3", "d1", "miniflare-D1DatabaseObject",
    "bb5754fe1a0a07a12d85997a173c8b5fc59d429985b9ee50dc7e6cb432bd42d1.sqlite",
)
FIXTURE_V1 = os.path.join(FIXTURES, "prod-v1.sqlite")
FIXTURE_V2 = os.path.join(FIXTURES, "prod-v2.sqlite")

PREFLIGHT = [
    "migrations/000_add_archived_at_to_subscriptions.sql",
    "migrations/001_link_priced_rows_to_items.sql",
]
MIGRATION = "migrations/002_schema_v2.sql"
# Applied after MIGRATION, in order, each targeting the previous version.
LATER_MIGRATIONS = ["migrations/003_ai_layer_tables.sql",
                    "migrations/004_normalise_units_merchants.sql",
                    "migrations/005_ai_message_sessions.sql",
                    "migrations/006_category_structure_triggers.sql"]


def main():
    # argv[1] = the export, argv[2] = optional target root (see the docstring).
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        return 2
    export = sys.argv[1]
    if not os.path.exists(export):
        print(f"no such file: {export}")
        return 2
    for f in PREFLIGHT + [MIGRATION] + LATER_MIGRATIONS:
        if not os.path.exists(f):
            print(f"missing {f} — run this from backend-ts/")
            return 2

    work = os.path.join(STAGING, "prod-v1.sqlite")
    if os.path.exists(STAGING):
        shutil.rmtree(STAGING)
    os.makedirs(os.path.dirname(DB_OBJECT), exist_ok=True)

    print(f"loading {export}")
    src = sqlite3.connect(":memory:")
    src.executescript(open(export, encoding="utf-8").read())
    os.makedirs(os.path.dirname(work), exist_ok=True)
    dst = sqlite3.connect(work)
    src.backup(dst)
    dst.close()

    db = sqlite3.connect(work)
    db.execute("PRAGMA foreign_keys = ON")

    cols = {r[1] for r in db.execute("PRAGMA table_info(subscriptions)")}
    if "archived_at" not in cols:
        db.executescript(open(PREFLIGHT[0], encoding="utf-8").read())
        print(f"  applied {PREFLIGHT[0]}")
    else:
        print("  archived_at already present")

    db.executescript(open(PREFLIGHT[1], encoding="utf-8").read())
    print(f"  applied {PREFLIGHT[1]}")

    unlinked = [r[0] for r in db.execute(
        "SELECT id FROM transactions WHERE unit_price IS NOT NULL AND item_id IS NULL")]
    if unlinked:
        print(f"  STILL UNLINKED after repair: {unlinked}")
        return 1
    print("  every priced row has an item")

    # Snapshot the pre-migration (repaired) state: the money oracle compares it
    # against the migrated database, and once `work` is migrated that comparison
    # is impossible. `work` itself carries on and becomes the migrated database.
    snapshot = os.path.join(STAGING, "preflight-v1.sqlite")
    db.commit()
    db.close()
    shutil.copyfile(work, snapshot)
    print(f"  pre-migration snapshot: {snapshot}")

    db = sqlite3.connect(work)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(open(MIGRATION, encoding="utf-8").read())
    db.commit()
    for later in LATER_MIGRATIONS:
        db.executescript(open(later, encoding="utf-8").read())
        db.commit()
        print(f"  applied {later}")

    tx = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    prices = db.execute("SELECT COUNT(*) FROM item_prices").fetchone()[0]
    renewals = db.execute(
        "SELECT COUNT(*) FROM transactions WHERE subscription_id IS NOT NULL").fetchone()[0]
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    db.close()

    shutil.copyfile(work, DB_OBJECT)

    # Identical copies for the automated checks, kept out of the staging
    # directory so a human clicking through the app cannot disturb a comparison.
    if os.path.exists(FIXTURES):
        shutil.rmtree(FIXTURES)
    os.makedirs(FIXTURES, exist_ok=True)
    shutil.copyfile(snapshot, FIXTURE_V1)
    shutil.copyfile(DB_OBJECT, FIXTURE_V2)

    print(f"\nmigrated: {tx} transactions, {prices} item_prices, "
          f"{renewals} renewal transactions linked")
    print(f"integrity: foreign_key_check {'clean' if not fk else fk[:3]}")
    print(f"\npre-migration snapshot: {snapshot}")
    print(f"migrated database:      {DB_OBJECT}")
    print(f"check fixtures:         {FIXTURE_V1}, {FIXTURE_V2}")
    print("\nserve it with:")
    print("  WRANGLER_REGISTRY_PATH=/tmp/wrhome/registry \\")
    print("  WRANGLER_LOG_PATH=/tmp/wrhome/logs \\")
    print("  npx wrangler dev --local --port 8788 --persist-to /tmp/prod-staging/persist")
    return 0


if __name__ == "__main__":
    sys.exit(main())
