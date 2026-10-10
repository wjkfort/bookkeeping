-- Migration 007 — the value domain becomes explicit.
--
-- Run AFTER 000–006.
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/007_value_domain.sql
--
-- Two parts, in this order:
--   1. repair the rows that predate the rules (pure DML, no schema change),
--   2. install triggers that refuse new rows breaking them.
--
-- ---------------------------------------------------------------------------
-- Why triggers and not CHECK constraints
--
-- Every rule below IS expressible as a CHECK, and a CHECK is normally the right
-- tool. It is not used here for one reason: SQLite cannot add a constraint to an
-- existing table, so a CHECK means rebuilding the table, and three of these
-- tables are referenced by others:
--
--   categories    <- categories.parent_id (CASCADE), transactions.category_id
--                    (RESTRICT), subscriptions.category_id (SET NULL)
--   transactions  <- item_prices.transaction_id (SET NULL)
--   subscriptions <- transactions.subscription_id (SET NULL)
--
-- `DROP TABLE` performs an implicit DELETE, which fires those ON DELETE actions
-- against rows that were just copied — migration 002 documents both hazards and
-- had to park every table to survive them. So "add a CHECK to categories" is
-- really a five-table park-and-rebuild, and it would be done to guard against
-- values that have never occurred in this database.
--
-- A trigger needs no rebuild and no FK surgery, and 006 already established the
-- mechanism and its `<CODE>: <prose>` convention. The trade is real and worth
-- naming: a CHECK lives in the table definition and shows up in
-- `PRAGMA table_info`, while a trigger is a separate object that can be dropped
-- on its own. `scripts/schema_signature.py` compares triggers by stored SQL, so
-- the two paths (migration chain and db/schema.sql) cannot drift apart
-- unnoticed. If these tables are ever rebuilt for another reason, converting
-- these triggers to CHECKs is a good thing to do in the same pass.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
--
-- INVALID_DATE  `date`, `observed_on`, `end_date`. summary.ts and queries.ts
--   group by `strftime('%Y-%m', date)`, which returns NULL rather than raising
--   for anything it cannot parse — so a malformed date does not fail, it leaves
--   every monthly total. The shape alone is not enough: `2026-02-30` matches
--   /^\d{4}-\d{2}-\d{2}$/ and SQLite accepts it (normalising it to 2026-03-02),
--   which is why this compares `date(x)` with `x` instead.
--
-- INVALID_JSON  `translations`, `tool_calls`. The columns are only TEXT, and the
--   readers `JSON.parse` them. One unparseable `translations` used to throw out
--   of listCategories and turn every category request into a 500.
--
-- NEGATIVE_AMOUNT  `subscriptions.amount_cents`. transactions and item_prices
--   already refuse a negative amount; subscriptions did not, and
--   renewSubscription turns its amount into a transaction, so a negative one
--   surfaced later as a confusing constraint error on a different table.
--
-- NON_POSITIVE_RATE  `exchange_rates.rate`. A zero or negative rate silently
--   zeroes or inverts every converted figure rather than failing.
--
-- NEGATIVE_TOKENS  `ai_messages.tokens_in`/`tokens_out`. These columns are the
--   cost accounting; the schema comment says so and nothing enforced it.
--
-- ---------------------------------------------------------------------------
-- Before: measured on the 2026-10-10 production export. Every row already
-- satisfies all five rules, so the triggers below reject nothing that exists.
-- The only repairs needed were cosmetic (part 1).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Repair
-- ===========================================================================

-- 26 rows stored '' where the rest of the table stores NULL. The update path in
-- services/transactions.ts wrote whatever it was given while the create path
-- normalised, so a transaction whose description was cleared ended up spelled
-- differently from one that never had a description. `WHERE description IS NULL`
-- silently missed them.
UPDATE transactions SET description = NULL WHERE description = '';

-- Timestamps written by `DEFAULT (datetime('now'))` use 'YYYY-MM-DD HH:MM:SS'
-- while everything else writes `toISOString()`. Both are UTC and both sort
-- correctly *within* a single column, so no query is currently wrong — but
-- ' ' (0x20) sorts before 'T' (0x54), so the moment a column mixes them any
-- range comparison or ORDER BY is wrong. 74 rows carried the default's shape.
-- The '.000Z' is honest: the default has second precision, so the milliseconds
-- are unknown and zero is the only value that does not invent one.
--
-- The shape test is `LIKE '____-__-__ __:__:__'` and not the equivalent GLOB
-- with `[0-9]` classes. Both match the same 74 rows and local SQLite accepts
-- both, but D1 rejects the GLOB with "LIKE or GLOB pattern too complex:
-- SQLITE_ERROR" — a difference between the SQLite you can test against locally
-- and the one that runs in production. `_` is a single-character wildcard, so
-- the pattern is just as precise here; there are no letters in it for LIKE's
-- case-insensitivity to affect.
UPDATE users SET created_at = replace(created_at, ' ', 'T') || '.000Z'
 WHERE created_at LIKE '____-__-__ __:__:__';
UPDATE users SET updated_at = replace(updated_at, ' ', 'T') || '.000Z'
 WHERE updated_at LIKE '____-__-__ __:__:__';
UPDATE categories SET created_at = replace(created_at, ' ', 'T') || '.000Z'
 WHERE created_at LIKE '____-__-__ __:__:__';
