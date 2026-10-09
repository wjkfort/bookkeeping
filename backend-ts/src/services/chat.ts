/**
 * §5.3 — one conversational turn.
 *
 *     user message → store → bounded snapshot → DeepSeek (with tools)
 *       → if tool_calls: validate and execute each, feed results back → repeat
 *       → final text → store with tokens_in/tokens_out → { reply, writes[] }
 *
 * The loop is bounded. `MAX_TOOL_ROUNDS` exists because a model that keeps
 * requesting tools must not burn unbounded provider calls — and since there is
 * deliberately no daily token cap (decided against), this round limit is the
 * remaining structural protection against a runaway turn. Token counts are still
 * recorded on every message so cost stays visible.
 *
 * A provider failure is reported, never swallowed: the caller gets a
 * `ServiceError` and the existing app keeps working (R6).
 */

import type { Env } from '../types';
import {
  chatCompletion, aiConfigFromEnv, isAiConfigured,
  type ChatMessage, type ChatResult, type ToolCall,
} from './deepseek';
import { buildPrompt } from './prompt';
import { toolDefinitions, runTool, TOOLS, type ToolResult } from './tools';
import {
  recordMessage, toolCallIdPayload, pruneOldMessages,
} from './conversation';
import { findGaps } from './gaps';
import { unavailable } from './errors';

/** Ceiling on tool-call round trips within one user message. */
export const MAX_TOOL_ROUNDS = 6;

/**
 * Ceiling on completion length. Bookkeeping replies are short, and a bounded
 * response keeps one turn's cost predictable even without a daily cap.
 */
export const MAX_COMPLETION_TOKENS = 1500;

export interface WriteSummary {
  tool: string;
  ok: boolean;
  /** Present on failure, so the reply can be checked against what happened. */
  code?: string;
  error?: string;
}

export interface ChatTurnResult {
  reply: string | null;
  /** Every tool invocation this turn, in order. */
  writes: WriteSummary[];
  usage: { tokens_in: number; tokens_out: number; rounds: number };
  /** True when the reply may be incomplete (round limit reached). */
  truncated: boolean;
}

export interface ChatTurnDeps {
  env: Env;
  userId: number;
  message: string;
  /**
   * The conversation this turn belongs to. Required: the model is shown only
   * this session's turns, so a missing id would either pool unrelated
   * conversations or silently start one nobody is tracking.
   */
  sessionId: string;
  today?: string;
  /**
   * The user's IANA zone, used to answer "what day is it for them". Defaults to
   * UTC+8. Every default date this turn produces — the prompt's reference day,
   * the reminder window, a written transaction — comes from this one value, so
   * they cannot disagree.
   */
  timezone?: string;
  /**
   * False for the opening turn: the "message" is a server-authored instruction
   * to open with today's reminders, and storing it would put words the user
   * never wrote into their transcript.
   */
  recordUser?: boolean;
  /** Injectable for tests: replaces the provider call entirely. */
  completion?: (messages: ChatMessage[]) => Promise<ChatResult>;
}

/**
 * Run one turn end to end.
 *
 * `completion` lets a test drive the loop with canned provider responses, which
 * is how the tool-calling path is verified without a key or a network.
 */
