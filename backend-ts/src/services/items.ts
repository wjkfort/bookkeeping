/**
 * Item reads and writes, plus the price statistics derived from an item's
 * observations.
 *
 * Extracted from `src/api/items.ts` so the HTTP handlers and the AI tools
 * (`list_items`, `add_item`, `rename_item`, `delete_item`) share one
 * implementation.
 *
 * Two shapes are preserved exactly as they were, because both are on the wire
 * and the contract baseline pins them:
 *
 *   - `listItems({ withStats: true })` sums money in SQL (cents) and converts
 *     once, so `total_spent` / `average_price` come from integer arithmetic.
 *   - `getItemHistory` derives its stats in JS from the already-converted
 *     decimals, because v1 did and the rounding differs in the last place.
 *
 * `unit` and the price fields are taken from the newest observation that HAS a
 * value, not merely the newest row: v1 filtered with `unit IS NOT NULL` and
 * `unit_price IS NOT NULL`, so a later purchase that recorded no unit must not
 * blank the unit out.
 */

import type { Item, ItemWithStats, Transaction, TransactionRow } from '../types';
import { toAmount } from '../utils/money';
import { badRequest, notFound, serverError } from './errors';

/** `items?with_stats=true` row: money still in cents, the rest already shaped. */
export interface ItemStatsRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  total_purchases: number;
  total_spent_cents: number | null;
  average_price_cents: number | null;
  last_purchase_date: string | null;
  last_unit_price_cents: number | null;
  average_unit_price_cents: number | null;
  total_quantity: number | null;
  unit: string | null;
}

export function toItemWithStats(row: ItemStatsRow): ItemWithStats {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at,
    total_purchases: row.total_purchases,
    total_spent: toAmount(row.total_spent_cents) ?? 0,
    average_price: toAmount(row.average_price_cents) ?? 0,
    last_purchase_date: row.last_purchase_date as string,
    last_unit_price: toAmount(row.last_unit_price_cents),
    average_unit_price: toAmount(row.average_unit_price_cents),
    total_quantity: row.total_quantity,
    unit: row.unit,
  };
}

/** A history row: a transaction plus the price observation it carried. */
export interface TxHistoryRow extends TransactionRow {
  item_name: string | null;
  item_id: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
  unit: string | null;
}

export function toHistoryTransaction(row: TxHistoryRow): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    amount: row.amount_cents / 100,
    currency: row.currency,
    description: row.description,
    date: row.date,
    category_id: row.category_id,
    item_id: row.item_id,
    unit_price: toAmount(row.unit_price_cents),
    quantity: row.quantity,
    unit: row.unit,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ItemHistoryStats {
  total_purchases: number;
  total_spent: number;
  average_price: number;
  first_purchase_date: string | null;
  last_purchase_date: string | null;
  last_unit_price: number | null;
  average_unit_price: number | null;
  total_quantity: number;
  unit: string | null;
}

export interface ItemHistory {
  item: Item;
  transactions: Transaction[];
  stats: ItemHistoryStats;
}

/**
 * Item/price data lives in item_prices in v2. `total_spent` and `average_price`
 * remain transaction-amount figures, so they are summed in cents here and
 * converted once at the boundary.
 */
export async function listItems(
  db: D1Database, userId: number, withStats = false,
): Promise<Item[] | ItemWithStats[]> {
  if (withStats) {
    const { results } = await db.prepare(`
      SELECT 
        i.id,
        i.user_id,
        i.name,
        i.created_at,
        COUNT(t.id) as total_purchases,
        SUM(t.amount_cents) as total_spent_cents,
        AVG(t.amount_cents) as average_price_cents,
        MAX(t.date) as last_purchase_date,
        (SELECT ip2.unit_price_cents FROM item_prices ip2 WHERE ip2.item_id = i.id AND ip2.user_id = i.user_id AND ip2.unit_price_cents IS NOT NULL ORDER BY ip2.observed_on DESC, ip2.created_at DESC LIMIT 1) as last_unit_price_cents,
        AVG(CASE WHEN ip.unit_price_cents IS NOT NULL THEN ip.unit_price_cents ELSE NULL END) as average_unit_price_cents,
        SUM(CASE WHEN ip.quantity IS NOT NULL THEN ip.quantity ELSE 0 END) as total_quantity,
        (SELECT ip3.unit FROM item_prices ip3 WHERE ip3.item_id = i.id AND ip3.user_id = i.user_id AND ip3.unit IS NOT NULL ORDER BY ip3.observed_on DESC, ip3.created_at DESC LIMIT 1) as unit
      FROM items i
      LEFT JOIN item_prices ip ON ip.item_id = i.id
      LEFT JOIN transactions t ON t.id = ip.transaction_id AND t.user_id = i.user_id
      WHERE i.user_id = ?
      GROUP BY i.id
      ORDER BY last_purchase_date DESC, i.name ASC
    `).bind(userId).all<ItemStatsRow>();

    return results.map(toItemWithStats);
  }

  const { results } = await db.prepare(
    'SELECT * FROM items WHERE user_id = ? ORDER BY name ASC',
  ).bind(userId).all<Item>();

  return results;
}

