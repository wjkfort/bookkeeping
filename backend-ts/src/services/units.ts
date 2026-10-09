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
 * "个/袋/斤" onto a code. When it cannot, the original wording is preserved in
 * `unit_raw` and the code is left empty — never guessed at.
 */

import { badRequest } from './errors';

export interface Unit {
  code: string;
  name: string;
}

/**
 * The vocabulary is small, shared by all users, and changes only by migration,
 * so it is cached per isolate rather than queried on every price write.
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
      `Unknown unit "${unit}". Use list_units and one of: ${units.map(u => u.code).join(', ')}`,
      { allowed_units: units.map(u => u.code) },
      'UNKNOWN_UNIT',
    );
  }
  return unit;
}
