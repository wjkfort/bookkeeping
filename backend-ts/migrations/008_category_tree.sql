-- Migration 008 — the category tree, reorganised.
--
-- Run AFTER 000–007.
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/008_category_tree.sql
--
-- This file is different in kind from 000–007. Those are schema work that would
-- apply to any database with this schema; this one is a decision about one
-- ledger's taxonomy. It addresses rows by the ids they have in production and
-- encodes what this user's categories should be. It is written to be re-runnable
-- (every statement is a no-op the second time), but it is not general.
--
-- ---------------------------------------------------------------------------
-- What a review of all 490 transactions found
--
-- Five problems, none of which the schema could have caught:
--
-- 1. `Groceries` and `Supermarket` split the same spending by two different
--    criteria — "what it is" vs "where it was bought" — and were used
--    interchangeably (面包 appears in both). Merged into Groceries.
-- 2. Categories contradicted their contents: 话费 (a phone bill) under
--    Transportation — whose Chinese name was 交通&通讯, which is how it got
--    there, while 网费 (internet) was already under Necessary; 香烟 and 酒水
--    (cigarettes, alcohol) under Food; 洗澡 (a bathhouse) sitting on the
--    Entertainment *group* rather than in a category of its own.
-- 3. Three groups held transactions directly (Household Goods 9, Transportation
--    3, Entertainment 1), so each was a bucket and a folder at once. After this
--    migration a category is one or the other, never both: generic spending gets
--    a named child (Daily Necessities, Parking, Public Transit) instead of
--    landing on the group.
-- 4. One-off personal spending sat at the top level (dad, haircut, 送礼) beside
--    whole areas of life. Grouped into Family & Gifts and Personal Care.
-- 5. Names were inconsistent: a misspelling (Electricty), lower case (alcohol,
--    travel, haircut, toll, shared bikes), and ten categories whose English
--    translation was the Chinese name — so the English UI showed Chinese.
--    `translations` is what the client renders
--    (`translations[lang] ?? translations.en ?? name`), so `name` alone is not
--    enough and both are set here.
--
-- 52 categories become 58. The tree grows: generic spending gets a home inside
-- its group and one-off roots get a parent. The shape is what was wrong, not the
-- count.
--
-- ---------------------------------------------------------------------------
-- Deliberately NOT done here
--
-- `items.name` still carries pack sizes (大宝SOD蜜200ml*1, 纯白凡士林508ml*1,
-- 桃李巧乐角面包65g). Stripping them was considered and rejected after checking:
-- for two of the three the size is recorded nowhere else (quantity and unit are
-- NULL), so the name is the only place it survives, and 65g is a per-piece
-- attribute rather than a count. If cross-size comparison is ever wanted the
-- answer is a `variant` column on items, not deleting the information.
--
-- tx393 (`报销`) keeps the description 'AI'. It looks like a mistake, but only
-- its author can say what it should read, and a wrong guess is worse than an odd
-- value.
--
-- ---------------------------------------------------------------------------
-- Not a constraint
--
-- "A category with children must not hold transactions" is now true of the data,
-- and could be enforced with a trigger like 006/007. It is not, on purpose: the
-- picker lets a caller choose a group, and refusing that would turn a reasonable
-- quick entry into an error. The convention is kept by the data, not by force.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Names and translations
--
-- `name` is the fallback; `translations` is what the UI shows. Both are set so
-- they cannot drift, and the Chinese name is preserved in `translations.zh`.
-- ===========================================================================

