import { Hono } from 'hono';
import type { Env, HonoVariables, Summary } from '../types';
import { getExchangeRate } from '../utils/currency';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/summary - Get income/expense summary
app.get('/', async (c) => {
  const target_currency = c.req.query('target_currency') || 'USD';
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const userId = c.get('userId');
  
  try {
    let query = `
      SELECT 
        t.amount,
        t.currency,
        c.type
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ?
    `;
    const params: any[] = [userId];

    if (start_date) {
      query += ' AND t.date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND t.date <= ?';
      params.push(end_date);
    }

    const stmt = c.env.DB.prepare(query);
    const { results } = await (params.length > 0 ? stmt.bind(...params) : stmt).all<{
      amount: number;
      currency: string;
      type: string;
    }>();

    let total_income = 0;
    let total_expense = 0;

    // Convert all amounts to target currency
    for (const row of results) {
      let amount = row.amount;
      
      // Convert if currencies don't match
      if (row.currency !== target_currency) {
        const rate = await getExchangeRate(c.env, row.currency, target_currency);
        amount = amount * rate;
      }

      if (row.type === 'income') {
        total_income += amount;
      } else {
        total_expense += amount;
      }
    }

    const summary: Summary = {
      total_income: Math.round(total_income * 100) / 100,
      total_expense: Math.round(total_expense * 100) / 100,
      balance: Math.round((total_income - total_expense) * 100) / 100,
      currency: target_currency
    };

    return c.json(summary);
  } catch (error) {
    console.error('Summary error:', error);
    return c.json({ error: 'Failed to calculate summary' }, 500);
  }
});

export default app;
