/**
 * Item price observations and the statistics derived from them.
 *
 * `item_prices` holds one row per price *seen*, which is not the same as one row
 * per purchase: a price can be logged without a transaction (a shelf price
 * noticed while shopping). R4 requires that trends, averages and "was it cheaper
 * last time" come from SQL rather than from the model, so every figure here is
 * computed by the database and merely shaped on the way out (R5).
 *
 * Two hard constraints are enforced by the schema and re-checked here so that a
 * model gets feedback it can act on instead of a raw constraint error:
 *
 *   - `unit` must be a `units.code` (see services/units.ts)
 *   - the raw `merchant` wording is stored next to the resolved `merchant_id`
 *
 * Money crosses this boundary as decimals; conversion to cents happens once,
 * at the `unit_price` → `unit_price_cents` step.
 */

import { toCents, toAmount } from '../utils/money';
import { todayInZone } from '../utils/time';
import { badRequest, notFound, serverError } from './errors';
import { listUnits } from './units';
import { resolveMerchant } from './merchants';

/**
 * R4: flag a price that is this far above the item's recent average.
 * Percentage, so 10 means "more than 10% above average".
 */
export const PRICE_SPIKE_THRESHOLD_PCT = 10;

const PRICE_SELECT = `
  SELECT
    ip.id, ip.user_id, ip.item_id, ip.transaction_id,
    ip.unit_price_cents, ip.quantity, ip.unit, ip.unit_raw, ip.currency,
    ip.merchant, ip.merchant_id, ip.observed_on, ip.created_at,
    i.name as item_name
  FROM item_prices ip
  JOIN items i ON i.id = ip.item_id AND i.user_id = ip.user_id
`;

export interface PriceRow {
  id: number;
  user_id: number;
  item_id: number;
  transaction_id: number | null;
  unit_price_cents: number;
  quantity: number | null;
  unit: string | null;
  unit_raw: string | null;
  currency: string;
  merchant: string | null;
  merchant_id: number | null;
  observed_on: string;
  created_at: string;
  item_name: string;
}

export interface Price {
  id: number;
  user_id: number;
  item_id: number;
  item_name: string;
  transaction_id: number | null;
  unit_price: number;
  quantity: number | null;
  unit: string | null;
  unit_raw: string | null;
  currency: string;
  merchant: string | null;
  merchant_id: number | null;
  observed_on: string;
  created_at: string;
}

export interface StatsRow {
  item_id: number;
  count: number;
  last_unit_price_cents: number | null;
  last_observed_on: string | null;
  average_unit_price_cents: number | null;
  min_unit_price_cents: number | null;
  max_unit_price_cents: number | null;
}

export interface PriceStats {
  item_id: number;
  count: number;
  last_unit_price: number | null;
  last_observed_on: string | null;
  average_unit_price: number | null;
  min_unit_price: number | null;
  max_unit_price: number | null;
}

export function toPrice(row: PriceRow): Price {
  return {
    id: row.id,
    user_id: row.user_id,
    item_id: row.item_id,
    item_name: row.item_name,
    transaction_id: row.transaction_id,
    unit_price: row.unit_price_cents / 100,
    quantity: row.quantity,
    unit: row.unit,
    unit_raw: row.unit_raw,
    currency: row.currency,
    merchant: row.merchant,
    merchant_id: row.merchant_id,
    observed_on: row.observed_on,
    created_at: row.created_at,
  };
}

/**
 * Round a cents average to the nearest cent before showing decimals, matching
 * what the pre-extraction `/prices/stats` handler returned.
 */
export function toStats(row: StatsRow): PriceStats {
  return {
    item_id: row.item_id,
    count: row.count,
    last_unit_price: toAmount(row.last_unit_price_cents),
    last_observed_on: row.last_observed_on,
    average_unit_price: toAmount(
      row.average_unit_price_cents === null ? null : Math.round(row.average_unit_price_cents),
    ),
    min_unit_price: toAmount(row.min_unit_price_cents),
    max_unit_price: toAmount(row.max_unit_price_cents),
  };
}

