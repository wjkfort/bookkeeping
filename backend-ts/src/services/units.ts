/**
 * The unit vocabulary (`units`).
 *
 * `units.code` is a closed list and `item_prices.unit` references it. On D1 the
 * foreign key genuinely bites — verified against a real `wrangler dev` D1, which
 * reports `PRAGMA foreign_keys = 1` — so writing an unknown unit fails with:
 *
 *   D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT
 *
 * That is the desired outcome (comparing "12.8/个" against "12.8/pack" is
 * meaningless), but it is a database exception, not something a model can learn
 * from. R6 treats model output as untrusted input that must get feedback it can
 * act on, so callers validate here first and get a 400 naming the legal codes.
 *
 * §5.1 assigns the mapping to the model: it should call `list_units` and map
 * "个/袋/斤" onto a code. When nothing fits it can call `add_unit` and use the
 * code it creates, so a real unit like 斤 no longer has to sit in `unit_raw` with
 * no code beside it and stay incomparable forever. The wording is still recorded
 * either way, and a unit is still never guessed at or converted.
 */

import { badRequest, serverError } from './errors';

export interface Unit {
  code: string;
  name: string;
}

/**
 * The vocabulary is small and shared by all users, so it is cached per isolate
 * rather than queried on every price write.
 *
 * `add_unit` is why the cache is cleared by the write instead of only filled on
 * a cold start. A stale cache after an insert is nearly invisible: the model
 * adds 斤, reads back a list without it, and `assertKnownUnit` then rejects 斤 on
 * the very price that motivated adding it — a failure that reads as "the add
 * silently did nothing". Keeping the write and the invalidation in one function
 * is what stops a later caller from forgetting the second half.
 */
let cached: Unit[] | null = null;

export async function listUnits(db: D1Database): Promise<Unit[]> {
  if (cached) return cached;

  const { results } = await db
    .prepare('SELECT code, name FROM units ORDER BY code')
    .all<Unit>();

  cached = results;
  return results;
}

/** Reset the per-isolate cache. Used by tests that swap databases. */
export function clearUnitsCache(): void {
  cached = null;
}

/**
 * Validate a unit code against the vocabulary.
 *
 * Returns the code, or null when the caller passed nothing (an observation may
 * legitimately have no unit). Throws a 400 listing the legal codes when the
 * value is not in the vocabulary, so the model can retry with a valid one.
 */
export async function assertKnownUnit(
  db: D1Database, unit: string | null | undefined,
): Promise<string | null> {
  if (unit === null || unit === undefined || unit === '') return null;

  const units = await listUnits(db);
  if (!units.some(u => u.code === unit)) {
    throw badRequest(
      `Unknown unit "${unit}". Call list_units and use one of: ${units.map(u => u.code).join(', ')}`
      + ' — or add_unit first when the user named a unit the vocabulary does not have.',
      { allowed_units: units.map(u => u.code) },
      'UNKNOWN_UNIT',
    );
  }
  return unit;
}

/** Longest unit code accepted, in characters (not bytes). */
export const MAX_UNIT_CODE_LENGTH = 8;

/**
 * Normalise and check a unit the model asked to add.
 *
 * NFKC folds the full-width forms a Chinese IME happily produces ("ｋｇ", "１") onto
 * their ASCII equivalents, so one unit cannot enter the table twice under two
 * spellings that look identical on screen and differ in a payload. `trim` does
 * the same for " 斤 ". Control characters are refused outright: the code ends up
 * as a locale key, a JSON value and a sort key, and a newline serves none of them.
 */
function normaliseUnitCode(raw: unknown): string {
  const shown = typeof raw === 'string' ? raw.slice(0, 40) : String(raw);
  const reject = (why: string): never => {
    throw badRequest(
      `"${shown}" is not a usable unit: ${why}.`,
      { max_length: MAX_UNIT_CODE_LENGTH },
      'INVALID_UNIT',
    );
  };

  if (typeof raw !== 'string') reject('a unit must be text');
  const code = (raw as string).normalize('NFKC').trim();
  if (code.length === 0) reject('it is empty');
  if (code.length > MAX_UNIT_CODE_LENGTH) {
    reject(`a unit may be at most ${MAX_UNIT_CODE_LENGTH} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(code)) reject('it contains a control character');
  return code;
}

export interface AddUnitResult {
  code: string;
  name: string;
  /** False when the code was already in the vocabulary — success, not a conflict. */
  created: boolean;
}

/**
 * Add a unit to the shared vocabulary (the model's `add_unit`).
 *
 * Idempotent on purpose. The vocabulary is shared and `item_prices.unit` points
 * at it, so "this code already exists" must not rewrite the row: renaming a unit
 * would silently change how every past price reads, for every user. Returning
 * the existing row with `created: false` still hands the model the code it
 * actually wanted, so its next call succeeds and the user is told the unit was
 * already there rather than that something failed.
 *
 * `name` is set to the code. The nine seeded units carry English words for names
 * and are labelled per language by the client; a unit added from a conversation
 * has no translation to offer, so the code is the honest display value and the
 * client falls back to it.
 */
export async function addUnit(db: D1Database, raw: unknown): Promise<AddUnitResult> {
  const code = normaliseUnitCode(raw);

  const info = await db
    .prepare('INSERT OR IGNORE INTO units (code, name) VALUES (?, ?)')
    .bind(code, code)
    .run();

  // Cleared before the read below, not after, so the row just written is the one
  // this call — and the price write that follows it in the same turn — sees.
  cached = null;

  const row = await db
    .prepare('SELECT code, name FROM units WHERE code = ?')
    .bind(code)
    .first<Unit>();

  if (!row) {
    // Reachable only if the insert was ignored for a reason other than a
    // duplicate code, which would be a broken binding rather than bad input.
    throw serverError('Failed to add the unit');
  }

  return {
    code: row.code,
    name: row.name,
    created: Number((info as any)?.meta?.changes ?? 0) > 0,
  };
}
