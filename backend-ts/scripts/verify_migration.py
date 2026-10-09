#!/usr/bin/env python3
"""
Verify the schema v2 migration against a copy of real data.

Usage:
    python3 -I scripts/verify_migration.py <database.sqlite | export.sql>

Accepts either a D1 SQLite file (wrangler local state, or a downloaded
--output=.sqlite) or a `wrangler d1 export` .sql file. The input is copied to a
temp file and never modified, so it is safe to point at the local dev database
while wrangler is stopped.

Checks, for every user:
  1. row counts per table before/after
  2. money: SUM(amount_cents) after == ROUND(SUM(amount)*100) before, per currency
  3. every item-linked v1 transaction produced exactly one item_prices row
  4. recorded unit_price values survive verbatim
  5. the category tree is unchanged (id, parent_id, name, type)
  6. no orphans on any foreign key, and PRAGMA foreign_key_check is clean
  7. new constraints actually bite (duplicate category, RESTRICT on category delete)
"""

import os
import re
import sqlite3
import sys
import tempfile

SCHEMA = "migrations/002_schema_v2.sql"
# Applied after SCHEMA, in order. Each is a separate file because it targets a
# database already on the previous version.
LATER_MIGRATIONS = ["migrations/003_ai_layer_tables.sql",
                    "migrations/004_normalise_units_merchants.sql",
                    "migrations/005_ai_message_sessions.sql"]
# The full schema for new/empty databases; must match what the migration builds.
SCHEMA_SQL = "db/schema.sql"

# (label, column, kind) — kind 'money' compares cents, 'count' compares row counts
TABLES = [
    ("users", "id", "count"),
    ("categories", "id", "count"),
    ("items", "id", "count"),
    ("subscriptions", "id", "count"),
    ("transactions", "id", "count"),
]

failures = []
passes = []


def check(label, ok, detail=""):
    (passes if ok else failures).append((label, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))


def load(path):
    """Return a connection to an isolated copy of the input."""
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    tmp.close()
    if path.endswith(".sql"):
        script = open(path, encoding="utf-8").read()
        db = sqlite3.connect(tmp.name)
        db.executescript(script)
        db.commit()
        return db, tmp.name
    with open(path, "rb") as src, open(tmp.name, "wb") as dst:
        dst.write(src.read())
    db = sqlite3.connect(tmp.name)
    return db, tmp.name


def apply_pending_column_migrations(db):
    """Bring the source to the state migration 002 expects.

    archived_at is added by migrations/add_archived_at_to_subscriptions.sql, a
    separate file applied by hand. Older exports lack it, so apply it here
    rather than let 002 fail with a confusing "no such column".
    """
    cols = {r[1] for r in db.execute("PRAGMA table_info(subscriptions)")}
    if "archived_at" not in cols:
        db.execute("ALTER TABLE subscriptions ADD COLUMN archived_at TEXT")
        db.commit()
        return ["add_archived_at_to_subscriptions.sql"]
    return []


