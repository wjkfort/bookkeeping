/**
 * R5 — the stored conversations and the bounded prompt they feed.
 *
 * Every turn is stored server-side, tagged with the `session_id` of the
 * conversation it belongs to. A page load starts a new conversation: it simply
 * uses a new id, and the model is only shown that conversation's turns. Older
 * conversations stay in the table — they cost nothing to keep and are the only
 * record of what was spent — rather than being deleted, which is what the
 * absence of a session column would have forced.
 *
 * Cross-conversation facts do NOT live here. They belong in `users.ai_memory`,
 * the short durable note, which is why a new conversation starting empty loses
 * nothing that matters.
 *
 * The rule that shapes this module: **never retrieve chat history to answer a
 * price or trend question.** Chat grows without bound, so every prompt is
 * assembled within a hard server-side budget:
 *
 *     recent N messages (still bounded by characters)
 *   + a server-built snapshot (categories, item names, this month's total, gaps)
 *   + the user's memory note
 *
 * Nothing here lets a client or a model widen that. §5.3 puts the ceiling on the
 * server, and `clampMessages` is where "recent N" stops being a count and
 * becomes a character budget too — a handful of very long messages must not
 * silently blow past the limit just because N was small.
 *
 * Token counts live on `ai_messages` (R6), which is enough to see cost without a
 * separate usage table. There is deliberately no daily cap: that was decided
 * against. The counts are recorded, not enforced.
 */

import type { AiMessage } from '../types';
import { badRequest, serverError } from './errors';

/** How many recent turns are considered for the prompt. */
export const PROMPT_RECENT_MESSAGES = 20;

/** Hard per-request ceiling on the chat transcript handed to the model. */
export const PROMPT_MESSAGE_CHAR_BUDGET = 12_000;

/**
 * R5: retention for stored chat. Nothing needs to outlive it — there is no audit
 * to keep, and habits survive in `ai_memory`.
 */
export const AI_MESSAGE_RETENTION_DAYS = 90;

export interface RecordMessageInput {
  /** The conversation this turn belongs to. */
  session_id: string;
  role: AiMessage['role'];
  content?: string | null;
  /** JSON string of the provider's tool_calls, when this turn requested tools. */
  tool_calls?: string | null;
  tokens_in?: number;
  tokens_out?: number;
}

/**
 * A `tool` turn has to remember which call it answers, or the transcript cannot
 * be replayed to the provider (an assistant `tool_calls` message must be
 * followed by tool results carrying matching ids).
 *
 * The schema has no column for that, so it is stored as JSON in `tool_calls`:
 * `{"tool_call_id":"...","name":"..."}`. This keeps the table unchanged while
 * preserving the pairing across turns, which is what makes a *stored*
 * conversation resumable rather than only a single in-flight request.
 */
export function toolCallIdPayload(toolCallId: string, name?: string): string {
  return JSON.stringify(name ? { tool_call_id: toolCallId, name } : { tool_call_id: toolCallId });
}

/** Read back the id stored by `toolCallIdPayload`, or null when absent. */
export function readToolCallId(toolCallsJson: string | null): string | null {
  if (!toolCallsJson) return null;
  try {
    const parsed = JSON.parse(toolCallsJson);
    if (Array.isArray(parsed)) return null;
    return typeof parsed?.tool_call_id === 'string' ? parsed.tool_call_id : null;
  } catch {
    return null;
  }
}