export async function runChatTurn(deps: ChatTurnDeps): Promise<ChatTurnResult> {
  const { env, userId, message } = deps;
  const db = env.DB;

  // The user's turn is stored BEFORE anything that can fail. If the provider is
  // unreachable or unkeyed, what they typed is still in the transcript for the
  // next attempt — the alternative is silently losing the message they just
  // sent. (Only the opening turn is exempt: its "message" is an instruction the
  // server wrote, not something the user said.)
  if (deps.recordUser !== false) {
    await recordMessage(db, userId, {
      session_id: deps.sessionId, role: 'user', content: message,
    });
  }

  // R5 retention: prune before assembling, so the window that gets loaded is
  // already inside the retention period. Habits survive in `ai_memory`.
  await pruneOldMessages(db, userId);

  if (!deps.completion && !isAiConfigured(env)) {
    throw unavailable(
      'The AI assistant is not configured on this server. Everything else keeps working.',
      { code: 'AI_UNAVAILABLE' },
    );
  }

  const { messages } = await buildPrompt(db, userId, message, {
    today: deps.today, timezone: deps.timezone, sessionId: deps.sessionId,
  });

  const config = aiConfigFromEnv(env);
  const tools = toolDefinitions();
  const writes: WriteSummary[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let rounds = 0;
  let truncated = false;

  const callProvider = async (msgs: ChatMessage[]): Promise<ChatResult> => {
    rounds += 1;
    if (deps.completion) return deps.completion(msgs);
    return chatCompletion(config, { messages: msgs, tools, maxTokens: MAX_COMPLETION_TOKENS });
  };

  let result = await callProvider(messages);
  tokensIn += result.usage.prompt_tokens;
  tokensOut += result.usage.completion_tokens;

  // Store the assistant turn. `content` stays null when it only requested tools,
  // which is what keeps "requested a tool" distinct from "said nothing" (003).
  if (result.content || result.tool_calls.length > 0) {
    await recordMessage(db, userId, {
      session_id: deps.sessionId,
      role: 'assistant',
      content: result.content,
      tool_calls: result.tool_calls.length > 0 ? JSON.stringify(result.tool_calls) : null,
      tokens_in: result.usage.prompt_tokens,
      tokens_out: result.usage.completion_tokens,
    });
  }

  // Feed tool results back until the model answers in words.
  let guard = 0;
  while (result.tool_calls.length > 0) {
    if (guard >= MAX_TOOL_ROUNDS) {
      truncated = true;
      break;
    }
    guard += 1;

    // The assistant turn that requested the tools has to be in the transcript
    // for the provider to accept the results.
    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.tool_calls,
    });

    for (const call of result.tool_calls) {
      const outcome: ToolResult = await runTool(
        { db, userId, timezone: deps.timezone }, call.function.name, call.function.arguments,
      );

      writes.push({
        tool: call.function.name,
        ok: outcome.ok,
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      });

      const payload = outcome.ok
        ? JSON.stringify(outcome.data ?? { ok: true })
        : JSON.stringify({ error: outcome.error, code: outcome.code });

      await recordMessage(db, userId, {
        session_id: deps.sessionId,
        role: 'tool',
        content: payload,
        tool_calls: toolCallIdPayload(call.id, call.function.name),
      });

      messages.push({
        role: 'tool',
        content: payload,
        tool_call_id: call.id,
        name: call.function.name,
      });
    }

    result = await callProvider(messages);
    tokensIn += result.usage.prompt_tokens;
    tokensOut += result.usage.completion_tokens;

    if (result.content || result.tool_calls.length > 0) {
      await recordMessage(db, userId, {
        session_id: deps.sessionId,
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls.length > 0 ? JSON.stringify(result.tool_calls) : null,
        tokens_in: result.usage.prompt_tokens,
        tokens_out: result.usage.completion_tokens,
      });
    }
  }

  if (result.tool_calls.length > 0) truncated = true;

  return {
    reply: result.content,
    writes,
    usage: { tokens_in: tokensIn, tokens_out: tokensOut, rounds },
    truncated,
  };
}

/**
 * Opening turn for R3: the AI greets the user with the open gaps.
 *
 * The gaps are computed server-side first (`findGaps`), then handed to the model
 * as the instruction — the model never queries for them and never decides
 * whether a day is missing. If the provider is unavailable this reports it
 * rather than failing: the reminders themselves are already available through
 * `GET /ai/gaps`.
 */
export async function runOpeningTurn(deps: ChatTurnDeps): Promise<ChatTurnResult> {
  const gaps = await findGaps(deps.env.DB, deps.userId, {
    today: deps.today, timezone: deps.timezone,
  });

  const parts: string[] = [];
  if (gaps.missing_days.length > 0) {
    parts.push(`days with nothing recorded: ${gaps.missing_days.map(m => m.date).join(', ')}`);
  }
  if (gaps.overdue_subscriptions.length > 0) {
    parts.push(
      `subscriptions whose period has passed with no renewal: ${
        gaps.overdue_subscriptions.map(o => `${o.name} (ended ${o.end_date})`).join(', ')
      }`,
    );
  }

  if (parts.length === 0) {
    return { reply: null, writes: [], usage: { tokens_in: 0, tokens_out: 0, rounds: 0 }, truncated: false };
  }

  // Phrased as an instruction, not as a question the model must derive. The
  // facts come from SQL; only the wording is the model's.
  const instruction =
    `Open the conversation by asking about these, briefly and in one message. ` +
    `Do not invent anything beyond this list: ${parts.join('; ')}.`;

  // recordUser:false — the instruction is the server's, not the user's, so it
  // must not appear in their chat history.
  return runChatTurn({ ...deps, message: instruction, recordUser: false });
}

/** The tool names available, for a health/diagnostic view. */
export function toolNames(): string[] {
  return Object.keys(TOOLS);
}
