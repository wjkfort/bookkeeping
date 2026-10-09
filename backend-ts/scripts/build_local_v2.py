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

Output: .wrangler-v2/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite

This does NOT run the verifier; run scripts/verify_migration.py against the
same source first. This only builds the artifact.
"""

import os
import shutil
import sqlite3
import sys

MIGRATION = "migrations/002_schema_v2.sql"
LATER_MIGRATIONS = ["migrations/003_ai_layer_tables.sql",
                    "migrations/004_normalise_units_merchants.sql"]
SCHEMA = "db/schema.sql"
OUT_DIR = ".wrangler-v2/state/v3/d1/miniflare-D1DatabaseObject"
# wrangler derives the object filename from a hash of the database id; any
# stable name works for --persist-to as long as it is the only *.sqlite here.
OUT_DB = os.path.join(OUT_DIR, "bookkeeping-v2.sqlite")


def find_local_clone():
    base = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
    if not os.path.isdir(base):
        return None
    for name in sorted(os.listdir(base)):
        if name.endswith(".sqlite") and "metadata" not in name:
            return os.path.join(base, name)
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

    if os.path.exists(OUT_DB):
        os.unlink(OUT_DB)
    os.makedirs(OUT_DIR, exist_ok=True)

    if empty:
        db = sqlite3.connect(OUT_DB)
        db.executescript(open(SCHEMA, encoding="utf-8").read())
        db.commit()
        print(f"built empty v2 database: {OUT_DB}")
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
    shutil.copyfile(source, OUT_DB)
    db = sqlite3.connect(OUT_DB)
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
    print(f"\nbuilt v2 database: {OUT_DB}")
    print("point wrangler at it with:")
    print(f"  npx wrangler dev --persist-to .wrangler-v2 --local")
    return 0


if __name__ == "__main__":
    sys.exit(main())
