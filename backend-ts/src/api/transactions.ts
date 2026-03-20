import { Hono } from 'hono';
import type { Env, HonoVariables, Transaction, CreateTransactionRequest, UpdateTransactionRequest } from '../types';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

async function ensureOwnedCategory(db: D1Database, categoryId: number, userId: number): Promise<boolean> {
  const category = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(categoryId, userId).first();
  return !!category;
}

async function ensureOwnedItem(db: D1Database, itemId: number, userId: number): Promise<boolean> {
  const item = await db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, userId).first();
  return !!item;
}

// Helper function to get all subcategory IDs recursively
async function getAllSubcategoryIds(db: D1Database, categoryId: number, userId: number): Promise<number[]> {
  const categoryIds = [categoryId];
  
  // Get all categories to build the tree
  const { results: allCategories } = await db.prepare(
    'SELECT id, parent_id FROM categories WHERE user_id = ?'
  ).bind(userId).all<{ id: number; parent_id: number | null }>();
  
  // Recursively find all children
  const findChildren = (parentId: number) => {
    const children = allCategories.filter(cat => cat.parent_id === parentId);
    children.forEach(child => {
      categoryIds.push(child.id);
      findChildren(child.id); // Recursive call for nested children
    });
  };
  
  findChildren(categoryId);
  return categoryIds;
}

// GET /api/v1/transactions - List transactions with filters
app.get('/', async (c) => {
  const category_id = c.req.query('category_id');
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const userId = c.get('userId');
  
  try {
    let query = `SELECT t.*, i.name as item_name 
                 FROM transactions t 
                 LEFT JOIN items i ON t.item_id = i.id AND i.user_id = t.user_id 
                 WHERE t.user_id = ?`;
    const params: any[] = [userId];

    if (category_id) {
      // Get all subcategory IDs including the parent
      const categoryIds = await getAllSubcategoryIds(c.env.DB, parseInt(category_id), userId);
      
      // Build IN clause for all category IDs
      const placeholders = categoryIds.map(() => '?').join(',');
      query += ` AND t.category_id IN (${placeholders})`;
      params.push(...categoryIds);
    }

    if (start_date) {
      query += ' AND t.date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND t.date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY t.date DESC, t.created_at DESC';

    const stmt = c.env.DB.prepare(query);
    const { results } = await (params.length > 0 ? stmt.bind(...params) : stmt).all<Transaction>();

    return c.json(results);
  } catch (error) {
    return c.json({ error: 'Failed to fetch transactions' }, 500);
  }
});

// GET /api/v1/transactions/:id - Get single transaction
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const transaction = await c.env.DB.prepare(
      `SELECT t.*, i.name as item_name 
       FROM transactions t 
       LEFT JOIN items i ON t.item_id = i.id AND i.user_id = t.user_id 
       WHERE t.id = ? AND t.user_id = ?`
    ).bind(id, userId).first<Transaction>();

    if (!transaction) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json(transaction);
  } catch (error) {
    return c.json({ error: 'Failed to fetch transaction' }, 500);
  }
});