export async function fetchItem(
  db: D1Database, userId: number, id: number,
): Promise<Item | null> {
  const item = await db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Item>();
  return item ?? null;
}

/**
 * Find an item by name for this user, creating it if it does not exist.
 * Shared by transaction writes, price logging and `add_item` so all of them
 * agree on what "the same item" means.
 */
export async function resolveItemIdByName(
  db: D1Database, userId: number, name: string,
): Promise<number | null> {
  const trimmed = name.trim();
  const existing = await db
    .prepare('SELECT id FROM items WHERE name = ? AND user_id = ?')
    .bind(trimmed, userId)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const created = await db
    .prepare('INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(trimmed, userId, new Date().toISOString())
    .first<{ id: number }>();
  return created?.id ?? null;
}

export async function getItemHistory(
  db: D1Database, userId: number, id: number,
): Promise<ItemHistory> {
  const item = await fetchItem(db, userId, id);
  if (!item) {
    throw notFound('Item not found');
  }

  // Purchase history comes from the item's price observations, joined to the
  // transaction they came from. Ordered newest first, as before.
  const { results: rows } = await db.prepare(
    `SELECT t.*, ip.item_id as item_id, ip.unit_price_cents as unit_price_cents,
            ip.quantity as quantity, ip.unit as unit, i.name as item_name
     FROM item_prices ip
     JOIN transactions t ON t.id = ip.transaction_id
     LEFT JOIN items i ON i.id = ip.item_id AND i.user_id = ip.user_id
     WHERE ip.item_id = ? AND t.user_id = ?
     ORDER BY t.date DESC, t.created_at DESC`,
  ).bind(id, userId).all<TxHistoryRow>();

  const transactions = rows.map(toHistoryTransaction);

  const transactionsWithUnitPrice = transactions.filter(t => t.unit_price !== null);
  const transactionsWithQuantity = transactions.filter(t => t.quantity !== null);
  const transactionsWithUnit = transactions.filter(t => t.unit !== null);

  const stats: ItemHistoryStats = {
    total_purchases: transactions.length,
    total_spent: transactions.reduce((sum, t) => sum + t.amount, 0),
    average_price: transactions.length > 0
      ? transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length
      : 0,
    first_purchase_date: transactions.length > 0 ? transactions[transactions.length - 1].date : null,
    last_purchase_date: transactions.length > 0 ? transactions[0].date : null,
    last_unit_price: transactionsWithUnitPrice.length > 0 ? transactionsWithUnitPrice[0].unit_price : null,
    average_unit_price: transactionsWithUnitPrice.length > 0
      ? transactionsWithUnitPrice.reduce((sum, t) => sum + (t.unit_price || 0), 0) / transactionsWithUnitPrice.length
      : null,
    total_quantity: transactionsWithQuantity.reduce((sum, t) => sum + (t.quantity || 0), 0),
    unit: transactionsWithUnit.length > 0 ? transactionsWithUnit[0].unit : null,
  };

  return { item, transactions, stats };
}

export async function createItem(
  db: D1Database, userId: number, name: string,
): Promise<Item> {
  if (!name || name.trim().length === 0) {
    throw badRequest('Item name is required');
  }

  const now = new Date().toISOString();

  const result = await db
    .prepare('INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(name.trim(), userId, now)
    .first<Item>();

  if (!result) {
    throw serverError('Failed to create item');
  }

  return result;
}

export async function renameItem(
  db: D1Database, userId: number, id: number, name: string,
): Promise<Item> {
  if (!name || name.trim().length === 0) {
    throw badRequest('Item name is required');
  }

  const result = await db
    .prepare('UPDATE items SET name = ? WHERE id = ? AND user_id = ? RETURNING *')
    .bind(name.trim(), id, userId)
    .first<Item>();

  if (!result) {
    throw notFound('Item not found');
  }

  return result;
}

/**
 * Delete an item. `item_prices.item_id` is ON DELETE CASCADE, so every price
 * observation for this item goes with it — the AI tool must say so before
 * calling this, because the price history is not recoverable.
 */
export async function deleteItem(
  db: D1Database, userId: number, id: number,
): Promise<void> {
  const result = await db
    .prepare('DELETE FROM items WHERE id = ? AND user_id = ? RETURNING id')
    .bind(id, userId)
    .first();

  if (!result) {
    throw notFound('Item not found');
  }
}

export async function searchItems(
  db: D1Database, userId: number, query: string,
): Promise<Item[]> {
  const { results } = await db
    .prepare('SELECT * FROM items WHERE user_id = ? AND name LIKE ? ORDER BY name ASC LIMIT 10')
    .bind(userId, `%${query}%`)
    .all<Item>();
  return results;
}
