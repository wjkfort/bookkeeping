#!/usr/bin/env python3
"""
Rehearse the production migration sequence end to end, on a copy, before running
it against production.

    python3 -I scripts/rehearse_migration.py prod-backup-<date>.sql

Steps, exactly as they will be run in production:

    1. load the export into a fresh database          (the backup)
    2. migrations/add_archived_at_to_subscriptions.sql (no-op if already present)
    3. migrations/001_link_priced_rows_to_items.sql    (pre-flight repair)
    4. verify_migration.py                             (must be 33/0)
    5. migrations/002_schema_v2.sql                    (the migration)
    5b. any later migrations (003 …), in order
    6. confirm a second run of 002 is refused and changes nothing

Step 6 matters because `wrangler d1 execute --file` runs the file in one
transaction: a re-run has to fail and roll back rather than half-apply. The
production run is a one-shot, so knowing what a mistake looks like is part of
rehearsing it.

Every step works on copies; the input file is never modified.
"""

import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

PREFLIGHT_ARCHIVED = "migrations/add_archived_at_to_subscriptions.sql"
PREFLIGHT_LINK = "migrations/001_link_priced_rows_to_items.sql"
MIGRATION = "migrations/002_schema_v2.sql"
# Applied after MIGRATION, in order.
LATER_MIGRATIONS = ["migrations/003_ai_layer_tables.sql",
                    "migrations/004_normalise_units_merchants.sql",
                    "migrations/005_ai_message_sessions.sql"]
VERIFIER = "scripts/verify_migration.py"

failures = []


