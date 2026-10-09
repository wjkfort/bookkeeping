-- Migration 002 — schema v2: simplify the schema and add the AI tables.
--
-- One file, run once against a database on the v1 schema:
--   npx wrangler d1 export  bookkeeping-db --remote --output=prod-backup-<date>.sql   # backup FIRST
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/002_schema_v2.sql
--
-- Test it against a copy of real data before touching prod:
--   python3 -I scripts/verify_migration.py <path-to.sqlite | path-to-export.sql>
--
-- NOT re-runnable: after success the v1 tables no longer exist. If it fails
-- midway on remote, restore from the backup taken above.
--
-- ---------------------------------------------------------------------------
-- STRATEGY (why it is shaped like this — read before editing)
--
-- SQLite cannot alter columns, so each table is rebuilt. The obvious pattern
-- (create foo_v2 → copy → drop foo → rename foo_v2 to foo) is UNSAFE with
-- foreign keys on, and D1 always has them on:
--   * `DROP TABLE users` does an implicit DELETE, which fires ON DELETE
--     CASCADE on every table referencing `users` — including freshly filled
--     _v2 tables, silently emptying them.
--   * `ALTER TABLE x RENAME` rewrites REFERENCES clauses in OTHER tables,
--     so _v2 tables end up pointing at tables that are about to be dropped.
-- Both were reproduced while writing this file.
--
-- Safe sequence used instead:
--   1. Drop dead tables (nothing live references them).
--   2. Park every surviving v1 table as <name>_old. Their mutual references
--      are rewritten to *_old, so the parked set is self-contained.
--   3. Create the v2 tables directly under their FINAL names.
--   4. Copy data from *_old.
--   5. Drop *_old, children first. No v2 table references *_old, so no FK
--      action can touch migrated data.
--   6. Create indexes.
-- ---------------------------------------------------------------------------

PRAGMA defer_foreign_keys = ON;

-- ===========================================================================
-- 1. Dead tables
--    utility_*            feature removed in 17a1863; user confirmed deletion
--    ai_conversations     never used (0 rows); replaced by ai_messages
--    subscription_renewals never used (0 rows); replaced by
--                         transactions.subscription_id
-- ===========================================================================
DROP TABLE IF EXISTS utility_readings;
DROP TABLE IF EXISTS utility_types;
DROP TABLE IF EXISTS utility_addresses;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS subscription_renewals;
DROP VIEW  IF EXISTS subscriptions_src;

-- ---------------------------------------------------------------------------
-- SAFETY CHECK — run this FIRST against the real database and read the output
-- before applying anything else in this file:
--
--   npx wrangler d1 execute bookkeeping-db --remote --command \
--     "SELECT name FROM pragma_table_info('subscriptions') ORDER BY cid"
--
-- archived_at must be present. migrations/add_archived_at_to_subscriptions.sql
-- was applied by hand to the local database but is absent from the prod backup
-- of 2026-07-22, so check rather than assume. If it is missing, apply that file
-- first; this migration cannot paper over it, because SQLite resolves column
-- names at prepare time and one statement cannot conditionally reference a
-- column that may not exist.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 2. Park v1 tables
-- ===========================================================================
ALTER TABLE transactions   RENAME TO transactions_old;
ALTER TABLE subscriptions  RENAME TO subscriptions_old;
ALTER TABLE items          RENAME TO items_old;
ALTER TABLE categories     RENAME TO categories_old;
ALTER TABLE exchange_rates RENAME TO exchange_rates_old;
ALTER TABLE users          RENAME TO users_old;

-- v1 indexes moved with their tables and will be dropped with them. Their
-- names would collide with nothing below, but drop explicitly for clarity.
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_categories_parent_id;
DROP INDEX IF EXISTS idx_categories_type;
DROP INDEX IF EXISTS idx_categories_user_id;
DROP INDEX IF EXISTS idx_transactions_category_id;
DROP INDEX IF EXISTS idx_transactions_date;
DROP INDEX IF EXISTS idx_transactions_currency;
DROP INDEX IF EXISTS idx_transactions_item_id;
DROP INDEX IF EXISTS idx_transactions_user_id;
DROP INDEX IF EXISTS idx_transactions_unit_price;
DROP INDEX IF EXISTS idx_exchange_rates_target_currency;
DROP INDEX IF EXISTS idx_exchange_rates_fetched_at;
DROP INDEX IF EXISTS idx_exchange_rates_lookup;
DROP INDEX IF EXISTS idx_items_name;
DROP INDEX IF EXISTS idx_items_user_id;
DROP INDEX IF EXISTS idx_subscriptions_user_id;
DROP INDEX IF EXISTS idx_subscriptions_category_id;

