import { Hono } from "hono";
import type { Env, HonoVariables } from "../types";
import { listUnits } from "../services/units";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * The shared unit vocabulary.
 *
 * §5.1 requires the model to map "个/袋/斤" onto a `units.code` before writing a
 * price: `item_prices.unit` references `units(code)`, so an unmapped value is
 * rejected. This endpoint is what the model reads to do that mapping.
 *
 * Mounted twice on purpose: at `/api/v1/units`, because the vocabulary is not
 * AI-specific, and at `/api/v1/prices/units`, next to the price routes that
 * consume it, which is where the AI tool description points.
 */
app.get("/", async (c) => {
  try {
    return c.json(await listUnits(c.env.DB));
  } catch (error) {
    console.error("Error fetching units:", error);
    return c.json({ error: "Failed to fetch units" }, 500);
  }
});

export default app;
