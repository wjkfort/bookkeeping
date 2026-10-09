-- Pre-flight repair for migration 002: give every priced transaction an item.
--
-- Five v1 rows recorded a unit price but no item_id:
--   tx 17  早点糖饼    2.00 CNY  piece
--   tx 21  (none)      9.90 CNY  piece
--   tx 28  ''          2.00 CNY  piece
--   tx 40  (none)      2.00 CNY  piece
--   tx 42  (none)      6.00 CNY  (no unit)
--
-- Migration 002 copies a transaction's price into item_prices with an INNER
-- JOIN on items, so a priced row without an item_id would have its price
-- dropped silently. scripts/verify_migration.py gates on exactly this and
-- reports it as "priced rows had an item to attach to (pre-flight)".
--
-- The item each of these rows belongs to is taken from the older local clone,
-- which had already been corrected by hand and identifies them as:
--   tx 17, 28, 40 -> 糖饼        (breakfast pancake)
--   tx 21         -> 优酷月卡     (Youku monthly pass)
--   tx 42         -> iCloud
-- None of those three items exist in production, so they are created first.
--
-- Run against a v1 database BEFORE migrations/002_schema_v2.sql:
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/001_link_priced_rows_to_items.sql
--
-- Idempotent: re-running finds the items and leaves already-linked rows alone.
-- Only rows that are still unlinked are touched.

-- 1. Create the missing items, reusing an existing one when the name is taken.
--
-- created_at is a fixed date rather than datetime('now') on purpose: the date
-- is the transaction's own date (the first purchase of that item), and a
-- clock-dependent value would make every re-run of this file produce different
-- rows, which then shows up as spurious noise when two runs are compared.
INSERT INTO items (name, user_id, created_at)
SELECT '糖饼', 1, '2026-03-10T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '糖饼' AND user_id = 1);

INSERT INTO items (name, user_id, created_at)
SELECT '优酷月卡', 1, '2026-03-13T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = '优酷月卡' AND user_id = 1);

INSERT INTO items (name, user_id, created_at)
SELECT 'iCloud', 1, '2026-03-24T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = 'iCloud' AND user_id = 1);

-- 2. Link the priced rows that have no item, without overwriting an existing
--    link in case one of them was fixed by hand since the export.
UPDATE transactions
   SET item_id = (SELECT id FROM items WHERE name = '糖饼' AND user_id = transactions.user_id)
 WHERE id IN (17, 28, 40)
   AND item_id IS NULL
   AND user_id = 1;

UPDATE transactions
   SET item_id = (SELECT id FROM items WHERE name = '优酷月卡' AND user_id = transactions.user_id)
 WHERE id = 21
   AND item_id IS NULL
   AND user_id = 1;

UPDATE transactions
   SET item_id = (SELECT id FROM items WHERE name = 'iCloud' AND user_id = transactions.user_id)
 WHERE id = 42
   AND item_id IS NULL
   AND user_id = 1;
