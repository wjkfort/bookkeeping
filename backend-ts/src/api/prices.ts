import { Hono } from 'hono';
import type { Env, HonoVariables } from '../types';
import { toCents, toAmount } from '../utils/money';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Price history for items.
 *
 * `item_prices` holds one row per price *seen*, which is not the same as one
 * row per purchase: a price can be logged without a transaction (a shelf price
 * noted while shopping). The statistics are computed in SQL so the numbers the
 * caller sees never come from arithmetic done outside the database.
 */

const PRICE_SELECT = `
  SELECT
    ip.id, ip.user_id, ip.item_id, ip.transaction_id,
    ip.unit_price_cents, ip.quantity, ip.unit, ip.currency, ip.merchant,
    ip.observed_on, ip.created_at,
    i.name as item_name
  FROM item_prices ip
  JOIN items i ON i.id = ip.item_id AND i.user_id = ip.user_id
`;

interface PriceRow {
  id: number;
  user_id: number;
  item_id: number;
  transaction_id: number | null;
  unit_price_cents: number;
  quantity: number | null;
  unit: string | null;
  currency: string;
  merchant: string | null;
  observed_on: string;
  created_at: string;
  item_name: string;
}

interface StatsRow {
  item_id: number;
  count: number;
  last_unit_price_cents: number | null;
  last_observed_on: string | null;
  average_unit_price_cents: number | null;
  min_unit_price_cents: number | null;
  max_unit_price_cents: number | null;
}

function toPrice(row: PriceRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    item_id: row.item_id,
    item_name: row.item_name,
    transaction_id: row.transaction_id,
    unit_price: row.unit_price_cents / 100,
    quantity: row.quantity,
    unit: row.unit,
    currency: row.currency,
    merchant: row.merchant,
    observed_on: row.observed_on,
    created_at: row.created_at,
  };
}

function toStats(row: StatsRow) {
  return {
    item_id: row.item_id,
    count: row.count,
    last_unit_price: toAmount(row.last_unit_price_cents),
    last_observed_on: row.last_observed_on,
    average_unit_price: toAmount(
      row.average_unit_price_cents === null ? null : Math.round(row.average_unit_price_cents)
    ),
    min_unit_price: toAmount(row.min_unit_price_cents),
    max_unit_price: toAmount(row.max_unit_price_cents),
  };
}

// GET /api/v1/prices - price observations, optionally for one item
// ?item_id=  restrict to one item
// ?merchant= restrict to one merchant (for "is it cheaper at X" questions)
app.get('/', async (c) => {
  const userId = c.get('userId');
  const itemIdRaw = c.req.query('item_id');
  const merchant = c.req.query('merchant');
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));

  try {
    const where: string[] = ['ip.user_id = ?'];
    const params: any[] = [userId];

    if (itemIdRaw) {
      const itemId = parseInt(itemIdRaw, 10);
      if (Number.isNaN(itemId)) {
        return c.json({ error: 'Invalid item_id' }, 400);
      }
      where.push('ip.item_id = ?');
      params.push(itemId);
    }

    if (merchant) {
      where.push('ip.merchant = ?');
      params.push(merchant);
    }

    const { results } = await c.env.DB.prepare(
      `${PRICE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY ip.observed_on DESC, ip.created_at DESC
       LIMIT ?`
    ).bind(...params, limit).all<PriceRow>();

    return c.json(results.map(toPrice));
  } catch (error) {
    console.error('Error fetching prices:', error);
    return c.json({ error: 'Failed to fetch prices' }, 500);
  }
});

