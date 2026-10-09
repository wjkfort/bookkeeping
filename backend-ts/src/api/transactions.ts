import { Hono } from 'hono';
import type { Env, HonoVariables, CreateTransactionRequest, UpdateTransactionRequest } from '../types';
import { getAllSubcategoryIds } from '../utils/categories';
import { centsToAmount, roundMoney } from '../utils/money';
import {
  TX_SELECT,
  toTransaction,
  type TxRow,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type ItemObservationInput,
} from '../services/transactions';
import { toErrorResponse } from '../services/errors';
import { requireTimezone } from '../utils/time';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

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
//
// The business logic lives in src/services/transactions.ts so that the AI tool
// `add_transaction` executes exactly this code instead of a parallel copy. The
// handler's job is the HTTP part: parse the body, delegate, map the result (or
// a ServiceError) onto a response.
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<CreateTransactionRequest & { timezone?: string }>();
    const { amount, currency, description, date, category_id, item_id, item_name, unit_price, quantity, unit } = body;

    // Optional, and only used when no date is supplied: an explicit date is the
    // caller's and is never moved. Defaults to UTC+8 (see utils/time.ts).
    const timezone = requireTimezone(body.timezone);

    // Only forwarded when something price/item-shaped was sent, so the service
    // can tell "no item" from "clear the item".
    const item: ItemObservationInput | null =
      item_id !== undefined || item_name !== undefined || unit_price !== undefined ||
      quantity !== undefined || unit !== undefined
        ? { item_id, item_name, unit_price, quantity, unit }
        : null;

    const transaction = await createTransaction(c.env.DB, userId, {
      amount, currency, date, category_id, description, item, timezone,
    });

    return c.json(transaction, 201);
  } catch (error: any) {
    if (error?.message?.includes('FOREIGN KEY constraint')) {
      return c.json({ error: 'Category not found' }, 404);
    }
    const { status, body } = toErrorResponse(error, 'Failed to create transaction');
    return c.json(body, status);
  }
});

// PUT /api/v1/transactions/:id - Update transaction
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<UpdateTransactionRequest>();
    const transaction = await updateTransaction(c.env.DB, userId, id, body);
    return c.json(transaction);
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to update transaction');
    return c.json(body, status);
  }
});

// DELETE /api/v1/transactions/:id - Delete transaction
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    await deleteTransaction(c.env.DB, userId, id);
    return c.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to delete transaction');
    return c.json(body, status);
  }
});

export default app;
