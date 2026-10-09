/**
 * R3 — the two independent reminder checks, plus `ledger_days`.
 *
 * Delivered in-conversation when the app opens: the backend computes the open
 * gaps and the AI opens with them. There is no mail, push or cron in v1.
 *
 * Two rules shape everything here:
 *
 *   1. The checks are independent queries, each scoped by `user_id`, and one
 *      failing must not block the other. `findGaps` therefore catches per-check
 *      errors and reports them rather than throwing the whole thing away.
 *   2. `ledger_days` has three states, not two. A day is skipped only when a row
 *      exists for it; `status` distinguishes "the user confirmed no spending"
 *      from "partly recorded, keep asking" (see migration 003). The check below
 *      asks whether a row exists at all, which is correct precisely because
 *      `partial` also means "stop inferring from emptiness, ask instead" — the
 *      AI has already been told about that day.
 */

import {
  listSubscriptions,
  type SubscriptionView,
} from './subscriptions';
import { badRequest, serverError } from './errors';
import { DEFAULT_TIMEZONE, localDateString } from '../utils/time';

/**
 * R3: how many days back the gap check looks.
 *
 * Decided as 3 (see the requirements doc §7.1). The window covers the three
 * complete days *before* today — see `gapWindow` for why today is excluded.
 */
export const GAP_LOOKBACK_DAYS = 3;

export type LedgerDayStatus = 'no_spend' | 'partial';

export interface MissingDay {
  date: string;
  /** Always true here: the day had no transactions at all. */
  has_transactions: false;
  status: null;
}

export interface OverdueSubscription {
  subscription_id: number;
  name: string;
  /** The period end that has passed without a renewal. */
  end_date: string;
  amount: number;
  currency: string;
  archived_at: string | null;
}

