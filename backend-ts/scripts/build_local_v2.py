#!/usr/bin/env python3
"""
Build a local, migrated (schema v2) D1 database to develop against.

The v1 -> v2 migration is breaking, so the application code cannot run against
the v1 local database once it is written. This produces a second, separate
local database directory so `wrangler dev` can point at v2 while the untouched
v1 state stays where it is.

    python3 -I scripts/build_local_v2.py                     # local clone -> v2
    python3 -I scripts/build_local_v2.py <source.sqlite>     # explicit source
    python3 -I scripts/build_local_v2.py --empty             # v2 schema, no data

Then serve it (the --persist-to value must be the directory that CONTAINS `v3/`):

    npx wrangler dev --local --port 8787 --persist-to .wrangler-v2/state

Output: <persist>/v3/d1/miniflare-D1DatabaseObject/<object-id>.sqlite

The file name matters. Miniflare derives it from a hash of the D1 `database_id`,
so a database written under any other name is invisible to the worker, which
then silently creates an EMPTY database beside it and every query fails with
`D1_ERROR: no such table: ...`. That is what the original version of this script
got wrong: it wrote `bookkeeping-v2.sqlite`, which used to be picked up but is
not any more. The name is therefore discovered from the existing local database
(same database_id, so same name) rather than guessed.

This does NOT run the verifier; run scripts/verify_migration.py against the
same source first. This only builds the artifact.
"""

import os
import shutil
import sqlite3
import sys

MIGRATION = "migrations/002_schema_v2.sql"
LATER_MIGRATIONS = ["migrations/003_ai_layer_tables.sql",
                    "migrations/004_normalise_units_merchants.sql",
                    "migrations/005_ai_message_sessions.sql"]
SCHEMA = "db/schema.sql"
# The persist root is the directory holding `v3/`, which is what --persist-to
# expects. The D1 objects live one level further down.
#
# The output keeps a `state/` level so that `--persist-to .wrangler-v2/state`
# resolves to exactly this directory (Miniflare appends `v3` to what it is
# given). Dropping `state` would work too, but only if the printed command were
# changed to match, and the two drifting apart is the bug this layout prevents.
OUT_ROOT = ".wrangler-v2"
D1_SUBDIR = os.path.join("v3", "d1", "miniflare-D1DatabaseObject")
OUT_DIR = os.path.join(OUT_ROOT, "state", D1_SUBDIR)
DEFAULT_D1_DIR = os.path.join(".wrangler", "state", D1_SUBDIR)
# Only used when no existing database reveals the real name.
FALLBACK_NAME = "bookkeeping-v2.sqlite"


def d1_file_name(directory):
    """The object-id file name in a D1 directory, ignoring metadata.sqlite."""
    if not os.path.isdir(directory):
        return None
    for name in sorted(os.listdir(directory)):
        if name.endswith(".sqlite") and "metadata" not in name:
            return name
    return None


def discover_object_name():
    """
    The file name Miniflare will look for.

    Every D1 binding in this project uses the same `database_id`, so the name
    found in the default local directory is the name the worker will use under
    any other persist root. Discovered rather than computed: the derivation is
    a hash internal to Miniflare, and hard-coding a guess is exactly the failure
    this function exists to prevent.
    """
    return d1_file_name(DEFAULT_D1_DIR) or d1_file_name(OUT_DIR) or FALLBACK_NAME


def find_local_clone():
    if not os.path.isdir(DEFAULT_D1_DIR):
        return None
    for name in sorted(os.listdir(DEFAULT_D1_DIR)):
        if name.endswith(".sqlite") and "metadata" not in name:
            return os.path.join(DEFAULT_D1_DIR, name)
    return None


def table_names(db):
    return {
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'"
        )
    }


def already_v2(db):
    """A migrated database has item_prices; a v1 one does not."""
    cols = {r[1] for r in db.execute("PRAGMA table_info(transactions)")}
    return "amount_cents" in cols