// GET /api/v1/prices/stats - last / average / min / max per item, plus per merchant
app.get('/stats', async (c) => {
  const userId = c.get('userId');
  const itemIdRaw = c.req.query('item_id');

  try {
    const where: string[] = ['ip.user_id = ?'];
    const params: any[] = [userId];

    if (itemIdRaw) {
      const itemId = parseInt(itemIdRaw, 10);
      if (Number.isNaN(itemId)) {
        return c.json({ error: 'Invalid item_id' }, 400);
      }
      where.push('ip.item_id = ?');
      params.push(itemId);
    }

    // `last_unit_price` is the newest observation, which SQL picks by ordering
    // on the same keys the history endpoint uses (observed_on, then created_at).
    const { results } = await c.env.DB.prepare(
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
       ORDER BY ip.item_id`
    ).bind(...params).all<StatsRow>();

    return c.json(results.map(toStats));
  } catch (error) {
    console.error('Error fetching price stats:', error);
    return c.json({ error: 'Failed to fetch price stats' }, 500);
  }
});

// GET /api/v1/prices/merchants - per-merchant comparison for one item
app.get('/merchants', async (c) => {
  const userId = c.get('userId');
  const itemIdRaw = c.req.query('item_id');
  if (!itemIdRaw) {
    return c.json({ error: 'item_id is required' }, 400);
  }
  const itemId = parseInt(itemIdRaw, 10);
  if (Number.isNaN(itemId)) {
    return c.json({ error: 'Invalid item_id' }, 400);
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         ip.merchant,
         COUNT(*) as count,
         AVG(ip.unit_price_cents) as average_unit_price_cents,
         MIN(ip.unit_price_cents) as min_unit_price_cents,
         MAX(ip.unit_price_cents) as max_unit_price_cents
       FROM item_prices ip
       WHERE ip.user_id = ? AND ip.item_id = ? AND ip.merchant IS NOT NULL
       GROUP BY ip.merchant
       ORDER BY average_unit_price_cents ASC`
    ).bind(userId, itemId).all<{
      merchant: string; count: number; average_unit_price_cents: number;
      min_unit_price_cents: number; max_unit_price_cents: number;
    }>();

    return c.json(results.map((r) => ({
      merchant: r.merchant,
      count: r.count,
      average_unit_price: Math.round(r.average_unit_price_cents) / 100,
      min_unit_price: r.min_unit_price_cents / 100,
      max_unit_price: r.max_unit_price_cents / 100,
    })));
  } catch (error) {
    console.error('Error fetching merchant comparison:', error);
    return c.json({ error: 'Failed to fetch merchant comparison' }, 500);
  }
});

// POST /api/v1/prices - log a price observation, with or without a transaction
app.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      item_id?: number;
      item_name?: string;
      unit_price?: number;
      quantity?: number;
      unit?: string;
      currency?: string;
      merchant?: string;
      observed_on?: string;
      transaction_id?: number | null;
    }>();

    const { unit_price, quantity, unit, merchant, transaction_id } = body;
    const currency = body.currency || 'CNY';

    if (unit_price === undefined || unit_price === null || !(unit_price >= 0)) {
      return c.json({ error: 'unit_price is required and must not be negative' }, 400);
    }

    if (currency.length !== 3) {
      return c.json({ error: 'Currency must be a 3-letter code' }, 400);
    }

    // Resolve the item, creating it from a name if that is what was given.
    let itemId = body.item_id ?? null;

    if (itemId !== null) {
      const owned = await c.env.DB.prepare(
        'SELECT id FROM items WHERE id = ? AND user_id = ?'
      ).bind(itemId, userId).first();
      if (!owned) {
        return c.json({ error: 'Item not found' }, 404);
      }
    } else if (body.item_name && body.item_name.trim().length > 0) {
      const name = body.item_name.trim();
      const existing = await c.env.DB.prepare(
        'SELECT id FROM items WHERE name = ? AND user_id = ?'
      ).bind(name, userId).first<{ id: number }>();
      if (existing) {
        itemId = existing.id;
      } else {
        const created = await c.env.DB.prepare(
          'INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id'
        ).bind(name, userId, new Date().toISOString()).first<{ id: number }>();
        itemId = created?.id ?? null;
      }
    }

    if (itemId === null) {
      return c.json({ error: 'Either item_id or item_name is required' }, 400);
    }

    if (transaction_id !== undefined && transaction_id !== null) {
      const ownedTx = await c.env.DB.prepare(
        'SELECT id, date FROM transactions WHERE id = ? AND user_id = ?'
      ).bind(transaction_id, userId).first<{ id: number; date: string }>();
      if (!ownedTx) {
        return c.json({ error: 'Transaction not found' }, 404);
      }
    }

    const observedOn = body.observed_on && /^\d{4}-\d{2}-\d{2}$/.test(body.observed_on)
      ? body.observed_on
      : new Date().toISOString().slice(0, 10);

    const result = await c.env.DB.prepare(
      `INSERT INTO item_prices
         (user_id, item_id, transaction_id, unit_price_cents, quantity, unit, currency, merchant, observed_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    ).bind(
      userId, itemId, transaction_id ?? null, toCents(unit_price),
      quantity ?? null, unit || null, currency, merchant?.trim() || null,
      observedOn, new Date().toISOString(),
    ).first<{ id: number }>();

    const row = await c.env.DB.prepare(
      `${PRICE_SELECT} WHERE ip.id = ? AND ip.user_id = ?`
    ).bind(result?.id, userId).first<PriceRow>();

    return c.json(row ? toPrice(row) : { id: result?.id }, 201);
  } catch (error) {
    console.error('Error logging price:', error);
    return c.json({ error: 'Failed to log price' }, 500);
  }
});

export default app;
