import { Hono } from 'hono';
import type { Env, Transaction, CreateTransactionRequest, UpdateTransactionRequest } from '../types';

const app = new Hono<{ Bindings: Env }>();

// GET /api/v1/transactions - List transactions with filters
app.get('/', async (c) => {
  const category_id = c.req.query('category_id');
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  
  try {
    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params: any[] = [];

    if (category_id) {
      query += ' AND category_id = ?';
      params.push(parseInt(category_id));
    }

    if (start_date) {
      query += ' AND date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY date DESC, created_at DESC';

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
  
  try {
    const transaction = await c.env.DB.prepare(
      'SELECT * FROM transactions WHERE id = ?'
    ).bind(id).first<Transaction>();

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
    const body = await c.req.json<CreateTransactionRequest>();
    const { amount, currency, description, date, category_id } = body;

    if (!amount || !currency || !date || !category_id) {
      return c.json({ error: 'Amount, currency, date, and category_id are required' }, 400);
    }

    if (currency.length !== 3) {
      return c.json({ error: 'Currency must be a 3-letter code' }, 400);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      `INSERT INTO transactions (amount, currency, description, date, category_id, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(amount, currency, description || null, date, category_id, now, now).first<Transaction>();

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
      updates.push('category_id = ?');
      values.push(body.category_id);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const result = await c.env.DB.prepare(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? RETURNING *`
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
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM transactions WHERE id = ? RETURNING id'
    ).bind(id).first();

    if (!result) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to delete transaction' }, 500);
  }
});

export default app;
