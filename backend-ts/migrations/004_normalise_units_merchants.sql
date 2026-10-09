-- Migration 004 — normalise merchant and unit.
--
-- Run AFTER 001, 002 and 003.
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/004_normalise_units_merchants.sql
--
-- Why both are needed:
--
--  * `item_prices.merchant` was free text. R4 wants to compare prices *between
--    merchants*, and "永辉" vs "永辉超市" would otherwise be two different
--    shops, making the comparison quietly wrong. A merchant becomes an entity
--    with aliases, so a name the AI hears can resolve to the same row.
--
--  * `item_prices.unit` was free text with no constraint. Comparing prices is
--    only meaningful in the same unit: "12.8/个" and "12.8/pack" are not the
--    same price. A closed vocabulary makes an unknown unit fail loudly instead
--    of silently splitting one unit across two spellings.
--
-- Measured state before this migration: merchant is NULL on all 23 item_prices
-- rows; unit uses exactly piece(8), pack(4), liter(4) and NULL(7). So there is
-- nothing to clean up — the backfills below are for safety in case rows have
-- appeared since.
--
-- Units are not user data: they are a shared vocabulary, so `units` has no
-- user_id. Merchants are user data, so `merchants` is scoped per user.

-- ---------------------------------------------------------------------------
-- 1. units
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
    code TEXT PRIMARY KEY,          -- canonical, stored on item_prices.unit
    name TEXT NOT NULL              -- how it is shown to the user
);

INSERT OR IGNORE INTO units (code, name) VALUES
    ('piece',  'piece'),
    ('pack',   'pack'),
    ('liter',  'liter'),
    ('kg',     'kg'),
    ('g',      'g'),
    ('ml',     'ml'),
    ('bottle', 'bottle'),
    ('box',    'box'),
    ('bag',    'bag');

-- ---------------------------------------------------------------------------
-- 2. merchants + aliases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS merchant_aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, alias)
);

-- ---------------------------------------------------------------------------
-- 3. Rebuild item_prices so `unit` can carry a REFERENCES units(code).
--
-- `ALTER TABLE ... ADD COLUMN` cannot add a REFERENCES clause, and a CHECK
-- cannot use a subquery, so the only way to make the unit vocabulary binding is
-- to recreate the table. Done here rather than later because item_prices is
-- still small and no code writes to it yet.
--
-- The rebuild follows 002's pattern: build the replacement under a temp name,
-- copy, drop the original, then rename the temp one into place. It does NOT
-- rename the original first — `ALTER TABLE ... RENAME` rewrites REFERENCES
-- clauses in other tables, and item_prices is referenced by nothing today, but
-- this order stays correct if that changes.
--
-- The temporary table's column order is `original columns + the two new ones`,
-- which is the order the pre-rebuild table already has, so a plain
-- `INSERT ... SELECT *` preserves every value including the raw `merchant` text
-- and the original `unit` spelling.
-- ---------------------------------------------------------------------------
CREATE TABLE item_prices_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    transaction_id   INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity         REAL CHECK (quantity IS NULL OR quantity > 0),
    -- A code from `units`, never free text.
    unit             TEXT REFERENCES units(code),
    unit_raw         TEXT,          -- what the user actually said, e.g. "个"
    currency         TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant         TEXT,          -- raw text as heard; kept even when resolved
    merchant_id      INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
    observed_on      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns are named rather than `SELECT *`: item_prices is still the 11-column
-- 002 shape at this point, and unit_raw has to be captured from the original
-- `unit` value here, before `unit` is normalised below.
INSERT INTO item_prices_new
    (id, user_id, item_id, transaction_id, unit_price_cents, quantity,
     unit, unit_raw, currency, merchant, observed_on, created_at)
SELECT id, user_id, item_id, transaction_id, unit_price_cents, quantity,
       unit, unit, currency, merchant, observed_on, created_at
FROM item_prices;

DROP TABLE item_prices;

ALTER TABLE item_prices_new RENAME TO item_prices;

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------

-- Give every distinct non-empty merchant text an entity, then link it. The raw
-- `merchant` text is deliberately kept: if resolution ever fails, the name the
-- user said is still there.
INSERT OR IGNORE INTO merchants (user_id, name)
SELECT DISTINCT user_id, TRIM(merchant) FROM item_prices
 WHERE merchant IS NOT NULL AND TRIM(merchant) <> '';

UPDATE item_prices
   SET merchant_id = (
         SELECT m.id FROM merchants m
          WHERE m.user_id = item_prices.user_id
            AND m.name = TRIM(item_prices.merchant))
 WHERE merchant IS NOT NULL AND TRIM(merchant) <> '';

-- Keep the wording the user used before normalising the code.
UPDATE item_prices SET unit_raw = unit WHERE unit IS NOT NULL AND unit_raw IS NULL;

-- Anything that is not already a known code is NOT guessed at: the raw value
-- stays in unit_raw and the code is cleared. verify_migration.py reports those
-- rows so they can be mapped deliberately instead of silently mangled.
UPDATE item_prices
   SET unit = NULL
 WHERE unit IS NOT NULL
   AND unit NOT IN (SELECT code FROM units);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_item_prices_item     ON item_prices (item_id, observed_on);
CREATE INDEX IF NOT EXISTS idx_item_prices_tx       ON item_prices (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_prices_merchant ON item_prices (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_aliases_m   ON merchant_aliases (user_id, alias);
