import { Hono } from 'hono';
import type { Env, Category, CreateCategoryRequest, UpdateCategoryRequest } from '../types';

const app = new Hono<{ Bindings: Env }>();

// Helper function to build category tree
function buildCategoryTree(categories: Category[]): Category[] {
  const categoryMap = new Map<number, Category>();
  const rootCategories: Category[] = [];

  // First pass: create map
  categories.forEach(cat => {
    categoryMap.set(cat.id, { ...cat, children: [] });
  });

  // Second pass: build tree
  categories.forEach(cat => {
    const category = categoryMap.get(cat.id)!;
    if (cat.parent_id === null) {
      rootCategories.push(category);
    } else {
      const parent = categoryMap.get(cat.parent_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(category);
      }
    }
  });

  return rootCategories;
}

// GET /api/v1/categories - List all categories
app.get('/', async (c) => {
  const flat = c.req.query('flat') === 'true';
  
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM categories ORDER BY created_at ASC'
    ).all<Category>();

    const categories = results.map(cat => ({
      ...cat,
      translations: cat.translations ? JSON.parse(cat.translations as any) : null
    }));

    if (flat) {
      return c.json(categories);
    }

    const tree = buildCategoryTree(categories);
    return c.json(tree);
  } catch (error) {
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// GET /api/v1/categories/:id - Get single category
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  try {
    const category = await c.env.DB.prepare(
      'SELECT * FROM categories WHERE id = ?'
    ).bind(id).first<Category>();

    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }

    return c.json({
      ...category,
      translations: category.translations ? JSON.parse(category.translations as any) : null
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch category' }, 500);
  }
});

// POST /api/v1/categories - Create category
app.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateCategoryRequest>();
    const { name, type, parent_id, translations } = body;

    if (!name || !type) {
      return c.json({ error: 'Name and type are required' }, 400);
    }

    if (type !== 'income' && type !== 'expense') {
      return c.json({ error: 'Type must be income or expense' }, 400);
    }

    const translationsJson = translations ? JSON.stringify(translations) : null;

    const result = await c.env.DB.prepare(
      'INSERT INTO categories (name, type, parent_id, translations) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(name, type, parent_id || null, translationsJson).first<Category>();

    return c.json({
      ...result,
      translations: result?.translations ? JSON.parse(result.translations as any) : null
    }, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Category with this name already exists' }, 409);
    }
    return c.json({ error: 'Failed to create category' }, 500);
  }
});

// PUT /api/v1/categories/:id - Update category
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  try {
    const body = await c.req.json<UpdateCategoryRequest>();
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.type !== undefined) {
      if (body.type !== 'income' && body.type !== 'expense') {
        return c.json({ error: 'Type must be income or expense' }, 400);
      }
      updates.push('type = ?');
      values.push(body.type);
    }
    if (body.parent_id !== undefined) {
      updates.push('parent_id = ?');
      values.push(body.parent_id);
    }
    if (body.translations !== undefined) {
      updates.push('translations = ?');
      values.push(JSON.stringify(body.translations));
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    values.push(id);

    const result = await c.env.DB.prepare(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ? RETURNING *`
    ).bind(...values).first<Category>();

    if (!result) {
      return c.json({ error: 'Category not found' }, 404);
    }

    return c.json({
      ...result,
      translations: result.translations ? JSON.parse(result.translations as any) : null
    });
  } catch (error) {
    return c.json({ error: 'Failed to update category' }, 500);
  }
});

// DELETE /api/v1/categories/:id - Delete category
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM categories WHERE id = ? RETURNING id'
    ).bind(id).first();

    if (!result) {
      return c.json({ error: 'Category not found' }, 404);
    }

    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to delete category' }, 500);
  }
});

export default app;
