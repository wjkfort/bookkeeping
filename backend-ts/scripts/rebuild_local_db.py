#!/usr/bin/env python3
"""
Rebuild the local D1 database from a CURRENT production export.

    python3 -I scripts/rebuild_local_db.py [export.sql] [persist-root]
    npm run db:rebuild

    export.sql    default: the newest prod-backup-*.sql in this directory
    persist-root  default: .wrangler/state — where `wrangler dev` and
                  `wrangler d1 execute --local` look without any flags

STOP `wrangler dev` FIRST. The swap below replaces the database file; a running
server keeps the old file open and would carry on serving the old data until it
is restarted (it would not corrupt the new one — the old inode survives the
unlink — but "my data did not change" is a confusing way to find that out).

Why this exists next to setup_prod_staging.py: that script is for a v1 export and
runs the whole 000 -> 006 chain, because 002 rebuilds every table and needs the
v1 columns (`amount`, `unit_price`, `item_id`) to copy from. Production has been
on v2 since 2026-10-09, so a current export is already v2 and that chain cannot
run against it — it aborts at 001 with "no such column: item_id". Loading
production is now a different job from verifying the migration:

  1. load the export verbatim (it carries the v2 schema and the data),
  2. apply the migrations production has not taken yet,
  3. prove the result is structurally what db/schema.sql describes,
  4. only then replace the local database.

The order matters: everything is built and checked in a temp file, so a failure
leaves the current local database untouched.
"""

import glob
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schema_signature import differences, signature  # noqa: E402

SCHEMA_SQL = "db/schema.sql"
DEFAULT_PERSIST = ".wrangler/state"

# Migrations a current production export may still be missing, in order. Each
# carries a probe that returns a non-zero count once the migration is applied;
# that is what makes this list safe to re-run and safe to leave a migration in
# after production has taken it.
#
# Adding a migration here is optional: the structural comparison below fails
# loudly if the database is missing one, so the worst case is a clear error
# naming the gap rather than a silently incomplete local database.
PENDING_MIGRATIONS = [
    ("migrations/006_category_structure_triggers.sql",
     "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' "
     "AND name='trg_categories_structure_update'"),
]


def die(message):
    print(f"error: {message}")
    return 2


def newest_export():
    exports = sorted(glob.glob("prod-backup-*.sql"), key=os.path.getmtime, reverse=True)
    return exports[0] if exports else None


def d1_object_dir(persist_root):
    return os.path.join(persist_root, "v3", "d1", "miniflare-D1DatabaseObject")


def find_db_object(persist_root):
    """The app database inside the D1 object directory.

    Found by elimination rather than by the filename wrangler derives from the
    database id (`bb5754fe...`): that hash is miniflare's business, it is not
    documented, and it is not a plain hash of the id. `metadata.sqlite` is
    miniflare's own bookkeeping for the binding and must be left alone.
    """
    directory = d1_object_dir(persist_root)
    if not os.path.isdir(directory):
        return None
    candidates = [f for f in glob.glob(os.path.join(directory, "*.sqlite"))
                  if os.path.basename(f) != "metadata.sqlite"]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        return None
    return None  # ambiguous; reported by the caller


def schema_version(db):
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    cols = {r[1] for r in db.execute("PRAGMA table_info(transactions)")}
    if "item_prices" in tables and "amount_cents" in cols:
        return "v2"
    if "amount" in cols and "item_prices" not in tables:
        return "v1"
    return "unknown"


