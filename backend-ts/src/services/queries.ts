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
import { badRequest } from './errors';
import { TX_SELECT, toTransaction, type TxRow } from './transactions';
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

export async function findTransactions(
  db: D1Database, userId: number, input: FindTransactionsInput,
): Promise<TransactionWithItemName[]> {
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

  return results.map(toTransaction);
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