def main():
    args = [a for a in sys.argv[1:] if a != "--empty"]
    empty = "--empty" in sys.argv[1:]

    if not os.path.exists(SCHEMA) or not os.path.exists(MIGRATION):
        print("run this from backend-ts/")
        return 2

    # Resolved here, not at import time: the name must match what the worker
    # will look for, which is only knowable once a real local database exists.
    os.makedirs(OUT_DIR, exist_ok=True)
    name = discover_object_name()
    out_db = os.path.join(OUT_DIR, name)
    print(f"target: {out_db}")

    if name == FALLBACK_NAME and not os.path.isdir(DEFAULT_D1_DIR):
        # No existing database to read the real name off. The worker would not
        # find this file, so say so loudly instead of letting it build an empty
        # database at runtime and fail every query with "no such table".
        print(
            "WARNING: no existing local D1 database found, so the object file\n"
            "         name had to be guessed. Start the worker once against a\n"
            "         throwaway persist root to let it create the real name:\n"
            "             npx wrangler dev --local --persist-to .wrangler-v2/state\n"
            "         then re-run this script."
        )

    if os.path.exists(out_db):
        os.unlink(out_db)

    if empty:
        db = sqlite3.connect(out_db)
        db.executescript(open(SCHEMA, encoding="utf-8").read())
        db.commit()
        print(f"built empty v2 database: {out_db}")
        print("  (schema.sql only — use this to verify a fresh install)")
        db.close()
        return 0

    source = args[0] if args else find_local_clone()
    if not source:
        print("no local v1 clone found; pass a .sqlite path or use --empty")
        return 2
    if not os.path.exists(source):
        print(f"no such file: {source}")
        return 2

    print(f"source: {source}")
    if not args and source.startswith(".wrangler/"):
        # Built from the machine's own v1 clone rather than an export. That is a
        # valid quick check of the migration, but the clone is a snapshot of
        # whenever this machine last ran v1 and drifts far behind production:
        # on 2026-10-09 it held 296 transactions against the export's 487, so
        # developing against it looks like "the app has no data". Say so here,
        # because the symptom shows up much later and looks like a code bug.
        print(
            "NOTE: this is the local v1 clone, not a production export. To\n"
            "      develop against real data, build the staging database first:\n"
            "        python3 -I scripts/setup_prod_staging.py prod-backup-<date>.sql\n"
            "        python3 -I scripts/build_local_v2.py /tmp/prod-staging/preflight-v1.sqlite"
        )
    shutil.copyfile(source, out_db)
    db = sqlite3.connect(out_db)
    db.execute("PRAGMA foreign_keys = ON")
    if already_v2(db):
        print("source is already on v2 — copied as-is, migration not re-run")
        db.close()
        return 0

    before = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    cols = {r[1] for r in db.execute("PRAGMA table_info(subscriptions)")}
    if "archived_at" not in cols:
        db.execute("ALTER TABLE subscriptions ADD COLUMN archived_at TEXT")
        db.commit()
        print("  applied pending column migration: archived_at")

    try:
        db.executescript(open(MIGRATION, encoding="utf-8").read())
        db.commit()
        for later in LATER_MIGRATIONS:
            db.executescript(open(later, encoding="utf-8").read())
            db.commit()
    except sqlite3.Error as exc:
        print(f"MIGRATION FAILED: {type(exc).__name__}: {exc}")
        return 1

    after = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    prices = db.execute("SELECT COUNT(*) FROM item_prices").fetchone()[0]
    tables = table_names(db)
    print(f"  transactions: {before} -> {after}")
    print(f"  item_prices:  {prices}")
    print(f"  tables ({len(tables)}): {', '.join(sorted(tables))}")

    if after != before:
        print(f"  ROW COUNT CHANGED ({before} -> {after}) — refusing to call this good")
        return 1
    if any(t.endswith("_old") for t in tables):
        print(f"  leftover *_old tables: {sorted(t for t in tables if t.endswith('_old'))}")
        return 1

    db.close()
    print(f"\nbuilt v2 database: {out_db}")
    print("point wrangler at it with:")
    # --persist-to takes the directory that CONTAINS `v3/`, i.e. OUT_ROOT/state,
    # not OUT_ROOT itself: Miniflare appends `v3` to whatever it is given, so
    # passing the outer directory would look in a different tree and silently
    # start from an empty database.
    print(f"  npx wrangler dev --local --port 8787 --persist-to {os.path.join(OUT_ROOT, 'state')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