export interface GapsResult {
  /**
   * The window these gaps were computed over. `to` is yesterday, never today:
   * the check only asks about days that have finished.
   */
  window: { from: string; to: string; days: number };
  missing_days: MissingDay[];
  overdue_subscriptions: OverdueSubscription[];
  /**
   * Per-check failures. A non-empty list with the other check populated is a
   * normal outcome, not an error: one query being unavailable must not hide the
   * other's findings.
   */
  errors: { check: 'missing_days' | 'overdue_subscriptions'; message: string }[];
  /**
   * The zone the dates above were computed in. Echoed so a client can see which
   * calendar its reminders refer to rather than having to assume.
   */
  timezone: string;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The dates the check considers, oldest first: the `days` complete calendar days
 * *before* today.
 *
 * Today is deliberately excluded. A day is not "missing" while it is still
 * happening — the user may simply not have spent anything yet, or not have got
 * round to telling us. Asking about today would nag on every open, and the
 * answer ("nothing yet") carries no information. Yesterday and the days before
 * it are finished, so a lack of records there is a real gap.
 *
 * `today` is injectable so tests do not depend on the wall clock.
 */
export function gapWindow(today: string, days: number = GAP_LOOKBACK_DAYS): string[] {
  const out: string[] = [];
  const base = new Date(today + 'T00:00:00Z');
  for (let i = days; i >= 1; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(toDateString(d));
  }
  return out;
}

/** Days in the window with no transactions and no `ledger_days` row. */
export async function findMissingDays(
  db: D1Database, userId: number, today: string,
  days: number = GAP_LOOKBACK_DAYS,
): Promise<MissingDay[]> {
  const window = gapWindow(today, days);
  const from = window[0];
  const to = window[window.length - 1];

  // One query for the whole window rather than one per day.
  const { results: spent } = await db
    .prepare(
      `SELECT DISTINCT date FROM transactions
        WHERE user_id = ? AND date >= ? AND date <= ?`,
    )
    .bind(userId, from, to)
    .all<{ date: string }>();

  const { results: marked } = await db
    .prepare(
      `SELECT date FROM ledger_days
        WHERE user_id = ? AND date >= ? AND date <= ?`,
    )
    .bind(userId, from, to)
    .all<{ date: string }>();

  const hasTransactions = new Set(spent.map(r => r.date));
  const isMarked = new Set(marked.map(r => r.date));

  return window
    .filter(d => !hasTransactions.has(d) && !isMarked.has(d))
    .map(d => ({ date: d, has_transactions: false as const, status: null }));
}

/**
 * Subscriptions whose `end_date` has passed with no renewal covering it.
 *
 * Recording a renewal resolves the condition, so no extra status is needed:
 * "overdue" is derived, never stored.
 */
export async function findOverdueSubscriptions(
  db: D1Database, userId: number, today: string,
): Promise<OverdueSubscription[]> {
  const { results } = await db
    .prepare(
      `SELECT
         s.id   AS subscription_id,
         s.name AS name,
         s.end_date AS end_date,
         s.amount_cents AS amount_cents,
         s.currency AS currency,
         s.archived_at AS archived_at
       FROM subscriptions s
       WHERE s.user_id = ?
         AND s.archived_at IS NULL
         AND s.end_date < ?
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
            WHERE t.subscription_id = s.id
              AND t.user_id = s.user_id
              AND t.date >= s.end_date
         )
       ORDER BY s.end_date ASC`,
    )
    .bind(userId, today)
    .all<{
      subscription_id: number; name: string; end_date: string;
      amount_cents: number; currency: string; archived_at: string | null;
    }>();

  return results.map(r => ({
    subscription_id: r.subscription_id,
    name: r.name,
    end_date: r.end_date,
    amount: r.amount_cents / 100,
    currency: r.currency,
    archived_at: r.archived_at,
  }));
}

export interface FindGapsOptions {
  /** The reference day. Defaults to today in `timeZone`. */
  today?: string;
  days?: number;
  /** The user's IANA zone; defaults to UTC+8 (see `utils/time.ts`). */
  timezone?: string;
}

/**
 * Both checks, each isolated so a failure in one still returns the other.
 * This is the function the AI opens the conversation with.
 *
 * Named options rather than positional: the timezone would otherwise sit fourth
 * in the list, and every new parameter would risk silently shifting it.
 */
export async function findGaps(
  db: D1Database, userId: number, opts: FindGapsOptions = {},
): Promise<GapsResult> {
  const days = opts.days ?? GAP_LOOKBACK_DAYS;
  const timeZone = opts.timezone ?? DEFAULT_TIMEZONE;
  const resolvedToday = opts.today ?? localDateString(timeZone);
  const window = gapWindow(resolvedToday, days);
  const errors: GapsResult['errors'] = [];

  let missingDays: MissingDay[] = [];
  try {
    missingDays = await findMissingDays(db, userId, resolvedToday, days);
  } catch (e: any) {
    errors.push({ check: 'missing_days', message: String(e?.message ?? e) });
  }

  let overdue: OverdueSubscription[] = [];
  try {
    overdue = await findOverdueSubscriptions(db, userId, resolvedToday);
  } catch (e: any) {
    errors.push({ check: 'overdue_subscriptions', message: String(e?.message ?? e) });
  }

  return {
    window: { from: window[0], to: window[window.length - 1], days },
    missing_days: missingDays,
    overdue_subscriptions: overdue,
    errors,
    timezone: timeZone,
  };
}

// ------------------------------------------------------------- ledger_days

export interface LedgerDay {
  user_id: number;
  date: string;
  status: LedgerDayStatus;
  created_at: string;
}

/**
 * Record what the user said about a day.
 *
 * `no_spend` — "I spent nothing that day": stop asking.
 * `partial`  — "only some of it is recorded": keep the day open.
 *
 * Upserted, because the user can revise an answer ("actually I did buy lunch"),
 * and the call is idempotent so a repeated answer is not an error.
 */
export async function markLedgerDay(
  db: D1Database, userId: number, date: string,
  status: LedgerDayStatus = 'no_spend',
): Promise<LedgerDay> {
  if (status !== 'no_spend' && status !== 'partial') {
    throw badRequest("status must be 'no_spend' or 'partial'");
  }

  await db
    .prepare(
      `INSERT INTO ledger_days (user_id, date, status, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status`,
    )
    .bind(userId, date, status, new Date().toISOString())
    .run();

  const row = await db
    .prepare('SELECT * FROM ledger_days WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .first<LedgerDay>();

  if (!row) {
    throw serverError('Failed to record the day');
  }
  return row;
}

export async function getLedgerDay(
  db: D1Database, userId: number, date: string,
): Promise<LedgerDay | null> {
  const row = await db
    .prepare('SELECT * FROM ledger_days WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .first<LedgerDay>();
  return row ?? null;
}

/** Convenience for the reminder UI: the subscription views behind overdue ids. */
export async function overdueSubscriptionNames(
  db: D1Database, userId: number, today: string,
): Promise<{ subscription: SubscriptionView; overdue: OverdueSubscription }[]> {
  const [overdue, subs] = await Promise.all([
    findOverdueSubscriptions(db, userId, today),
    listSubscriptions(db, userId, true),
  ]);

  const byId = new Map(subs.map(s => [s.id, s]));
  return overdue
    .map(o => ({ subscription: byId.get(o.subscription_id)!, overdue: o }))
    .filter(x => x.subscription !== undefined);
}
