#!/usr/bin/env python3
"""
Regression oracle for the v1 -> v2 money change.

The API contract does NOT change: the API keeps accepting and returning
decimals while the database stores integer cents. So for the same real data,
the numbers the endpoints produce must be identical before and after. This
script replays the money arithmetic from `src/api/summary.ts`,
`src/api/transactions.ts` and `src/api/items.ts` against both databases and
compares.

    python3 -I scripts/compare_money.py <v1.sqlite> <v2.sqlite>

Exit code 0 means every money figure is identical. Any difference is printed
with both values, so a 100x unit error or a rounding drift is obvious.

Rates are read once from each database and held fixed (the endpoints cache
them for 24h, so a single snapshot is the honest comparison). Sums are done in
a fixed order because the v1 endpoint relies on the SQL row order and
floating-point accumulation is order sensitive; ordering both sides the same
way compares the arithmetic, not the query planner.
"""

import json
import sqlite3
import sys

failures = []
checks = 0

DEFAULT_RATE = 1.0


def check(label, old, new, tol=0.0):
    """tol=0 means exact; money is rounded to the cent on both sides anyway."""
    global checks
    checks += 1
    same = (old == new) if tol == 0.0 else (
        old is not None and new is not None and abs(old - new) <= tol)
    if not same:
        failures.append((label, old, new))
    print(f"  [{'PASS' if same else 'FAIL'}] {label}"
          + ("" if same else f"  — v1={old!r}  v2={new!r}"))


def load_rates(db, target):
    """getExchangeRate(): latest row per pair, falling back to 1:1."""
    rates = {}
    for base, tgt, rate in db.execute(
        "SELECT base_currency, target_currency, rate FROM exchange_rates"
    ):
        rates[(base, tgt)] = rate
    return rates


def user_ids(db):
    return [r[0] for r in db.execute("SELECT id FROM users ORDER BY id")]


def converted(amount, currency, target, rates):
    """`amount * rate` as the endpoints do it, unrounded."""
    if currency == target:
        return amount
    return amount * rates.get((currency, target), DEFAULT_RATE)


def round2(x):
    """Math.round(x * 100) / 100"""
    return round(x * 100) / 100


def cents_to_money(cents):
    """Boundary conversion the v2 API performs before serialising."""
    return cents / 100


# --------------------------------------------------------------------------
# GET /summary   (summary.ts:16-69)
# --------------------------------------------------------------------------
def summary(db, uid, target, v2):
    rates = load_rates(db, target)
    if v2:
        rows = db.execute(
            "SELECT t.amount_cents, t.currency, c.type FROM transactions t "
            "JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? "
            "ORDER BY t.id", (uid,)).fetchall()
    else:
        rows = db.execute(
            "SELECT t.amount, t.currency, c.type FROM transactions t "
            "JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? "
            "ORDER BY t.id", (uid,)).fetchall()

    income = expense = 0
    for amount, currency, ctype in rows:
        if v2:
            amount = cents_to_money(amount)
        amount = converted(amount, currency, target, rates)
        if ctype == 'income':
            income += amount
        else:
            expense += amount
    return {
        "total_income": round2(income),
        "total_expense": round2(expense),
        "balance": round2(income - expense),
        "currency": target,
    }


# --------------------------------------------------------------------------
# GET /summary/monthly   (summary.ts:90-160)
# --------------------------------------------------------------------------
def monthly(db, uid, target, v2):
    rates = load_rates(db, target)
    amount_col = "t.amount_cents" if v2 else "t.amount"
    rows = db.execute(
        f"SELECT t.date, {amount_col}, t.currency, c.type FROM transactions t "
        "JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? "
        "ORDER BY t.id", (uid,)).fetchall()
    buckets = {}
    for date, amount, currency, ctype in rows:
        if v2:
            amount = cents_to_money(amount)
        amount = converted(amount, currency, target, rates)
        month = date[:7]
        b = buckets.setdefault(month, {"income": 0.0, "expense": 0.0})
        if ctype == 'income':
            b["income"] += amount
        else:
            b["expense"] += amount
    out = {}
    for month, b in buckets.items():
        out[month] = {
            "income": round2(b["income"]),
            "expense": round2(b["expense"]),
            "net": round2(b["income"] - b["expense"]),
        }
    return out


