import { Hono } from 'hono';
import type { Env, HonoVariables, Item, ItemWithStats, Transaction, TransactionRow } from '../types';
import { toAmount } from '../utils/money';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/** `items?with_stats=true` row: money still in cents, the rest already shaped. */
interface ItemStatsRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  total_purchases: number;
  total_spent_cents: number | null;
  average_price_cents: number | null;
  last_purchase_date: string | null;
  last_unit_price_cents: number | null;
  average_unit_price_cents: number | null;
  total_quantity: number | null;
  unit: string | null;
}

function toItemWithStats(row: ItemStatsRow): ItemWithStats {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at,
    total_purchases: row.total_purchases,
    total_spent: toAmount(row.total_spent_cents) ?? 0,
    average_price: toAmount(row.average_price_cents) ?? 0,
    last_purchase_date: row.last_purchase_date as string,
    last_unit_price: toAmount(row.last_unit_price_cents),
    average_unit_price: toAmount(row.average_unit_price_cents),
    total_quantity: row.total_quantity,
    unit: row.unit,
  };
}

/** A history row: a transaction plus the price observation it carried. */
interface TxHistoryRow extends TransactionRow {
  item_name: string | null;
  item_id: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
  unit: string | null;
}

function toHistoryTransaction(row: TxHistoryRow): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    amount: row.amount_cents / 100,
    currency: row.currency,
    description: row.description,
    date: row.date,
    category_id: row.category_id,
    item_id: row.item_id,
    unit_price: toAmount(row.unit_price_cents),
    quantity: row.quantity,
    unit: row.unit,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/v1/items - List all items with optional stats
app.get('/', async (c) => {
  const withStats = c.req.query('with_stats') === 'true';
  const userId = c.get('userId');
  
  try {
    if (withStats) {
      // Item/price data lives in item_prices in v2. `total_spent` and
      // `average_price` remain transaction-amount figures, so they are summed
      // in cents here and converted once at the boundary.
      const { results } = await c.env.DB.prepare(`
        SELECT 
          i.id,
          i.user_id,
          i.name,
          i.created_at,
          COUNT(t.id) as total_purchases,
          SUM(t.amount_cents) as total_spent_cents,
          AVG(t.amount_cents) as average_price_cents,
          MAX(t.date) as last_purchase_date,
          (SELECT ip2.unit_price_cents FROM item_prices ip2 WHERE ip2.item_id = i.id AND ip2.user_id = i.user_id AND ip2.unit_price_cents IS NOT NULL ORDER BY ip2.observed_on DESC, ip2.created_at DESC LIMIT 1) as last_unit_price_cents,
          AVG(CASE WHEN ip.unit_price_cents IS NOT NULL THEN ip.unit_price_cents ELSE NULL END) as average_unit_price_cents,
          SUM(CASE WHEN ip.quantity IS NOT NULL THEN ip.quantity ELSE 0 END) as total_quantity,
          (SELECT ip3.unit FROM item_prices ip3 WHERE ip3.item_id = i.id AND ip3.user_id = i.user_id AND ip3.unit IS NOT NULL ORDER BY ip3.observed_on DESC, ip3.created_at DESC LIMIT 1) as unit
        FROM items i
        LEFT JOIN item_prices ip ON ip.item_id = i.id
        LEFT JOIN transactions t ON t.id = ip.transaction_id AND t.user_id = i.user_id
        WHERE i.user_id = ?
        GROUP BY i.id
        ORDER BY last_purchase_date DESC, i.name ASC
      `).bind(userId).all<ItemStatsRow>();
      
      return c.json(results.map(toItemWithStats));
    } else {
      // Get simple item list
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM items WHERE user_id = ? ORDER BY name ASC'
      ).bind(userId).all<Item>();
      
      return c.json(results);
    }
  } catch (error) {
    return c.json({ error: 'Failed to fetch items' }, 500);
  }
});

// GET /api/v1/items/:id - Get single item
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const item = await c.env.DB.prepare(
      'SELECT * FROM items WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first<Item>();

    if (!item) {
      return c.json({ error: 'Item not found' }, 404);
    }

    return c.json(item);
  } catch (error) {
    return c.json({ error: 'Failed to fetch item' }, 500);
  }
});

