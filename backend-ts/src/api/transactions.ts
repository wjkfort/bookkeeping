import { Hono } from 'hono';
import type { Env, HonoVariables, Transaction, TransactionRow, TransactionWithItemName, ItemPrice, CreateTransactionRequest, UpdateTransactionRequest } from '../types';
import { getAllSubcategoryIds } from '../utils/categories';
import { toCents, toAmount, centsToAmount, roundMoney } from '../utils/money';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// Item and price columns come from item_prices rather than from transactions
// (v2 moved them). The API contract is unchanged, so they are folded back into
// the transaction object on the way out.
const TX_SELECT = `
  SELECT t.*, i.name as item_name,
         ip.item_id as item_id, ip.unit_price_cents as unit_price_cents,
         ip.quantity as quantity, ip.unit as unit
  FROM transactions t
  LEFT JOIN item_prices ip ON ip.transaction_id = t.id
  LEFT JOIN items i ON i.id = ip.item_id AND i.user_id = t.user_id
`;

interface TxRow extends TransactionRow {
  item_name: string | null;
  item_id: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
  unit: string | null;
}

/** Storage row -> wire shape: money back to decimals, price fields reattached. */
function toTransaction(row: TxRow): TransactionWithItemName {
  return {
    id: row.id,
    user_id: row.user_id,
    amount: centsToAmount(row.amount_cents),
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
    item_name: row.item_name,
  };
}

async function ensureOwnedCategory(db: D1Database, categoryId: number, userId: number): Promise<boolean> {
  const category = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(categoryId, userId).first();
  return !!category;
}

async function ensureOwnedItem(db: D1Database, itemId: number, userId: number): Promise<boolean> {
  const item = await db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, userId).first();
  return !!item;
}

// GET /api/v1/transactions - List transactions with filters
// Optional: page + page_size for pagination (default page_size=20 when page is sent)
// Response when paginated: { items, total, page, page_size, total_pages, totals }
// Response when not paginated (legacy): Transaction[]
app.get('/', async (c) => {
  const category_id = c.req.query('category_id');
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const pageParam = c.req.query('page');
  const pageSizeParam = c.req.query('page_size');
  const userId = c.get('userId');

  const paginated = pageParam !== undefined && pageParam !== '';
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const page_size = Math.min(100, Math.max(1, parseInt(pageSizeParam || '20', 10) || 20));

  try {
    let where = 'WHERE t.user_id = ?';
    const params: any[] = [userId];

    if (category_id) {
      // Get all subcategory IDs including the parent
      const categoryIds = await getAllSubcategoryIds(c.env.DB, parseInt(category_id), userId);

      const placeholders = categoryIds.map(() => '?').join(',');
      where += ` AND t.category_id IN (${placeholders})`;
      params.push(...categoryIds);
    }

    if (start_date) {
      where += ' AND t.date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      where += ' AND t.date <= ?';
      params.push(end_date);
    }

    if (!paginated) {
      const query = `${TX_SELECT}
                     ${where}
                     ORDER BY t.date DESC, t.created_at DESC`;
      const { results } = await c.env.DB.prepare(query).bind(...params).all<TxRow>();
      return c.json(results.map(toTransaction));
    }

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM transactions t ${where}`
    )
      .bind(...params)
      .first<{ total: number }>();
    const total = countRow?.total ?? 0;
    const total_pages = total === 0 ? 0 : Math.ceil(total / page_size);
    const offset = (page - 1) * page_size;

    // Totals over the full filtered set (not just the current page).
    // Summed in cents so the arithmetic is integer, then converted once.
    const sumRows = await c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN c.type = 'income' THEN t.amount_cents ELSE 0 END), 0) as income_cents,
         COALESCE(SUM(CASE WHEN c.type = 'expense' THEN t.amount_cents ELSE 0 END), 0) as expense_cents
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       ${where}`
    )
      .bind(...params)
      .first<{ income_cents: number; expense_cents: number }>();

    const listQuery = `${TX_SELECT}
                       ${where}
                       ORDER BY t.date DESC, t.created_at DESC
                       LIMIT ? OFFSET ?`;
    const { results } = await c.env.DB.prepare(listQuery)
      .bind(...params, page_size, offset)
      .all<TxRow>();

    const income = centsToAmount(sumRows?.income_cents ?? 0);
    const expense = centsToAmount(sumRows?.expense_cents ?? 0);

    return c.json({
      items: results.map(toTransaction),
      total,
      page,
      page_size,
      total_pages,
      totals: {
        income: roundMoney(income),
        expense: roundMoney(expense),
        net: roundMoney(income - expense),
      },
    });
  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    return c.json({ error: 'Failed to fetch transactions' }, 500);
  }
});