-- ===========================================================================
-- 3. v2 tables (final names). 9 tables total, down from 11.
-- ===========================================================================

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    username      TEXT NOT NULL,
    ai_memory     TEXT CHECK (ai_memory IS NULL OR length(ai_memory) <= 2000),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Max depth 2 and child.type = parent.type are enforced in the API (all
-- current rows satisfy both). Uniqueness uses an expression index (step 6)
-- because UNIQUE(name, parent_id, user_id) never constrained top-level rows:
-- SQLite treats NULL parent_id values as distinct.
CREATE TABLE categories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id    INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    translations TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    icon         TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency     TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
    cycle_days   INTEGER NOT NULL DEFAULT 30 CHECK (cycle_days > 0),
    end_date     TEXT NOT NULL,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    archived_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);
-- last_renewed_at removed: it is MAX(date) of transactions with this
-- subscription_id. It was NULL on every row.

-- Money is integer cents. item_id / unit_price / quantity / unit removed:
-- that data now lives in item_prices.
-- category_id is ON DELETE RESTRICT: in v1 it was CASCADE, so deleting a
-- category silently deleted all of its transactions.
CREATE TABLE transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency        TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    date            TEXT NOT NULL,
    description     TEXT,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

-- One row per observed price. transaction_id is NULL when a price was noted
-- without buying ("eggs are 15 at the corner shop").
CREATE TABLE item_prices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    transaction_id   INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity         REAL CHECK (quantity IS NULL OR quantity > 0),
    unit             TEXT,
    currency         TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant         TEXT,
    observed_on      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cache: one row per currency pair, upserted. v1 appended every fetch.
CREATE TABLE exchange_rates (
    base_currency   TEXT NOT NULL CHECK (length(base_currency) = 3),
    target_currency TEXT NOT NULL CHECK (length(target_currency) = 3),
    rate            REAL NOT NULL,
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (base_currency, target_currency)
) WITHOUT ROWID;

-- AI: one continuous conversation per user. Token counts live here, so no
-- separate usage table is needed; daily caps are SUM(tokens_*) over a day.
CREATE TABLE ai_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content    TEXT NOT NULL,
    tool_calls TEXT,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Days the user confirmed had no spending, so gap detection stops asking.
CREATE TABLE ledger_days (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
) WITHOUT ROWID;

-- ===========================================================================
-- 4. Copy data. IDs are preserved everywhere, so every reference stays valid.
--
-- NOTE ON subscriptions.archived_at — this file covers the database that HAS
-- the column, which is the expected prod state (the local database, cloned from
-- prod, has it). The column never arrives by itself: it comes from the separate
-- hand-applied migrations/add_archived_at_to_subscriptions.sql.
--
-- SQLite resolves column names at prepare time, so one statement cannot
-- conditionally reference a column that might be missing — an IF/EXISTS guard
-- does not help, tested. If prod turns out to lack the column, run
-- migrations/add_archived_at_to_subscriptions.sql FIRST (it is a one-line
-- ALTER TABLE ADD COLUMN, harmless on a database that already has it would be
-- an error instead, so check before running).
--
-- Verify the column exists before applying:
--   npx wrangler d1 execute bookkeeping-db --remote --command \
--     "SELECT name FROM pragma_table_info('subscriptions') ORDER BY cid"
-- ===========================================================================

INSERT INTO users (id, email, password_hash, username, created_at, updated_at)
SELECT id, email, password_hash, username, created_at, updated_at
FROM users_old;

-- Parents before children: the self-reference is checked per row.
INSERT INTO categories (id, user_id, name, type, parent_id, translations, created_at)
SELECT id, user_id, name, type, parent_id, translations, created_at
FROM categories_old
ORDER BY parent_id IS NOT NULL, id;

INSERT INTO subscriptions
    (id, user_id, name, icon, amount_cents, currency, cycle_days, end_date,
     category_id, archived_at, created_at)
SELECT id, user_id, name, icon, CAST(ROUND(amount * 100) AS INTEGER), currency,
       cycle, end_date, category_id, archived_at, created_at
FROM subscriptions_old;

INSERT INTO transactions
    (id, user_id, category_id, amount_cents, currency, date, description,
     created_at, updated_at)
