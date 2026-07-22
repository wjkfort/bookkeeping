import { Hono } from 'hono';
import type { Env, HonoVariables, Summary, MonthlySummary, CategorySummary } from '../types';
import { getExchangeRate } from '../utils/currency';
import { getAllSubcategoryIds } from '../utils/categories';

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
    const { results } = await stmt.bind(...params).all<{
      amount: number;
      currency: string;
      type: string;
    }>();

    let total_income = 0;
    let total_expense = 0;

    for (const row of results) {
      let amount = row.amount;

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
      currency: target_currency,
    };

    return c.json(summary);
  } catch (error) {
    console.error('Summary error:', error);
    return c.json({ error: 'Failed to calculate summary' }, 500);
  }
});

// GET /api/v1/summary/monthly - Monthly income/expense trend
// Optional category_id: filter to that category + all subcategories
app.get('/monthly', async (c) => {
  const target_currency = c.req.query('target_currency') || 'USD';
  const months = Math.min(Math.max(parseInt(c.req.query('months') || '6', 10) || 6, 1), 24);
  const categoryIdRaw = c.req.query('category_id');
  const userId = c.get('userId');

  try {
    // Inclusive window: first day of (months-1) months ago → today
    const end = new Date();
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
    const start_date = start.toISOString().slice(0, 10);

    let query = `
      SELECT
        strftime('%Y-%m', t.date) as month,
        t.amount,
        t.currency,
        c.type
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ? AND t.date >= ?
    `;
    const params: any[] = [userId, start_date];

    if (categoryIdRaw) {
      const categoryId = parseInt(categoryIdRaw, 10);
      if (Number.isNaN(categoryId)) {
        return c.json({ error: 'Invalid category_id' }, 400);
      }
      const owned = await c.env.DB.prepare(
        'SELECT id FROM categories WHERE id = ? AND user_id = ?',
      )
        .bind(categoryId, userId)
        .first();
      if (!owned) {
        return c.json({ error: 'Category not found' }, 404);
      }
      const categoryIds = await getAllSubcategoryIds(c.env.DB, categoryId, userId);
      const placeholders = categoryIds.map(() => '?').join(',');
      query += ` AND t.category_id IN (${placeholders})`;
      params.push(...categoryIds);
    }

    query += ' ORDER BY month';

    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all<{ month: string; amount: number; currency: string; type: string }>();

    const byMonth = new Map<string, { income: number; expense: number }>();

    // Seed empty months so chart has continuous axis
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const key = d.toISOString().slice(0, 7);
      byMonth.set(key, { income: 0, expense: 0 });
    }

    for (const row of results) {
      let amount = row.amount;
      if (row.currency !== target_currency) {
        const rate = await getExchangeRate(c.env, row.currency, target_currency);
        amount = amount * rate;
      }
      const bucket = byMonth.get(row.month) ?? { income: 0, expense: 0 };
      if (row.type === 'income') bucket.income += amount;
      else bucket.expense += amount;
      byMonth.set(row.month, bucket);
    }

    const data: MonthlySummary[] = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        income: Math.round(v.income * 100) / 100,
        expense: Math.round(v.expense * 100) / 100,
        net: Math.round((v.income - v.expense) * 100) / 100,
      }));

    return c.json({ currency: target_currency, months: data });
  } catch (error) {
    console.error('Monthly summary error:', error);
    return c.json({ error: 'Failed to calculate monthly summary' }, 500);
  }
});

// GET /api/v1/summary/by-category - Expense breakdown by category
app.get('/by-category', async (c) => {
  const target_currency = c.req.query('target_currency') || 'USD';
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  // parent = roll up to parent category when present; leaf = use actual category
  const level = c.req.query('level') === 'leaf' ? 'leaf' : 'parent';
  const userId = c.get('userId');

  try {
    let query = `
      SELECT
        c.id as category_id,
        c.name as category_name,
        c.parent_id,
        c.translations as category_translations,
        p.id as parent_category_id,
        p.name as parent_name,
        p.translations as parent_translations,
        t.amount,
        t.currency
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      WHERE t.user_id = ? AND c.type = 'expense'
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

    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all<{
        category_id: number;
        category_name: string;
        parent_id: number | null;
        category_translations: string | null;
        parent_category_id: number | null;
        parent_name: string | null;
        parent_translations: string | null;
        amount: number;
        currency: string;
      }>();

    const parseTranslations = (raw: string | null) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    const buckets = new Map<
      number,
      {
        category_id: number;
        name: string;
        parent_id: number | null;
        amount: number;
        translations: ReturnType<typeof parseTranslations>;
      }
    >();

    for (const row of results) {
      let amount = row.amount;
      if (row.currency !== target_currency) {
        const rate = await getExchangeRate(c.env, row.currency, target_currency);
        amount = amount * rate;
      }

      const useParent = level === 'parent' && row.parent_category_id != null;
      const id = useParent ? row.parent_category_id! : row.category_id;
      const name = useParent ? row.parent_name! : row.category_name;
      const parent_id = useParent ? null : row.parent_id;
      const translations = parseTranslations(
        useParent ? row.parent_translations : row.category_translations
      );

      const existing = buckets.get(id) ?? {
        category_id: id,
        name,
        parent_id,
        amount: 0,
        translations,
      };
      existing.amount += amount;
      // Keep translations if first row had none but later rows do
      if (!existing.translations && translations) {
        existing.translations = translations;
      }
      buckets.set(id, existing);
    }

    const total = Array.from(buckets.values()).reduce((s, b) => s + b.amount, 0);

    const data: CategorySummary[] = Array.from(buckets.values())
      .map((b) => ({
        category_id: b.category_id,
        name: b.name,
        parent_id: b.parent_id,
        amount: Math.round(b.amount * 100) / 100,
        pct: total > 0 ? Math.round((b.amount / total) * 1000) / 10 : 0,
        translations: b.translations,
      }))
      .sort((a, b) => b.amount - a.amount);

    return c.json({ currency: target_currency, total: Math.round(total * 100) / 100, categories: data });
  } catch (error) {
    console.error('Category summary error:', error);
    return c.json({ error: 'Failed to calculate category summary' }, 500);
  }
});

export default app;
