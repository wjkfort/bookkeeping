import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoVariables } from "./types";
import categoriesRouter from "./api/categories";
import transactionsRouter from "./api/transactions";
import summaryRouter from "./api/summary";
import exchangeRatesRouter from "./api/exchange-rates";
import translateRouter from "./api/translate";
import itemsRouter from "./api/items";
import authRouter from "./api/auth";
import { authMiddleware } from "./middleware/auth";
import subscriptionsRouter from "./api/subscriptions";
import proxyRouter from "./api/proxy";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// CORS middleware
app.use(
  "/*",
  cors({
    origin: (origin) => {
      // Allow all Cloudflare Pages URLs (production and previews)
      if (origin.endsWith('.pages.dev') ||
          origin === 'http://localhost:5174' ||
          origin === 'http://localhost:5173') {
        return origin;
      }
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    message: "Bookkeeping API",
    docs: "https://github.com/yourusername/bookkeeping",
    version: "1.0.0",
  });
});

// API routes
const api = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

// Public routes (no auth required)
api.route("/auth", authRouter);
api.route("/proxy", proxyRouter);

// Protected routes (auth required)
api.use("/categories/*", authMiddleware);
api.use("/transactions/*", authMiddleware);
api.use("/summary/*", authMiddleware);
api.use("/items/*", authMiddleware);
api.use("/subscriptions/*", authMiddleware);

api.route("/categories", categoriesRouter);
api.route("/transactions", transactionsRouter);
api.route("/summary", summaryRouter);
api.route("/exchange-rates", exchangeRatesRouter);
api.route("/translate", translateRouter);
api.route("/items", itemsRouter);
api.route("/subscriptions", subscriptionsRouter);

app.route("/api/v1", api);

export default app;
