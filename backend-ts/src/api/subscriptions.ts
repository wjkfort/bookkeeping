import { Hono } from "hono";
import type { Env, HonoVariables, Subscription, SubscriptionRow, SubscriptionRenewal } from "../types";
import { toCents, centsToAmount } from "../utils/money";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Subscription row plus the joined category name and derived renewal date. */
interface SubscriptionJoined extends SubscriptionRow {
  category_name: string | null;
  last_renewed_at: string | null;
}

// `last_renewed_at` was dropped in v2: it is the timestamp of the subscription's
// most recent renewal transaction. The transaction's created_at is used rather
// than its date, because the v1 column held a full timestamp and the renewal
// transaction is written at the moment of renewal.
const SUBSCRIPTION_SELECT = `
  SELECT
    s.id, s.user_id, s.name, s.icon, s.amount_cents, s.currency,
    s.cycle_days, s.end_date, s.category_id, s.archived_at, s.created_at,
    c.name as category_name,
    (SELECT t.created_at FROM transactions t
      WHERE t.subscription_id = s.id AND t.user_id = s.user_id
      ORDER BY t.date DESC, t.created_at DESC LIMIT 1) as last_renewed_at
  FROM subscriptions s
  LEFT JOIN categories c ON s.category_id = c.id
`;

/**
 * Storage row -> wire shape. The API contract is unchanged: `amount` stays
 * decimal, `cycle` keeps its old name, and `last_renewed_at` is still present.
 */
