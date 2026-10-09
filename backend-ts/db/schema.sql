-- Full D1 schema (v2) for a NEW, empty database.
--   npm run db:schema:local    /  npm run db:schema:remote (empty DB only)
--
-- An existing v1 database is upgraded with migrations/002_schema_v2.sql, not
-- with this file. Table and index definitions here are copied from sections 3
-- and 6 of that migration and must be kept identical to it.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS categories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id    INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    translations TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
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
CREATE TABLE IF NOT EXISTS transactions (
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

CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

-- One row per observed price. transaction_id is NULL when a price was noted
-- without buying ("eggs are 15 at the corner shop").
-- Shared unit vocabulary. Not user data: it is one closed list, so that a price
-- is only ever compared against prices in the same unit.
CREATE TABLE IF NOT EXISTS units (
    code TEXT PRIMARY KEY,          -- canonical, stored on item_prices.unit
    name TEXT NOT NULL              -- how it is shown to the user
);

-- A merchant is an entity, not a string, so that "永辉" and "永辉超市" resolve to
-- the same shop when comparing prices (R4).
CREATE TABLE IF NOT EXISTS merchants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

-- Other spellings the AI may hear for a merchant the user already has.
CREATE TABLE IF NOT EXISTS merchant_aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, alias)
);

CREATE TABLE IF NOT EXISTS item_prices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    transaction_id   INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity         REAL CHECK (quantity IS NULL OR quantity > 0),
    -- A code from `units`, never free text: comparing prices across different
    -- units is meaningless, so an unknown unit must fail rather than split one
    -- unit across two spellings.
    unit             TEXT REFERENCES units(code),
    unit_raw         TEXT,          -- what the user actually said, e.g. "个"
    currency         TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant         TEXT,          -- raw text as heard; kept even when resolved
    merchant_id      INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
    observed_on      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cache: one row per currency pair, upserted. v1 appended every fetch.
CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency   TEXT NOT NULL CHECK (length(base_currency) = 3),
    target_currency TEXT NOT NULL CHECK (length(target_currency) = 3),
    rate            REAL NOT NULL,
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (base_currency, target_currency)
) WITHOUT ROWID;

-- AI: one continuous conversation per user. Token counts live here, so no
-- separate usage table is needed; daily caps are SUM(tokens_*) over a day.
CREATE TABLE IF NOT EXISTS ai_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content    TEXT,   -- nullable: a tool-call turn has no text
    tool_calls TEXT,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Days the user confirmed had no spending, so gap detection stops asking.
CREATE TABLE IF NOT EXISTS ledger_days (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    -- 'no_spend' = the user confirmed nothing was spent on this day.
    -- 'partial'  = something is recorded for it, but the day is not confirmed
    --              complete, so the AI should still ask about it.
    status     TEXT NOT NULL DEFAULT 'no_spend'
               CHECK (status IN ('no_spend', 'partial')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
) WITHOUT ROWID;

-- Indexes
-- list / gap detection / summaries: WHERE user_id = ? AND date BETWEEN ...
CREATE INDEX IF NOT EXISTS idx_transactions_user_date  ON transactions (user_id, date);
-- RESTRICT check on category delete, and category filters
CREATE INDEX IF NOT EXISTS idx_transactions_category   ON transactions (category_id);
-- subscription renewal history, SET NULL on subscription delete
CREATE INDEX IF NOT EXISTS idx_transactions_sub        ON transactions (subscription_id) WHERE subscription_id IS NOT NULL;
-- category tree per user; real uniqueness for top-level and child names
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique ON categories (user_id, COALESCE(parent_id, 0), name);
CREATE INDEX IF NOT EXISTS idx_categories_parent       ON categories (parent_id);
-- price history and "cheaper than last time"
-- Seed the unit vocabulary. INSERT OR IGNORE so this stays idempotent.
INSERT OR IGNORE INTO units (code, name) VALUES
    ('piece', 'piece'), ('pack', 'pack'), ('liter', 'liter'),
    ('kg', 'kg'), ('g', 'g'), ('ml', 'ml'),
    ('bottle', 'bottle'), ('box', 'box'), ('bag', 'bag');

CREATE INDEX IF NOT EXISTS idx_item_prices_item        ON item_prices (item_id, observed_on);
CREATE INDEX IF NOT EXISTS idx_item_prices_merchant ON item_prices (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_aliases_m   ON merchant_aliases (user_id, alias);
CREATE INDEX IF NOT EXISTS idx_item_prices_tx          ON item_prices (transaction_id) WHERE transaction_id IS NOT NULL;
-- chat window: latest N messages per user
CREATE INDEX IF NOT EXISTS idx_ai_messages_user        ON ai_messages (user_id, id);
-- audit lookups: history of one row