// ------------------------------------------------------------------ reads

/** Price observations, newest first, optionally narrowed to one item. */
export async function listPrices(
  db: D1Database, userId: number,
  opts: { item_id?: number; merchant?: string; limit?: number } = {},
): Promise<Price[]> {
  const where: string[] = ['ip.user_id = ?'];
  const params: any[] = [userId];

  if (opts.item_id !== undefined) {
    if (Number.isNaN(opts.item_id)) throw badRequest('Invalid item_id');
    where.push('ip.item_id = ?');
    params.push(opts.item_id);
  }

  if (opts.merchant) {
    where.push('ip.merchant = ?');
    params.push(opts.merchant);
  }

  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));

  const { results } = await db
    .prepare(
      `${PRICE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY ip.observed_on DESC, ip.created_at DESC
       LIMIT ?`,
    )
    .bind(...params, limit)
    .all<PriceRow>();

  return results.map(toPrice);
}

/**
 * last / average / min / max per item.
 *
 * `last_unit_price` is the newest observation, picked by the same keys the
 * history list orders on (observed_on, then created_at).
 */
export async function getPriceStats(
  db: D1Database, userId: number, itemId?: number,
): Promise<PriceStats[]> {
  const where: string[] = ['ip.user_id = ?'];
  const params: any[] = [userId];

  if (itemId !== undefined) {
    if (Number.isNaN(itemId)) throw badRequest('Invalid item_id');
    where.push('ip.item_id = ?');
    params.push(itemId);
  }

  const { results } = await db
    .prepare(
      `SELECT
         ip.item_id,
         COUNT(*) as count,
         (SELECT ip2.unit_price_cents FROM item_prices ip2
            WHERE ip2.item_id = ip.item_id AND ip2.user_id = ip.user_id
            ORDER BY ip2.observed_on DESC, ip2.created_at DESC LIMIT 1) as last_unit_price_cents,
         (SELECT ip2.observed_on FROM item_prices ip2
            WHERE ip2.item_id = ip.item_id AND ip2.user_id = ip.user_id
            ORDER BY ip2.observed_on DESC, ip2.created_at DESC LIMIT 1) as last_observed_on,
         AVG(ip.unit_price_cents) as average_unit_price_cents,
         MIN(ip.unit_price_cents) as min_unit_price_cents,
         MAX(ip.unit_price_cents) as max_unit_price_cents
       FROM item_prices ip
       WHERE ${where.join(' AND ')}
       GROUP BY ip.item_id
       ORDER BY ip.item_id`,
    )
    .bind(...params)
    .all<StatsRow>();

  return results.map(toStats);
}

export interface MerchantComparison {
  merchant: string;
  count: number;
  average_unit_price: number;
  min_unit_price: number;
  max_unit_price: number;
}

/** Per-merchant comparison for one item ("is it cheaper at X?"). */
export async function compareMerchants(
  db: D1Database, userId: number, itemId: number,
): Promise<MerchantComparison[]> {
  if (Number.isNaN(itemId)) throw badRequest('Invalid item_id');

  const { results } = await db
    .prepare(
      `SELECT
         ip.merchant,
         COUNT(*) as count,
         AVG(ip.unit_price_cents) as average_unit_price_cents,
         MIN(ip.unit_price_cents) as min_unit_price_cents,
         MAX(ip.unit_price_cents) as max_unit_price_cents
       FROM item_prices ip
       WHERE ip.user_id = ? AND ip.item_id = ? AND ip.merchant IS NOT NULL
       GROUP BY ip.merchant
       ORDER BY average_unit_price_cents ASC`,
    )
    .bind(userId, itemId)
    .all<{
      merchant: string; count: number; average_unit_price_cents: number;
      min_unit_price_cents: number; max_unit_price_cents: number;
    }>();

  return results.map(r => ({
    merchant: r.merchant,
    count: r.count,
    average_unit_price: Math.round(r.average_unit_price_cents) / 100,
    min_unit_price: r.min_unit_price_cents / 100,
    max_unit_price: r.max_unit_price_cents / 100,
  }));
}

