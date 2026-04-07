import { Hono } from "hono";
import type { Env, HonoVariables, UtilityReading } from "../types";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// Helper to get current YYYY-MM
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Helper to get last month YYYY-MM
function getLastMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// GET /api/v1/utility-readings - List all readings with address info
app.get("/", async (c) => {
  const userId = c.get("userId");

  try {
    const { results } = await c.env.DB.prepare(
      `
      SELECT
        r.*,
        a.name as address_name,
        a.address as address_full
      FROM utility_readings r
      LEFT JOIN utility_addresses a ON r.address_id = a.id
      WHERE r.user_id = ?
      ORDER BY a.name ASC, r.type ASC, r.record_time DESC
    `,
    )
      .bind(userId)
      .all<UtilityReading>();

    return c.json(results);
  } catch (error) {
    console.error("Error fetching utility readings:", error);
    return c.json({ error: "Failed to fetch utility readings" }, 500);
  }
});

// GET /api/v1/utility-readings/summary - Current + last month per address+type
app.get("/summary", async (c) => {
  const userId = c.get("userId");

  try {
    const currentMonth = getCurrentMonth();
    const lastMonth = getLastMonth();

    // Get all addresses for this user
    const { results: addresses } = await c.env.DB.prepare(
      `
      SELECT id, name, address FROM utility_addresses WHERE user_id = ?
    `,
    )
      .bind(userId)
      .all<{ id: number; name: string; address: string }>();

    const summary: Record<
      string,
      {
        address_id: number;
        address_name: string;
        address_full: string;
        type: string;
        currency: string;
        currentMonth: UtilityReading | null;
        lastMonth: UtilityReading | null;
        lastMonthExpense: number;
      }
    > = {};

    for (const addr of addresses) {
      for (const type of ["water", "electricity"] as const) {
        const key = `${addr.id}|${type}`;

        const current = await c.env.DB.prepare(
          `
          SELECT * FROM utility_readings
          WHERE user_id = ? AND address_id = ? AND type = ? AND record_time = ?
        `,
        )
          .bind(userId, addr.id, type, currentMonth)
          .first<UtilityReading>();

        const last = await c.env.DB.prepare(
          `
          SELECT * FROM utility_readings
          WHERE user_id = ? AND address_id = ? AND type = ? AND record_time = ?
        `,
        )
          .bind(userId, addr.id, type, lastMonth)
          .first<UtilityReading>();

        // Calculate this month's expense = last month balance - current balance
        // (if meter reading decreased, it means meter was reset)
        const currentBalance = current?.balance ?? 0;
        const lastBalance = last?.balance ?? 0;
        const lastMonthExpense = Math.max(0, lastBalance - currentBalance);

        if (current || last) {
          summary[key] = {
            address_id: addr.id,
            address_name: addr.name,
            address_full: addr.address,
            type,
            currency: current?.currency ?? last?.currency ?? "CNY",
            currentMonth: current ?? null,
            lastMonth: last ?? null,
            lastMonthExpense,
          };
        }
      }
    }

    return c.json(Object.values(summary));
  } catch (error) {
    console.error("Error fetching utility readings summary:", error);
    return c.json({ error: "Failed to fetch summary" }, 500);
  }
});

// GET /api/v1/utility-readings/:id - Get single reading
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const reading = await c.env.DB.prepare(
      `
      SELECT
        r.*,
        a.name as address_name,
        a.address as address_full
      FROM utility_readings r
      LEFT JOIN utility_addresses a ON r.address_id = a.id
      WHERE r.id = ? AND r.user_id = ?
    `,
    )
      .bind(id, userId)
      .first<UtilityReading>();

    if (!reading) {
      return c.json({ error: "Reading not found" }, 404);
    }

    return c.json(reading);
  } catch (error) {
    return c.json({ error: "Failed to fetch reading" }, 500);
  }
});

// POST /api/v1/utility-readings - Create a reading
app.post("/", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{
      address_id: number;
      type: "water" | "electricity";
      balance: number;
      record_time: string;
      currency?: string;
    }>();

    const { address_id, type, balance, record_time, currency = "CNY" } = body;

    if (!address_id || !type || balance === undefined || !record_time) {
      return c.json({ error: "address_id, type, balance, and record_time are required" }, 400);
    }

    if (!["water", "electricity"].includes(type)) {
      return c.json({ error: "type must be water or electricity" }, 400);
    }

    // Validate record_time format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(record_time)) {
      return c.json({ error: "record_time must be in YYYY-MM format" }, 400);
    }

    // Verify address belongs to user
    const address = await c.env.DB.prepare("SELECT * FROM utility_addresses WHERE id = ? AND user_id = ?").bind(address_id, userId).first();

    if (!address) {
      return c.json({ error: "Address not found" }, 404);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      `
      INSERT INTO utility_readings (user_id, address_id, type, balance, record_time, currency, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `,
    )
      .bind(userId, address_id, type, balance, record_time, currency, now)
      .first<UtilityReading>();

    return c.json(result, 201);
  } catch (error: any) {
    if (error.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "A reading for this address, type, and month already exists" }, 409);
    }
    console.error("Error creating utility reading:", error);
    return c.json({ error: "Failed to create utility reading" }, 500);
  }
});

// PUT /api/v1/utility-readings/:id - Update balance of a reading
app.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{ balance?: number; currency?: string }>();
    const { balance, currency } = body;

    if (balance === undefined && !currency) {
      return c.json({ error: "balance or currency is required" }, 400);
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: (number | string)[] = [];

    if (balance !== undefined) {
      updates.push("balance = ?");
      values.push(balance);
    }
    if (currency) {
      updates.push("currency = ?");
      values.push(currency);
    }

    values.push(id, userId);

    const result = await c.env.DB.prepare(
      `
      UPDATE utility_readings
      SET ${updates.join(", ")}
      WHERE id = ? AND user_id = ?
      RETURNING *
    `,
    )
      .bind(...values)
      .first<UtilityReading>();

    if (!result) {
      return c.json({ error: "Reading not found" }, 404);
    }

    return c.json(result);
  } catch (error) {
    console.error("Error updating utility reading:", error);
    return c.json({ error: "Failed to update utility reading" }, 500);
  }
});

// DELETE /api/v1/utility-readings/:id - Delete a reading
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const result = await c.env.DB.prepare("DELETE FROM utility_readings WHERE id = ? AND user_id = ? RETURNING id").bind(id, userId).first();

    if (!result) {
      return c.json({ error: "Reading not found" }, 404);
    }

    return c.json({ message: "Reading deleted successfully" });
  } catch (error) {
    console.error("Error deleting utility reading:", error);
    return c.json({ error: "Failed to delete utility reading" }, 500);
  }
});

export default app;
