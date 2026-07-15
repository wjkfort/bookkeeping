import { Hono } from "hono";
import type { Env, HonoVariables, Subscription, SubscriptionRenewal } from "../types";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchSubscription(
  db: D1Database,
  id: number,
  userId: number
): Promise<(Subscription & { category_name: string | null }) | null> {
  return db
    .prepare(
      `SELECT
        s.*,
        c.name as category_name
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.id = ? AND s.user_id = ?`
    )
    .bind(id, userId)
    .first<Subscription & { category_name: string | null }>();
}

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
    const subscription = await fetchSubscription(c.env.DB, id, userId);

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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return c.json({ error: "end_date must be in YYYY-MM-DD format" }, 400);
    }

    if (cycle < 1) {
      return c.json({ error: "cycle must be at least 1 day" }, 400);
    }

    if (category_id) {
      const category = await c.env.DB.prepare(
        "SELECT id FROM categories WHERE id = ? AND user_id = ?"
      )
        .bind(category_id, userId)
        .first();
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

    if (result) {
      const full = await fetchSubscription(c.env.DB, result.id, userId);
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

// POST /api/v1/subscriptions/:id/renew - Advance end_date and optionally create expense
app.post("/:id/renew", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      amount?: number;
      currency?: string;
      date?: string;
      category_id?: number | null;
      create_transaction?: boolean;
      description?: string;
    };

    const subscription = await c.env.DB.prepare(
      "SELECT * FROM subscriptions WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .first<Subscription>();

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    const amount = body.amount !== undefined ? body.amount : subscription.amount;
    const currency = body.currency || subscription.currency;
    const createTx = body.create_transaction !== false;
    const categoryId =
      body.category_id !== undefined ? body.category_id : subscription.category_id;
    const txDate =
      body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : new Date().toISOString().slice(0, 10);
    const description =
      body.description?.trim() || `Subscription renewal: ${subscription.name}`;

    if (createTx && amount > 0 && !categoryId) {
      return c.json(
        {
          error:
            "category_id is required to create a transaction (set it on the subscription or pass it in the request)",
        },
        400
      );
    }

    if (createTx && categoryId) {
      const category = await c.env.DB.prepare(
        "SELECT id, type FROM categories WHERE id = ? AND user_id = ?"
      )
        .bind(categoryId, userId)
        .first<{ id: number; type: string }>();
      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
      if (category.type !== "expense") {
        return c.json({ error: "Renewal category must be an expense category" }, 400);
      }
    }

    const periodStart = subscription.end_date;
    const periodEnd = addDays(subscription.end_date, subscription.cycle);
    const now = new Date().toISOString();

    let transactionId: number | null = null;

    if (createTx && amount > 0 && categoryId) {
      const tx = await c.env.DB.prepare(
        `INSERT INTO transactions (user_id, amount, currency, description, date, category_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
        .bind(userId, amount, currency, description, txDate, categoryId, now, now)
        .first<{ id: number }>();
      transactionId = tx?.id ?? null;
    }

    await c.env.DB.prepare(
      `UPDATE subscriptions
       SET end_date = ?, last_renewed_at = ?, category_id = COALESCE(?, category_id)
       WHERE id = ? AND user_id = ?`
    )
      .bind(periodEnd, now, categoryId, id, userId)
      .run();

    const renewal = await c.env.DB.prepare(
      `INSERT INTO subscription_renewals
        (user_id, subscription_id, transaction_id, amount, currency, period_start, period_end, renewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
      .bind(userId, id, transactionId, amount, currency, periodStart, periodEnd, now)
      .first<SubscriptionRenewal>();

    const updated = await fetchSubscription(c.env.DB, id, userId);

    return c.json({
      subscription: updated,
      renewal,
      transaction_id: transactionId,
    });
  } catch (error) {
    console.error("Error renewing subscription:", error);
    return c.json({ error: "Failed to renew subscription" }, 500);
  }
});

// GET /api/v1/subscriptions/:id/renewals - Renewal history
app.get("/:id/renewals", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const subscription = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .first();

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM subscription_renewals
       WHERE subscription_id = ? AND user_id = ?
       ORDER BY renewed_at DESC`
    )
      .bind(id, userId)
      .all<SubscriptionRenewal>();

    return c.json(results);
  } catch (error) {
    console.error("Error fetching renewals:", error);
    return c.json({ error: "Failed to fetch renewals" }, 500);
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

    const existing = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .first();
    if (!existing) {
      return c.json({ error: "Subscription not found" }, 404);
    }

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
      if (category_id !== null) {
        const category = await c.env.DB.prepare(
          "SELECT id FROM categories WHERE id = ? AND user_id = ?"
        )
          .bind(category_id, userId)
          .first();
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

    if (result) {
      const full = await fetchSubscription(c.env.DB, result.id, userId);
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
    const result = await c.env.DB.prepare(
      "DELETE FROM subscriptions WHERE id = ? AND user_id = ? RETURNING id"
    )
      .bind(id, userId)
      .first();

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
