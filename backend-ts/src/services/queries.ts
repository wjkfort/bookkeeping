/**
 * R5 / R6 — the two read shapes the AI needs that are not already a route.
 *
 * `findTransactions` is `find_transactions` from §5.1 ("how much did I spend on
 * lunch last week", "did I already record this?"). `summarize` is the §5.1
 * `summarize` tool, which must reuse `/summary/*`'s aggregation rather than let
 * the model do arithmetic.
 *
 * Both are bounded on purpose. R5 forbids loading a table into the prompt to
 * compute a trend, so the limits below are part of the contract, not a
 * convenience: a caller cannot ask for more than `MAX_FIND_LIMIT` rows, and
 * `summarize` returns aggregate buckets only.
 */

import type { TransactionWithItemName } from '../types';
import { centsToAmount, roundMoney } from '../utils/money';
import { deriveQuantity } from '../utils/quantity';
import { badRequest, notFound } from './errors';
import {
  PRIMARY_PRICE_JOIN, TX_SELECT, toTransaction, type TxRow,
} from './transactions';
import { getAllSubcategoryIds } from '../utils/categories';

/** Hard ceiling on rows returned to the model in one query. */
export const MAX_FIND_LIMIT = 50;

export interface FindTransactionsInput {
  date_from?: string;
  date_to?: string;
  category_id?: number;
  /** Exact amount match, in decimal units (to find a possible duplicate). */
  amount?: number;
  /** Substring match on the description. */
  keyword?: string;
  /**
   * Field-presence filters.
   *
   * These exist because "how detailed is this entry?" is a question about
   * absence, and absence cannot be found by reading rows a page at a time: the
   * ledger is larger than one turn can page through, so a completeness question
   * has to be asked of the database rather than assembled from samples.
   *
   * They are deliberately about *presence*, not about value: they never judge
   * whether a description is good.
   */
  missing_detail?: boolean;
  /** Narrow to one absent field: 'item' | 'unit' | 'quantity' | 'description'. */
  missing_field?: 'item' | 'unit' | 'quantity' | 'description';
  limit?: number;
}

/**
 * The definition of a "detailed enough" entry, as a SQL predicate.
 *
 * The user set the bottom line: a product name, a unit and a quantity. The item
 * link is what carries the name (and, through it, the price row that carries
 * the unit and quantity), so all three are read from the same join.
 */
const MISSING_ANY_DETAIL =
  '(ip.item_id IS NULL OR ip.unit IS NULL OR ip.quantity IS NULL)';

const MISSING_FIELD_SQL: Record<NonNullable<FindTransactionsInput['missing_field']>, string> = {
  item: 'ip.item_id IS NULL',
  unit: 'ip.unit IS NULL',
  quantity: 'ip.quantity IS NULL',
  description: "(t.description IS NULL OR TRIM(t.description) = '')",
};

/**
 * What the assistant sees for one transaction.
 *
 * The wire shape plus `price_id`: the row that carries this purchase's unit and
 * quantity. Without it the only way to add a missing size was `log_price`, which
 * *records* rather than corrects — that is what put a second price row on the
 * crab, after which the item counted twice and the missing-quantity flag never
 * cleared. With it, `update_price` is a single obvious call.
 */
export interface AiTransaction extends TransactionWithItemName {
  price_id: number | null;
}