// POST /api/v1/transactions - Create transaction
app.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<CreateTransactionRequest>();
    const { amount, currency, description, date, category_id, item_id, item_name, unit_price, quantity, unit } = body;

    if (!amount || !currency || !date || !category_id) {
      return c.json({ error: 'Amount, currency, date, and category_id are required' }, 400);
    }

    if (currency.length !== 3) {
      return c.json({ error: 'Currency must be a 3-letter code' }, 400);
    }

    if (!(await ensureOwnedCategory(c.env.DB, category_id, userId))) {
      return c.json({ error: 'Category not found' }, 404);
    }

    let finalItemId = item_id || null;

    if (finalItemId && !(await ensureOwnedItem(c.env.DB, finalItemId, userId))) {
      return c.json({ error: 'Item not found' }, 404);
    }

    // If item_name is provided, create or find the item
    if (item_name && item_name.trim().length > 0) {
      // Check if item already exists
      const existingItem = await c.env.DB.prepare(
        'SELECT id FROM items WHERE name = ? AND user_id = ?'
      ).bind(item_name.trim(), userId).first<{ id: number }>();

      if (existingItem) {
        finalItemId = existingItem.id;
      } else {
        // Create new item
        const newItem = await c.env.DB.prepare(
          'INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id'
        ).bind(item_name.trim(), userId, new Date().toISOString()).first<{ id: number }>();
        
        if (newItem) {
          finalItemId = newItem.id;
        }
      }
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      `INSERT INTO transactions (user_id, amount, currency, description, date, category_id, item_id, unit_price, quantity, unit, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(userId, amount, currency, description || null, date, category_id, finalItemId, unit_price || null, quantity || null, unit || null, now, now).first<Transaction>();

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes('FOREIGN KEY constraint')) {
      return c.json({ error: 'Category not found' }, 404);
    }
    return c.json({ error: 'Failed to create transaction' }, 500);
  }
});

// PUT /api/v1/transactions/:id - Update transaction
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const body = await c.req.json<UpdateTransactionRequest>();
    const updates: string[] = [];
    const values: any[] = [];

    if (body.amount !== undefined) {
      updates.push('amount = ?');
      values.push(body.amount);
    }
    if (body.currency !== undefined) {
      if (body.currency.length !== 3) {
        return c.json({ error: 'Currency must be a 3-letter code' }, 400);
      }
      updates.push('currency = ?');
      values.push(body.currency);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.date !== undefined) {
      updates.push('date = ?');
      values.push(body.date);
    }
    if (body.category_id !== undefined) {
      if (!(await ensureOwnedCategory(c.env.DB, body.category_id, userId))) {
        return c.json({ error: 'Category not found' }, 404);
      }
      updates.push('category_id = ?');
      values.push(body.category_id);
    }
    
    // Handle item_id and item_name
    if (body.item_name !== undefined) {
      if (body.item_name && body.item_name.trim().length > 0) {
        // Check if item already exists
        const existingItem = await c.env.DB.prepare(
          'SELECT id FROM items WHERE name = ? AND user_id = ?'
        ).bind(body.item_name.trim(), userId).first<{ id: number }>();

        if (existingItem) {
          updates.push('item_id = ?');
          values.push(existingItem.id);
        } else {
          // Create new item
          const newItem = await c.env.DB.prepare(
            'INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id'
          ).bind(body.item_name.trim(), userId, new Date().toISOString()).first<{ id: number }>();
          
          if (newItem) {
            updates.push('item_id = ?');
            values.push(newItem.id);
          }
        }
      } else {
        // Clear item_id if item_name is empty
        updates.push('item_id = ?');
        values.push(null);
      }
    } else if (body.item_id !== undefined) {
      if (body.item_id !== null && !(await ensureOwnedItem(c.env.DB, body.item_id, userId))) {
        return c.json({ error: 'Item not found' }, 404);
      }
      updates.push('item_id = ?');
      values.push(body.item_id);
    }

    // Handle unit price fields
    if (body.unit_price !== undefined) {
      updates.push('unit_price = ?');
      values.push(body.unit_price);
    }
    if (body.quantity !== undefined) {
      updates.push('quantity = ?');
      values.push(body.quantity);
    }
    if (body.unit !== undefined) {
      updates.push('unit = ?');
      values.push(body.unit);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id, userId);

    const result = await c.env.DB.prepare(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
    ).bind(...values).first<Transaction>();

    if (!result) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json(result);
  } catch (error) {
    return c.json({ error: 'Failed to update transaction' }, 500);
  }
});

// DELETE /api/v1/transactions/:id - Delete transaction
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM transactions WHERE id = ? AND user_id = ? RETURNING id'
    ).bind(id, userId).first();

    if (!result) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to delete transaction' }, 500);
  }
});

export default app;