export async function fetchPrice(
  db: D1Database, userId: number, id: number,
): Promise<Price | null> {
  const row = await db
    .prepare(`${PRICE_SELECT} WHERE ip.id = ? AND ip.user_id = ?`)
    .bind(id, userId)
    .first<PriceRow>();
  return row ? toPrice(row) : null;
}

// ----------------------------------------------------------------- writes

export interface LogPriceInput {
  item_id?: number | null;
  item_name?: string | null;
  unit_price: number;
  quantity?: number | null;
  /** A `units.code`. The AI tool sets this from `unit_raw` via `list_units`. */
  unit?: string | null;
  /** The user's own wording ("个"); preserved even when the code is set. */
  unit_raw?: string | null;
  currency?: string;
  merchant?: string | null;
  observed_on?: string;
  transaction_id?: number | null;
  /** The user's IANA zone, for defaulting `observed_on` to their calendar day. */
  timezone?: string | null;
}

/**
 * Resolve the user's wording and/or a code into the pair the schema stores.
 *
 * The column pair exists because comparing prices across units is meaningless:
 * "12.8/个" and "12.8/pack" are different prices. When the user's wording is a
 * known code the two coincide; when it is not, the wording is kept in `unit_raw`
 * and the code is left empty rather than guessed at (§5.1).
 */
/**
 * Resolve the wording and/or code a caller supplied into the pair stored.
 *
 * A value that is not in `units` is treated as the user's own wording rather
 * than rejected. That is deliberate, and it fixes a real failure: hard-rejecting
 * "斤" produced `UNKNOWN_UNIT`, the model retried, and its retry was to CONVERT
 * 斤 into kg — writing 5 kg for what is 2.5 kg, a wrong number in the price
 * history. Nothing is lost by keeping the number as stated and the wording in
 * `unit_raw`: no comparison can be made against it (there is no code), which the
 * assistant reports, and a later migration can map the wording properly.
 *
 * "Never invent a unit code" is still honoured — an unmappable unit yields no
 * code at all — and the schema's foreign key remains the real guarantee.
 */
export async function resolveUnitPair(
  db: D1Database, unit?: string | null, unitRaw?: string | null,
): Promise<{ unit: string | null; unit_raw: string | null; unmapped?: string }> {
  const supplied = unit ?? null;
  const units = await listUnits(db);
  const isCode = supplied !== null && units.some(u => u.code === supplied);

  if (supplied !== null && !isCode) {
    // Not a code: keep the wording exactly as given, with no code.
    return { unit: null, unit_raw: unitRaw ?? supplied, unmapped: supplied };
  }

  return { unit: supplied, unit_raw: unitRaw ?? supplied };
}

/**
 * Record one observed price, with or without a transaction.
 *
 * `item_id` is verified to belong to the user (the model cannot pick a user or
 * reach another user's item), and `unit` is validated against the vocabulary
 * before touching the table so failures are actionable.
 */
