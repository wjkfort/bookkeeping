import { Hono } from 'hono';
import type { Env, Item, ItemWithStats, Transaction } from '../types';

const app = new Hono<{ Bindings: Env }>();

// GET /api/v1/items - List all items with optional stats
app.get('/', async (c) => {
  const withStats = c.req.query('with_stats') === 'true';
  
  try {
    if (withStats) {
      // Get items with purchase statistics
      const { results } = await c.env.DB.prepare(`
        SELECT 
          i.id,
          i.name,
          i.created_at,
          COUNT(t.id) as total_purchases,
          SUM(t.amount) as total_spent,
          AVG(t.amount) as average_price,
          MAX(t.date) as last_purchase_date,
          (SELECT t2.unit_price FROM transactions t2 WHERE t2.item_id = i.id AND t2.unit_price IS NOT NULL ORDER BY t2.date DESC, t2.created_at DESC LIMIT 1) as last_unit_price,
          AVG(CASE WHEN t.unit_price IS NOT NULL THEN t.unit_price ELSE NULL END) as average_unit_price,
          SUM(CASE WHEN t.quantity IS NOT NULL THEN t.quantity ELSE 0 END) as total_quantity,
          (SELECT t3.unit FROM transactions t3 WHERE t3.item_id = i.id AND t3.unit IS NOT NULL ORDER BY t3.date DESC, t3.created_at DESC LIMIT 1) as unit
        FROM items i
        LEFT JOIN transactions t ON t.item_id = i.id
        GROUP BY i.id
        ORDER BY last_purchase_date DESC, i.name ASC
      `).all<ItemWithStats>();
      
      return c.json(results);
    } else {
      // Get simple item list
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM items ORDER BY name ASC'
      ).all<Item>();
      
      return c.json(results);
    }
  } catch (error) {
    return c.json({ error: 'Failed to fetch items' }, 500);
  }
});

// GET /api/v1/items/:id - Get single item
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  try {
    const item = await c.env.DB.prepare(
      'SELECT * FROM items WHERE id = ?'
    ).bind(id).first<Item>();

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
  
  try {
    // First check if item exists
    const item = await c.env.DB.prepare(
      'SELECT * FROM items WHERE id = ?'
    ).bind(id).first<Item>();

    if (!item) {
      return c.json({ error: 'Item not found' }, 404);
    }

    // Get all transactions for this item
    const { results: transactions } = await c.env.DB.prepare(
      'SELECT * FROM transactions WHERE item_id = ? ORDER BY date DESC, created_at DESC'
    ).bind(id).all<Transaction>();

    // Calculate statistics
    const transactionsWithUnitPrice = transactions.filter(t => t.unit_price !== null);
    const transactionsWithQuantity = transactions.filter(t => t.quantity !== null);
    
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
      unit: transactionsWithUnitPrice.length > 0 ? transactionsWithUnitPrice[0].unit : null,
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
    const body = await c.req.json<{ name: string }>();
    const { name } = body;

    if (!name || name.trim().length === 0) {
      return c.json({ error: 'Item name is required' }, 400);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      'INSERT INTO items (name, created_at) VALUES (?, ?) RETURNING *'
    ).bind(name.trim(), now).first<Item>();

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
  
  try {
    const body = await c.req.json<{ name: string }>();
    const { name } = body;

    if (!name || name.trim().length === 0) {
      return c.json({ error: 'Item name is required' }, 400);
    }

    const result = await c.env.DB.prepare(
      'UPDATE items SET name = ? WHERE id = ? RETURNING *'
    ).bind(name.trim(), id).first<Item>();

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
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM items WHERE id = ? RETURNING id'
    ).bind(id).first();

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
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM items WHERE name LIKE ? ORDER BY name ASC LIMIT 10'
    ).bind(`%${query}%`).all<Item>();

    return c.json(results);
  } catch (error) {
    return c.json({ error: 'Failed to search items' }, 500);
  }
});

export default app;
