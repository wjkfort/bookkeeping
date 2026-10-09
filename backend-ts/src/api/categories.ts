import { Hono } from 'hono';
import type { Env, HonoVariables, CreateCategoryRequest, UpdateCategoryRequest } from '../types';
import {
  listCategories,
  fetchCategory,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../services/categories';
import { toErrorResponse } from '../services/errors';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/categories - List all categories
app.get('/', async (c) => {
  const flat = c.req.query('flat') === 'true';
  const userId = c.get('userId');

  try {
    return c.json(await listCategories(c.env.DB, userId, flat));
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// GET /api/v1/categories/:id - Get single category
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const category = await fetchCategory(c.env.DB, userId, id);
    if (!category) {
      return c.json({ error: 'Category not found' }, 404);
    }
    return c.json(category);
  } catch (error) {
    return c.json({ error: 'Failed to fetch category' }, 500);
  }
});

// POST /api/v1/categories - Create category
//
// Depth and type rules live in src/services/categories.ts (see the note there):
// a child may not have children, and a child's type must match its parent's.
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<CreateCategoryRequest>();
    return c.json(await createCategory(c.env.DB, userId, body), 201);
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Category with this name already exists' }, 409);
    }
    const { status, body } = toErrorResponse(error, 'Failed to create category');
    return c.json(body, status);
  }
});

// PUT /api/v1/categories/:id - Update category
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<UpdateCategoryRequest>();
    return c.json(await updateCategory(c.env.DB, userId, id, body));
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Category with this name already exists' }, 409);
    }
    const { status, body } = toErrorResponse(error, 'Failed to update category');
    return c.json(body, status);
  }
});

// DELETE /api/v1/categories/:id - Delete category
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    await deleteCategory(c.env.DB, userId, id);
    return c.json({ message: 'Category deleted successfully' });
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to delete category');
    return c.json(body, status);
  }
});

export default app;
