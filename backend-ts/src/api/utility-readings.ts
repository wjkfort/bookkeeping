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

// Helper to get all subcategory IDs recursively (same logic as transactions.ts)
async function getAllSubcategoryIds(db: D1Database, categoryId: number, userId: number): Promise<number[]> {
  const categoryIds = [categoryId];
  const { results: allCategories } = await db.prepare(
    'SELECT id, parent_id FROM categories WHERE user_id = ?'
  ).bind(userId).all<{ id: number; parent_id: number | null }>();

  const findChildren = (parentId: number) => {
    const children = allCategories.filter(cat => cat.parent_id === parentId);
    children.forEach(child => {
      categoryIds.push(child.id);
      findChildren(child.id);
    });
  };

  findChildren(categoryId);
  return categoryIds;
}

// GET /api/v1/utility-readings - List all readings with address + type info
app.get("/", async (c) => {
  const userId = c.get("userId");

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
        r.*,
        a.name as address_name,
        a.address as address_full,
        ut.name as type_name,
        ut.icon as type_icon
      FROM utility_readings r
      LEFT JOIN utility_addresses a ON r.address_id = a.id
      LEFT JOIN utility_types ut ON r.type_id = ut.id
      WHERE r.user_id = ?
      ORDER BY a.name ASC, ut.name ASC, r.record_time DESC`
    )
      .bind(userId)
      .all<UtilityReading>();

    return c.json(results);
  } catch (error) {
    console.error("Error fetching utility readings:", error);
    return c.json({ error: "Failed to fetch utility readings" }, 500);
  }
});

// GET /api/v1/utility-readings/summary - Current + last month per address+type with recharge calculation
app.get("/summary", async (c) => {
  const userId = c.get("userId");

  try {
    const currentMonth = getCurrentMonth();
    const lastMonth = getLastMonth();

    // Get all addresses for this user
    const { results: addresses } = await c.env.DB.prepare(
      "SELECT id, name, address FROM utility_addresses WHERE user_id = ?"
    )
      .bind(userId)
      .all<{ id: number; name: string; address: string }>();

    // Get all utility types for this user
    const { results: types } = await c.env.DB.prepare(
      `SELECT ut.*, c.name as category_name
       FROM utility_types ut
       LEFT JOIN categories c ON ut.category_id = c.id
       WHERE ut.user_id = ?`
    )
      .bind(userId)
      .all<{ id: number; name: string; icon: string | null; category_id: number | null; category_name: string | null }>();

    const summary: Record<
      string,
      {
        address_id: number;
        address_name: string;
        address_full: string;
        type_id: number;
        type_name: string;
        type_icon: string | null;
        currency: string;
        currentMonth: UtilityReading | null;
        lastMonth: UtilityReading | null;
        lastMonthExpense: number;
        recharges: number;
      }
    > = {};

    for (const addr of addresses) {
      for (const utType of types) {
        const key = `${addr.id}|${utType.id}`;

        const current = await c.env.DB.prepare(
          `SELECT r.*, ut.name as type_name, ut.icon as type_icon
           FROM utility_readings r
           LEFT JOIN utility_types ut ON r.type_id = ut.id
           WHERE r.user_id = ? AND r.address_id = ? AND r.type_id = ? AND r.record_time = ?`
        )
          .bind(userId, addr.id, utType.id, currentMonth)
          .first<UtilityReading>();

        const last = await c.env.DB.prepare(
          `SELECT r.*, ut.name as type_name, ut.icon as type_icon
           FROM utility_readings r
           LEFT JOIN utility_types ut ON r.type_id = ut.id
           WHERE r.user_id = ? AND r.address_id = ? AND r.type_id = ? AND r.record_time = ?`
        )
          .bind(userId, addr.id, utType.id, lastMonth)
          .first<UtilityReading>();

        // Calculate recharges from bound category
        let recharges = 0;
        if (utType.category_id) {
          // Get all category IDs including subcategories
          const categoryIds = await getAllSubcategoryIds(c.env.DB, utType.category_id, userId);

          // Calculate last month date range
          const [lastYear, lastMon] = lastMonth.split("-").map(Number);
          const lastDayOfLastMonth = new Date(lastYear, lastMon, 0).getDate();
          const lastMonthStart = `${lastMonth}-01`;
          const lastMonthEnd = `${lastMonth}-${String(lastDayOfLastMonth).padStart(2, "0")}`;

          const placeholders = categoryIds.map(() => "?").join(",");
          const rechargeResult = await c.env.DB.prepare(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM transactions
             WHERE user_id = ? AND category_id IN (${placeholders})
             AND date >= ? AND date <= ?`
          )
            .bind(userId, ...categoryIds, lastMonthStart, lastMonthEnd)
            .first<{ total: number }>();

          recharges = rechargeResult?.total ?? 0;
        }

        const currentBalance = current?.balance ?? 0;
        const lastBalance = last?.balance ?? 0;
        const lastMonthExpense = Math.max(0, lastBalance + recharges - currentBalance);

        if (current || last) {
          summary[key] = {
            address_id: addr.id,
            address_name: addr.name,
            address_full: addr.address,
            type_id: utType.id,
            type_name: utType.name,
            type_icon: utType.icon,
            currency: current?.currency ?? last?.currency ?? "CNY",
            currentMonth: current ?? null,
            lastMonth: last ?? null,
            lastMonthExpense,
            recharges,
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
      `SELECT
        r.*,
        a.name as address_name,
        a.address as address_full,
        ut.name as type_name,
        ut.icon as type_icon
      FROM utility_readings r
      LEFT JOIN utility_addresses a ON r.address_id = a.id
      LEFT JOIN utility_types ut ON r.type_id = ut.id
      WHERE r.id = ? AND r.user_id = ?`
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
      type_id: number;
      balance: number;
      record_time: string;
      currency?: string;
    }>();

    const { address_id, type_id, balance, record_time, currency = "CNY" } = body;

    if (!address_id || !type_id || balance === undefined || !record_time) {
      return c.json({ error: "address_id, type_id, balance, and record_time are required" }, 400);
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

    // Verify type belongs to user
    const utType = await c.env.DB.prepare("SELECT * FROM utility_types WHERE id = ? AND user_id = ?").bind(type_id, userId).first();
    if (!utType) {
      return c.json({ error: "Utility type not found" }, 404);
    }

    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(
      `INSERT INTO utility_readings (user_id, address_id, type_id, balance, record_time, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
      .bind(userId, address_id, type_id, balance, record_time, currency, now)
      .first<UtilityReading>();

    // Fetch with joined fields
    if (result) {
      const full = await c.env.DB.prepare(
        `SELECT
          r.*,
          a.name as address_name,
          a.address as address_full,
          ut.name as type_name,
          ut.icon as type_icon
        FROM utility_readings r
        LEFT JOIN utility_addresses a ON r.address_id = a.id
        LEFT JOIN utility_types ut ON r.type_id = ut.id
        WHERE r.id = ?`
      ).bind(result.id).first<UtilityReading>();
      return c.json(full, 201);
    }

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
      `UPDATE utility_readings
       SET ${updates.join(", ")}
       WHERE id = ? AND user_id = ?
       RETURNING *`
    )
      .bind(...values)
      .first<UtilityReading>();

    if (!result) {
      return c.json({ error: "Reading not found" }, 404);
    }

    // Fetch with joined fields
    const full = await c.env.DB.prepare(
      `SELECT
        r.*,
        a.name as address_name,
        a.address as address_full,
        ut.name as type_name,
        ut.icon as type_icon
      FROM utility_readings r
      LEFT JOIN utility_addresses a ON r.address_id = a.id
      LEFT JOIN utility_types ut ON r.type_id = ut.id
      WHERE r.id = ?`
    ).bind(result.id).first<UtilityReading>();

    return c.json(full);
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