UPDATE categories SET name = 'Transportation',    translations = '{"en":"Transportation","zh":"交通"}'       WHERE id = 10;
UPDATE categories SET name = 'Zenless Zone Zero', translations = '{"en":"Zenless Zone Zero","zh":"绝区零"}' WHERE id = 13;
UPDATE categories SET name = 'Mobile Bill',       translations = '{"en":"Mobile Bill","zh":"话费"}'         WHERE id = 16;
UPDATE categories SET name = 'Shared Bikes',      translations = '{"en":"Shared Bikes","zh":"共享单车"}'    WHERE id = 17;
UPDATE categories SET name = 'Internet Cafes',    translations = '{"en":"Internet Cafes","zh":"网吧"}'      WHERE id = 22;
UPDATE categories SET name = 'Headphone Cover',   translations = '{"en":"Headphone Cover","zh":"耳机罩"}'   WHERE id = 26;
UPDATE categories SET name = 'Electricity Bill',  translations = '{"en":"Electricity Bill","zh":"电费"}'    WHERE id = 31;
UPDATE categories SET name = 'Travel',            translations = '{"en":"Travel","zh":"旅游"}'              WHERE id = 35;
UPDATE categories SET name = 'Family Support',    translations = '{"en":"Family Support","zh":"家用"}'      WHERE id = 37;
UPDATE categories SET name = 'Toll',              translations = '{"en":"Toll","zh":"过路费"}'              WHERE id = 38;
UPDATE categories SET name = 'Haircut',           translations = '{"en":"Haircut","zh":"理发"}'             WHERE id = 39;
UPDATE categories SET name = 'Alcohol',           translations = '{"en":"Alcohol","zh":"酒水"}'             WHERE id = 42;
UPDATE categories SET name = 'NS Game Card',      translations = '{"en":"NS Game Card","zh":"NS游戏卡"}'   WHERE id = 46;
UPDATE categories SET name = 'Reimbursement',     translations = '{"en":"Reimbursement","zh":"报销"}'      WHERE id = 47;
UPDATE categories SET name = 'Power Bank',        translations = '{"en":"Power Bank","zh":"充电宝"}'       WHERE id = 48;
UPDATE categories SET name = 'Watch Strap',       translations = '{"en":"Watch Strap","zh":"手表表带"}'    WHERE id = 49;
UPDATE categories SET name = 'Azur Lane',         translations = '{"en":"Azur Lane","zh":"碧蓝航线"}'      WHERE id = 50;
UPDATE categories SET name = 'Gifts',             translations = '{"en":"Gifts","zh":"送礼"}'              WHERE id = 51;
UPDATE categories SET name = 'Heating',           translations = '{"en":"Heating","zh":"暖气费"}'          WHERE id = 52;

-- ===========================================================================
-- 2. New categories
--
-- Explicit ids so the result is identical everywhere and this file can be
-- re-run. `created_at` is a fixed date rather than datetime('now') for the same
-- reason migration 001 gives: a clock-dependent value makes two runs produce
-- different rows, which then shows up as noise in any comparison.
-- ===========================================================================

INSERT OR IGNORE INTO categories (id, user_id, name, type, parent_id, translations, created_at) VALUES
  (53, 1, 'Daily Necessities', 'expense', 6,  '{"en":"Daily Necessities","zh":"日用消耗品"}', '2026-10-10T00:00:00.000Z'),
  (54, 1, 'Personal Care',     'expense', NULL,'{"en":"Personal Care","zh":"个人护理"}',     '2026-10-10T00:00:00.000Z'),
  (55, 1, 'Bath & Sauna',      'expense', 54, '{"en":"Bath & Sauna","zh":"洗浴"}',           '2026-10-10T00:00:00.000Z'),
  (56, 1, 'Tobacco & Alcohol', 'expense', NULL,'{"en":"Tobacco & Alcohol","zh":"烟酒"}',     '2026-10-10T00:00:00.000Z'),
  (57, 1, 'Parking',           'expense', 10, '{"en":"Parking","zh":"停车费"}',              '2026-10-10T00:00:00.000Z'),
  (58, 1, 'Public Transit',    'expense', 10, '{"en":"Public Transit","zh":"公共交通"}',     '2026-10-10T00:00:00.000Z'),
  (59, 1, 'Family & Gifts',    'expense', NULL,'{"en":"Family & Gifts","zh":"家庭与人情"}',   '2026-10-10T00:00:00.000Z');

