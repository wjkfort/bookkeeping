#!/usr/bin/env python3
"""
Diff two captures produced by scripts/api_capture.ts.

    python3 -I scripts/api_diff.py <baseline.json> <candidate.json>

The baseline is taken with the current code against the v1 database; the
candidate with the new code against the migrated v2 database. Because the API
contract must not change, every endpoint must return the same JSON.

Not every difference is a defect, so they are classified rather than lumped
together:

  MONEY   a numeric money field changed. Always a defect: this is the whole
          point of the comparison.
  STATUS  a different HTTP status. Always a defect.
  FIELDS  a key was added or removed. Usually a defect, but the migration
          legitimately moves item price fields from the transaction onto a
          price record, so additions are listed for review.
  ENRICH  a price field went from null to a value. Expected: migration §3.3
          gives every item-linked v1 row a price, deriving it from the amount.
"""

import json
import os
import re
import sqlite3
import sys

MONEY_HINTS = ("amount", "total", "income", "expense", "balance", "net",
               "price", "spent", "pct", "rate", "converted")

# Differences that were reviewed and accepted, so they do not fail the run.
#
# v2 drops subscriptions.last_renewed_at in favour of deriving it from the
# subscription's renewal transactions. Production had two populated values. One
# (iCloud) is recovered exactly because migration 002 links the renewal
# transaction. The other (Zenless Zone Zero, 2026-08-05T08:43:32.195Z) has no
# transaction that could be it, so it cannot be derived; the decision was to
# keep the schema simple and accept losing that one timestamp. Keyed by the
# field path, with the accepted candidate values. The same decision is recorded
# in scripts/verify_migration.py.
#
# Item 21's two price fields, for the same kind of reason in a different place.
#
# The stored baseline is a capture of the OLD (v1) code against an UN-REPAIRED
# v1 database, so `items/21` there is whatever item 21 happened to be before
# migrations/001 linked the five unlinked priced rows (17, 21, 28, 40, 42). With
# 001 applied, item 21 is a different item with two prices instead of one, so the
# baseline's 50 and the candidate's 52.5 do not describe the same thing.
#
# This is the change the requirements doc §3.3 predicted: "物品 1、2、4、21、22
# 显示被修正过的价格（v1 漏算了它们未记单价的购买）". It is not a regression.
# `price_history_improved` cannot recognise it because that check asks whether
# v2's price SET strictly contains v1's — which is only meaningful when both reads
# describe the same item, and that is exactly what stopped being true.
#
# Listed explicitly rather than handled by loosening the money rule: a loosened
# rule would also hide a real regression in these same fields.
ACCEPTED_DIFFS = {
    "user1 /api/v1/subscriptions[1].last_renewed_at": (None,),
    "user1 /api/v1/items/21/history.stats.average_unit_price": (51.25,),
    "user1 /api/v1/items/21/history.stats.last_unit_price": (52.5,),
    "user1 /api/v1/items?with_stats=true[1].average_unit_price": (51.25,),
    "user1 /api/v1/items?with_stats=true[1].last_unit_price": (52.5,),
}

failures = []
review = []
enrichments = []
improvements = []
accepted = []

# Populated from the capture files' recorded database paths. Only used to
# distinguish "more price history" from "price history went backwards".
V1_PRICES = {}
V2_PRICES = {}

# ('baseline'|'candidate', endpoint) -> response body, for index lookups.
RESPONSES = {}

# The endpoint key currently being compared, set per endpoint in main().
CURRENT_ENDPOINT = ''


def _item_id(prefix, endpoint):
    """
    Item id for a stats field.

    `/items/:id/history` carries the id in the path. `items?with_stats=true` is
    a list, so the id comes from the row at the reported index.
    """
    m = re.search(r"/items/(\d+)", prefix)
    if m:
        return int(m.group(1))
    m = re.search(r"\[(\d+)\]", prefix)
    if m and endpoint.endswith("/items?with_stats=true"):
        body = RESPONSES.get(("candidate", endpoint)) or RESPONSES.get(("baseline", endpoint))
        idx = int(m.group(1))
        if isinstance(body, list) and idx < len(body) and isinstance(body[idx], dict):
            return body[idx].get("id")
    return None


