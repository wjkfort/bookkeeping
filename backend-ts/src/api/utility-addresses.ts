import { Hono } from 'hono';
import type { Env, HonoVariables } from '../types';

interface UtilityAddress {
  id: number;
  user_id: number;
  name: string;
  address: string;
  created_at: string;
}

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/utility-addresses - List all addresses
app.get('/', async (c) => {
  const userId = c.get('userId');

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM utility_addresses
      WHERE user_id = ?
      ORDER BY name ASC
    `).bind(userId).all<UtilityAddress>();

    return c.json(results);
  } catch (error) {
    console.error('Error fetching utility addresses:', error);
    return c.json({ error: 'Failed to fetch utility addresses' }, 500);
  }
});

// GET /api/v1/utility-addresses/:id - Get single address
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const address = await c.env.DB.prepare(
      'SELECT * FROM utility_addresses WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first<UtilityAddress>();

    if (!address) {
      return c.json({ error: 'Address not found' }, 404);
    }

    return c.json(address);
  } catch (error) {
    return c.json({ error: 'Failed to fetch address' }, 500);
  }
});

// POST /api/v1/utility-addresses - Create address
app.post('/', async (c) => {
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name: string; address: string }>();
    const { name, address } = body;

    if (!name || !address) {
      return c.json({ error: 'name and address are required' }, 400);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(`
      INSERT INTO utility_addresses (user_id, name, address, created_at)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).bind(userId, name, address, now).first<UtilityAddress>();

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'An address with this name already exists' }, 409);
    }
    console.error('Error creating utility address:', error);
    return c.json({ error: 'Failed to create utility address' }, 500);
  }
});

// PUT /api/v1/utility-addresses/:id - Update address
app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const body = await c.req.json<{ name?: string; address?: string }>();
    const { name, address } = body;

    if (!name && !address) {
      return c.json({ error: 'name or address is required' }, 400);
    }

    const updates: string[] = [];
    const values: (number | string)[] = [];

    if (name) {
      updates.push('name = ?');
      values.push(name);
    }
    if (address) {
      updates.push('address = ?');
      values.push(address);
    }

    values.push(id, userId);

    const result = await c.env.DB.prepare(`
      UPDATE utility_addresses
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
      RETURNING *
    `).bind(...values).first<UtilityAddress>();

    if (!result) {
      return c.json({ error: 'Address not found' }, 404);
    }

    return c.json(result);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'An address with this name already exists' }, 409);
    }
    console.error('Error updating utility address:', error);
    return c.json({ error: 'Failed to update utility address' }, 500);
  }
});

// DELETE /api/v1/utility-addresses/:id - Delete address
app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');

  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM utility_addresses WHERE id = ? AND user_id = ? RETURNING id'
    ).bind(id, userId).first();

    if (!result) {
      return c.json({ error: 'Address not found' }, 404);
    }

    return c.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Error deleting utility address:', error);
    return c.json({ error: 'Failed to delete utility address' }, 500);
  }
});

export default app;
