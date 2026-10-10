/**
 * Subscription reads and writes, including renewal.
 *
 * Extracted from `src/api/subscriptions.ts` so the HTTP handlers and the AI
 * tools (`list_subscriptions`, `add_subscription`, `update_subscription`,
 * `archive_subscription`, `renew_subscription`) share one implementation.
 *
 * `renewSubscription` is the substantial one: it advances `end_date` by the
 * cycle and writes the renewal as a transaction carrying `subscription_id`.
 * That transaction *is* the renewal — v2 dropped `subscription_renewals`, and
 * `last_renewed_at` is derived from it — which is why R3 can treat "overdue" as
 * "the period has passed and no renewal transaction exists" without extra state.
 *
 * The API contract is unchanged: `amount` stays decimal, `cycle` keeps its old
 * name over `cycle_days`, and `last_renewed_at` is still present.
 */

import type { Subscription, SubscriptionRow, SubscriptionRenewal } from '../types';
import { toCents, centsToAmount } from '../utils/money';
import { isDateOnly, todayInZone } from '../utils/time';
import { badRequest, notFound, serverError } from './errors';
import { ensureOwnedCategory } from './transactions';

/**
 * Advance a calendar date by `days`.
 *
 * Pure calendar arithmetic on a `YYYY-MM-DD` string, anchored at UTC midnight so
 * the result cannot drift: a cycle is a number of days, not a number of hours,
 * and must not become 29 or 31 because of a DST transition in some zone. The
 * zoned "what day is it now" question is answered separately, in `utils/time.ts`.
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Subscription row plus the joined category name and derived renewal date. */
export interface SubscriptionJoined extends SubscriptionRow {
  category_name: string | null;
  last_renewed_at: string | null;
}

// `last_renewed_at` was dropped in v2: it is the timestamp of the subscription's
// most recent renewal transaction. The transaction's created_at is used rather
// than its date, because the v1 column held a full timestamp and the renewal
// transaction is written at the moment of renewal.
export const SUBSCRIPTION_SELECT = `
  SELECT
    s.id, s.user_id, s.name, s.icon, s.amount_cents, s.currency,
    s.cycle_days, s.end_date, s.category_id, s.archived_at, s.created_at,
    c.name as category_name,
    (SELECT t.created_at FROM transactions t
      WHERE t.subscription_id = s.id AND t.user_id = s.user_id
      ORDER BY t.date DESC, t.created_at DESC LIMIT 1) as last_renewed_at
  FROM subscriptions s
  LEFT JOIN categories c ON s.category_id = c.id
`;

export type SubscriptionView = Subscription & { category_name: string | null };

/**
 * Storage row -> wire shape. The API contract is unchanged: `amount` stays
 * decimal, `cycle` keeps its old name, and `last_renewed_at` is still present.
 */