export async function findTransactions(
  db: D1Database, userId: number, input: FindTransactionsInput,
): Promise<AiTransaction[]> {
  const where: string[] = ['t.user_id = ?'];
  const params: any[] = [userId];

  if (input.date_from) {
    where.push('t.date >= ?');
    params.push(input.date_from);
  }
  if (input.date_to) {
    where.push('t.date <= ?');
    params.push(input.date_to);
  }
  if (input.category_id !== undefined) {
    // Match the category and its children, as the list endpoint does.
    const ids = await getAllSubcategoryIds(db, input.category_id, userId);
    if (ids.length === 0) return [];
    where.push(`t.category_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (input.amount !== undefined) {
    where.push('t.amount_cents = ?');
    params.push(Math.round(input.amount * 100));
  }
  if (input.keyword && input.keyword.trim().length > 0) {
    where.push('t.description LIKE ?');
    params.push(`%${input.keyword.trim()}%`);
  }

  if (input.missing_field !== undefined) {
    where.push(MISSING_FIELD_SQL[input.missing_field]);
  } else if (input.missing_detail === true) {
    where.push(MISSING_ANY_DETAIL);
  } else if (input.missing_detail === false) {
    where.push(`NOT ${MISSING_ANY_DETAIL}`);
  }

  const limit = Math.max(1, Math.min(MAX_FIND_LIMIT, input.limit ?? 20));

  const { results } = await db
    .prepare(
      `${TX_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ?`,
    )
    .bind(...params, limit)
    .all<TxRow>();

  // `price_id` is added here rather than in `toTransaction`, which is the API's
  // wire shape as well: the id of the price row is something the assistant needs
  // in order to correct that row, and the HTTP contract has no use for it.
  return results.map((row) => ({ ...toTransaction(row), price_id: row.price_id }));
}

/**
 * The amount a purchase is reported through, for dividing by the unit price.
 *
 * Separate from `findTransactions` so the arithmetic has one home, and read-only
 * on purpose: this answers "how many would that be?", and answering is not
 * recording. The write path is `update_price`'s `derive_quantity`.
 */
export interface DerivedQuantityView {
  transaction_id: number;
  date: string;
  description: string | null;
  currency: string;
  item_id: number | null;
  item_name: string | null;
  /** The price row the unit price came from, so it can be corrected in place. */
  price_id: number | null;
  unit: string | null;
  unit_raw: string | null;
  amount: number;
  unit_price: number;
  /** What the division gives, rounded when it did not come out even. */
  quantity: number;
  /** False when the amount does not divide evenly — see utils/quantity.ts. */
  exact: boolean;
}

export async function deriveQuantityForTransaction(
  db: D1Database, userId: number, transactionId: number,
): Promise<DerivedQuantityView> {
  const row = await db
    .prepare(
      `SELECT t.id, t.date, t.description, t.amount_cents, t.currency,
              ip.id as price_id, ip.unit_price_cents, ip.unit, ip.unit_raw,
              i.id as item_id, i.name as item_name
         FROM transactions t
         ${PRIMARY_PRICE_JOIN}
         LEFT JOIN items i ON i.id = ip.item_id AND i.user_id = t.user_id
        WHERE t.id = ? AND t.user_id = ?`,
    )
    .bind(transactionId, userId)
    .first<{
      id: number; date: string; description: string | null;
      amount_cents: number; currency: string;
      price_id: number | null; unit_price_cents: number | null;
      unit: string | null; unit_raw: string | null;
      item_id: number | null; item_name: string | null;
    }>();

  if (!row) throw notFound('Transaction not found');

  // Both refusals are "there is nothing to divide", and both have to reach the
  // model as a reason it can act on rather than as a generic 400.
  if (row.unit_price_cents === null) {
    throw badRequest(
      'This purchase has no price per unit recorded, so there is nothing to divide the amount by.',
      { code: 'NO_UNIT_PRICE' }, 'NO_UNIT_PRICE',
    );
  }

  const derived = deriveQuantity(row.amount_cents, row.unit_price_cents);
  if (!derived) {
    throw badRequest(
      'The recorded unit price is zero, so the amount cannot be divided by it.',
      { code: 'NO_UNIT_PRICE' }, 'NO_UNIT_PRICE',
    );
  }

  return {
    transaction_id: row.id,
    date: row.date,
    description: row.description,
    currency: row.currency,
    item_id: row.item_id,
    item_name: row.item_name,
    price_id: row.price_id,
    unit: row.unit,
    unit_raw: row.unit_raw,
    amount: centsToAmount(row.amount_cents),
    unit_price: centsToAmount(row.unit_price_cents),
    quantity: derived.quantity,
    exact: derived.exact,
  };
}

export type SummaryGroupBy = 'category' | 'month' | 'day';

export interface SummaryBucket {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface SummaryResult {
  group_by: SummaryGroupBy;
  currency: string;
  total: number;
  buckets: SummaryBucket[];
}

export interface SummarizeInput {
  group_by: SummaryGroupBy;
  date_from?: string;
  date_to?: string;
  currency?: string;
}

/**
 * Aggregation, done in SQL. The model receives buckets, never rows, so a total
 * it quotes is a number SQL produced in this same turn (R6).
 */
export async function summarize(
  db: D1Database, userId: number, input: SummarizeInput,
): Promise<SummaryResult> {
  const currency = input.currency || 'CNY';

  if (input.group_by !== 'category' && input.group_by !== 'month' && input.group_by !== 'day') {
    throw badRequest("group_by must be one of: category, month, day");
  }

  const where: string[] = ['t.user_id = ?', "c.type = 'expense'"];
  const params: any[] = [userId];

  if (input.date_from) {
    where.push('t.date >= ?');
    params.push(input.date_from);
  }
  if (input.date_to) {
    where.push('t.date <= ?');
    params.push(input.date_to);
  }

  // Mixed currencies are summed only within the requested one; anything else is
  // reported separately by the caller rather than silently converted here (R4
  // leaves cross-currency comparison out of scope).
  where.push('t.currency = ?');
  params.push(currency);

  let select: string;
  let groupBy: string;
  if (input.group_by === 'category') {
    select = `c.id AS k, c.name AS label`;
    groupBy = 'c.id, c.name';
  } else if (input.group_by === 'month') {
    select = `strftime('%Y-%m', t.date) AS k, strftime('%Y-%m', t.date) AS label`;
    groupBy = `strftime('%Y-%m', t.date)`;
  } else {
    select = `t.date AS k, t.date AS label`;
    groupBy = 't.date';
  }

  const { results } = await db
    .prepare(
      `SELECT ${select},
              SUM(t.amount_cents) AS total_cents,
              COUNT(*) AS count
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
        WHERE ${where.join(' AND ')}
        GROUP BY ${groupBy}
        ORDER BY ${input.group_by === 'category' ? 'total_cents DESC' : 'k ASC'}`,
    )
    .bind(...params)
    .all<{ k: string | number; label: string; total_cents: number; count: number }>();

  const buckets: SummaryBucket[] = results.map(r => ({
    key: String(r.k),
    label: r.label,
    total: centsToAmount(r.total_cents),
    count: r.count,
  }));

  const total = buckets.reduce((sum, b) => sum + b.total, 0);

  return {
    group_by: input.group_by,
    currency,
    total: roundMoney(total),
    buckets,
  };
}