SELECT id, user_id, category_id, CAST(ROUND(amount * 100) AS INTEGER), currency,
       date, description, created_at, updated_at
FROM transactions_old;

-- v2 replaces subscriptions.last_renewed_at with MAX(transactions.date) over
-- the subscription's renewal transactions, so those transactions have to be
-- linked for a past renewal to stay visible. v1 had no such column, but the
-- renew endpoint has always written a recognisable description, so the
-- transactions it created are identified by exactly that string. Only rows that
-- are still unlinked are touched.
--
-- This is deliberately conservative: it recovers the renewals that can be
-- proven from data the app itself wrote. A subscription whose last_renewed_at
-- was populated some other way (edited by hand, or renewed before the
-- description convention) has nothing to match on and is reported by
-- scripts/verify_migration.py as "no identifiable renewal transaction".
UPDATE transactions
   SET subscription_id = (
         SELECT s.id FROM subscriptions s
          WHERE s.user_id = transactions.user_id
            AND transactions.description = 'Subscription renewal: ' || s.name
       )
 WHERE subscription_id IS NULL
   AND EXISTS (
         SELECT 1 FROM subscriptions s
          WHERE s.user_id = transactions.user_id
            AND transactions.description = 'Subscription renewal: ' || s.name
       );

INSERT INTO items (id, user_id, name, created_at)
SELECT id, user_id, name, created_at
FROM items_old;

-- item_prices: one row per v1 transaction linked to an item.
--  * unit_price recorded → copied verbatim, never recomputed. unit_price ×
--    quantity ≠ amount in 8 of 17 local rows (rounding, and e.g. id 56:
--    0.03 × 7000 = 210 vs amount 192); what the user typed wins.
--  * no unit_price → the amount was the price paid for the item; recorded as
--    the unit price with quantity NULL (unknown, not assumed 1).
INSERT INTO item_prices
    (user_id, item_id, transaction_id, unit_price_cents, quantity, unit,
     currency, observed_on, created_at)
SELECT t.user_id, t.item_id, t.id,
       CAST(ROUND(COALESCE(t.unit_price, t.amount) * 100) AS INTEGER),
       CASE WHEN t.unit_price IS NOT NULL AND t.quantity > 0 THEN t.quantity END,
       CASE WHEN t.unit_price IS NOT NULL THEN NULLIF(TRIM(t.unit), '') END,
       t.currency, t.date, t.created_at
FROM transactions_old t
JOIN items_old i ON i.id = t.item_id AND i.user_id = t.user_id
ORDER BY t.date, t.id;

-- Newest row per pair. Many v1 rows share an identical fetched_at (batch
-- inserts), so id breaks ties.
INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at)
SELECT base_currency, target_currency, rate, fetched_at
FROM (
    SELECT base_currency, target_currency, rate, fetched_at,
           ROW_NUMBER() OVER (PARTITION BY base_currency, target_currency
                              ORDER BY fetched_at DESC, id DESC) AS rn
    FROM exchange_rates_old
)
WHERE rn = 1;

-- ===========================================================================
-- 5. Drop parked v1 tables, children before parents.
-- ===========================================================================
DROP TABLE transactions_old;
DROP TABLE subscriptions_old;
DROP TABLE items_old;
DROP TABLE categories_old;
DROP TABLE exchange_rates_old;
DROP TABLE users_old;

-- ===========================================================================
-- 6. Indexes — 9, down from 28. Each one serves a known query.
-- ===========================================================================
-- list / gap detection / summaries: WHERE user_id = ? AND date BETWEEN ...
CREATE INDEX idx_transactions_user_date  ON transactions (user_id, date);
-- RESTRICT check on category delete, and category filters
CREATE INDEX idx_transactions_category   ON transactions (category_id);
-- subscription renewal history, SET NULL on subscription delete
CREATE INDEX idx_transactions_sub        ON transactions (subscription_id) WHERE subscription_id IS NOT NULL;
-- category tree per user; real uniqueness for top-level and child names
CREATE UNIQUE INDEX idx_categories_unique ON categories (user_id, COALESCE(parent_id, 0), name);
CREATE INDEX idx_categories_parent       ON categories (parent_id);
-- price history and "cheaper than last time"
CREATE INDEX idx_item_prices_item        ON item_prices (item_id, observed_on);
CREATE INDEX idx_item_prices_tx          ON item_prices (transaction_id) WHERE transaction_id IS NOT NULL;
-- chat window: latest N messages per user
CREATE INDEX idx_ai_messages_user        ON ai_messages (user_id, id);
