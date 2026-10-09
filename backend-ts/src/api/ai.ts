import { Hono } from "hono";
import type { Env, HonoVariables } from "../types";
import { findGaps, markLedgerDay, type LedgerDayStatus } from "../services/gaps";
import { readMemory, writeMemory, appendMemory } from "../services/memory";
import { listUnits } from "../services/units";
import { toErrorResponse, badRequest } from "../services/errors";
import { runChatTurn, runOpeningTurn, toolNames } from "../services/chat";
import {
  pageMessages, tokenUsage, startOfUtcDay, listSessions, requireSessionId,
} from "../services/conversation";
import { isAiConfigured } from "../services/deepseek";
import { requireTimezone } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * R3 / R5 supporting endpoints.
 *
 * These are deliberately model-free: they compute and store, and say nothing.
 * `/ai/chat` (Phase 2) is what turns their output into a greeting. Keeping them
 * separate means the reminder logic can be exercised without a DeepSeek key and
 * still works when DeepSeek is down (R6).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/v1/ai/gaps - the open reminders: missing days and overdue subscriptions
// ?today=YYYY-MM-DD  override the reference day (tests, and re-opening the app
//                    just after midnight)
app.get("/gaps", async (c) => {
  const userId = c.get("userId");
  const today = c.req.query("today");

  if (today !== undefined && !DATE_RE.test(today)) {
    return c.json({ error: "today must be in YYYY-MM-DD format" }, 400);
  }

  try {
    return c.json(await findGaps(c.env.DB, userId, {
      today: today || undefined,
      timezone: requireTimezone(c.req.query("timezone")),
    }));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to compute gaps");
    if (status === 500) console.error("Error computing gaps:", error);
    return c.json(body, status);
  }
});

// POST /api/v1/ai/gaps/no-spend - record the user's answer about a day
//
//   { date, status?: 'no_spend' | 'partial' }
//
// `no_spend` (the default): the user confirmed nothing was spent, so stop
// asking. `partial`: something is recorded but the day is not confirmed
// complete, so the AI should still ask about it. Upserted, because an answer
// can be revised.
app.post("/gaps/no-spend", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{ date?: string; status?: LedgerDayStatus }>();

    if (!body.date || !DATE_RE.test(body.date)) {
      return c.json({ error: "date is required and must be in YYYY-MM-DD format" }, 400);
    }

    const day = await markLedgerDay(c.env.DB, userId, body.date, body.status ?? "no_spend");
    return c.json(day, 201);
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to record the day");
    return c.json(body, status);
  }
});

// POST /api/v1/ai/chat - send a message; get the reply and what was written
//
// The model's only route to the database. Every write it performs goes through
// `src/services/`, with `userId` bound from the JWT — the model cannot name a
// user. `writes[]` reports each tool call and whether it succeeded.
app.post("/chat", async (c) => {
  const userId = c.get("userId");

  try {
    // `today` is an optional override of the reference day, for the same reason
    // `/ai/gaps` accepts one: it makes the reminder window deterministic in
    // tests and lets a client that has been open across midnight ask about the
    // day it thinks it is.
    const body = await c.req.json<{
      message?: string; opening?: boolean; today?: string; timezone?: string;
      session?: string;
    }>();

    if (body.today !== undefined && !DATE_RE.test(body.today)) {
      throw badRequest("today must be in YYYY-MM-DD format");
    }

    // Resolved here so a bad zone is a 400 with a usable message, rather than
    // silently falling back and dating the user's entries to the wrong day.
    const timezone = requireTimezone(body.timezone);

    // Which conversation this turn belongs to. Required: the model is shown only
    // this session's turns, so an absent id would either pool unrelated
    // conversations or start one the client is not tracking.
    const sessionId = requireSessionId(body.session);

    // The opening turn is how R3 delivers reminders: the gaps are computed
    // server-side and the model only phrases them.
    if (body.opening === true) {
      return c.json(await runOpeningTurn({
        env: c.env, userId, message: "", today: body.today, timezone, sessionId,
      }));
    }

    if (!body.message || body.message.trim().length === 0) {
      throw badRequest("message is required");
    }

    return c.json(await runChatTurn({
      env: c.env, userId, message: body.message, today: body.today, timezone, sessionId,
    }));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to handle the message");
    if (status === 500) console.error("Error in /ai/chat:", error);
    return c.json(body, status);
  }
});