function toSubscription(row: SubscriptionJoined): Subscription & { category_name: string | null } {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    amount: centsToAmount(row.amount_cents),
    currency: row.currency,
    end_date: row.end_date,
    cycle: row.cycle_days,
    category_id: row.category_id,
    category_name: row.category_name,
    last_renewed_at: row.last_renewed_at,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

async function fetchSubscription(
  db: D1Database,
  id: number,
  userId: number
): Promise<(Subscription & { category_name: string | null }) | null> {
  const row = await db
    .prepare(`${SUBSCRIPTION_SELECT} WHERE s.id = ? AND s.user_id = ?`)
    .bind(id, userId)
    .first<SubscriptionJoined>();
  return row ? toSubscription(row) : null;
}

// GET /api/v1/subscriptions - List all subscriptions for user
// ?include_archived=true to include archived (paused) subscriptions
app.get("/", async (c) => {
  const userId = c.get("userId");
  const includeArchived = c.req.query("include_archived") === "true";

  try {
    const { results } = await c.env.DB.prepare(
      `${SUBSCRIPTION_SELECT}
      WHERE s.user_id = ?
        ${includeArchived ? "" : "AND s.archived_at IS NULL"}
      ORDER BY s.archived_at IS NOT NULL, s.end_date ASC`
    )
      .bind(userId)
      .all<SubscriptionJoined>();

    return c.json(results.map(toSubscription));
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
      `INSERT INTO subscriptions (user_id, name, icon, amount_cents, currency, end_date, cycle_days, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
      .bind(userId, name, icon || null, toCents(amount), currency, end_date, cycle, category_id, now)
      .first<{ id: number }>();

    if (result) {
      const full = await fetchSubscription(c.env.DB, result.id, userId);
      return c.json(full, 201);
    }

    return c.json({ error: "Failed to create subscription" }, 500);
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
      .first<SubscriptionRow>();

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    if (subscription.archived_at) {
      return c.json(
        { error: "Cannot renew an archived subscription. Restore it first." },
        400
      );
    }

    // `amount` arrives in dollars and is stored in cents; keep the cents value
    // so the transaction insert and the response agree on the unit.
    const amount = body.amount !== undefined ? body.amount : centsToAmount(subscription.amount_cents);
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
    const periodEnd = addDays(subscription.end_date, subscription.cycle_days);
    const now = new Date().toISOString();

    let transactionId: number | null = null;

    if (createTx && amount > 0 && categoryId) {
      // The renewal transaction carries subscription_id, which replaces the
      // dropped subscription_renewals table and makes last_renewed_at derivable.
      const tx = await c.env.DB.prepare(
        `INSERT INTO transactions (user_id, amount_cents, currency, description, date, category_id, subscription_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
         RETURNING id`
      )
        .bind(userId, toCents(amount), currency, description, txDate, categoryId, id, now, now)
        .first<{ id: number }>();
      transactionId = tx?.id ?? null;
    }

    await c.env.DB.prepare(
      `UPDATE subscriptions
       SET end_date = ?, category_id = COALESCE(?, category_id)
       WHERE id = ? AND user_id = ?`
    )
      .bind(periodEnd, categoryId, id, userId)
      .run();

    // subscription_renewals is gone in v2, but the API contract still returns a
    // renewal record describing this renewal, so it is composed from the values
    // already in hand rather than read back.
    const renewal: SubscriptionRenewal = {
      id: transactionId ?? 0,
      user_id: userId,
      subscription_id: id,
      transaction_id: transactionId,
      amount,
      currency,
      period_start: periodStart,
      period_end: periodEnd,
      renewed_at: now,
    };

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
      "SELECT id, cycle_days FROM subscriptions WHERE id = ? AND user_id = ?"
    )
      .bind(id, userId)
      .first<{ id: number; cycle_days: number }>();

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    // Renewals are transactions carrying this subscription_id now. The cycle
    // length is not stored per renewal, so the period end is derived.
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.user_id, t.amount_cents, t.currency, t.date, t.subscription_id,
              t.created_at
       FROM transactions t
       WHERE t.subscription_id = ? AND t.user_id = ?
       ORDER BY t.date DESC, t.created_at DESC`
    )
      .bind(id, userId)
      .all<{
        id: number; user_id: number; amount_cents: number; currency: string;
        date: string; subscription_id: number; created_at: string;
      }>();

    const renewals: SubscriptionRenewal[] = results.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      subscription_id: r.subscription_id,
      transaction_id: r.id,
      amount: centsToAmount(r.amount_cents),
      currency: r.currency,
      period_start: r.date,
      period_end: addDays(r.date, subscription.cycle_days),
      renewed_at: r.created_at,
    }));

    return c.json(renewals);
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
      updates.push("amount_cents = ?");
      values.push(toCents(amount));
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
      updates.push("cycle_days = ?");
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

// POST /api/v1/subscriptions/:id/archive - Archive (pause) a subscription without deleting
app.post("/:id/archive", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const result = await c.env.DB.prepare(
      "UPDATE subscriptions SET archived_at = ? WHERE id = ? AND user_id = ? RETURNING id"
    )
      .bind(new Date().toISOString(), id, userId)
      .first();

    if (!result) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    const full = await fetchSubscription(c.env.DB, id, userId);
    return c.json(full);
  } catch (error) {
    console.error("Error archiving subscription:", error);
    return c.json({ error: "Failed to archive subscription" }, 500);
  }
});

// POST /api/v1/subscriptions/:id/restore - Restore an archived subscription with a new end date
app.post("/:id/restore", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      end_date?: string;
      cycle?: number;
    };
    const { end_date, cycle } = body;

    if (!end_date || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return c.json(
        { error: "end_date is required and must be in YYYY-MM-DD format" },
        400
      );
    }
    if (cycle !== undefined && (typeof cycle !== "number" || cycle < 1)) {
      return c.json({ error: "cycle must be at least 1 day" }, 400);
    }

    // Only archived subscriptions can be restored
    const existing = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE id = ? AND user_id = ? AND archived_at IS NOT NULL"
    )
      .bind(id, userId)
      .first();
    if (!existing) {
      return c.json({ error: "Subscription not found or not archived" }, 404);
    }

    await c.env.DB.prepare(
      `UPDATE subscriptions
       SET end_date = ?, cycle_days = COALESCE(?, cycle_days), archived_at = NULL
       WHERE id = ? AND user_id = ?`
    )
      .bind(end_date, cycle ?? null, id, userId)
      .run();

    const full = await fetchSubscription(c.env.DB, id, userId);
    return c.json(full);
  } catch (error) {
    console.error("Error restoring subscription:", error);
    return c.json({ error: "Failed to restore subscription" }, 500);
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