UPDATE transactions SET updated_at = replace(updated_at, ' ', 'T') || '.000Z'
 WHERE updated_at LIKE '____-__-__ __:__:__';

-- ===========================================================================
-- 2. Guard
--
-- The statements below are byte-identical to the ones in db/schema.sql:
-- scripts/verify_migration.py compares that file against the migrated schema,
-- and compares triggers by their stored SQL. Keep them in step.
-- ===========================================================================
CREATE TRIGGER IF NOT EXISTS trg_transactions_value_domain_insert
BEFORE INSERT ON transactions
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: transactions.date must be a real date in YYYY-MM-DD form')
     WHERE NEW.date IS NULL OR date(NEW.date) IS NOT NEW.date;
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_value_domain_update
BEFORE UPDATE ON transactions
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: transactions.date must be a real date in YYYY-MM-DD form')
     WHERE NEW.date IS NULL OR date(NEW.date) IS NOT NEW.date;
END;

CREATE TRIGGER IF NOT EXISTS trg_item_prices_value_domain_insert
BEFORE INSERT ON item_prices
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: item_prices.observed_on must be a real date in YYYY-MM-DD form')
     WHERE NEW.observed_on IS NULL OR date(NEW.observed_on) IS NOT NEW.observed_on;
END;

CREATE TRIGGER IF NOT EXISTS trg_item_prices_value_domain_update
BEFORE UPDATE ON item_prices
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: item_prices.observed_on must be a real date in YYYY-MM-DD form')
     WHERE NEW.observed_on IS NULL OR date(NEW.observed_on) IS NOT NEW.observed_on;
END;

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_value_domain_insert
BEFORE INSERT ON subscriptions
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: subscriptions.end_date must be a real date in YYYY-MM-DD form')
     WHERE NEW.end_date IS NULL OR date(NEW.end_date) IS NOT NEW.end_date;

    SELECT RAISE(ABORT, 'NEGATIVE_AMOUNT: subscriptions.amount_cents must not be negative')
     WHERE NEW.amount_cents IS NOT NULL AND NEW.amount_cents < 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_subscriptions_value_domain_update
BEFORE UPDATE ON subscriptions
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: subscriptions.end_date must be a real date in YYYY-MM-DD form')
     WHERE NEW.end_date IS NULL OR date(NEW.end_date) IS NOT NEW.end_date;

    SELECT RAISE(ABORT, 'NEGATIVE_AMOUNT: subscriptions.amount_cents must not be negative')
     WHERE NEW.amount_cents IS NOT NULL AND NEW.amount_cents < 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_days_value_domain_insert
BEFORE INSERT ON ledger_days
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: ledger_days.date must be a real date in YYYY-MM-DD form')
     WHERE NEW.date IS NULL OR date(NEW.date) IS NOT NEW.date;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_days_value_domain_update
BEFORE UPDATE ON ledger_days
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_DATE: ledger_days.date must be a real date in YYYY-MM-DD form')
     WHERE NEW.date IS NULL OR date(NEW.date) IS NOT NEW.date;
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_value_domain_insert
BEFORE INSERT ON categories
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_JSON: categories.translations must be JSON or NULL')
     WHERE NEW.translations IS NOT NULL AND NOT json_valid(NEW.translations);
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_value_domain_update
BEFORE UPDATE ON categories
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_JSON: categories.translations must be JSON or NULL')
     WHERE NEW.translations IS NOT NULL AND NOT json_valid(NEW.translations);
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_value_domain_insert
BEFORE INSERT ON ai_messages
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_JSON: ai_messages.tool_calls must be JSON or NULL')
     WHERE NEW.tool_calls IS NOT NULL AND NOT json_valid(NEW.tool_calls);

    SELECT RAISE(ABORT, 'NEGATIVE_TOKENS: ai_messages.tokens_in must not be negative')
     WHERE NEW.tokens_in IS NOT NULL AND NEW.tokens_in < 0;

    SELECT RAISE(ABORT, 'NEGATIVE_TOKENS: ai_messages.tokens_out must not be negative')
     WHERE NEW.tokens_out IS NOT NULL AND NEW.tokens_out < 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_value_domain_update
BEFORE UPDATE ON ai_messages
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INVALID_JSON: ai_messages.tool_calls must be JSON or NULL')
     WHERE NEW.tool_calls IS NOT NULL AND NOT json_valid(NEW.tool_calls);

    SELECT RAISE(ABORT, 'NEGATIVE_TOKENS: ai_messages.tokens_in must not be negative')
     WHERE NEW.tokens_in IS NOT NULL AND NEW.tokens_in < 0;

    SELECT RAISE(ABORT, 'NEGATIVE_TOKENS: ai_messages.tokens_out must not be negative')
     WHERE NEW.tokens_out IS NOT NULL AND NEW.tokens_out < 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_exchange_rates_value_domain_insert
BEFORE INSERT ON exchange_rates
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'NON_POSITIVE_RATE: exchange_rates.rate must be greater than zero')
     WHERE NEW.rate IS NULL OR NEW.rate <= 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_exchange_rates_value_domain_update
BEFORE UPDATE ON exchange_rates
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'NON_POSITIVE_RATE: exchange_rates.rate must be greater than zero')
     WHERE NEW.rate IS NULL OR NEW.rate <= 0;
END;