// GET /api/v1/ai/messages - ?before=<id> paged chat history (R5)
app.get("/messages", async (c) => {
  const userId = c.get("userId");
  const beforeRaw = c.req.query("before");
  const limitRaw = c.req.query("limit");

  const before = beforeRaw ? parseInt(beforeRaw, 10) : undefined;
  if (beforeRaw !== undefined && Number.isNaN(before)) {
    return c.json({ error: "before must be a message id" }, 400);
  }

  try {
    // `session` selects the conversation. Without it there is no sensible
    // default: guessing would either mix conversations or show an empty one.
    return c.json(await pageMessages(
      c.env.DB, userId, requireSessionId(c.req.query("session")), {
        before,
        limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
      },
    ));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to fetch messages");
    if (status === 500) console.error("Error fetching messages:", error);
    return c.json(body, status);
  }
});

// GET /api/v1/ai/sessions - the conversations on record, newest first
//
// Nothing in the UI reads this yet. It exists because keeping transcripts
// instead of deleting them is only useful if they can be found again — for cost
// accounting now, and for a history view later.
app.get("/sessions", async (c) => {
  const userId = c.get("userId");
  const limitRaw = c.req.query("limit");

  try {
    return c.json(await listSessions(
      c.env.DB, userId, limitRaw ? parseInt(limitRaw, 10) : undefined,
    ));
  } catch (error) {
    console.error("Error listing conversations:", error);
    return c.json({ error: "Failed to list conversations" }, 500);
  }
});

// GET /api/v1/ai/status - whether the AI layer is configured, and the cost so far
//
// R6: DeepSeek being unavailable or unkeyed must leave every other feature
// working, so the client can ask this before showing a chat box. Token usage is
// reported for visibility; there is no daily cap to report against.
app.get("/status", async (c) => {
  const userId = c.get("userId");

  try {
    const since = startOfUtcDay();
    const [today, total] = await Promise.all([
      tokenUsage(c.env.DB, userId, since),
      tokenUsage(c.env.DB, userId),
    ]);

    return c.json({
      configured: isAiConfigured(c.env),
      tools: toolNames(),
      usage: { today, total },
      daily_token_limit: null,
    });
  } catch (error) {
    return c.json({ error: "Failed to read AI status" }, 500);
  }
});

// GET /api/v1/ai/units - the unit vocabulary, for mapping "个/袋/斤" onto codes
//
// §5.1 has the model call `list_units` before writing a price. Also exposed
// under /ai because that is where the tool lives; the vocabulary itself is not
// AI-specific.
app.get("/units", async (c) => {
  try {
    return c.json(await listUnits(c.env.DB));
  } catch (error) {
    console.error("Error fetching units:", error);
    return c.json({ error: "Failed to fetch units" }, 500);
  }
});

// GET /api/v1/ai/memory - the user's memory note (R5)
app.get("/memory", async (c) => {
  const userId = c.get("userId");
  try {
    return c.json(await readMemory(c.env.DB, userId));
  } catch (error) {
    return c.json({ error: "Failed to read memory" }, 500);
  }
});

// PUT /api/v1/ai/memory - replace the note (the model's `remember` tool)
app.put("/memory", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{ memory?: string | null }>();
    if (body.memory === undefined) {
      throw badRequest("memory is required (pass null to clear it)");
    }
    return c.json(await writeMemory(c.env.DB, userId, body.memory));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to write memory");
    return c.json(body, status);
  }
});

// POST /api/v1/ai/memory/append - add one fact to the note
app.post("/memory/append", async (c) => {
  const userId = c.get("userId");

  try {
    const body = await c.req.json<{ fact?: string }>();
    if (!body.fact || body.fact.trim().length === 0) {
      throw badRequest("fact is required");
    }
    return c.json(await appendMemory(c.env.DB, userId, body.fact));
  } catch (error) {
    const { status, body } = toErrorResponse(error, "Failed to append to memory");
    return c.json(body, status);
  }
});

export default app;
