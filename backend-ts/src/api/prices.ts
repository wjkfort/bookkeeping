import { Hono } from 'hono';
import type { Env, HonoVariables } from '../types';
import {
  listPrices,
  getPriceStats,
  compareMerchants,
  logPrice,
  updatePrice,
  deletePrice,
  type LogPriceInput,
} from '../services/prices';
import { toErrorResponse } from '../services/errors';
import { requireTimezone } from '../utils/time';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Price history for items.
 *
 * `item_prices` holds one row per price *seen*, which is not the same as one
 * row per purchase: a price can be logged without a transaction (a shelf price
 * noted while shopping). The statistics are computed in SQL so the numbers the
 * caller sees never come from arithmetic done outside the database.
 *
 * The logic lives in src/services/prices.ts so the AI tools (`log_price`,
 * `price_stats`, `resolve_merchant`) execute exactly this code.
 */

// GET /api/v1/prices - price observations, optionally for one item
// ?item_id=  restrict to one item
// ?merchant= restrict to one merchant (for "is it cheaper at X" questions)
app.get('/', async (c) => {
  const userId = c.get('userId');
  const itemIdRaw = c.req.query('item_id');
  const merchant = c.req.query('merchant');
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));

  try {
    const itemId = itemIdRaw ? parseInt(itemIdRaw, 10) : undefined;
    return c.json(await listPrices(c.env.DB, userId, { item_id: itemId, merchant, limit }));
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to fetch prices');
    if (status === 500) console.error('Error fetching prices:', error);
    return c.json(body, status);
  }
});

// GET /api/v1/prices/stats - last / average / min / max per item, plus per merchant
app.get('/stats', async (c) => {
  const userId = c.get('userId');
  const itemIdRaw = c.req.query('item_id');

  try {
    const itemId = itemIdRaw ? parseInt(itemIdRaw, 10) : undefined;
    return c.json(await getPriceStats(c.env.DB, userId, itemId));
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to fetch price stats');
    if (status === 500) console.error('Error fetching price stats:', error);
    return c.json(body, status);
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
    return c.json(await compareMerchants(c.env.DB, userId, itemId));
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to fetch merchant comparison');
    if (status === 500) console.error('Error fetching merchant comparison:', error);
    return c.json(body, status);
  }
});

// POST /api/v1/prices - log a price observation, with or without a transaction
//
// `timezone` (optional) is the caller's IANA zone: it decides the day an
// observation with no `observed_on` is filed under. Defaults to UTC+8.
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<LogPriceInput & { timezone?: string }>();
    const timezone = requireTimezone(body.timezone);
    return c.json(await logPrice(c.env.DB, userId, { ...body, timezone }), 201);
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to log price');
    if (status === 500) console.error('Error logging price:', error);
    return c.json(body, status);
  }
});

// PUT /api/v1/prices/:id - correct one observation (the AI "that price was wrong" path)
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<Parameters<typeof updatePrice>[3]>();
    return c.json(await updatePrice(c.env.DB, userId, id, body));
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to update price');
    return c.json(body, status);
  }
});

// DELETE /api/v1/prices/:id - retract one observation
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    await deletePrice(c.env.DB, userId, id);
    return c.json({ message: 'Price deleted successfully' });
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to delete price');
    return c.json(body, status);
  }
});

export default app;
