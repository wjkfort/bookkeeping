"""
Structural signature of a SQLite schema.

One definition of "these two databases are the same shape", used by
`verify_migration.py` (does the migration chain build what db/schema.sql builds?)
and by `rebuild_local_db.py` (did loading a production export plus its pending
migrations produce what db/schema.sql describes?). Two copies of this logic would
drift, and the drift would be invisible precisely when it matters — when one of
the two says PASS.

Compares structure, not DDL text: the stored `sql` includes comments and the
exact spelling of `CREATE TABLE` / quoting, none of which change behaviour, and
comments cannot be stripped safely because they may contain quoted defaults.
What matters is columns, types, nullability, defaults, keys, indexes, CHECKs,
views and triggers.
"""

import re


def signature(conn):
    """Return ({table: (cols, fks, indexes, checks, views)}, triggers).

    Trigger statements are compared by their stored SQL with whitespace
    collapsed, so the same statement written in migrations/006 and in
    db/schema.sql compares equal while a real edit does not.
    """
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
    # Triggers are collected separately rather than per table because the
    # per-table tuple is zipped against a fixed label list; a name/sql pair is
    # all a trigger needs.
    triggers = tuple(sorted(
        (r[0], re.sub(r"\s+", " ", (r[1] or "")).strip())
        for r in conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name")))
    return sig, triggers


def differences(a, b):
    """Human-readable differences between two `signature()` results.

    Returns a list of strings; empty means structurally identical. `a` is
    treated as the expected side (db/schema.sql) and `b` as the observed one.
    """
    (A, A_triggers), (B, B_triggers) = a, b
    labels = ("columns", "foreign keys", "indexes", "checks", "views")
    out = []
    only_a = sorted(set(A) - set(B))
    only_b = sorted(set(B) - set(A))
    if only_a:
        out.append(f"tables only in expected: {only_a}")
    if only_b:
        out.append(f"tables only in observed: {only_b}")
    for t in sorted(set(A) & set(B)):
        if A[t] == B[t]:
            continue
        for lab, x, y in zip(labels, A[t], B[t]):
            if x == y:
                continue
            if isinstance(x, tuple) and isinstance(y, tuple):
                # Show the offending entries, not just counts: a count
                # difference of zero is meaningless to a reader.
                out.append(f"{t}.{lab}: only expected={[i for i in x if i not in y]} "
                           f"only observed={[i for i in y if i not in x]}")
            else:
                out.append(f"{t}.{lab}: {x!r} vs {y!r}")
    if A_triggers != B_triggers:
        out.append("triggers: only expected="
                   f"{[n for n, _ in A_triggers if (n, _) not in B_triggers]} only observed="
                   f"{[n for n, _ in B_triggers if (n, _) not in A_triggers]}")
    return out
