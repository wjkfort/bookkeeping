import { Hono } from 'hono';
import type { Env, HonoVariables } from '../types';
import {
  listItems,
  fetchItem,
  getItemHistory,
  createItem,
  renameItem,
  deleteItem,
  searchItems,
} from '../services/items';
import { toErrorResponse } from '../services/errors';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/items - List all items with optional stats
app.get('/', async (c) => {
  const withStats = c.req.query('with_stats') === 'true';
  const userId = c.get('userId');

  try {
    return c.json(await listItems(c.env.DB, userId, withStats));
  } catch (error) {
    console.error('Failed to fetch items:', error);
    return c.json({ error: 'Failed to fetch items' }, 500);
  }
});

// GET /api/v1/items/:id - Get single item
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const item = await fetchItem(c.env.DB, userId, id);
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
    return c.json(await getItemHistory(c.env.DB, userId, id));
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to fetch item history');
    return c.json(body, status);
  }
});

// POST /api/v1/items - Create new item
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name: string }>();
    return c.json(await createItem(c.env.DB, userId, body.name), 201);
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Item with this name already exists' }, 409);
    }
    const { status, body } = toErrorResponse(error, 'Failed to create item');
    return c.json(body, status);
  }
});

// PUT /api/v1/items/:id - Update item
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name: string }>();
    return c.json(await renameItem(c.env.DB, userId, id, body.name));
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Item with this name already exists' }, 409);
    }
    const { status, body } = toErrorResponse(error, 'Failed to update item');
    return c.json(body, status);
  }
});

// DELETE /api/v1/items/:id - Delete item
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    await deleteItem(c.env.DB, userId, id);
    return c.json({ message: 'Item deleted successfully' });
  } catch (error) {
    const { status, body } = toErrorResponse(error, 'Failed to delete item');
    return c.json(body, status);
  }
});

// GET /api/v1/items/search/:query - Search items by name
app.get('/search/:query', async (c) => {
  const query = c.req.param('query');
  const userId = c.get('userId');

  try {
    return c.json(await searchItems(c.env.DB, userId, query));
  } catch (error) {
    return c.json({ error: 'Failed to search items' }, 500);
  }
});

export default app;