# --------------------------------------------------------------------------
# GET /summary/categories   (summary.ts:175-278)
#
# level=child groups by category, level=parent folds a child into its parent.
# --------------------------------------------------------------------------
def categories(db, uid, target, v2, level):
    rates = load_rates(db, target)
    amount_col = "t.amount_cents" if v2 else "t.amount"
    rows = db.execute(
        f"SELECT c.id, c.name, c.parent_id, p.id, p.name, {amount_col}, t.currency "
        "FROM transactions t JOIN categories c ON t.category_id = c.id "
        "LEFT JOIN categories p ON c.parent_id = p.id "
        "WHERE t.user_id = ? AND c.type = 'expense' ORDER BY t.id", (uid,)).fetchall()
    buckets = {}
    for cid, cname, parent_id, pid, pname, amount, currency in rows:
        if v2:
            amount = cents_to_money(amount)
        amount = converted(amount, currency, target, rates)
        use_parent = level == 'parent' and pid is not None
        key = pid if use_parent else cid
        name = pname if use_parent else cname
        b = buckets.setdefault(key, {"name": name, "amount": 0.0})
        b["amount"] += amount
    total = sum(b["amount"] for b in buckets.values())
    data = [
        {"category_id": k, "name": b["name"], "amount": round2(b["amount"]),
         "pct": round((b["amount"] / total) * 1000) / 10 if total > 0 else 0}
        for k, b in buckets.items()
    ]
    data.sort(key=lambda d: (-d["amount"], d["category_id"]))
    return {"currency": target, "total": round2(total), "categories": data}


# --------------------------------------------------------------------------
# GET /transactions/stats   (transactions.ts:70-112)
# --------------------------------------------------------------------------
def tx_stats(db, uid, target, v2):
    col = "t.amount_cents" if v2 else "t.amount"
    rows = db.execute(
        f"SELECT c.type, {col} FROM transactions t "
        "JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? "
        "ORDER BY t.id", (uid,)).fetchall()
    income = expense = 0
    for ctype, amount in rows:
        if v2:
            amount = cents_to_money(amount)
        if ctype == 'income':
            income += amount
        else:
            expense += amount
    return {"income": round2(income), "expense": round2(expense),
            "net": round2(income - expense)}


# --------------------------------------------------------------------------
# GET /items/:id/history   (items.ts:69-118)
# --------------------------------------------------------------------------
def _history_rows(db, uid, item_id, v2):
    """The (amount, unit_price, quantity, unit, date) tuples the endpoint sees."""
    if v2:
        # v2: the item's price observations come from item_prices; the amount
        # spent still comes from the transaction.
        rows = db.execute(
            "SELECT t.amount_cents, ip.unit_price_cents, ip.quantity, ip.unit, t.date "
            "FROM transactions t "
            "LEFT JOIN item_prices ip ON ip.transaction_id = t.id "
            "WHERE ip.item_id = ? AND t.user_id = ? "
            "ORDER BY t.date DESC, t.created_at DESC", (item_id, uid)).fetchall()
        return [(cents_to_money(a), (None if up is None else cents_to_money(up)), q, u, d)
                for a, up, q, u, d in rows]
    rows = db.execute(
        "SELECT amount, unit_price, quantity, unit, date FROM transactions "
        "WHERE item_id = ? AND user_id = ? "
        "ORDER BY date DESC, created_at DESC", (item_id, uid)).fetchall()
    return [(a, up, q, u, d) for a, up, q, u, d in rows]