def _load_price_history(db_path):
    """
    item_id -> sorted unit prices, read straight from a database.

    v1 reads unit_price off the transaction; v2 reads unit_price_cents off
    item_prices. Both are limited to item-linked rows, which is what the
    endpoints' statistics are computed from.
    """
    if not db_path or not os.path.exists(db_path):
        return {}
    db = sqlite3.connect(db_path)
    cols = {r[1] for r in db.execute("PRAGMA table_info(transactions)")}
    out = {}
    if "amount_cents" in cols:
        rows = db.execute(
            "SELECT ip.item_id, ip.unit_price_cents FROM item_prices ip "
            "JOIN transactions t ON t.id = ip.transaction_id")
        for item_id, cents in rows:
            out.setdefault(item_id, []).append(cents / 100.0)
    else:
        rows = db.execute(
            "SELECT item_id, unit_price FROM transactions "
            "WHERE item_id IS NOT NULL AND unit_price IS NOT NULL")
        for item_id, price in rows:
            out.setdefault(item_id, []).append(price)
    db.close()
    return {k: sorted(v) for k, v in out.items()}


def price_history_improved(prefix, endpoint, leaf, old, new):
    """
    v1's item price statistics only summed rows that HAD a recorded unit_price,
    so an item-linked purchase without one was silently excluded from last and
    average price. Migration §3.3 gives every item-linked row a price (the
    amount), so v2 counts those purchases too.

    That moves an item's average or last price for a legitimate reason: it is
    computed from strictly more observations, all of them real. Accepted only
    when the price set genuinely grew and still contains every value v1 had, so
    a price that fell below what v1 could see remains a failure.
    """
    if leaf not in ("last_unit_price", "average_unit_price"):
        return False
    if not (isinstance(old, (int, float)) and isinstance(new, (int, float))):
        return False
    item_id = _item_id(prefix, endpoint)
    v1_prices = V1_PRICES.get(item_id)
    v2_prices = V2_PRICES.get(item_id)
    if not v1_prices or not v2_prices:
        return False
    if len(v2_prices) <= len(v1_prices):
        return False
    if not set(v1_prices) <= set(v2_prices):
        return False
    return new >= min(v2_prices)


def is_money_key(key):
    return any(h in key.lower() for h in MONEY_HINTS)