-- ===========================================================================
-- 3. Re-parent the categories that moved
--
-- Nothing references these by parent, so re-parenting carries their
-- transactions with them: 香烟/酒水 leave Food, 话费 joins the other utility
-- bills, and the three one-off roots find a home.
-- ===========================================================================

UPDATE categories SET parent_id = 56 WHERE id = 27;  -- Cigarette:  Food            -> Tobacco & Alcohol
UPDATE categories SET parent_id = 56 WHERE id = 42;  -- Alcohol:    Food            -> Tobacco & Alcohol
UPDATE categories SET parent_id = 29 WHERE id = 16;  -- Mobile Bill:Transportation  -> Necessary
UPDATE categories SET parent_id = 54 WHERE id = 39;  -- Haircut:    root            -> Personal Care
UPDATE categories SET parent_id = 59 WHERE id = 37;  -- Family Support: root        -> Family & Gifts
UPDATE categories SET parent_id = 59 WHERE id = 51;  -- Gifts:      root            -> Family & Gifts

-- ===========================================================================
-- 4. Move the transactions that were sitting on a group
--
-- Scoped by user_id as well as category so this can only touch this ledger.
-- ===========================================================================

-- Groceries + Supermarket were the same spending split two ways.
UPDATE transactions SET category_id = 5 WHERE user_id = 1 AND category_id = 9;

-- Entertainment held one bathhouse visit; it belongs in Personal Care.
UPDATE transactions SET category_id = 55 WHERE user_id = 1 AND category_id = 20;

-- Household Goods held its own generic consumables.
UPDATE transactions SET category_id = 53 WHERE user_id = 1 AND category_id = 6;

-- Transportation held three: parking for one category, the rest are transit.
-- 停车费 is the only one that is not public transit, so it is named explicitly
-- and everything else in the group goes to Public Transit.
UPDATE transactions SET category_id = 57 WHERE user_id = 1 AND category_id = 10 AND description = '停车费';
UPDATE transactions SET category_id = 58 WHERE user_id = 1 AND category_id = 10;

-- Supermarket is now empty and redundant: it existed only as the "where" half of
-- a split that no longer exists. Nothing references it at this point.
DELETE FROM categories WHERE id = 9 AND user_id = 1;

-- ===========================================================================
-- 5. Link the two representations of a subscription
--
-- Subscriptions were tracked twice with nothing joining the two: a row in
-- `subscriptions` whose renewals carry `subscription_id`, and hand-recorded
-- transactions in a `Subscription` category carrying nothing. iCloud had both —
-- 4 hand-recorded months and 3 generated ones, on the 24th of every month from
-- March to September — so anything summing a subscription's cost by
-- `subscription_id` was four months short.
--
-- Both updates are inferable from the data rather than guessed: the iCloud
-- series is unbroken, and Subscription > VPN has exactly one VPN transaction and
-- one VPN subscription. YouKu is left alone: it has four transactions and no
-- subscription row, and inventing one would mean inventing a cycle and an
-- amount.
--
-- Confirmed by the ledger's owner before this migration was applied anywhere:
-- the links match the subscriptions they were meant for. Recorded because a
-- future reader looking at `subscription_id` on tx42 should be able to tell that
-- it was reviewed rather than filled in by a script's guess.
-- ===========================================================================

UPDATE transactions SET subscription_id = 2 WHERE user_id = 1 AND category_id = 23 AND subscription_id IS NULL;
UPDATE transactions SET subscription_id = 1 WHERE user_id = 1 AND category_id = 25 AND subscription_id IS NULL;

-- `subscriptions.category_id` decides which category a generated renewal lands
-- in, so leaving it NULL sends them nowhere useful. iCloud already pointed at
-- its category; these two did not. Apple Music is archived with no category of
-- its own, so it is left as it is.
UPDATE subscriptions SET category_id = 25 WHERE id = 1 AND user_id = 1;  -- VPN             -> Subscription > VPN
UPDATE subscriptions SET category_id = 13 WHERE id = 5 AND user_id = 1;  -- Zenless Zone Zero -> Game > Zenless Zone Zero
