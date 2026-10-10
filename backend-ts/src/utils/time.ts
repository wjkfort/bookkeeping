/**
 * Date arithmetic in the user's own timezone.
 *
 * The server runs in UTC, but "today" is a question about the *user's* calendar.
 * Getting this wrong is not cosmetic: at 01:00 in UTC+8 the UTC date is still
 * yesterday, so a window derived from UTC asks about the day before last and
 * misses the day the user has just lived through — and a purchase made then is
 * filed under the wrong date.
 *
 * The rule (decided): the client tells the server its IANA zone; when it does
 * not (older client, direct API call, a tool) the default is **UTC+8**, because
 * this is a China-facing ledger. Anything derived from "now" goes through here,
 * so the reminder window and the dates writes are filed under can never drift
 * apart.
 */

import { badRequest } from '../services/errors';

/** Used when the caller sends no timezone. */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/**
 * Today in the user's zone — the default for anything the server dates itself.
 *
 * Writes go through this too, on purpose: if the reminder window used the local
 * day but a purchase recorded at 01:00 were filed under the UTC day, the two
 * would disagree about which day the user just had.
 */
export function todayInZone(
  timeZone: string | undefined | null, now: Date = new Date(),
): string {
  return localDateString(
    isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE, now,
  );
}

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a caller-supplied timezone, throwing a 400 it can act on.
 *
 * Validation lives at the edge rather than deep in the date helpers so that a
 * typo produces "unknown timezone" instead of a confusing failure later.
 */
export function requireTimezone(tz: unknown): string {
  if (tz === undefined || tz === null || tz === '') return DEFAULT_TIMEZONE;
  if (!isValidTimezone(tz)) {
    throw badRequest(
      `Unknown timezone "${String(tz)}". Use an IANA zone name such as Asia/Shanghai.`,
      { code: 'UNKNOWN_TIMEZONE' },
      'UNKNOWN_TIMEZONE',
    );
  }
  return tz;
}

/**
 * The calendar date at `now` in `timeZone`, as `YYYY-MM-DD`.
 *
 * `en-CA` is used because its short date format is already ISO-shaped, so the
 * parts can be joined without locale guesswork.
 */
export function localDateString(
  timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Today in the user's zone, plus the window of the `days` complete days before
 * it. Today is excluded on purpose: see `services/gaps.ts`.
 */
export function localGapWindow(
  timeZone: string = DEFAULT_TIMEZONE, days = 3, now: Date = new Date(),
): { today: string; window: string[] } {
  const today = localDateString(timeZone, now);
  const base = new Date(today + 'T00:00:00Z');
  const window: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    window.push(d.toISOString().slice(0, 10));
  }
  return { today, window };
}

/**
 * A date-only string, `YYYY-MM-DD`, that is also a real calendar date.
 *
 * The shape alone is not enough. `2026-02-30` matches `/^\d{4}-\d{2}-\d{2}$/`
 * and every date function accepts it, and SQLite's normalises it to 2026-03-02
 * — but `summary.ts` and `queries.ts` group by `strftime('%Y-%m', date)`, which
 * returns NULL for anything it cannot parse. A malformed date therefore does not
 * raise: the row simply leaves every monthly total (R6's silent wrong number,
 * the same class of failure the category rules guard against).
 *
 * `new Date(Date.UTC(...))` is the round trip that catches it: a day that
 * overflows its month rolls forward, so the parts no longer match the input.
 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

