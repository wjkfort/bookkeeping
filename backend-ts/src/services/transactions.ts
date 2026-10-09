/**
 * Transaction reads and writes.
 *
 * Extracted verbatim from `src/api/transactions.ts` so that the HTTP handlers
 * and the AI tools execute *one* implementation. The extraction is deliberately
 * behaviour-preserving: every validation, error message and ordering below is
 * the one the handlers already had, because `scripts/baseline/api-contract-baseline.json`
 * pins the wire format and would report any drift as a regression.
 *
 * Two additions exist only for the AI layer and are inert on the HTTP path:
 *
 *  - `source` records whether a row was written by a human or by the model
 *    (`transactions.source` has a CHECK for exactly these two values). The old
 *    handler hardcoded `'manual'` in its INSERT; that is kept as the default, so
 *    nothing changes for the HTTP caller, but the AI tool can now write `'ai'`
 *    instead of silently mislabelling its own writes.
 *  - `merchant` is passed through to `item_prices`. R2 expects one message to
 *    produce a transaction *and* price observations with a shop attached, and
 *    `logPrice` needs the same resolution, so the column is threaded through one
 *    shared write path rather than two. The HTTP handler does not send it.
 */

import type {
  TransactionRow,
  TransactionWithItemName,
  UpdateTransactionRequest,
  ItemPrice,
} from '../types';
import { toCents, toAmount, centsToAmount } from '../utils/money';
import { todayInZone } from '../utils/time';
import { badRequest, notFound, serverError } from './errors';
import { logPrice } from './prices';
import { normaliseMerchantName } from './merchants';

// Item and price columns come from item_prices rather than from transactions
// (v2 moved them). The API contract is unchanged, so they are folded back into
// the transaction object on the way out.
export const TX_SELECT = `
  SELECT t.*, i.name as item_name,
         ip.item_id as item_id, ip.unit_price_cents as unit_price_cents,
         ip.quantity as quantity, ip.unit as unit
  FROM transactions t
  LEFT JOIN item_prices ip ON ip.transaction_id = t.id
  LEFT JOIN items i ON i.id = ip.item_id AND i.user_id = t.user_id
`;

export interface TxRow extends TransactionRow {
  item_name: string | null;
  item_id: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
  unit: string | null;
}

/** Storage row -> wire shape: money back to decimals, price fields reattached. */
export function toTransaction(row: TxRow): TransactionWithItemName {
  return {
    id: row.id,
    user_id: row.user_id,
    amount: centsToAmount(row.amount_cents),
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
    item_name: row.item_name,
  };
}

export async function ensureOwnedCategory(
  db: D1Database, categoryId: number, userId: number,
): Promise<boolean> {
  const category = await db
    .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .bind(categoryId, userId)
    .first();
  return !!category;
}

export async function ensureOwnedItem(
  db: D1Database, itemId: number, userId: number,
): Promise<boolean> {
  const item = await db
    .prepare('SELECT id FROM items WHERE id = ? AND user_id = ?')
    .bind(itemId, userId)
    .first();
  return !!item;
}

/**
 * Item lookup is an items concern, so `resolveItemIdByName` lives in the items
 * service and is imported here for transaction writes. It is re-exported so
 * callers that think of it as part of writing a transaction keep one import.
 */
import { resolveItemIdByName } from './items';
export { resolveItemIdByName };

/** Load one transaction in the wire shape, or null when it is not this user's. */
export async function fetchTransaction(
  db: D1Database, userId: number, id: number,
): Promise<TransactionWithItemName | null> {
  const row = await db
    .prepare(`${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`)
    .bind(id, userId)
    .first<TxRow>();
  return row ? toTransaction(row) : null;
}

// ---------------------------------------------------------------- create

export interface ItemObservationInput {
  /** An existing item. Resolved by name when absent. */
  item_id?: number | null;
  item_name?: string | null;
  unit_price?: number;
  quantity?: number | null;
  /** A `units.code`. */
  unit?: string | null;
  /** The user's own wording ("个"), preserved even when a code is set. */
  unit_raw?: string | null;
  /** Raw shop name; kept alongside merchant_id so a failed match loses nothing. */
  merchant?: string | null;
}