// GET /api/v1/transactions/:id - Get single transaction
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    const transaction = await c.env.DB.prepare(
      `${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`
    ).bind(id, userId).first<TxRow>();

    if (!transaction) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json(toTransaction(transaction));
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
      `INSERT INTO transactions (user_id, amount_cents, currency, description, date, category_id, source, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?) RETURNING *`
    ).bind(userId, toCents(amount), currency, description || null, date, category_id, now, now).first<TransactionRow>();

    if (!result) {
      return c.json({ error: 'Failed to create transaction' }, 500);
    }

    // The item and its price live in item_prices now. Without an item there is
    // nothing to attach the observation to, so the fields are dropped — that is
    // the same information the v1 schema kept in these columns.
    if (finalItemId) {
      await c.env.DB.prepare(
        `INSERT INTO item_prices
           (user_id, item_id, transaction_id, unit_price_cents, quantity, unit, currency, merchant, observed_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).bind(
        userId, finalItemId, result.id,
        toCents(unit_price ?? amount), quantity ?? null, unit || null,
        currency, date, now,
      ).run();
    }

    const full = await c.env.DB.prepare(
      `${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`
    ).bind(result.id, userId).first<TxRow>();

    return c.json(full ? toTransaction(full) : toTransaction({
      ...result, item_name: null, item_id: null, unit_price_cents: null,
      quantity: null, unit: null,
    }), 201);
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
      updates.push('amount_cents = ?');
      values.push(toCents(body.amount));
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
    
    // Item and price fields are no longer columns on transactions; they are
    // resolved here and written to item_prices after the transaction row.
    let nextItemId: number | null | undefined;

    // Handle item_id and item_name
    if (body.item_name !== undefined) {
      if (body.item_name && body.item_name.trim().length > 0) {
        // Check if item already exists
        const existingItem = await c.env.DB.prepare(
          'SELECT id FROM items WHERE name = ? AND user_id = ?'
        ).bind(body.item_name.trim(), userId).first<{ id: number }>();

        if (existingItem) {
          nextItemId = existingItem.id;
        } else {
          // Create new item
          const newItem = await c.env.DB.prepare(
            'INSERT INTO items (name, user_id, created_at) VALUES (?, ?, ?) RETURNING id'
          ).bind(body.item_name.trim(), userId, new Date().toISOString()).first<{ id: number }>();
          
          if (newItem) {
            nextItemId = newItem.id;
          }
        }
      } else {
        // Clear the item link if item_name is empty
        nextItemId = null;
      }
    } else if (body.item_id !== undefined) {
      if (body.item_id !== null && !(await ensureOwnedItem(c.env.DB, body.item_id, userId))) {
        return c.json({ error: 'Item not found' }, 404);
      }
      nextItemId = body.item_id;
    }

    const hasPriceUpdate =
      nextItemId !== undefined ||
      body.unit_price !== undefined ||
      body.quantity !== undefined ||
      body.unit !== undefined;

    if (!hasPriceUpdate && updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    const now = new Date().toISOString();

    let result: TransactionRow | null = null;
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id, userId);

      result = await c.env.DB.prepare(
        `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
      ).bind(...values).first<TransactionRow>();

      if (!result) {
        return c.json({ error: 'Transaction not found' }, 404);
      }
    } else {
      result = await c.env.DB.prepare(
        'SELECT * FROM transactions WHERE id = ? AND user_id = ?'
      ).bind(id, userId).first<TransactionRow>();

      if (!result) {
        return c.json({ error: 'Transaction not found' }, 404);
      }
    }

    if (hasPriceUpdate) {
      const existing = await c.env.DB.prepare(
        'SELECT * FROM item_prices WHERE transaction_id = ?'
      ).bind(id).first<ItemPrice>();

      const itemId = nextItemId !== undefined ? nextItemId
        : (existing ? existing.item_id : null);

      if (itemId === null) {
        // Nothing to attach a price to: remove any existing observation.
        await c.env.DB.prepare('DELETE FROM item_prices WHERE transaction_id = ?')
          .bind(id).run();
      } else if (existing) {
        await c.env.DB.prepare(
          `UPDATE item_prices
             SET item_id = ?, unit_price_cents = ?, quantity = ?, unit = ?, observed_on = ?
           WHERE transaction_id = ?`
        ).bind(
          itemId,
          body.unit_price !== undefined ? toCents(body.unit_price) : existing.unit_price_cents,
          body.quantity !== undefined ? body.quantity : existing.quantity,
          body.unit !== undefined ? body.unit : existing.unit,
          body.date !== undefined ? body.date : existing.observed_on,
          id,
        ).run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO item_prices
             (user_id, item_id, transaction_id, unit_price_cents, quantity, unit, currency, merchant, observed_on, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        ).bind(
          userId, itemId, id,
          body.unit_price !== undefined ? toCents(body.unit_price) : result.amount_cents,
          body.quantity ?? null, body.unit ?? null,
          result.currency, result.date, now,
        ).run();
      }
    }

    const full = await c.env.DB.prepare(
      `${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`
    ).bind(id, userId).first<TxRow>();

    return c.json(full ? toTransaction(full) : toTransaction({
      ...result, item_name: null, item_id: null, unit_price_cents: null,
      quantity: null, unit: null,
    }));
  } catch (error) {
    return c.json({ error: 'Failed to update transaction' }, 500);
  }
});

// DELETE /api/v1/transactions/:id - Delete transaction
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  
  try {
    // The price observation this transaction recorded has to go with it. Its
    // foreign key is ON DELETE SET NULL (a price can legitimately exist without
    // a transaction, so CASCADE is not appropriate), which would otherwise
    // leave an orphan indistinguishable from a price the user logged by hand —
    // and that phantom would keep counting towards the item's last/average
    // price. v1 stored the price on the transaction, so deleting the
    // transaction removed it; this preserves that.
    await c.env.DB.prepare(
      'DELETE FROM item_prices WHERE transaction_id = ? AND user_id = ?'
    ).bind(id, userId).run();

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