/** Read the tool name stored alongside the id on a tool turn. */
export function readToolName(toolCallsJson: string | null): string | null {
  if (!toolCallsJson) return null;
  try {
    const parsed = JSON.parse(toolCallsJson);
    if (Array.isArray(parsed)) return null;
    return typeof parsed?.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}

/** Read back an assistant turn's tool_calls array, or [] when absent. */
export function readToolCalls(toolCallsJson: string | null): any[] {
  if (!toolCallsJson) return [];
  try {
    const parsed = JSON.parse(toolCallsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append one turn.
 *
 * `content` is nullable on purpose: DeepSeek returns tool calls with empty
 * content, and storing `''` would make "this turn only requested a tool"
 * indistinguishable from "this turn said nothing", polluting the history the
 * prompt is rebuilt from (see migration 003).
 */
export async function recordMessage(
  db: D1Database, userId: number, input: RecordMessageInput,
): Promise<AiMessage> {
  if (input.role !== 'user' && input.role !== 'assistant' && input.role !== 'tool') {
    throw badRequest("role must be 'user', 'assistant' or 'tool'");
  }

  const sessionId = requireSessionId(input.session_id);

  const row = await db
    .prepare(
      `INSERT INTO ai_messages (user_id, session_id, role, content, tool_calls, tokens_in, tokens_out, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      userId,
      sessionId,
      input.role,
      input.content ?? null,
      input.tool_calls ?? null,
      input.tokens_in ?? 0,
      input.tokens_out ?? 0,
      new Date().toISOString(),
    )
    .first<AiMessage>();

  if (!row) {
    throw serverError('Failed to record the message');
  }
  return row;
}

/**
 * The most recent turns, oldest first (the order a prompt needs).
 *
 * `limit` bounds how many rows are read; the character budget is applied by
 * `clampMessages`, which is what actually protects the prompt.
 */
export async function loadRecentMessages(
  db: D1Database, userId: number, sessionId: string,
  limit: number = PROMPT_RECENT_MESSAGES,
): Promise<AiMessage[]> {
  const capped = Math.max(1, Math.min(200, limit));

  // Scoped to the conversation, not the user. This is what makes a new
  // conversation actually new: the model must not see earlier ones, and before
  // `session_id` existed the only way to achieve that was to delete them.
  const { results } = await db
    .prepare(
      `SELECT * FROM ai_messages
        WHERE user_id = ? AND session_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .bind(userId, requireSessionId(sessionId), capped)
    .all<AiMessage>();

  return results.reverse();
}

/**
 * Trim a transcript to the character budget, keeping the newest turns.
 *
 * A tool-call turn and its tool result are a pair: dropping the request while
 * keeping the result (or the reverse) produces a transcript the provider
 * rejects. Both carry `role: 'tool'` / a `tool_calls` value, so the walk keeps
 * the newest turns until the budget is reached and then stops — it never
 * leaves a dangling half of a pair at the front, because it always drops from
 * the oldest end.
 */
export function clampMessages(
  messages: AiMessage[], charBudget: number = PROMPT_MESSAGE_CHAR_BUDGET,
): AiMessage[] {
  if (charBudget <= 0) return [];

  const kept: AiMessage[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const size = (m.content?.length ?? 0) + (m.tool_calls?.length ?? 0);
    if (used + size > charBudget && kept.length > 0) break;
    used += size;
    kept.push(m);
  }

  return kept.reverse();
}

/** Chat page for `GET /ai/messages`: newest first, paged by id (R5's UI need). */
export async function pageMessages(
  db: D1Database, userId: number, sessionId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<AiMessage[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));

  const { results } = await db
    .prepare(
      `SELECT * FROM ai_messages
        WHERE user_id = ? AND session_id = ? ${opts.before !== undefined ? 'AND id < ?' : ''}
        ORDER BY id DESC
        LIMIT ?`,
    )
    .bind(
      ...(opts.before !== undefined
        ? [userId, requireSessionId(sessionId), opts.before, limit]
        : [userId, requireSessionId(sessionId), limit]),
    )
    .all<AiMessage>();

  return results;
}

/**
 * Token usage, for seeing cost (R6). Not a limit: no daily cap is enforced.
 * Kept as a query so the figure always comes from SQL rather than from memory.
 */
export async function tokenUsage(
  db: D1Database, userId: number, sinceIso?: string,
): Promise<{ tokens_in: number; tokens_out: number; messages: number }> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(tokens_in), 0)  AS tokens_in,
         COALESCE(SUM(tokens_out), 0) AS tokens_out,
         COUNT(*)                     AS messages
       FROM ai_messages
       WHERE user_id = ? ${sinceIso ? 'AND created_at >= ?' : ''}`,
    )
    .bind(...(sinceIso ? [userId, sinceIso] : [userId]))
    .first<{ tokens_in: number; tokens_out: number; messages: number }>();

  return row ?? { tokens_in: 0, tokens_out: 0, messages: 0 };
}

/** UTC day boundary, for the "today" figure in the cost view. */
export function startOfUtcDay(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** A session id is a client-supplied label; keep it bounded and non-empty. */
export const MAX_SESSION_ID_LENGTH = 100;

/**
 * Validate a conversation id.
 *
 * The client generates it (so a page load can start a new one without a round
 * trip). It is only ever compared for equality and stored, never trusted as
 * anything more, but it still must be a sane non-empty string: an empty id would
 * silently pool unrelated conversations together.
 */
export function requireSessionId(sessionId: unknown): string {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw badRequest(
      'A conversation id is required. Generate one per conversation and send it with every request.',
      { code: 'SESSION_REQUIRED' },
      'SESSION_REQUIRED',
    );
  }
  const trimmed = sessionId.trim();
  if (trimmed.length > MAX_SESSION_ID_LENGTH) {
    throw badRequest(
      `Conversation id must be at most ${MAX_SESSION_ID_LENGTH} characters.`,
      { code: 'SESSION_TOO_LONG' },
      'SESSION_TOO_LONG',
    );
  }
  return trimmed;
}

export interface SessionSummary {
  session_id: string;
  messages: number;
  first_at: string;
  last_at: string;
  tokens_in: number;
  tokens_out: number;
}

/**
 * The conversations on record, newest first.
 *
 * Nothing in the UI reads this yet. It exists because the point of keeping
 * `session_id` rather than deleting transcripts is that old conversations remain
 * available — for cost accounting now, and for browsing later. Reported here
 * rather than by scanning rows so the caller cannot accidentally pull an entire
 * conversation into a prompt.
 */
export async function listSessions(
  db: D1Database, userId: number, limit = 20,
): Promise<SessionSummary[]> {
  const capped = Math.max(1, Math.min(100, limit));
  const { results } = await db
    .prepare(
      `SELECT session_id,
              COUNT(*)            AS messages,
              MIN(created_at)     AS first_at,
              MAX(created_at)     AS last_at,
              COALESCE(SUM(tokens_in), 0)  AS tokens_in,
              COALESCE(SUM(tokens_out), 0) AS tokens_out
         FROM ai_messages
        WHERE user_id = ?
        GROUP BY session_id
        ORDER BY last_at DESC
        LIMIT ?`,
    )
    .bind(userId, capped)
    .all<SessionSummary>();

  return results;
}

/**
 * R5: delete chat older than the retention window. Habits carry on in
 * `ai_memory`, so nothing is lost that matters.
 *
 * Still useful after the move to per-conversation lifecycles: conversations are
 * cleared on load, but a turn can sit in the table for a long time if the app is
 * left open, and the token ledger has to stay bounded.
 */
export async function pruneOldMessages(
  db: D1Database, userId: number, days: number = AI_MESSAGE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const info = await db
    .prepare('DELETE FROM ai_messages WHERE user_id = ? AND created_at < ?')
    .bind(userId, cutoff)
    .run();
  return Number((info as any)?.meta?.changes ?? 0);
}