export interface CreateTransactionInput {
  amount: number;
  currency: string;
  /** Omit to file it under today in the user's zone. */
  date?: string | null;
  category_id: number;
  description?: string | null;
  source?: 'manual' | 'ai';
  /** Set when this transaction is a subscription renewal. */
  subscription_id?: number | null;
  /** The user's IANA zone, for resolving an omitted `date`. Defaults to UTC+8. */
  timezone?: string | null;
  item?: ItemObservationInput | null;
}

export async function createTransaction(
  db: D1Database, userId: number, input: CreateTransactionInput,
): Promise<TransactionWithItemName> {
  const { amount, currency, category_id, description, item } = input;
  const source = input.source ?? 'manual';

  if (!amount || !currency || !category_id) {
    throw badRequest('Amount, currency, and category_id are required');
  }

  if (currency.length !== 3) {
    throw badRequest('Currency must be a 3-letter code');
  }

  // A date the caller supplied is used verbatim — the API contract requires it,
  // and a date already given must never be shifted into another zone. Only an
  // omitted date is resolved, and then in the *user's* zone: a purchase made at
  // 01:00 in UTC+8 belongs to that local day, not to the UTC one the server is
  // running on.
  const date = input.date ?? todayInZone(input.timezone);

  if (!(await ensureOwnedCategory(db, category_id, userId))) {
    throw notFound('Category not found');
  }

  // Resolve the item: an explicit id is verified, a name is found-or-created.
  let finalItemId: number | null = null;

  if (item?.item_id) {
    if (!(await ensureOwnedItem(db, item.item_id, userId))) {
      throw notFound('Item not found');
    }
    finalItemId = item.item_id;
  }

  if (item?.item_name && item.item_name.trim().length > 0) {
    finalItemId = await resolveItemIdByName(db, userId, item.item_name);
  }

  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `INSERT INTO transactions (user_id, amount_cents, currency, description, date, category_id, subscription_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      userId, toCents(amount), currency, description || null, date,
      category_id, input.subscription_id ?? null, source, now, now,
    )
    .first<TransactionRow>();

  if (!result) {
    throw serverError('Failed to create transaction');
  }

  // The item and its price live in item_prices now. Without an item there is
  // nothing to attach the observation to, so the fields are dropped — that is
  // the same information the v1 schema kept in these columns.
  //
  // The observation is written through the prices service, so a transaction
  // carrying an item and a bare `log_price` call go down one path: unit
  // vocabulary validation and merchant resolution live there.
  if (finalItemId) {
    await logPrice(db, userId, {
      item_id: finalItemId,
      transaction_id: result.id,
      // A purchase with an item but no stated unit price is priced at what was
      // actually paid. This is the rule migration 002 applies to historical
      // rows, and the one §5.1 fixes for new writes.
      unit_price: item?.unit_price ?? amount,
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? null,
      unit_raw: item?.unit_raw ?? null,
      currency,
      merchant: item?.merchant ?? null,
      observed_on: date,
    });
  }

  const full = await fetchTransaction(db, userId, result.id);
  return full ?? toTransaction({
    ...result, item_name: null, item_id: null, unit_price_cents: null,
    quantity: null, unit: null,
  });
}

// ---------------------------------------------------------------- update

export interface UpdateTransactionInput extends UpdateTransactionRequest {
  /** AI-only: attach the shop to the price observation this write touches. */
  merchant?: string | null;
}

export async function updateTransaction(
  db: D1Database, userId: number, id: number, body: UpdateTransactionInput,
): Promise<TransactionWithItemName> {
  const updates: string[] = [];
  const values: any[] = [];

  if (body.amount !== undefined) {
    updates.push('amount_cents = ?');
    values.push(toCents(body.amount));
  }
  if (body.currency !== undefined) {
    if (body.currency.length !== 3) {
      throw badRequest('Currency must be a 3-letter code');
    }
    updates.push('currency = ?');
    values.push(body.currency);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }
  if (body.date !== undefined) {
    updates.push('date = ?');
    values.push(body.date);
  }
  if (body.category_id !== undefined) {
    if (!(await ensureOwnedCategory(db, body.category_id, userId))) {
      throw notFound('Category not found');
    }
    updates.push('category_id = ?');
    values.push(body.category_id);
  }

  // Item and price fields are no longer columns on transactions; they are
  // resolved here and written to item_prices after the transaction row.
  let nextItemId: number | null | undefined;

  if (body.item_name !== undefined) {
    if (body.item_name && body.item_name.trim().length > 0) {
      nextItemId = await resolveItemIdByName(db, userId, body.item_name);
    } else {
      // Clear the item link if item_name is empty
      nextItemId = null;
    }
  } else if (body.item_id !== undefined) {
    if (body.item_id !== null && !(await ensureOwnedItem(db, body.item_id, userId))) {
      throw notFound('Item not found');
    }
    nextItemId = body.item_id;
  }

  const hasPriceUpdate =
    nextItemId !== undefined ||
    body.unit_price !== undefined ||
    body.quantity !== undefined ||
    body.unit !== undefined ||
    body.merchant !== undefined;

  if (!hasPriceUpdate && updates.length === 0) {
    throw badRequest('No fields to update');
  }

  const now = new Date().toISOString();

  let result: TransactionRow | null = null;
  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id, userId);

    result = await db
      .prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
      .bind(...values)
      .first<TransactionRow>();

    if (!result) {
      throw notFound('Transaction not found');
    }
  } else {
    result = await db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<TransactionRow>();

    if (!result) {
      throw notFound('Transaction not found');
    }
  }

  if (hasPriceUpdate) {
    const existing = await db
      .prepare('SELECT * FROM item_prices WHERE transaction_id = ?')
      .bind(id)
      .first<ItemPrice>();

    const itemId = nextItemId !== undefined ? nextItemId : (existing ? existing.item_id : null);

    if (itemId === null) {
      // Nothing to attach a price to: remove any existing observation.
      await db.prepare('DELETE FROM item_prices WHERE transaction_id = ?').bind(id).run();
    } else if (existing) {
      await db
        .prepare(
          `UPDATE item_prices
             SET item_id = ?, unit_price_cents = ?, quantity = ?, unit = ?, unit_raw = ?, merchant = ?, observed_on = ?
           WHERE transaction_id = ?`,
        )
        .bind(
          itemId,
          body.unit_price !== undefined ? toCents(body.unit_price) : existing.unit_price_cents,
          body.quantity !== undefined ? body.quantity : existing.quantity,
          body.unit !== undefined ? body.unit : existing.unit,
          // The raw wording tracks the code, so "个" is not lost when a code is set.
          body.unit !== undefined ? body.unit : existing.unit_raw,
          body.merchant !== undefined ? normaliseMerchantName(body.merchant) : existing.merchant,
          body.date !== undefined ? body.date : existing.observed_on,
          id,
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO item_prices
             (user_id, item_id, transaction_id, unit_price_cents, quantity, unit, unit_raw, currency, merchant, observed_on, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          userId, itemId, id,
          body.unit_price !== undefined ? toCents(body.unit_price) : result.amount_cents,
          body.quantity ?? null, body.unit ?? null,
          body.unit ?? null,
          result.currency, normaliseMerchantName(body.merchant), result.date, now,
        )
        .run();
    }
  }

  const full = await fetchTransaction(db, userId, id);
  return full ?? toTransaction({
    ...result, item_name: null, item_id: null, unit_price_cents: null,
    quantity: null, unit: null,
  });
}

// ---------------------------------------------------------------- delete

export async function deleteTransaction(
  db: D1Database, userId: number, id: number,
): Promise<void> {
  // The price observation this transaction recorded has to go with it. Its
  // foreign key is ON DELETE SET NULL (a price can legitimately exist without
  // a transaction, so CASCADE is not appropriate), which would otherwise
  // leave an orphan indistinguishable from a price the user logged by hand —
  // and that phantom would keep counting towards the item's last/average
  // price. v1 stored the price on the transaction, so deleting the
  // transaction removed it; this preserves that.
  await db
    .prepare('DELETE FROM item_prices WHERE transaction_id = ? AND user_id = ?')
    .bind(id, userId)
    .run();

  const result = await db
    .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ? RETURNING id')
    .bind(id, userId)
    .first();

  if (!result) {
    throw notFound('Transaction not found');
  }
}