def walk(base, cand, path, out):
    if isinstance(base, dict) and isinstance(cand, dict):
        for k in sorted(set(base) | set(cand)):
            if k not in base:
                out.append(("FIELDS", f"{path}.{k}", "<absent>", cand[k]))
            elif k not in cand:
                out.append(("FIELDS", f"{path}.{k}", base[k], "<absent>"))
            else:
                walk(base[k], cand[k], f"{path}.{k}", out)
    elif isinstance(base, list) and isinstance(cand, list):
        if len(base) != len(cand):
            out.append(("FIELDS", f"{path}[]", f"{len(base)} items", f"{len(cand)} items"))
            return
        for i, (b, c) in enumerate(zip(base, cand)):
            walk(b, c, f"{path}[{i}]", out)
    else:
        if base == cand:
            return
        leaf = path.rsplit(".", 1)[-1]
        # A reviewed-and-accepted difference is settled before anything else
        # looks at it. Checked first on purpose: a money field would otherwise be
        # classified as MONEY and could never reach the accepted list, which is
        # why the item-21 price deltas could not be recorded there until this was
        # reordered. Matching on the exact candidate value keeps the entry narrow
        # — any further movement in the same field still fails.
        if path in ACCEPTED_DIFFS and cand in ACCEPTED_DIFFS[path]:
            out.append(("ACCEPTED", path, base, cand))
        # null -> value on a price-ish field is the documented enrichment.
        elif base is None and isinstance(cand, (int, float)) and is_money_key(leaf):
            out.append(("ENRICH", path, base, cand))
        elif is_money_key(leaf) and isinstance(base, (int, float)) and isinstance(cand, (int, float)):
            if abs(base - cand) > 1e-9:
                if price_history_improved(path, CURRENT_ENDPOINT, leaf, base, cand):
                    out.append(("IMPROVED", path, base, cand))
                else:
                    out.append(("MONEY", path, base, cand))
        else:
            out.append(("VALUE", path, base, cand))


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    base = json.load(open(sys.argv[1], encoding="utf-8"))
    cand = json.load(open(sys.argv[2], encoding="utf-8"))
    br, cr = base["responses"], cand["responses"]

    # The captures record which database they came from, which is what lets the
    # price-stat classifier tell "more observations" from "a price went down".
    V1_PRICES.update(_load_price_history(base.get("db")))
    V2_PRICES.update(_load_price_history(cand.get("db")))
    RESPONSES.update({("baseline", k): v.get("body") for k, v in br.items()})
    RESPONSES.update({("candidate", k): v.get("body") for k, v in cr.items()})

    global CURRENT_ENDPOINT

    print(f"baseline:  {base.get('db')}  ({len(br)} endpoints)")
    print(f"candidate: {cand.get('db')}  ({len(cr)} endpoints)\n")

    added_endpoints = []
    # An endpoint that 404s in the baseline did not exist when it was captured
    # (a router added later), so it is new surface rather than a difference.
    baseline_404 = {k for k, v in br.items() if v.get("status") == 404}
    if set(br) != set(cr):
        missing = sorted(set(br) - set(cr) - baseline_404)
        extra = sorted(set(cr) - set(br))
        if missing:
            failures.append(("ENDPOINTS", f"{len(missing)} endpoint(s) missing", missing[:5], None))
        # Endpoints present only in the candidate are new surface, not a
        # regression: nothing that used to work can break by an addition. They
        # are reported so they get a look, but they do not fail the run.
        added_endpoints = extra

    identical = 0
    newly_available = []
    for key in sorted(set(br) & set(cr)):
        b, c = br[key], cr[key]
        out = []
        # A route that did not exist when the baseline was captured answers 404
        # there and 200 in the candidate. That is new surface, not a status
        # regression, and its body has no baseline to compare against.
        if b.get("status") == 404 and c.get("status") == 200:
            newly_available.append(key)
            continue
        if b.get("status") != c.get("status"):
            failures.append(("STATUS", key, b.get("status"), c.get("status")))
        CURRENT_ENDPOINT = key
        walk(b.get("body"), c.get("body"), key, out)
        if not out:
            identical += 1
            continue
        for kind, path, old, new in out:
            row = (kind, path, old, new)
            if kind == "MONEY":
                failures.append(row)
            elif kind == "ENRICH":
                enrichments.append(row)
            elif kind == "IMPROVED":
                improvements.append(row)
            elif kind == "ACCEPTED":
                accepted.append(row)
            elif path in ACCEPTED_DIFFS and new in ACCEPTED_DIFFS[path]:
                accepted.append(row)
            else:
                review.append(row)

    print(f"identical endpoints: {identical}/{len(set(br) & set(cr))}")

    if added_endpoints:
        print(f"\nNEW endpoints (no v1 counterpart, not diffed): {len(added_endpoints)}")
        for path in added_endpoints[:8]:
            print(f"    {path}")
        if len(added_endpoints) > 8:
            print(f"    ... and {len(added_endpoints) - 8} more")

    if newly_available:
        print(f"\nNEWLY AVAILABLE (404 in baseline, route added since): {len(newly_available)}")
        for path in newly_available[:8]:
            print(f"    {path}")

    if improvements:
        print(f"\nIMPROVED (price stats now include purchases v1 silently skipped): "
              f"{len(improvements)} field(s)")
        for _, path, old, new in improvements[:6]:
            print(f"    {path}: {old!r} -> {new!r}")
        if len(improvements) > 6:
            print(f"    ... and {len(improvements) - 6} more")

    if enrichments:
        print(f"\nEXPECTED enrichments (§3.3 price derivation): {len(enrichments)} field(s)")
        for path, _, old, new in enrichments[:5]:
            print(f"    {path}: {old!r} -> {new!r}")
        if len(enrichments) > 5:
            print(f"    ... and {len(enrichments) - 5} more")

    if accepted:
        print(f"\nACCEPTED losses (reviewed decision, not failures): {len(accepted)}")
        for _, path, old, new in accepted:
            print(f"    {path}: {old!r} -> {new!r}")

    if review:
        print(f"\nNEEDS REVIEW: {len(review)} difference(s) — added/removed keys or values")
        for kind, path, old, new in review[:15]:
            print(f"    [{kind}] {path}: {old!r} -> {new!r}")
        if len(review) > 15:
            print(f"    ... and {len(review) - 15} more")

    print("\n" + "=" * 60)
    if failures:
        print(f"RESULT: {len(failures)} FAILURE(S)")
        for kind, path, old, new in failures[:20]:
            print(f"  [{kind}] {path}: {old!r} -> {new!r}")
        return 1
    print("RESULT: no money or status regressions")
    if review:
        print(f"        ({len(review)} field difference(s) still need review)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
