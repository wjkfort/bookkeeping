#!/usr/bin/env python3
"""
One unit vocabulary, and the table is the only copy of it.

    python3 -I scripts/check_unit_vocabulary.py

Why this exists:

`item_prices.unit` has a real foreign key to `units.code`, so a unit that is not
in that table cannot be stored at all. The vocabulary used to be written down in
four files, and they had drifted apart in both directions:

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

That is the bug this check was written for, and the answer to it is not a longer
list: the picker now reads `GET /units` and the assistant can add a row itself
with `add_unit` when the user names a unit the table does not have (斤, 两, 打).
A list in the client would go stale the first time that happened, which is why
the checks on the form are structural — that it reads the API, keeps no list of
its own, and can label a code the locale files have never seen.

What is left to keep in step:

  1. `db/schema.sql` and `migrations/004` seed the same codes. Both exist and
     both must: one is a fresh install, the other upgrades a database that is
     already running.
  2. Both locale files label every seeded code and nothing else. Labels are the
     one thing the database cannot supply, and an unlabelled seeded code is the
     "units.ml" bug.
  3. The form reads the vocabulary instead of restating it, and falls back to the
     row's own name for a code no locale knows.
  4. The service does not restate it either.

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
SERVICE = "backend-ts/src/services/units.ts"
FORM = "client/src/components/features/TransactionFormModal.tsx"
LOCALES = ["client/src/locales/zh.json", "client/src/locales/en.json"]

SEED_RE = re.compile(
    r"INSERT\s+OR\s+IGNORE\s+INTO\s+units\s*\(code,\s*name\)\s*VALUES(.*?);",
    re.DOTALL | re.IGNORECASE,
)
# The code is the first string of each tuple; `[^']+` rather than `[A-Za-z]+` so
# a unit seeded in Chinese (which is the whole point of add_unit) still counts.
SEED_CODE_RE = re.compile(r"\(\s*'([^']+)'")

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
    return set(SEED_CODE_RE.findall(match.group(1)))


def describe(a, b, a_name, b_name):
    only_a = sorted(a - b)
    only_b = sorted(b - a)
    bits = []
    if only_a:
        bits.append(f"only in {a_name}: {', '.join(only_a)}")
    if only_b:
        bits.append(f"only in {b_name}: {', '.join(only_b)}")
    return "; ".join(bits)


def check_form():
    """The picker must not own a copy of the vocabulary. Three ways to tell."""
    form = read(FORM)

    report(
        "getUnits(" in form,
        "the transaction form reads the vocabulary from the API",
        "it calls getUnits()"
        if "getUnits(" in form
        else "it never calls getUnits(), so its options come from somewhere else",
    )
    report(
        "UNIT_OPTIONS" not in form,
        "the transaction form keeps no list of its own",
        "no hardcoded list"
        if "UNIT_OPTIONS" not in form
        else "UNIT_OPTIONS is back: a constant in the form is what drifted from the table twice",
    )
    # A code the assistant added has no translation yet. Rendering t("units.<code>")
    # for it prints the key itself, which is the shape of the original bug.
    report(
        "unit.name" in form,
        "a unit the locales do not label falls back to its own name",
        "falls back to unit.name"
        if "unit.name" in form
        else f"{FORM} never reads .name, so a newly added unit renders as \"units.<code>\"",
    )


def check_service(schema):
    """`units` is the list; a second copy in the service would drift too."""
    service = read(SERVICE)
    restated = sorted(c for c in schema if f"'{c}'" in service or f'"{c}"' in service)

    report(
        not restated,
        "the server reads the vocabulary from the table",
        "no codes restated in units.ts"
        if not restated
        else f"{SERVICE} hardcodes {', '.join(restated)} — the codes belong in the "
             f"table, which add_unit extends at runtime",
    )


def main():
    schema = seed_codes(SCHEMA)
    migration = seed_codes(MIGRATION)
    report(
        schema == migration,
        "schema.sql and migrations/004 seed the same units",
        f"{len(schema)} codes" if schema == migration
        else describe(schema, migration, "schema.sql", "004"),
    )

    check_form()
    check_service(schema)

    for path in LOCALES:
        labels = set(json.loads(read(path)).get("units", {}))
        if not labels:
            print(f"  [FAIL] {path} has no `units` section")
            sys.exit(1)
        report(
            labels == schema,
            f"{path} labels every seeded unit and nothing else",
            f"{len(labels)} labels" if labels == schema
            else describe(labels, schema, path, "the seed"),
        )

    print(f"\nRESULT: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