export async function logPrice(
  db: D1Database, userId: number, input: LogPriceInput,
): Promise<Price> {
  const { unit_price, quantity, unit, transaction_id } = input;
  const currency = input.currency || 'CNY';

  if (unit_price === undefined || unit_price === null || !(unit_price >= 0)) {
    throw badRequest('unit_price is required and must not be negative');
  }

  if (currency.length !== 3) {
    throw badRequest('Currency must be a 3-letter code');
  }

  // Resolve the item: an explicit id must be the user's, a name is found or
  // created.
  let itemId = input.item_id ?? null;

  if (itemId !== null) {
    const owned = await db
      .prepare('SELECT id FROM items WHERE id = ? AND user_id = ?')
      .bind(itemId, userId)
      .first();
    if (!owned) throw notFound('Item not found');
  } else if (input.item_name && input.item_name.trim().length > 0) {
    const name = input.item_name.trim();
    const existing = await db
      .prepare('SELECT id FROM items WHERE name = ? AND user_id = ?')
      .bind(name, userId)
      .first<{ id: number }>();
    if (existing) {
      itemId = existing.id;
    } else {
      const created = await db
        .prepare('INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id')
        .bind(name, userId, new Date().toISOString())
        .first<{ id: number }>();
      itemId = created?.id ?? null;
    }
  }

  if (itemId === null) {
    throw badRequest('Either item_id or item_name is required');
  }

  if (transaction_id !== undefined && transaction_id !== null) {
    const ownedTx = await db
      .prepare('SELECT id, date FROM transactions WHERE id = ? AND user_id = ?')
      .bind(transaction_id, userId)
      .first<{ id: number; date: string }>();
    if (!ownedTx) throw notFound('Transaction not found');
  }

  // Validated here rather than left to the foreign key, so the model receives
  // a 400 naming the legal units instead of a constraint error. The user's own
  // wording is preserved in unit_raw whether or not it mapped to a code.
  const unitPair = await resolveUnitPair(db, unit, input.unit_raw);

  const merchant = await resolveMerchant(db, userId, input.merchant);

  const observedOn = input.observed_on && /^\d{4}-\d{2}-\d{2}$/.test(input.observed_on)
    ? input.observed_on
    : todayInZone(input.timezone);

  const result = await db
    .prepare(
      `INSERT INTO item_prices
         (user_id, item_id, transaction_id, unit_price_cents, quantity, unit, unit_raw, currency, merchant, merchant_id, observed_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      userId, itemId, transaction_id ?? null, toCents(unit_price),
      quantity ?? null, unitPair.unit, unitPair.unit_raw, currency,
      merchant.merchant, merchant.merchant_id, observedOn, new Date().toISOString(),
    )
    .first<{ id: number }>();

  if (!result) {
    throw serverError('Failed to log price');
  }

  const row = await fetchPrice(db, userId, result.id);
  if (!row) {
    throw serverError('Failed to log price');
  }
  return row;
}

export interface UpdatePriceInput {
  unit_price?: number;
  quantity?: number | null;
  /** A `units.code`; the wording goes in `unit_raw`. */
  unit?: string | null;
  unit_raw?: string | null;
  currency?: string;
  merchant?: string | null;
  observed_on?: string;
  item_id?: number;
}

export async function updatePrice(
  db: D1Database, userId: number, id: number, body: UpdatePriceInput,
): Promise<Price> {
  const existing = await fetchPrice(db, userId, id);
  if (!existing) throw notFound('Price not found');

  const updates: string[] = [];
  const values: any[] = [];

  if (body.item_id !== undefined) {
    const owned = await db
      .prepare('SELECT id FROM items WHERE id = ? AND user_id = ?')
      .bind(body.item_id, userId)
      .first();
    if (!owned) throw notFound('Item not found');
    updates.push('item_id = ?');
    values.push(body.item_id);
  }

  if (body.unit_price !== undefined) {
    if (!(body.unit_price >= 0)) throw badRequest('unit_price must not be negative');
    updates.push('unit_price_cents = ?');
    values.push(toCents(body.unit_price));
  }

  if (body.quantity !== undefined) {
    updates.push('quantity = ?');
    values.push(body.quantity);
  }

  if (body.unit !== undefined) {
    // The raw wording follows the code, so the original is never lost.
    const pair = await resolveUnitPair(db, body.unit, body.unit_raw);
    updates.push('unit = ?');
    values.push(pair.unit);
    updates.push('unit_raw = ?');
    values.push(pair.unit_raw);
  }

  if (body.currency !== undefined) {
    if (body.currency.length !== 3) throw badRequest('Currency must be a 3-letter code');
    updates.push('currency = ?');
    values.push(body.currency);
  }

  if (body.merchant !== undefined) {
    const merchant = await resolveMerchant(db, userId, body.merchant);
    updates.push('merchant = ?');
    values.push(merchant.merchant);
    updates.push('merchant_id = ?');
    values.push(merchant.merchant_id);
  }

  if (body.observed_on !== undefined) {
    updates.push('observed_on = ?');
    values.push(body.observed_on);
  }

  if (updates.length === 0) {
    throw badRequest('No fields to update');
  }

  values.push(id, userId);

  const result = await db
    .prepare(`UPDATE item_prices SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING id`)
    .bind(...values)
    .first();

  if (!result) throw notFound('Price not found');

  const row = await fetchPrice(db, userId, id);
  if (!row) throw notFound('Price not found');
  return row;
}

export async function deletePrice(
  db: D1Database, userId: number, id: number,
): Promise<void> {
  const result = await db
    .prepare('DELETE FROM item_prices WHERE id = ? AND user_id = ? RETURNING id')
    .bind(id, userId)
    .first();

  if (!result) throw notFound('Price not found');
}

// ------------------------------------------------- cost per unit (R4)

/**
 * One observation reduced to a comparable shape.
 *
 * `total_cents` is what was actually paid. `per_unit_cents` divides it by
 * `quantity`, which is what makes two sizes of the same product comparable:
 * 30ml for 45 and 50ml for 60 are not comparable as totals (60 > 45) but are as
 * unit costs (1.5/ml vs 1.2/ml). The division happens in SQL, so the model is
 * handed a per-unit figure rather than being asked to compute one.
 */
export interface UnitPriceSample {
  observed_on: string;
  /** What was paid in total for this observation. */
  total_cents: number;
  quantity: number | null;
  /** `quantity` defaulted to 1, because a bare price is a price for one. */
  quantity_inferred: boolean;
  /** Comparable unit cost, or null when the row carries no unit code. */
  per_unit_cents: number | null;
  currency: string;
}

/**
 * Observations grouped by unit.
 *
 * Grouping is the point: a per-unit average is only meaningful inside one unit.
 * Averaging `per ml` with `per piece` produces a number that describes nothing,
 * which is what §5.1 means by "comparing prices across different units is
 * meaningless".
 */
export interface UnitGroup {
  /** A `units.code`, or null for rows recorded without one. */
  unit: string | null;
  count: number;
  /** Cheapest and dearest unit cost seen in this unit. */
  min_per_unit: number | null;
  max_per_unit: number | null;
  average_per_unit: number | null;
  /** The newest observation's unit cost, by (observed_on, id). */
  last_per_unit: number | null;
  last_observed_on: string | null;
  /** Paid totals in this group, so "60 for 50ml vs 45 for 30ml" stays visible. */
  totals: number[];
  quantities: (number | null)[];
  /** True when at least one row had its quantity assumed to be 1. */
  any_quantity_inferred: boolean;
  /** True when a per-unit figure could NOT be computed for some row. */
  has_uncomputable: boolean;
}

export interface UnitBreakdown {
  /** The group that matches the unit being judged, when one was supplied. */
  comparable: UnitGroup | null;
  /**
   * Other units the same item was bought in. Reported, never mixed in: the
   * assistant should mention them ("you also bought this per piece") while
   * stating that they cannot be compared.
   */
  other_units: UnitGroup[];
  /** Observations carrying no unit at all, which cannot be normalised. */
  without_unit: UnitGroup | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Group an item's observations by unit, each normalised to a cost per unit. */
export async function groupPricesByUnit(
  db: D1Database, userId: number, itemId: number,
): Promise<UnitGroup[]> {
  const { results } = await db
    .prepare(
      `SELECT observed_on, unit, quantity, unit_price_cents, currency, id
         FROM item_prices
        WHERE user_id = ? AND item_id = ?
        ORDER BY observed_on ASC, id ASC`,
    )
    .bind(userId, itemId)
    .all<{
      observed_on: string; unit: string | null; quantity: number | null;
      unit_price_cents: number; currency: string; id: number;
    }>();

  const byUnit = new Map<string, UnitGroup>();

  for (const r of results) {
    const key = r.unit ?? '__none__';
    let g = byUnit.get(key);
    if (!g) {
      g = {
        unit: r.unit,
        count: 0,
        min_per_unit: null,
        max_per_unit: null,
        average_per_unit: null,
        last_per_unit: null,
        last_observed_on: null,
        totals: [],
        quantities: [],
        any_quantity_inferred: false,
        has_uncomputable: false,
      };
      byUnit.set(key, g);
    }

    // A bare price is a price for one thing; inferring quantity 1 keeps it
    // comparable instead of discarding it, and the flag says it was inferred.
    const inferred = r.quantity === null;
    const qty = r.quantity ?? 1;
    // Currency amounts, not cents, so every figure in this object shares one
    // unit — mixing them made `min_per_unit` read as 120 "yuan" per ml.
    const paid = r.unit_price_cents / 100;
    const perUnit = r.unit === null ? null : paid / qty;

    g.count += 1;
    g.totals.push(paid);
    g.quantities.push(r.quantity);
    if (inferred) g.any_quantity_inferred = true;
    if (perUnit === null) g.has_uncomputable = true;
    if (perUnit !== null) {
      g.min_per_unit = g.min_per_unit === null ? perUnit : Math.min(g.min_per_unit, perUnit);
      g.max_per_unit = g.max_per_unit === null ? perUnit : Math.max(g.max_per_unit, perUnit);
    }
    // Rows arrive oldest-first, so the last one wins.
    g.last_per_unit = perUnit;
    g.last_observed_on = r.observed_on;
  }

  // Averages are computed from the normalised per-unit values, not from raw
  // totals: averaging totals across different sizes is exactly the bug this
  // grouping exists to prevent.
  for (const g of byUnit.values()) {
    const perUnitValues: number[] = [];
    for (let i = 0; i < g.totals.length; i++) {
      const q = g.quantities[i] ?? 1;
      if (g.unit !== null) perUnitValues.push(g.totals[i] / q);
    }
    g.average_per_unit = perUnitValues.length > 0
      ? round2(perUnitValues.reduce((a, b) => a + b, 0) / perUnitValues.length)
      : null;
    if (g.min_per_unit !== null) g.min_per_unit = round2(g.min_per_unit);
    if (g.max_per_unit !== null) g.max_per_unit = round2(g.max_per_unit);
    if (g.last_per_unit !== null) g.last_per_unit = round2(g.last_per_unit);
    g.totals = g.totals.map(round2);
  }

  return [...byUnit.values()];
}

/**
 * Split a per-unit breakdown into "the unit being judged" and everything else.
 *
 * With no unit supplied, nothing is treated as comparable: the caller has not
 * said what basis to compare on, and guessing one would silently average
 * incomparable things.
 */
export function splitByComparableUnit(
  groups: UnitGroup[], unit: string | null | undefined,
): UnitBreakdown {
  if (unit === undefined) {
    return {
      comparable: null,
      other_units: groups.filter(g => g.unit !== null),
      without_unit: groups.find(g => g.unit === null) ?? null,
    };
  }

  const comparable = groups.find(g => g.unit === unit) ?? null;
  return {
    comparable,
    other_units: groups.filter(g => g.unit !== null && g.unit !== unit),
    without_unit: groups.find(g => g.unit === null) ?? null,
  };
}

/** The normalized, unit-scoped view the assistant uses for a price question. */
export async function priceBreakdown(
  db: D1Database, userId: number, itemId: number, unit?: string | null,
): Promise<{ item_id: number; groups: UnitGroup[] } & UnitBreakdown> {
  const groups = await groupPricesByUnit(db, userId, itemId);
  return { item_id: itemId, groups, ...splitByComparableUnit(groups, unit) };
}

// ------------------------------------------------- R4 comparison helpers

export interface PriceComparison {
  /** The compared unit cost (per unit), not the amount paid. */
  per_unit_price: number;
  /** The unit this comparison is scoped to; null when it could not be scoped. */
  unit: string | null;
  /** Average unit cost over strictly earlier observations in the same unit. */
  average_per_unit: number | null;
  /** Signed percentage vs that average; null when there is no average. */
  change_pct: number | null;
  /** True when the price is more than PRICE_SPIKE_THRESHOLD_PCT above average. */
  is_spike: boolean;
  /** True when no earlier observation exists to compare against. */
  is_first: boolean;
  /**
   * Other units the item was bought in. They are reported so the assistant can
   * mention them, and are explicitly NOT part of the average.
   */
  other_units: { unit: string; count: number; average_per_unit: number | null }[];
  /** Earlier observations with no unit, which cannot be compared at all. */
  without_unit_count: number;
}

/**
 * Compare one price against the item's own earlier history (R4).
 *
 * Three things this deliberately does NOT do, because each makes the verdict
 * wrong rather than merely imprecise:
 *
 *   1. It does not average the item's whole history. The observation being
 *      judged is already stored by the time this runs, so including it dilutes
 *      exactly the movement being looked for.
 *   2. It does not compare against observations on the same date or later.
 *      "Is this more expensive than before?" means strictly earlier.
 *   3. **It does not compare across units.** A cost per millilitre and a cost
 *      per piece describe different things, and averaging them produces a
 *      number that describes nothing. Observations in other units are returned
 *      separately so the assistant can say "you also bought this per piece"
 *      while making clear it is not part of the comparison.
 *
 * The arithmetic lives here rather than in the prompt: the model receives the
 * verdict, never the rows, and never a mixed-unit average.
 */
export async function compareToHistory(
  db: D1Database, userId: number, itemId: number, unitPrice: number,
  opts: {
    beforeDate?: string;
    excludePriceId?: number;
    /** The unit of the observation being judged; comparison is scoped to it. */
    unit?: string | null;
    /** How many units `unitPrice` buys. Defaults to 1. */
    quantity?: number | null;
  } = {},
): Promise<PriceComparison> {
  const groups = await groupPricesByUnit(db, userId, itemId);
  const unit = opts.unit === undefined ? null : opts.unit;

  const otherUnits = groups
    .filter(g => g.unit !== null && g.unit !== unit)
    .map(g => ({ unit: g.unit as string, count: g.count, average_per_unit: g.average_per_unit }));
  const withoutUnitCount = groups.find(g => g.unit === null)?.count ?? 0;

  // The cost per unit of the observation being judged, the same way the stored
  // rows are normalised.
  const qty = opts.quantity ?? 1;
  const normalized = unit === null ? unitPrice : unitPrice / qty;

  // Strictly earlier observations in the SAME unit, normalised the same way.
  const { results } = await db
    .prepare(
      `SELECT unit_price_cents, quantity
         FROM item_prices
        WHERE user_id = ? AND item_id = ?
          AND ${unit === null ? 'unit IS NULL' : 'unit = ?'}
          ${opts.beforeDate !== undefined
            ? 'AND (observed_on < ? OR (observed_on = ? AND id < ?))'
            : opts.excludePriceId !== undefined ? 'AND id <> ?' : ''}`,
    )
    .bind(
      ...(unit === null ? [userId, itemId] : [userId, itemId, unit]),
      ...(opts.beforeDate !== undefined
        ? [opts.beforeDate, opts.beforeDate, opts.excludePriceId ?? Number.MAX_SAFE_INTEGER]
        : opts.excludePriceId !== undefined ? [opts.excludePriceId] : []),
    )
    .all<{ unit_price_cents: number; quantity: number | null }>();

  if (results.length === 0) {
    return {
      per_unit_price: round2(normalized),
      unit,
      average_per_unit: null,
      change_pct: null,
      is_spike: false,
      is_first: true,
      other_units: otherUnits,
      without_unit_count: withoutUnitCount,
    };
  }

  const perUnit = results.map(r => (r.unit_price_cents / 100) / (r.quantity ?? 1));
  const average = perUnit.reduce((a, b) => a + b, 0) / perUnit.length;
  // Both sides are currency amounts (not cents): `normalized` was built from
  // `unitPrice`, which is already decimal, and `perUnit` divides cents by 100.
  const changePct = average === 0 ? null : ((normalized - average) / average) * 100;

  return {
    per_unit_price: round2(normalized),
    unit,
    average_per_unit: round2(average),
    change_pct: changePct === null ? null : Math.round(changePct * 10) / 10,
    is_spike: changePct !== null && changePct > PRICE_SPIKE_THRESHOLD_PCT,
    is_first: false,
    other_units: otherUnits,
    without_unit_count: withoutUnitCount,
  };
}
