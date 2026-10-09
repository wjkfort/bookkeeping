import { Hono } from "hono";
import type { Env, HonoVariables } from "../types";
import {
  listSubscriptions,
  fetchSubscription,
  createSubscription,
  updateSubscription,
  archiveSubscription,
  restoreSubscription,
  deleteSubscription,
  renewSubscription,
  listRenewals,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
  type RenewSubscriptionInput,
} from "../services/subscriptions";
import { toErrorResponse } from "../services/errors";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Subscriptions, including renewal.
 *
 * The logic lives in src/services/subscriptions.ts so the AI tools
 * (`renew_subscription` in particular) execute exactly this code rather than a
 * second copy of the "advance end_date and record the renewal" rule.
 */

// GET /api/v1/subscriptions - List all subscriptions for user
// ?include_archived=true to include archived (paused) subscriptions
app.get("/", async (c) => {
  const userId = c.get("userId");
  const includeArchived = c.req.query("include_archived") === "true";

  try {
    return c.json(await listSubscriptions(c.env.DB, userId, includeArchived));
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
    return c.json({ error: "Failed to fetch subscription" }, 500);
  }
});

// POST /api/v1/subscriptions - Create subscription
app.post("/", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<CreateSubscriptionInput>();
    return c.json(await createSubscription(c.env.DB, userId, body), 201);
  } catch (error: any) {
    if (error?.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "A subscription with this name already exists" }, 409);
    }
    const { status, body } = toErrorResponse(error, "Failed to create subscription");
    if (status === 500) console.error("Error creating subscription:", error);
    return c.json(body, status);
  }
});

// POST /api/v1/subscriptions/:id/renew - Advance end_date and optionally create expense
app.post("/:id/renew", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = (await c.req.json().catch(() => ({}))) as RenewSubscriptionInput;
    return c.json(await renewSubscription(c.env.DB, userId, id, body));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to renew subscription");
    if (status === 500) console.error("Error renewing subscription:", error);
    return c.json(body, status);
  }
});

// GET /api/v1/subscriptions/:id/renewals - Renewal history
app.get("/:id/renewals", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    return c.json(await listRenewals(c.env.DB, userId, id));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to fetch renewals");
    if (status === 500) console.error("Error fetching renewals:", error);
    return c.json(body, status);
  }
});

// PUT /api/v1/subscriptions/:id - Update subscription
app.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = await c.req.json<UpdateSubscriptionInput>();
    return c.json(await updateSubscription(c.env.DB, userId, id, body));
  } catch (error: any) {
    if (error?.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "A subscription with this name already exists" }, 409);
    }
    const { status, body } = toErrorResponse(error, "Failed to update subscription");
    if (status === 500) console.error("Error updating subscription:", error);
    return c.json(body, status);
  }
});

// POST /api/v1/subscriptions/:id/archive - Archive (pause) a subscription without deleting
app.post("/:id/archive", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    return c.json(await archiveSubscription(c.env.DB, userId, id));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to archive subscription");
    if (status === 500) console.error("Error archiving subscription:", error);
    return c.json(body, status);
  }
});

// POST /api/v1/subscriptions/:id/restore - Restore an archived subscription with a new end date
app.post("/:id/restore", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    const body = (await c.req.json().catch(() => ({}))) as { end_date?: string; cycle?: number };
    return c.json(await restoreSubscription(c.env.DB, userId, id, body));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to restore subscription");
    if (status === 500) console.error("Error restoring subscription:", error);
    return c.json(body, status);
  }
});

// DELETE /api/v1/subscriptions/:id - Delete subscription
app.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const userId = c.get("userId");

  try {
    await deleteSubscription(c.env.DB, userId, id);
    return c.json({ message: "Subscription deleted successfully" });
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to delete subscription");
    if (status === 500) console.error("Error deleting subscription:", error);
    return c.json(body, status);
  }
});

export default app;