export function toSubscription(row: SubscriptionJoined): SubscriptionView {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    amount: centsToAmount(row.amount_cents),
    currency: row.currency,
    end_date: row.end_date,
    cycle: row.cycle_days,
    category_id: row.category_id,
    category_name: row.category_name,
    last_renewed_at: row.last_renewed_at,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

export async function fetchSubscription(
  db: D1Database, id: number, userId: number,
): Promise<SubscriptionView | null> {
  const row = await db
    .prepare(`${SUBSCRIPTION_SELECT} WHERE s.id = ? AND s.user_id = ?`)
    .bind(id, userId)
    .first<SubscriptionJoined>();
  return row ? toSubscription(row) : null;
}

/** The stored row (cents, `cycle_days`), for internal logic. */
export async function fetchSubscriptionRow(
  db: D1Database, id: number, userId: number,
): Promise<SubscriptionRow | null> {
  const row = await db
    .prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<SubscriptionRow>();
  return row ?? null;
}

export async function listSubscriptions(
  db: D1Database, userId: number, includeArchived = false,
): Promise<SubscriptionView[]> {
  const { results } = await db
    .prepare(
      `${SUBSCRIPTION_SELECT}
      WHERE s.user_id = ?
        ${includeArchived ? "" : "AND s.archived_at IS NULL"}
      ORDER BY s.archived_at IS NOT NULL, s.end_date ASC`,
    )
    .bind(userId)
    .all<SubscriptionJoined>();

  return results.map(toSubscription);
}

// ------------------------------------------------------------------ create

export interface CreateSubscriptionInput {
  name: string;
  icon?: string;
  amount?: number;
  currency?: string;
  end_date: string;
  cycle?: number;
  category_id?: number | null;
}

export async function createSubscription(
  db: D1Database, userId: number, input: CreateSubscriptionInput,
): Promise<SubscriptionView> {
  const { name, icon, amount = 0, currency = "USD", end_date, cycle = 30, category_id = null } = input;

  if (!name || !end_date) {
    throw badRequest("name and end_date are required");
  }

  if (!isDateOnly(end_date)) {
    throw badRequest("end_date must be a real date in YYYY-MM-DD form",
                     { end_date }, "INVALID_DATE");
  }

  if (cycle < 1) {
    throw badRequest("cycle must be at least 1 day");
  }

  if (category_id) {
    if (!(await ensureOwnedCategory(db, category_id, userId))) {
      throw notFound("Category not found");
    }
  }

  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `INSERT INTO subscriptions (user_id, name, icon, amount_cents, currency, end_date, cycle_days, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(userId, name, icon || null, toCents(amount), currency, end_date, cycle, category_id, now)
    .first<{ id: number }>();

  if (!result) {
    throw serverError("Failed to create subscription");
  }

  const full = await fetchSubscription(db, result.id, userId);
  if (!full) {
    throw serverError("Failed to create subscription");
  }
  return full;
}

// ------------------------------------------------------------------ update

export interface UpdateSubscriptionInput {
  name?: string;
  icon?: string | null;
  amount?: number;
  currency?: string;
  end_date?: string;
  cycle?: number;
  category_id?: number | null;
}

export async function updateSubscription(
  db: D1Database, userId: number, id: number, body: UpdateSubscriptionInput,
): Promise<SubscriptionView> {
  const { name, icon, amount, currency, end_date, cycle, category_id } = body;

  const existing = await db
    .prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  if (!existing) {
    throw notFound("Subscription not found");
  }

  const updates: string[] = [];
  const values: (number | string | null)[] = [];

  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (icon !== undefined) {
    updates.push("icon = ?");
    values.push(icon);
  }
  if (amount !== undefined) {
    updates.push("amount_cents = ?");
    values.push(toCents(amount));
  }
  if (currency !== undefined) {
    updates.push("currency = ?");
    values.push(currency);
  }
  if (end_date !== undefined) {
    if (!isDateOnly(end_date)) {
      throw badRequest("end_date must be a real date in YYYY-MM-DD form",
                     { end_date }, "INVALID_DATE");
    }
    updates.push("end_date = ?");
    values.push(end_date);
  }
  if (cycle !== undefined) {
    if (cycle < 1) {
      throw badRequest("cycle must be at least 1 day");
    }
    updates.push("cycle_days = ?");
    values.push(cycle);
  }
  if (category_id !== undefined) {
    if (category_id !== null) {
      if (!(await ensureOwnedCategory(db, category_id, userId))) {
        throw notFound("Category not found");
      }
    }
    updates.push("category_id = ?");
    values.push(category_id);
  }

  if (updates.length === 0) {
    throw badRequest("No fields to update");
  }

  values.push(id, userId);

  const result = await db
    .prepare(
      `UPDATE subscriptions
       SET ${updates.join(", ")}
       WHERE id = ? AND user_id = ?
       RETURNING *`,
    )
    .bind(...values)
    .first<Subscription>();

  if (!result) {
    throw notFound("Subscription not found");
  }

  const full = await fetchSubscription(db, result.id, userId);
  if (!full) {
    throw serverError("Failed to update subscription");
  }
  return full;
}

// --------------------------------------------------------- archive/restore

export async function archiveSubscription(
  db: D1Database, userId: number, id: number,
): Promise<SubscriptionView> {
  const result = await db
    .prepare("UPDATE subscriptions SET archived_at = ? WHERE id = ? AND user_id = ? RETURNING id")
    .bind(new Date().toISOString(), id, userId)
    .first();

  if (!result) {
    throw notFound("Subscription not found");
  }

  const full = await fetchSubscription(db, id, userId);
  if (!full) {
    throw notFound("Subscription not found");
  }
  return full;
}

export async function restoreSubscription(
  db: D1Database, userId: number, id: number,
  body: { end_date?: string; cycle?: number },
): Promise<SubscriptionView> {
  const { end_date, cycle } = body;

  if (!end_date || !isDateOnly(end_date)) {
    throw badRequest("end_date is required and must be a real date in YYYY-MM-DD form",
                     { end_date }, "INVALID_DATE");
  }
  if (cycle !== undefined && (typeof cycle !== "number" || cycle < 1)) {
    throw badRequest("cycle must be at least 1 day");
  }

  // Only archived subscriptions can be restored
  const existing = await db
    .prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ? AND archived_at IS NOT NULL")
    .bind(id, userId)
    .first();
  if (!existing) {
    throw notFound("Subscription not found or not archived");
  }

  await db
    .prepare(
      `UPDATE subscriptions
       SET end_date = ?, cycle_days = COALESCE(?, cycle_days), archived_at = NULL
       WHERE id = ? AND user_id = ?`,
    )
    .bind(end_date, cycle ?? null, id, userId)
    .run();

  const full = await fetchSubscription(db, id, userId);
  if (!full) {
    throw notFound("Subscription not found");
  }
  return full;
}

// ------------------------------------------------------------------ delete

export async function deleteSubscription(
  db: D1Database, userId: number, id: number,
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM subscriptions WHERE id = ? AND user_id = ? RETURNING id")
    .bind(id, userId)
    .first();

  if (!result) {
    throw notFound("Subscription not found");
  }
}

// ------------------------------------------------------------------- renew

export interface RenewSubscriptionInput {
  amount?: number;
  currency?: string;
  date?: string;
  category_id?: number | null;
  create_transaction?: boolean;
  description?: string;
  /** AI-only: record who wrote the renewal transaction. */
  source?: 'manual' | 'ai';
  /** The user's IANA zone, for defaulting the renewal date to their calendar day. */
  timezone?: string | null;
}

export interface RenewResult {
  subscription: SubscriptionView | null;
  renewal: SubscriptionRenewal;
  transaction_id: number | null;
}

/**
 * Advance `end_date` by one cycle and record the renewal.
 *
 * The renewal transaction is what makes R3's overdue check resolvable: once it
 * exists, the period has been paid for and the subscription stops being
 * overdue. When `create_transaction` is false (or the amount is zero) the date
 * still advances and no transaction is written.
 */
export async function renewSubscription(
  db: D1Database, userId: number, id: number, body: RenewSubscriptionInput,
): Promise<RenewResult> {
  const subscription = await fetchSubscriptionRow(db, id, userId);

  if (!subscription) {
    throw notFound("Subscription not found");
  }

  if (subscription.archived_at) {
    throw badRequest("Cannot renew an archived subscription. Restore it first.");
  }

  // `amount` arrives in dollars and is stored in cents; keep the cents value
  // so the transaction insert and the response agree on the unit.
  const amount = body.amount !== undefined ? body.amount : centsToAmount(subscription.amount_cents);
  const currency = body.currency || subscription.currency;
  const createTx = body.create_transaction !== false;
  const categoryId =
    body.category_id !== undefined ? body.category_id : subscription.category_id;
  // As with createTransaction: an absent date is resolved in the user's zone,
  // but a supplied one that is not a real date is rejected. Recording a renewal
  // on the wrong day because the model sent "next month" is not a recovery.
  if (body.date !== undefined && body.date !== null && !isDateOnly(body.date)) {
    throw badRequest("date must be a real date in YYYY-MM-DD form", { date: body.date },
                     "INVALID_DATE");
  }
  const txDate = body.date ?? todayInZone(body.timezone);
  const description =
    body.description?.trim() || `Subscription renewal: ${subscription.name}`;

  if (createTx && amount > 0 && !categoryId) {
    throw badRequest(
      "category_id is required to create a transaction (set it on the subscription or pass it in the request)",
    );
  }

  if (createTx && categoryId) {
    const category = await db
      .prepare("SELECT id, type FROM categories WHERE id = ? AND user_id = ?")
      .bind(categoryId, userId)
      .first<{ id: number; type: string }>();
    if (!category) {
      throw notFound("Category not found");
    }
    if (category.type !== "expense") {
      throw badRequest("Renewal category must be an expense category");
    }
  }

  const periodStart = subscription.end_date;
  const periodEnd = addDays(subscription.end_date, subscription.cycle_days);
  const now = new Date().toISOString();

  let transactionId: number | null = null;

  if (createTx && amount > 0 && categoryId) {
    // The renewal transaction carries subscription_id, which replaces the
    // dropped subscription_renewals table and makes last_renewed_at derivable.
    const tx = await db
      .prepare(
        `INSERT INTO transactions (user_id, amount_cents, currency, description, date, category_id, subscription_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        userId, toCents(amount), currency, description, txDate, categoryId, id,
        body.source ?? 'manual', now, now,
      )
      .first<{ id: number }>();
    transactionId = tx?.id ?? null;
  }

  await db
    .prepare(
      `UPDATE subscriptions
       SET end_date = ?, category_id = COALESCE(?, category_id)
       WHERE id = ? AND user_id = ?`,
    )
    .bind(periodEnd, categoryId, id, userId)
    .run();

  // subscription_renewals is gone in v2, but the API contract still returns a
  // renewal record describing this renewal, so it is composed from the values
  // already in hand rather than read back.
  const renewal: SubscriptionRenewal = {
    id: transactionId ?? 0,
    user_id: userId,
    subscription_id: id,
    transaction_id: transactionId,
    amount,
    currency,
    period_start: periodStart,
    period_end: periodEnd,
    renewed_at: now,
  };

  const updated = await fetchSubscription(db, id, userId);

  return { subscription: updated, renewal, transaction_id: transactionId };
}

/** Renewal history: the transactions carrying this subscription_id. */
export async function listRenewals(
  db: D1Database, userId: number, id: number,
): Promise<SubscriptionRenewal[]> {
  const subscription = await db
    .prepare("SELECT id, cycle_days FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ id: number; cycle_days: number }>();

  if (!subscription) {
    throw notFound("Subscription not found");
  }

  // The cycle length is not stored per renewal, so the period end is derived.
  const { results } = await db
    .prepare(
      `SELECT t.id, t.user_id, t.amount_cents, t.currency, t.date, t.subscription_id,
              t.created_at
       FROM transactions t
       WHERE t.subscription_id = ? AND t.user_id = ?
       ORDER BY t.date DESC, t.created_at DESC`,
    )
    .bind(id, userId)
    .all<{
      id: number; user_id: number; amount_cents: number; currency: string;
      date: string; subscription_id: number; created_at: string;
    }>();

  return results.map(r => ({
    id: r.id,
    user_id: r.user_id,
    subscription_id: r.subscription_id,
    transaction_id: r.id,
    amount: centsToAmount(r.amount_cents),
    currency: r.currency,
    period_start: r.date,
    period_end: addDays(r.date, subscription.cycle_days),
    renewed_at: r.created_at,
  }));
}
