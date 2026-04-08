import { Hono } from 'hono';
import type { Env, HonoVariables, UtilityType } from '../types';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/utility-types - List all utility types for user
app.get('/', async (c) => {
  const userId = c.get('userId');

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT ut.*, c.name as category_name
       FROM utility_types ut
       LEFT JOIN categories c ON ut.category_id = c.id
       WHERE ut.user_id = ?
       ORDER BY ut.created_at ASC`
    ).bind(userId).all<UtilityType>();

    return c.json(results);
  } catch (error) {
    console.error('Error fetching utility types:', error);
    return c.json({ error: 'Failed to fetch utility types' }, 500);
  }
});

// GET /api/v1/utility-types/:id - Get single utility type
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const result = await c.env.DB.prepare(
      `SELECT ut.*, c.name as category_name
       FROM utility_types ut
       LEFT JOIN categories c ON ut.category_id = c.id
       WHERE ut.id = ? AND ut.user_id = ?`
    ).bind(id, userId).first<UtilityType>();

    if (!result) {
      return c.json({ error: 'Utility type not found' }, 404);
    }

    return c.json(result);
  } catch (error) {
    return c.json({ error: 'Failed to fetch utility type' }, 500);
  }
});

// POST /api/v1/utility-types - Create utility type
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name: string; icon?: string; category_id?: number | null }>();
    const { name, icon, category_id } = body;

    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400);
    }

    // Validate category_id if provided
    if (category_id) {
      const category = await c.env.DB.prepare(
        'SELECT id FROM categories WHERE id = ? AND user_id = ?'
      ).bind(category_id, userId).first();
      if (!category) {
        return c.json({ error: 'Category not found' }, 404);
      }
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO utility_types (user_id, name, icon, category_id)
       VALUES (?, ?, ?, ?) RETURNING *`
    ).bind(userId, name.trim(), icon || null, category_id || null).first<UtilityType>();

    // Fetch with category_name
    if (result) {
      const full = await c.env.DB.prepare(
        `SELECT ut.*, c.name as category_name
         FROM utility_types ut
         LEFT JOIN categories c ON ut.category_id = c.id
         WHERE ut.id = ?`
      ).bind(result.id).first<UtilityType>();
      return c.json(full, 201);
    }

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Utility type with this name already exists' }, 409);
    }
    console.error('Error creating utility type:', error);
    return c.json({ error: 'Failed to create utility type' }, 500);
  }
});

// PUT /api/v1/utility-types/:id - Update utility type
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name?: string; icon?: string; category_id?: number | null }>();
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return c.json({ error: 'Name cannot be empty' }, 400);
      }
      updates.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.icon !== undefined) {
      updates.push('icon = ?');
      values.push(body.icon);
    }
    if (body.category_id !== undefined) {
      if (body.category_id !== null) {
        const category = await c.env.DB.prepare(
          'SELECT id FROM categories WHERE id = ? AND user_id = ?'
        ).bind(body.category_id, userId).first();
        if (!category) {
          return c.json({ error: 'Category not found' }, 404);
        }
      }
      updates.push('category_id = ?');
      values.push(body.category_id);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    values.push(id, userId);

    const result = await c.env.DB.prepare(
      `UPDATE utility_types SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`
    ).bind(...values).first<UtilityType>();

    if (!result) {
      return c.json({ error: 'Utility type not found' }, 404);
    }

    // Fetch with category_name
    const full = await c.env.DB.prepare(
      `SELECT ut.*, c.name as category_name
       FROM utility_types ut
       LEFT JOIN categories c ON ut.category_id = c.id
       WHERE ut.id = ?`
    ).bind(result.id).first<UtilityType>();

    return c.json(full);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Utility type with this name already exists' }, 409);
    }
    console.error('Error updating utility type:', error);
    return c.json({ error: 'Failed to update utility type' }, 500);
  }
});

// DELETE /api/v1/utility-types/:id - Delete utility type
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM utility_types WHERE id = ? AND user_id = ? RETURNING id'
    ).bind(id, userId).first();

    if (!result) {
      return c.json({ error: 'Utility type not found' }, 404);
    }

    return c.json({ message: 'Utility type deleted successfully' });
  } catch (error) {
    console.error('Error deleting utility type:', error);
    return c.json({ error: 'Failed to delete utility type' }, 500);
  }
});

export default app;