// GET /api/v1/items/:id/history - Get purchase history for an item
app.get('/:id/history', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    // First check if item exists
    const item = await c.env.DB.prepare(
      'SELECT * FROM items WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first<Item>();

    if (!item) {
      return c.json({ error: 'Item not found' }, 404);
    }

    // Purchase history comes from the item's price observations, joined to the
    // transaction they came from. Ordered newest first, as before.
    const { results: rows } = await c.env.DB.prepare(
      `SELECT t.*, ip.item_id as item_id, ip.unit_price_cents as unit_price_cents,
              ip.quantity as quantity, ip.unit as unit, i.name as item_name
       FROM item_prices ip
       JOIN transactions t ON t.id = ip.transaction_id
       LEFT JOIN items i ON i.id = ip.item_id AND i.user_id = ip.user_id
       WHERE ip.item_id = ? AND t.user_id = ?
       ORDER BY t.date DESC, t.created_at DESC`
    ).bind(id, userId).all<TxHistoryRow>();

    const transactions = rows.map(toHistoryTransaction);

    // Calculate statistics. Note `unit` is taken from the newest row that HAS a
    // unit, not simply the newest row: a later purchase can record no unit, and
    // v1 filtered those out with `unit IS NOT NULL`. Same for the price fields.
    const transactionsWithUnitPrice = transactions.filter(t => t.unit_price !== null);
    const transactionsWithQuantity = transactions.filter(t => t.quantity !== null);
    const transactionsWithUnit = transactions.filter(t => t.unit !== null);
    
    const stats = {
      total_purchases: transactions.length,
      total_spent: transactions.reduce((sum, t) => sum + t.amount, 0),
      average_price: transactions.length > 0 
        ? transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length 
        : 0,
      first_purchase_date: transactions.length > 0 ? transactions[transactions.length - 1].date : null,
      last_purchase_date: transactions.length > 0 ? transactions[0].date : null,
      last_unit_price: transactionsWithUnitPrice.length > 0 ? transactionsWithUnitPrice[0].unit_price : null,
      average_unit_price: transactionsWithUnitPrice.length > 0
        ? transactionsWithUnitPrice.reduce((sum, t) => sum + (t.unit_price || 0), 0) / transactionsWithUnitPrice.length
        : null,
      total_quantity: transactionsWithQuantity.reduce((sum, t) => sum + (t.quantity || 0), 0),
      unit: transactionsWithUnit.length > 0 ? transactionsWithUnit[0].unit : null,
    };

    return c.json({
      item,
      transactions,
      stats
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch item history' }, 500);
  }
});

// POST /api/v1/items - Create new item
app.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{ name: string }>();
    const { name } = body;

    if (!name || name.trim().length === 0) {
      return c.json({ error: 'Item name is required' }, 400);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      'INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING *'
    ).bind(name.trim(), userId, now).first<Item>();

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Item with this name already exists' }, 409);
    }
    return c.json({ error: 'Failed to create item' }, 500);
  }
});

// PUT /api/v1/items/:id - Update item
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const body = await c.req.json<{ name: string }>();
    const { name } = body;

    if (!name || name.trim().length === 0) {
      return c.json({ error: 'Item name is required' }, 400);
    }

    const result = await c.env.DB.prepare(
      'UPDATE items SET name = ? WHERE id = ? AND user_id = ? RETURNING *'
    ).bind(name.trim(), id, userId).first<Item>();

    if (!result) {
      return c.json({ error: 'Item not found' }, 404);
    }

    return c.json(result);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Item with this name already exists' }, 409);
    }
    return c.json({ error: 'Failed to update item' }, 500);
  }
});

// DELETE /api/v1/items/:id - Delete item
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM items WHERE id = ? AND user_id = ? RETURNING id'
    ).bind(id, userId).first();

    if (!result) {
      return c.json({ error: 'Item not found' }, 404);
    }

    return c.json({ message: 'Item deleted successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to delete item' }, 500);
  }
});

// GET /api/v1/items/search/:query - Search items by name
app.get('/search/:query', async (c) => {
  const query = c.req.param('query');
  const userId = c.get('userId');
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM items WHERE user_id = ? AND name LIKE ? ORDER BY name ASC LIMIT 10'
    ).bind(userId, `%${query}%`).all<Item>();

    return c.json(results);
  } catch (error) {
    return c.json({ error: 'Failed to search items' }, 500);
  }
});

export default app;
