#!/usr/bin/env python3
"""
One unit vocabulary, told in four places.

    python3 -I scripts/check_unit_vocabulary.py

Why this exists:

`item_prices.unit` has a real foreign key to `units.code`, so a unit that is not
in that table cannot be stored at all. The vocabulary is nevertheless written
down in four files, and they had drifted apart in both directions:

  * `TransactionFormModal.tsx` offered "gallon" and "lb", which the database does
    not have — choosing either one and saving produced

        FOREIGN KEY constraint failed

    as a raw 500. (Reported from the tea egg entry, where the unit came back as
    the code "piece" and the picker turned out to be a separate, older list.)
  * `g`, `ml` and `bag` could not be chosen in the form at all, even though the
    assistant is explicitly told to use `ml` for anything bought by volume.
  * `zh.json` / `en.json` had no label for `g`, `ml` or `bag` (so the Items page
    would have rendered the raw key, e.g. "units.ml"), and labelled two units
    that no row can ever hold.

Sets are compared, not counts, and a missing list is a failure rather than a
silent pass — otherwise renaming a constant would quietly disable this check.
"""

import json
import os
import re
import sys

# Paths are written repo-relative (they are what the messages print) and resolved
# against the repository root, so this runs the same way from `backend-ts` — which
# is where check.sh puts it — or from the root itself.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCHEMA = "backend-ts/db/schema.sql"
MIGRATION = "backend-ts/migrations/004_normalise_units_merchants.sql"
FORM = "client/src/components/features/TransactionFormModal.tsx"
LOCALES = ["client/src/locales/zh.json", "client/src/locales/en.json"]

SEED_RE = re.compile(
    r"INSERT\s+OR\s+IGNORE\s+INTO\s+units\s*\(code,\s*name\)\s*VALUES(.*?);",
    re.DOTALL | re.IGNORECASE,
)
OPTIONS_RE = re.compile(r"const\s+UNIT_OPTIONS\s*=\s*\[(.*?)\]\s*as\s+const", re.DOTALL)

passed = 0
failed = 0


def report(ok, label, detail):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}  — {detail}")
    else:
        failed += 1
        print(f"  [FAIL] {label}  — {detail}")


def read(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        print(f"  [FAIL] {path} is missing — it moved, and this check no longer covers it")
        sys.exit(1)
    return open(full, encoding="utf-8").read()


def seed_codes(path):
    """The unit codes seeded by a schema file. Empty means the block was renamed."""
    match = SEED_RE.search(read(path))
    if not match:
        print(f"  [FAIL] no `INSERT OR IGNORE INTO units` block found in {path}")
        sys.exit(1)
    return set(re.findall(r"\(\s*'([A-Za-z]+)'", match.group(1)))


def describe(a, b, a_name, b_name):
    only_a = sorted(a - b)
    only_b = sorted(b - a)
    bits = []
    if only_a:
        bits.append(f"only in {a_name}: {', '.join(only_a)}")
    if only_b:
        bits.append(f"only in {b_name}: {', '.join(only_b)}")
    return "; ".join(bits)


def main():
    schema = seed_codes(SCHEMA)
    migration = seed_codes(MIGRATION)
    report(
        schema == migration,
        "schema.sql and migrations/004 seed the same units",
        f"{len(schema)} codes" if schema == migration
        else describe(schema, migration, "schema.sql", "004"),
    )

    match = OPTIONS_RE.search(read(FORM))
    if not match:
        print(f"  [FAIL] no `const UNIT_OPTIONS = [...] as const` found in {FORM}")
        sys.exit(1)
    form = set(re.findall(r'"([A-Za-z]+)"', match.group(1)))
    if not form:
        print(f"  [FAIL] `UNIT_OPTIONS` in {FORM} is empty — the parsing or the list is wrong")
        sys.exit(1)
    report(
        form == schema,
        "the transaction form offers exactly the vocabulary",
        f"{len(form)} options" if form == schema
        else describe(form, schema, "the form", "the database"),
    )

    for path in LOCALES:
        labels = set(json.loads(read(path)).get("units", {}))
        if not labels:
            print(f"  [FAIL] {path} has no `units` section")
            sys.exit(1)
        report(
            labels == schema,
            f"{path} labels every unit and nothing else",
            f"{len(labels)} labels" if labels == schema
            else describe(labels, schema, path, "the database"),
        )

    print(f"\nRESULT: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