def step(n, text):
    print(f"\n[{n}] {text}")


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def copy_of(src, dst):
    shutil.copyfile(src, dst)
    return sqlite3.connect(dst)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    export = sys.argv[1]
    if not os.path.exists(export):
        print(f"no such file: {export}")
        return 2
    for f in (PREFLIGHT_ARCHIVED, PREFLIGHT_LINK, MIGRATION, VERIFIER):
        if not os.path.exists(f):
            print(f"missing {f} — run this from backend-ts/")
            return 2

    tmp = tempfile.mkdtemp(prefix="rehearse-")
    backup_sql = os.path.join(tmp, "export.sql")
    db_path = os.path.join(tmp, "prod.sqlite")
    shutil.copyfile(export, backup_sql)

    step(1, f"load {export}")
    src = sqlite3.connect(":memory:")
    src.executescript(open(backup_sql, encoding="utf-8").read())
    dst = sqlite3.connect(db_path)
    src.backup(dst)
    dst.close()
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA foreign_keys = ON")
    uid = db.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()[0]
    tx_before = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    check("loaded", tx_before > 0, f"{tx_before} transactions")

    step(2, "apply add_archived_at_to_subscriptions.sql if needed")
    cols = {r[1] for r in db.execute("PRAGMA table_info(subscriptions)")}
    if "archived_at" not in cols:
        db.executescript(open(PREFLIGHT_ARCHIVED, encoding="utf-8").read())
        db.commit()
        check("archived_at added", True)
    else:
        check("archived_at already present (nothing to do)", True)

    step(3, f"apply {PREFLIGHT_LINK}")
    unlinked_before = db.execute(
        "SELECT COUNT(*) FROM transactions WHERE unit_price IS NOT NULL AND item_id IS NULL"
    ).fetchone()[0]
    db.executescript(open(PREFLIGHT_LINK, encoding="utf-8").read())
    db.commit()
    unlinked_after = db.execute(
        "SELECT COUNT(*) FROM transactions WHERE unit_price IS NOT NULL AND item_id IS NULL"
    ).fetchone()[0]
    check("every priced row now has an item",
          unlinked_after == 0, f"{unlinked_before} -> {unlinked_after}")
    # The repair must be safe to re-run; it is not idempotent in the strict
    # sense, so prove a second application changes nothing.
    items_once = db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    db.executescript(open(PREFLIGHT_LINK, encoding="utf-8").read())
    db.commit()
    items_twice = db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    check("re-running the repair creates no duplicate items",
          items_once == items_twice, f"{items_once} -> {items_twice}")
    db.close()

    step(4, f"verify before migrating ({VERIFIER})")
    res = run(["python3", "-I", VERIFIER, db_path])
    tail = [l for l in res.stdout.splitlines() if l.startswith("RESULT:")]
    check("verifier passes on the repaired database",
          bool(tail) and " 0 failed" in tail[-1], tail[-1] if tail else res.stdout[-200:])

    step(5, f"apply {MIGRATION} then {', '.join(LATER_MIGRATIONS)}")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA foreign_keys = ON")
    try:
        db.executescript(open(MIGRATION, encoding="utf-8").read())
        db.commit()
        for later in LATER_MIGRATIONS:
            db.executescript(open(later, encoding="utf-8").read())
            db.commit()
        applied = True
        err = ""
    except sqlite3.Error as exc:
        applied = False
        err = f"{type(exc).__name__}: {exc}"
    check("migration applied", applied, err)
    if applied:
        tx_after = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        prices = db.execute("SELECT COUNT(*) FROM item_prices").fetchone()[0]
        renewals = db.execute(
            "SELECT COUNT(*) FROM transactions WHERE subscription_id IS NOT NULL").fetchone()[0]
        total_cents = db.execute("SELECT SUM(amount_cents) FROM transactions").fetchone()[0]
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        leftover = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_old'")]
        check("no rows lost", tx_after == tx_before, f"{tx_before} -> {tx_after}")
        check("item_prices populated", prices > 0, str(prices))
        check("foreign_key_check clean", not fk, str(fk[:2]))
        check("integrity_check ok", integrity == "ok", integrity)
        check("no *_old tables left", not leftover, str(leftover))
        print(f"      item_prices: {prices}, renewal transactions linked: {renewals}")

        # What 003 is for: a tool-call turn has no text, and a partly recorded
        # day must be distinguishable from a confirmed empty one.
        content = {r[1]: r[3] for r in db.execute("PRAGMA table_info(ai_messages)")}
        check("ai_messages.content is nullable after 003",
              content.get("content") == 0, f"notnull={content.get('content')}")
        ledger_cols = [r[1] for r in db.execute("PRAGMA table_info(ledger_days)")]
        check("ledger_days gained status after 003",
              "status" in ledger_cols, str(ledger_cols))
        if "status" in ledger_cols:
            try:
                db.execute("INSERT INTO ledger_days (user_id, date) VALUES (?, ?)",
                           (uid, "2099-01-01"))
                default_status = db.execute(
                    "SELECT status FROM ledger_days WHERE date='2099-01-01'").fetchone()[0]
                check("status defaults to 'no_spend'", default_status == "no_spend", default_status)
                db.execute("INSERT INTO ledger_days (user_id, date, status) VALUES (?,?,?)",
                           (uid, "2099-01-02", "partial"))
                db.execute("DELETE FROM ledger_days WHERE date LIKE '2099-%'")
                db.commit()
            except sqlite3.Error as exc:
                check("status is usable", False, f"{type(exc).__name__}: {exc}")
            try:
                db.execute("INSERT INTO ledger_days (user_id, date, status) VALUES (?,?,?)",
                           (uid, "2099-01-03", "bogus"))
                check("status rejects unknown values", False, "insert succeeded")
            except sqlite3.IntegrityError:
                check("status rejects unknown values", True)
            db.rollback()

        # What 005 is for: every turn must state which conversation it belongs
        # to, so the model can be shown one conversation instead of all of them.
        # Existing rows are attributed to 'legacy' rather than dropped.
        msg_cols = {r[1]: r for r in db.execute("PRAGMA table_info(ai_messages)")}
        check("ai_messages gained session_id after 005",
              "session_id" in msg_cols, str(sorted(msg_cols)))
        if "session_id" in msg_cols:
            check("session_id is NOT NULL after 005",
                  msg_cols["session_id"][3] == 1, f"notnull={msg_cols['session_id'][3]}")
            idx = [r[1] for r in db.execute(
                "SELECT type, name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='ai_messages'")]
            check("the conversation index is present after 005",
                  "idx_ai_messages_session" in idx, str(idx))
            try:
                db.execute("INSERT INTO ai_messages (user_id, role, content) VALUES (?,?,?)",
                           (uid, "user", "no session given"))
                got = db.execute(
                    "SELECT session_id FROM ai_messages WHERE content='no session given'"
                ).fetchone()[0]
                check("a turn written without a session is still recorded",
                      got == "default", str(got))
                db.execute("DELETE FROM ai_messages WHERE content='no session given'")
                db.commit()
            except sqlite3.Error as exc:
                check("a turn written without a session is still recorded", False,
                      f"{type(exc).__name__}: {exc}")
                db.rollback()
            try:
                db.execute("INSERT INTO ai_messages (user_id, session_id, role, content) "
                           "VALUES (?,?,?,?)", (uid, None, "user", "null session"))
                check("session_id rejects NULL", False, "insert succeeded")
            except sqlite3.IntegrityError:
                check("session_id rejects NULL", True)
            db.rollback()

        step(6, "a repeated 002 must be refused, and the backup must restore")
        # 002 renames every live table to <name>_old before creating the v2
        # tables. Run twice it fails part-way ('item_prices already exists'),
        # having parked the v2 tables and created empty replacements, so the
        # data is no longer in the live tables. It is NOT re-runnable, which the
        # file says at the top.
        #
        # Under `wrangler d1 execute --file` — how production runs it — the whole
        # file is one transaction, so a failure rolls back instead of parking
        # anything (verified against --local). The exposure is only if someone
        # runs the file a second time after a successful first run. What has to
        # be true is that the backup taken beforehand restores the database, so
        # that is what this step proves.
        rerun_db = os.path.join(tmp, "rerun.sqlite")
        copy_of(db_path, rerun_db).close()
        rd = sqlite3.connect(rerun_db)
        try:
            rd.executescript(open(MIGRATION, encoding="utf-8").read())
            rd.commit()
            refused = False
            reason = "it succeeded instead — check for a duplicated row or index"
        except sqlite3.Error as exc:
            refused = True
            reason = f"{type(exc).__name__}: {exc}"
        rd.close()
        check("a repeated 002 is refused", refused, reason)

        step(7, "restore from the backup and confirm the data comes back")
        restored = os.path.join(tmp, "restored.sqlite")
        r = sqlite3.connect(restored)
        try:
            r.executescript(open(backup_sql, encoding="utf-8").read())
            r.commit()
            r.executescript(open(PREFLIGHT_LINK, encoding="utf-8").read())
            r.commit()
            r.executescript(open(MIGRATION, encoding="utf-8").read())
            r.commit()
            for later in LATER_MIGRATIONS:
                r.executescript(open(later, encoding="utf-8").read())
                r.commit()
            tx_restored = r.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            cents_restored = r.execute("SELECT SUM(amount_cents) FROM transactions").fetchone()[0]
            prices_restored = r.execute("SELECT COUNT(*) FROM item_prices").fetchone()[0]
            fk2 = r.execute("PRAGMA foreign_key_check").fetchall()
            check("backup restores to the same row count", tx_restored == tx_after,
                  f"{tx_after} -> {tx_restored}")
            check("backup restores the same total money", cents_restored == total_cents,
                  f"{total_cents} -> {cents_restored}")
            check("backup restores the same price rows", prices_restored == prices,
                  f"{prices} -> {prices_restored}")
            check("restored database passes foreign_key_check", not fk2, str(fk2[:2]))
        except sqlite3.Error as exc:
            check("backup restore path works", False, f"{type(exc).__name__}: {exc}")
        finally:
            r.close()
    db.close()

    shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 60)
    if failures:
        print(f"REHEARSAL FAILED: {len(failures)} problem(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("REHEARSAL PASSED: the production sequence works end to end on this export")
    return 0


if __name__ == "__main__":
    sys.exit(main())