def holders(path):
    """PIDs with `path` open, or [] when lsof is unavailable."""
    if not shutil.which("lsof"):
        return []
    try:
        out = subprocess.run(["lsof", "-t", path], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return []
    return [p for p in out.stdout.split() if p.strip()]


def main():
    args = [a for a in sys.argv[1:]]
    if len(args) > 2:
        print(__doc__)
        return 2
    export = args[0] if args else newest_export()
    if not export:
        return die("no prod-backup-*.sql here — export one first:\n"
                   "  npx wrangler d1 export bookkeeping-db --remote "
                   "--output=prod-backup-$(date +%Y%m%d-%H%M%S).sql")
    if not os.path.exists(export):
        return die(f"no such file: {export}")
    persist_root = args[1] if len(args) > 1 else DEFAULT_PERSIST

    print(f"export:       {export} ({os.path.getsize(export)} bytes)")
    print(f"persist root: {persist_root}")

    target = find_db_object(persist_root)
    directory = d1_object_dir(persist_root)
    if target is None:
        if os.path.isdir(directory):
            others = [f for f in glob.glob(os.path.join(directory, "*.sqlite"))
                      if os.path.basename(f) != "metadata.sqlite"]
            if len(others) > 1:
                return die(f"more than one candidate database in {directory}: "
                           f"{[os.path.basename(o) for o in others]}")
        # With nothing to replace there is no filename to take over, so the
        # rebuild cannot be placed anywhere. Say so before spending a full
        # load-and-verify cycle on it.
        return die(f"{directory} has no database yet — run `npm run dev` once so\n"
                   "       wrangler creates it, then run this again")
    print(f"target:       {target} ({os.path.getsize(target)} bytes)")
    busy = holders(target)
    if busy:
        print(f"\n  WARNING: PID(s) {', '.join(busy)} currently have that file open.")
        print("  That is almost certainly `wrangler dev`. It will keep serving the old")
        print("  data until restarted; stop it before relying on this rebuild.\n")

    work = tempfile.mkdtemp(prefix="rebuild-local-")
    built = os.path.join(work, "db.sqlite")
    try:
        db = sqlite3.connect(built)

        print(f"\n1. loading the export")
        db.executescript(open(export, encoding="utf-8").read())
        db.commit()

        version = schema_version(db)
        print(f"   schema version: {version}")
        if version != "v2":
            if version == "v1":
                return die(
                    "this is a v1 export. The v1 -> v2 chain is a one-time migration that\n"
                    "       already shipped; rebuilding from a v1 export is a rehearsal, not a\n"
                    "       rebuild. Use scripts/setup_prod_staging.py for that")
            return die("cannot tell whether this export is v1 or v2 — refusing to guess")

        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        before = {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
        print(f"   {len(tables)} tables, {sum(before.values())} rows total")

        print("2. applying migrations production has not taken yet")
        applied = 0
        for path, probe in PENDING_MIGRATIONS:
            if not os.path.exists(path):
                print(f"   skipped {path} (not present)")
                continue
            if db.execute(probe).fetchone()[0]:
                print(f"   {path}: already applied")
                continue
            db.executescript(open(path, encoding="utf-8").read())
            db.commit()
            print(f"   {path}: applied")
            applied += 1
        if not applied:
            print("   nothing to apply")

        print(f"3. structure vs {SCHEMA_SQL}")
        fresh = sqlite3.connect(":memory:")
        fresh.executescript(open(SCHEMA_SQL, encoding="utf-8").read())
        expected, observed = signature(fresh), signature(db)
        fresh.close()
        diffs = differences(expected, observed)
        for d in diffs:
            print(f"   FAIL {d}")
        if not diffs:
            print(f"   PASS: {len(expected[0])} tables, {len(expected[1])} triggers, "
                  f"columns/keys/indexes/CHECKs/views all match")

        print("4. integrity")
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"   foreign_key_check: {'clean' if not fk else fk[:5]}")
        print(f"   integrity_check:   {integrity}")

        after = {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in before}
        changed = {t: (before[t], after[t]) for t in before if before[t] != after[t]}
        if changed:
            print("   rows changed by the migrations applied above:")
            for t, (b, a) in sorted(changed.items()):
                print(f"     {t}: {b} -> {a}")

        db.close()
        if diffs or fk or integrity != "ok":
            return die("the rebuilt database did not check out — the local database at\n"
                       f"       {target} was left untouched")

        print(f"5. replacing the local database")
        # The -wal and -shm belong to the database being replaced; leaving them
        # behind would apply an unrelated write-ahead log to the new file.
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(target + suffix):
                os.unlink(target + suffix)
        shutil.copyfile(built, target)
        print(f"   wrote {target}")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print(f"\nlocal database replaced with {export}")
    print("start `npm run dev` (or restart it) to serve the new data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