def snapshot(db):
    """Collect everything the post-migration state must preserve."""
    snap = {}
    for table, _, _ in TABLES:
        snap[table] = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    snap["money"] = dict(
        db.execute(
            "SELECT currency, CAST(ROUND(SUM(amount) * 100) AS INTEGER) "
            "FROM transactions GROUP BY currency"
        ).fetchall()
    )
    snap["category_tree"] = db.execute(
        "SELECT id, parent_id, name, type FROM categories ORDER BY id"
    ).fetchall()
    snap["item_linked_ids"] = [r[0] for r in db.execute(
        "SELECT t.id FROM transactions t JOIN items i ON i.id = t.item_id AND i.user_id = t.user_id")]
    snap["item_linked"] = len(snap["item_linked_ids"])
    snap["recorded_prices"] = dict(
        db.execute(
            "SELECT id, CAST(ROUND(unit_price * 100) AS INTEGER) "
            "FROM transactions WHERE item_id IS NOT NULL AND unit_price IS NOT NULL"
        ).fetchall()
    )
    # Every row that recorded a price must keep it, item-linked or not. The
    # 002 migration INSERTs into item_prices with a JOIN on items, so a priced
    # row with item_id IS NULL is dropped silently; without this check the
    # recorded_prices comparison above cannot see that loss.
    snap["priced_ids"] = [r[0] for r in db.execute(
        "SELECT id FROM transactions WHERE unit_price IS NOT NULL ORDER BY id")]
    snap["priced_without_item"] = [r[0] for r in db.execute(
        "SELECT id FROM transactions WHERE unit_price IS NOT NULL AND item_id IS NULL ORDER BY id")]
    # v2 drops subscriptions.last_renewed_at on the theory that it equals
    # MAX(transactions.date) for the subscription. That only holds if the
    # renewal transaction is identifiable, which requires the subscription_id
    # backfill below. Any populated value that cannot be derived is data loss,
    # so record both the values and whether a matching renewal transaction
    # exists for each.
    snap["last_renewed"] = dict(
        db.execute(
            "SELECT id, last_renewed_at FROM subscriptions WHERE last_renewed_at IS NOT NULL"
        ).fetchall()
    )
    snap["renewal_tx_by_sub"] = dict(
        db.execute(
            "SELECT s.id, COUNT(t.id) FROM subscriptions s "
            "JOIN transactions t ON t.user_id = s.user_id "
            "  AND t.description = 'Subscription renewal: ' || s.name "
            "GROUP BY s.id"
        ).fetchall()
    )
    snap["per_user_tx"] = dict(
        db.execute("SELECT user_id, COUNT(*) FROM transactions GROUP BY user_id").fetchall()
    )
    snap["per_user_money"] = dict(
        db.execute(
            "SELECT user_id, SUM(CAST(ROUND(amount * 100) AS INTEGER)) "
            "FROM transactions GROUP BY user_id"
        ).fetchall()
    )
    return snap


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    source = sys.argv[1]
    if not os.path.exists(source):
        print(f"no such file: {source}")
        return 2
    if not os.path.exists(SCHEMA):
        print(f"cannot find {SCHEMA} — run from backend-ts/")
        return 2

    print(f"source: {source}\n")
    db, tmp_path = load(source)
    db.execute("PRAGMA foreign_keys = ON")

    pending = apply_pending_column_migrations(db)
    if pending:
        print(f"applied pending column migrations first: {', '.join(pending)}\n")

    print("=== BEFORE (v1) ===")
    before = snapshot(db)
    for table, _, _ in TABLES:
        print(f"  {table}: {before[table]}")
    print(f"  item-linked transactions: {before['item_linked']}")
    print(f"  money by currency: {before['money']}")

    print("\n=== APPLYING MIGRATION ===")
    try:
        db.executescript(open(SCHEMA, encoding="utf-8").read())
        db.commit()
        for later in LATER_MIGRATIONS:
            if os.path.exists(later):
                db.executescript(open(later, encoding="utf-8").read())
                db.commit()
                print(f"  applied {later}")
        print("  migration applied")
    except sqlite3.Error as exc:
        print(f"  MIGRATION FAILED: {type(exc).__name__}: {exc}")
        print(f"  (working copy kept at {tmp_path})")
        return 1

    print("\n=== AFTER (v2) ===")
    for table, _, _ in TABLES:
        print(f"  {table}: {db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]}")
    print(f"  item_prices: {db.execute('SELECT COUNT(*) FROM item_prices').fetchone()[0]}")
    print(f"  exchange_rates: {db.execute('SELECT COUNT(*) FROM exchange_rates').fetchone()[0]}")

    print("\n=== PRESERVATION ===")
    for table, _, _ in TABLES:
        now = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        check(f"{table} row count", now == before[table], f"{before[table]} -> {now}")

    money_after = dict(
        db.execute("SELECT currency, SUM(amount_cents) FROM transactions GROUP BY currency").fetchall()
    )
    check("money preserved per currency", money_after == before["money"],
          f"{money_after}")

    per_user_after = dict(
        db.execute("SELECT user_id, COUNT(*) FROM transactions GROUP BY user_id").fetchall()
    )
    check("transactions per user", per_user_after == before["per_user_tx"], f"{per_user_after}")

    money_user_after = dict(
        db.execute("SELECT user_id, SUM(amount_cents) FROM transactions GROUP BY user_id").fetchall()
    )
    check("money per user", money_user_after == before["per_user_money"])

    cats_after = db.execute(
        "SELECT id, parent_id, name, type FROM categories ORDER BY id"
    ).fetchall()
    check("category tree unchanged", cats_after == before["category_tree"],
          f"{len(cats_after)} rows")

    prices = db.execute("SELECT COUNT(*) FROM item_prices").fetchone()[0]
    check("one price row per item-linked transaction",
          prices == before["item_linked"], f"{before['item_linked']} -> {prices}")

    linked_ids = set(before["item_linked_ids"])
    price_tx_ids = {r[0] for r in db.execute(
        "SELECT transaction_id FROM item_prices WHERE transaction_id IS NOT NULL")}
    check("every item-linked transaction has its price row",
          linked_ids == price_tx_ids,
          f"missing={sorted(linked_ids - price_tx_ids)[:5]} extra={sorted(price_tx_ids - linked_ids)[:5]}")

    recorded_after = dict(db.execute(
        "SELECT transaction_id, unit_price_cents FROM item_prices WHERE transaction_id IS NOT NULL"))
    rec = before["recorded_prices"]
    check("recorded unit prices verbatim",
          all(recorded_after.get(k) == v for k, v in rec.items()),
          f"{len(rec)} rows compared")

    priced_ids = set(before["priced_ids"])
    missing_priced = sorted(priced_ids - price_tx_ids)
    check("every v1 row with a unit_price produced an item_prices row",
          not missing_priced,
          f"{len(priced_ids)} priced rows -> {len(priced_ids & price_tx_ids)} kept"
          + (f", lost={missing_priced}" if missing_priced else ""))
    if before["priced_without_item"]:
        check("priced rows had an item to attach to (pre-flight)",
              False,
              f"item_id IS NULL on {before['priced_without_item']} — link these to items "
              f"before migrating, or the price is dropped")

    # Every subscription renewal that v1 recorded must still be visible in v2,
    # unless losing it was an explicit, reviewed decision.
    #
    # v2 derives a renewal as MAX(date) over transactions carrying its
    # subscription_id, so it survives only if the migration linked one.
    # migration 002 backfills that link from the description the renew endpoint
    # writes ('Subscription renewal: <name>').
    #
    # ACCEPTED LOSS: subscription 5 (Zenless Zone Zero) had
    # last_renewed_at = 2026-08-05T08:43:32.195Z with no transaction anywhere
    # that could be it: the only candidate that day (tx 346, 50 CNY,
    # description 'https://www.micuapi.ai/') disagrees on amount (50 vs the
    # subscription's 30) and does not match the renewal description. Linking it
    # would be a guess. The decision was to keep the schema simple and accept
    # losing this one timestamp. Remove an entry here if the data is ever
    # repaired by hand.
    ACCEPTED_LOSSES = {
        5: "2026-08-05T08:43:32.195Z",
    }

    derived = dict(db.execute(
        "SELECT subscription_id, MAX(date) FROM transactions "
        "WHERE subscription_id IS NOT NULL GROUP BY subscription_id"))
    orphaned_renewals = []
    accepted = []
    for sub_id, renewed_at in before["last_renewed"].items():
        if sub_id in derived:
            continue
        if ACCEPTED_LOSSES.get(sub_id) == renewed_at:
            accepted.append((sub_id, renewed_at))
        elif before["renewal_tx_by_sub"].get(sub_id):
            orphaned_renewals.append((sub_id, renewed_at, "renewal tx exists but was not linked"))
        else:
            orphaned_renewals.append((sub_id, renewed_at, "no identifiable renewal transaction"))
    check("every recorded subscription renewal is still derivable",
          not orphaned_renewals,
          f"{len(before['last_renewed'])} populated last_renewed_at -> "
          f"{len(before['last_renewed']) - len(orphaned_renewals) - len(accepted)} derivable"
          + (f", {len(accepted)} accepted loss(es) {accepted}" if accepted else "")
          + (f"; LOST {[(s, t) for s, t, _ in orphaned_renewals]}"
             if orphaned_renewals else ""))
    for sub_id, renewed_at, why in orphaned_renewals:
        check(f"  subscription {sub_id} last_renewed_at preserved", False,
              f"{renewed_at!r} — {why}")

    print("\n=== INTEGRITY ===")
    orphans = [
        ("transactions.user_id", "SELECT COUNT(*) FROM transactions WHERE user_id NOT IN (SELECT id FROM users)"),
        ("transactions.category_id", "SELECT COUNT(*) FROM transactions WHERE category_id NOT IN (SELECT id FROM categories)"),
        ("transactions.subscription_id", "SELECT COUNT(*) FROM transactions WHERE subscription_id IS NOT NULL AND subscription_id NOT IN (SELECT id FROM subscriptions)"),
        ("item_prices.item_id", "SELECT COUNT(*) FROM item_prices WHERE item_id NOT IN (SELECT id FROM items)"),
        ("item_prices.transaction_id", "SELECT COUNT(*) FROM item_prices WHERE transaction_id IS NOT NULL AND transaction_id NOT IN (SELECT id FROM transactions)"),
        ("item_prices.user_id", "SELECT COUNT(*) FROM item_prices WHERE user_id NOT IN (SELECT id FROM users)"),
        ("categories.parent_id", "SELECT COUNT(*) FROM categories WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM categories)"),
        ("categories.user_id", "SELECT COUNT(*) FROM categories WHERE user_id NOT IN (SELECT id FROM users)"),
    ]
    for label, sql in orphans:
        n = db.execute(sql).fetchone()[0]
        check(f"no orphan {label}", n == 0, str(n))

    check("PRAGMA integrity_check", db.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    check("PRAGMA foreign_key_check", not fk, str(fk[:3]) if fk else "")

    print("\n=== NEW CONSTRAINTS ACTUALLY BITE ===")
    store = db.execute("SELECT user_id, name, type FROM categories WHERE parent_id IS NULL LIMIT 1").fetchone()
    if store:
        uid, name, ctype = store
        try:
            db.execute("INSERT INTO categories (user_id, name, type, parent_id) VALUES (?,?,?,NULL)",
                       (uid, name, ctype))
            check("duplicate top-level category rejected", False, "insert succeeded")
        except sqlite3.IntegrityError:
            check("duplicate top-level category rejected", True, f"'{name}'")
    used = db.execute("SELECT category_id FROM transactions LIMIT 1").fetchone()
    if used:
        try:
            db.execute("DELETE FROM categories WHERE id = ?", (used[0],))
            check("deleting a category in use is blocked", False, "delete succeeded")
        except sqlite3.IntegrityError:
            check("deleting a category in use is blocked", True, f"category {used[0]}")

    print("\n=== DEAD TABLES GONE ===")
    remaining = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'"
    )}
    # change_log was dropped from the design: it existed only to make invisible
    # AI edits traceable, which is not a requirement. It is listed here so that
    # it cannot reappear by accident.
    for dead in ("utility_readings", "utility_types", "utility_addresses",
                 "ai_conversations", "subscription_renewals", "change_log"):
        check(f"{dead} dropped", dead not in remaining)
    check("no leftover *_old tables",
          not any(t.endswith("_old") for t in remaining), str(sorted(remaining)))

    # 004: the whole point is that a price is only ever compared in its own
    # unit, and that a merchant is an entity rather than a string. Both are
    # worthless if the backfill left values that do not resolve.
    if "units" in remaining:
        unnormalised = db.execute(
            "SELECT COUNT(*) FROM item_prices "
            "WHERE unit IS NOT NULL AND unit NOT IN (SELECT code FROM units)").fetchone()[0]
        check("every item_prices.unit is a known code", unnormalised == 0, str(unnormalised))
        # unit_raw must retain what was said, so normalising never loses wording.
        lost_raw = db.execute(
            "SELECT COUNT(*) FROM item_prices WHERE unit IS NOT NULL AND unit_raw IS NULL"
        ).fetchone()[0]
        check("normalising the unit kept the original wording", lost_raw == 0, str(lost_raw))
        orphan_merchant = db.execute(
            "SELECT COUNT(*) FROM item_prices "
            "WHERE merchant_id IS NOT NULL AND merchant_id NOT IN (SELECT id FROM merchants)"
        ).fetchone()[0]
        check("no item_prices row points at a missing merchant", orphan_merchant == 0,
              str(orphan_merchant))
        # The FK is what makes an unknown unit fail loudly; ALTER TABLE cannot
        # create it, so its presence proves the rebuild actually happened.
        unit_fk = any(r[2] == "units" and r[3] == "unit"
                      for r in db.execute("PRAGMA foreign_key_list(item_prices)"))
        check("item_prices.unit is constrained to units(code)", unit_fk,
              "" if unit_fk else "ALTER TABLE cannot add REFERENCES; the rebuild did not run")

    print("\n=== SCHEMA ===")
    print(f"  tables ({len(remaining)}): {', '.join(sorted(remaining))}")
    n_idx = db.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
    ).fetchone()[0]
    print(f"  indexes: {n_idx}")

    # db/schema.sql is the path a NEW database takes, so it must build the same
    # schema this migration just built. Compared STRUCTURALLY rather than as DDL
    # text: the stored `sql` includes comments and the exact spelling of
    # `CREATE TABLE` / quoting, none of which change behaviour, and comments
    # cannot be stripped safely because they may contain quoted defaults. What
    # matters is columns, types, nullability, defaults, keys and indexes.
    def signature(conn):
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' ORDER BY name")]
        sig = {}
        for t in tables:
            cols = tuple(
                (r[1], (r[2] or '').upper(), r[3], r[4], r[5])
                for r in conn.execute(f'PRAGMA table_info("{t}")')
            )
            fks = tuple(sorted(
                (r[2], r[3], r[4], r[5], r[6])
                for r in conn.execute(f'PRAGMA foreign_key_list("{t}")')
            ))
            # `PRAGMA index_list` has gained columns across SQLite versions, so
            # index columns are read by name and the indexed expressions are
            # pulled from each index's own DDL.
            idx = []
            for r in conn.execute(f'PRAGMA index_list("{t}")'):
                row = dict(zip(("seq", "name", "unique", "origin", "partial"), r))
                isql = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='index' AND name=?",
                    (row["name"],)).fetchone()
                idx.append((row["name"], row["unique"], row.get("partial"),
                            re.sub(r"\s+", " ", (isql[0] if isql and isql[0] else "")).strip()))
            idx = tuple(sorted(idx))
            ddl = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (t,)
            ).fetchone()
            # CHECK constraints decide what the database accepts, so they are
            # part of the signature even though PRAGMA does not expose them.
            checks = tuple(sorted(re.findall(
                r"CHECK\s*\([^)]*\)", re.sub(r"\s+", " ", ddl[0] or ""), re.I)))
            views = tuple(sorted(
                (r[0], re.sub(r"\s+", " ", r[1] or "").strip())
                for r in conn.execute(
                    "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name")))
            sig[t] = (cols, fks, idx, checks, views)
        return sig

    if os.path.exists(SCHEMA_SQL):
        fresh = sqlite3.connect(":memory:")
        try:
            fresh.executescript(open(SCHEMA_SQL, encoding="utf-8").read())
            A, B = signature(fresh), signature(db)
            only_fresh = sorted(set(A) - set(B))
            only_migrated = sorted(set(B) - set(A))
            differing = []
            for t in sorted(set(A) & set(B)):
                if A[t] == B[t]:
                    continue
                labels = ("columns", "foreign keys", "indexes", "checks", "views")
                detail = []
                for lab, x, y in zip(labels, A[t], B[t]):
                    if x == y:
                        continue
                    if isinstance(x, tuple) and isinstance(y, tuple):
                        # Show the offending entries, not just counts: a count
                        # difference of zero is meaningless to a reader.
                        only_a = [i for i in x if i not in y]
                        only_b = [i for i in y if i not in x]
                        detail.append(f"{lab}: only here={only_a} only migrated={only_b}")
                    else:
                        detail.append(f"{lab}: {x!r} vs {y!r}")
                differing.append((t, detail))
            check(f"{SCHEMA_SQL} matches the migrated schema",
                  not only_fresh and not only_migrated and not differing,
                  f"{len(A)} tables; only-in-{os.path.basename(SCHEMA_SQL)}={only_fresh} "
                  f"only-in-migration={only_migrated} differing={differing}")
        except sqlite3.Error as exc:
            check(f"{SCHEMA_SQL} applies to an empty database", False, str(exc))
        finally:
            fresh.close()
    else:
        print(f"  ({SCHEMA_SQL} not found — skipping the fresh-install comparison)")

    print("\n" + "=" * 60)
    print(f"RESULT: {len(passes)} passed, {len(failures)} failed")
    for label, detail in failures:
        print(f"  FAILED: {label}" + (f" — {detail}" if detail else ""))
    db.close()
    if not failures:
        os.unlink(tmp_path)
    else:
        print(f"working copy kept at: {tmp_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
