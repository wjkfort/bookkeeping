import { Hono } from "hono";
import type { Env, HonoVariables, Subscription } from "../types";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// GET /api/v1/subscriptions - List all subscriptions for user
app.get("/", async (c) => {
  const userId = c.get("userId");

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
        s.*,
        c.name as category_name
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.user_id = ?
      ORDER BY s.end_date ASC`
    )
      .bind(userId)
      .all<Subscription & { category_name: string | null }>();

    return c.json(results);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return c.json({ error: "Failed to fetch subscriptions" }, 500);
  }
});

// GET /api/v1/subscriptions/:id - Get single subscription
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const subscription = await c.env.DB.prepare(
      `SELECT
        s.*,
        c.name as category_name
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.id = ? AND s.user_id = ?`
    )
      .bind(id, userId)
      .first<Subscription & { category_name: string | null }>();

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json(subscription);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return c.json({ error: "Failed to fetch subscription" }, 500);
  }
});

// POST /api/v1/subscriptions - Create subscription
app.post("/", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{
      name: string;
      icon?: string;
      amount?: number;
      currency?: string;
      end_date: string;
      cycle?: number;
      category_id?: number | null;
    }>();

    const { name, icon, amount = 0, currency = "USD", end_date, cycle = 30, category_id = null } = body;

    if (!name || !end_date) {
      return c.json({ error: "name and end_date are required" }, 400);
    }

    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return c.json({ error: "end_date must be in YYYY-MM-DD format" }, 400);
    }

    // Validate cycle
    if (cycle < 1) {
      return c.json({ error: "cycle must be at least 1 day" }, 400);
    }

    // Validate category if provided
    if (category_id) {
      const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?").bind(category_id, userId).first();
      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      `INSERT INTO subscriptions (user_id, name, icon, amount, currency, end_date, cycle, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
      .bind(userId, name, icon || null, amount, currency, end_date, cycle, category_id, now)
      .first<Subscription>();

    // Fetch with category name
    if (result) {
      const full = await c.env.DB.prepare(
        `SELECT
          s.*,
          c.name as category_name
        FROM subscriptions s
        LEFT JOIN categories c ON s.category_id = c.id
        WHERE s.id = ?`
      ).bind(result.id).first<Subscription & { category_name: string | null }>();
      return c.json(full, 201);
    }

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "A subscription with this name already exists" }, 409);
    }
    console.error("Error creating subscription:", error);
    return c.json({ error: "Failed to create subscription" }, 500);
  }
});

// PUT /api/v1/subscriptions/:id - Update subscription
app.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{
      name?: string;
      icon?: string | null;
      amount?: number;
      currency?: string;
      end_date?: string;
      cycle?: number;
      category_id?: number | null;
    }>();

    const { name, icon, amount, currency, end_date, cycle, category_id } = body;

    // Check subscription exists
    const existing = await c.env.DB.prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ?").bind(id, userId).first();
    if (!existing) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: (number | string | null)[] = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }
    if (icon !== undefined) {
      updates.push("icon = ?");
      values.push(icon);
    }
    if (amount !== undefined) {
      updates.push("amount = ?");
      values.push(amount);
    }
    if (currency !== undefined) {
      updates.push("currency = ?");
      values.push(currency);
    }
    if (end_date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        return c.json({ error: "end_date must be in YYYY-MM-DD format" }, 400);
      }
      updates.push("end_date = ?");
      values.push(end_date);
    }
    if (cycle !== undefined) {
      if (cycle < 1) {
        return c.json({ error: "cycle must be at least 1 day" }, 400);
      }
      updates.push("cycle = ?");
      values.push(cycle);
    }
    if (category_id !== undefined) {
      // Validate category if provided
      if (category_id !== null) {
        const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?").bind(category_id, userId).first();
        if (!category) {
          return c.json({ error: "Category not found" }, 404);
        }
      }
      updates.push("category_id = ?");
      values.push(category_id);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    values.push(id, userId);

    const result = await c.env.DB.prepare(
      `UPDATE subscriptions
       SET ${updates.join(", ")}
       WHERE id = ? AND user_id = ?
       RETURNING *`
    )
      .bind(...values)
      .first<Subscription>();

    // Fetch with category name
    if (result) {
      const full = await c.env.DB.prepare(
        `SELECT
          s.*,
          c.name as category_name
        FROM subscriptions s
        LEFT JOIN categories c ON s.category_id = c.id
        WHERE s.id = ?`
      ).bind(result.id).first<Subscription & { category_name: string | null }>();
      return c.json(full);
    }

    return c.json(result);
  } catch (error: any) {
    if (error.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "A subscription with this name already exists" }, 409);
    }
    console.error("Error updating subscription:", error);
    return c.json({ error: "Failed to update subscription" }, 500);
  }
});

// DELETE /api/v1/subscriptions/:id - Delete subscription
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const result = await c.env.DB.prepare("DELETE FROM subscriptions WHERE id = ? AND user_id = ? RETURNING id").bind(id, userId).first();

    if (!result) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json({ message: "Subscription deleted successfully" });
  } catch (error) {
    console.error("Error deleting subscription:", error);
    return c.json({ error: "Failed to delete subscription" }, 500);
  }
});

export default app;