def item_history(db, uid, item_id, v2):
    tx = _history_rows(db, uid, item_id, v2)

    with_price = [t for t in tx if t[1] is not None]
    with_qty = [t for t in tx if t[2] is not None]
    total_spent = sum(t[0] for t in tx)
    # v1 sourced `unit` from a subquery filtered on `unit IS NOT NULL`
    # (items.ts:27), so "last" means last row that HAS a unit, not simply the
    # newest row — the newest row may have none. Same for last_unit_price
    # (items.ts:24 filters on unit_price IS NOT NULL).
    with_unit = [t for t in tx if t[3] is not None]
    return {
        "count": len(tx),
        "total_purchases": len(tx),
        "total_spent": total_spent,
        "average_price": (total_spent / len(tx)) if tx else 0,
        "last_unit_price": with_price[0][1] if with_price else None,
        "average_unit_price": (sum(t[1] or 0 for t in with_price) / len(with_price))
                              if with_price else None,
        "total_quantity": sum(t[2] or 0 for t in with_qty),
        "unit": with_unit[0][3] if with_unit else None,
        "first_purchase_date": tx[-1][4] if tx else None,
        "last_purchase_date": tx[0][4] if tx else None,
    }


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    v1_path, v2_path = sys.argv[1], sys.argv[2]
    v1 = sqlite3.connect(v1_path)
    v2 = sqlite3.connect(v2_path)

    targets = sorted({r[0] for r in v1.execute("SELECT DISTINCT currency FROM transactions")}
                     | {r[0] for r in v2.execute("SELECT DISTINCT currency FROM transactions")})
    if not targets:
        targets = ["USD"]
    print(f"v1: {v1_path}\nv2: {v2_path}\ncurrencies: {', '.join(targets)}\n")

    uids = sorted(set(user_ids(v1)) | set(user_ids(v2)))
    for uid in uids:
        for target in targets:
            print(f"=== user {uid} / target {target} ===")
            for label, fn in (("/summary", summary),
                              ("/summary/monthly", monthly),
                              ("/transactions/stats", tx_stats)):
                a = fn(v1, uid, target, False)
                b = fn(v2, uid, target, True)
                check(label, a, b)
            for level in ("child", "parent"):
                a = categories(v1, uid, target, False, level)
                b = categories(v2, uid, target, True, level)
                check(f"/summary/categories?level={level}", a, b)

    print("\n=== /items/:id/history ===")
    # Money, row counts and dates must match exactly. The price fields are
    # expected to CHANGE, by design: migration §3.3 gives every item-linked v1
    # row a price row, deriving unit_price from the amount when v1 had none
    # (13 rows here). That strengthens data rather than regressing it, so it is
    # reported separately — but a price that existed in v1 and is missing in v2
    # is a real loss and fails.
    MONEY_KEYS = ("count", "total_purchases", "total_spent", "average_price",
                  "first_purchase_date", "last_purchase_date")
    PRICE_KEYS = ("last_unit_price", "average_unit_price", "total_quantity", "unit")
    enriched = []
    for item_id in sorted({r[0] for r in v1.execute("SELECT id FROM items")}
                          | {r[0] for r in v2.execute("SELECT id FROM items")}):
        a = item_history(v1, uids[0], item_id, False)
        b = item_history(v2, uids[0], item_id, True)
        check(f"item {item_id} money/dates", {k: a[k] for k in MONEY_KEYS},
              {k: b[k] for k in MONEY_KEYS})

        # v1's price statistics only considered rows where unit_price was
        # recorded, so an item-linked purchase with no unit_price was silently
        # left out of last/average/min. Migration §3.3 gives every item-linked
        # row a price (the amount), so those purchases are counted in v2. A
        # change is only a regression if the price SHRANK below everything v1
        # could see; otherwise it is extra history, which is the point.
        v1_prices = [t[1] for t in _history_rows(v1, uids[0], item_id, False) if t[1] is not None]
        v2_prices = [t[1] for t in _history_rows(v2, uids[0], item_id, True) if t[1] is not None]
        gained = [p for p in v2_prices if p not in v1_prices]
        lost = [p for p in v1_prices if p not in v2_prices]
        new_extremes = (
            a["last_unit_price"] is not None
            and b["last_unit_price"] is not None
            and (b["last_unit_price"] < min(v1_prices) or b["average_unit_price"] < min(v1_prices))
        )
        if lost or new_extremes:
            check(f"item {item_id} did not lose price history",
                  {"prices": sorted(v1_prices)}, {"prices": sorted(v2_prices)})
        elif any(a[k] != b[k] for k in PRICE_KEYS):
            enriched.append((item_id, {k: (a[k], b[k]) for k in PRICE_KEYS
                                       if a[k] != b[k]},
                             f"+{len(gained)} observation(s), lowest seen {min(v2_prices) if v2_prices else None}"))

    if enriched:
        print(f"\n  {len(enriched)} item(s) gained price detail (expected, §3.3):")
        for item_id, delta, why in enriched:
            bits = ", ".join(f"{k}: {p!r} -> {q!r}" for k, (p, q) in delta.items())
            print(f"    item {item_id}: {bits}  [{why}]")

    print("\n" + "=" * 60)
    print(f"RESULT: {checks - len(failures)} passed, {len(failures)} failed")
    for label, old, new in failures:
        print(f"  FAILED: {label}\n     v1={json.dumps(old, default=str)[:400]}"
              f"\n     v2={json.dumps(new, default=str)[:400]}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
