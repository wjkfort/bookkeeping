/**
 * DeepSeek chat-completions client (R2).
 *
 * A thin wrapper, deliberately: no agent framework, no retry storm, no hidden
 * state. What it owns is the things that must not be got wrong at the call site:
 *
 *   - the key comes from a Worker secret and is only ever seen here (R2). It is
 *     never logged, never returned in an error body, and never reaches the
 *     browser because every call happens server-side.
 *   - a missing key is *not* an exception path that breaks the app: it surfaces
 *     as `unavailable`, and R6 requires every other feature to work regardless.
 *   - a transport failure, a non-2xx response and a malformed body all become a
 *     `providerError` the caller can report, rather than an unhandled throw.
 *   - the request is bounded in wall-clock time, so a hung provider cannot pin a
 *     Worker invocation.
 *
 * `fetchImpl` is injectable so the tool-calling loop can be tested against
 * canned provider responses with no network and no key.
 */

import { providerError, unavailable } from './errors';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

/** Wall-clock ceiling for one provider call. */
export const AI_REQUEST_TIMEOUT_MS = 45_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present on an assistant turn that requested tools. */
  tool_calls?: ToolCall[];
  /** Present on a `tool` turn: which call this is the result of. */
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A tool as the provider expects it (JSON Schema parameters). */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  content: string | null;
  tool_calls: ToolCall[];
  usage: ChatUsage;
  finish_reason: string | null;
  model: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** 0 for bookkeeping extraction: wording consistency matters more than flair. */
  temperature?: number;
  maxTokens?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface AiConfig {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

/** Resolve configuration from the Worker environment. */
export function aiConfigFromEnv(env: {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}): AiConfig {
  return {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: (env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, ''),
    model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
  };
}

/** R6: is the AI layer configured at all? */
export function isAiConfigured(env: { DEEPSEEK_API_KEY?: string }): boolean {
  return typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.trim().length > 0;
}

interface DeepSeekChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  };
  finish_reason?: string | null;
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  error?: { message?: string; type?: string; code?: string };
}

/**
 * One completion. Returns content plus any tool calls the model wants run.
 *
 * A provider-level failure (no key, HTTP error, unreadable body) raises a
 * `ServiceError`; the caller decides whether to surface it or fall back. Nothing
 * here throws a bare Error, so the HTTP layer never turns a provider outage into
 * an opaque 500.
 */
export async function chatCompletion(
  config: AiConfig, options: ChatOptions,
): Promise<ChatResult> {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw unavailable(
      'The AI assistant is not configured on this server.',
      { code: 'AI_UNAVAILABLE' },
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
    temperature: options.temperature ?? 0,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    // Let the model choose. Bookkeeping turns are frequently a plain answer
    // ("you spent 320 this month") with no write at all.
    body.tool_choice = 'auto';
  }
  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }

  // Bound the call even when the provider never answers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  const signal = options.signal ?? controller.signal;

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    const aborted = e?.name === 'AbortError';
    throw providerError(
      aborted
        ? `The AI provider did not respond within ${AI_REQUEST_TIMEOUT_MS / 1000}s.`
        : 'Could not reach the AI provider.',
      { code: aborted ? 'AI_TIMEOUT' : 'AI_UNREACHABLE' },
    );
  }
  clearTimeout(timer);

  const text = await response.text();

  if (!response.ok) {
    // The provider's own message is passed through, but the key is not: it is
    // never in the body, and this is the only place a body is inspected.
    let apiMessage: string | undefined;
    try {
      apiMessage = (JSON.parse(text) as DeepSeekResponse)?.error?.message;
    } catch { /* not JSON; fall through to the status text */ }

    throw providerError(
      apiMessage
        ? `AI provider error (${response.status}): ${apiMessage}`
        : `AI provider returned HTTP ${response.status}.`,
      { status: response.status, code: 'AI_PROVIDER_ERROR' },
    );
  }

  let payload: DeepSeekResponse;
  try {
    payload = JSON.parse(text) as DeepSeekResponse;
  } catch {
    throw providerError('The AI provider returned an unreadable response.', {
      code: 'AI_MALFORMED_RESPONSE',
    });
  }

  const choice = payload.choices?.[0];
  if (!choice?.message) {
    throw providerError('The AI provider returned no message.', {
      code: 'AI_EMPTY_RESPONSE',
    });
  }

  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(tc => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));

  return {
    content: choice.message.content ?? null,
    tool_calls: toolCalls,
    usage: {
      prompt_tokens: payload.usage?.prompt_tokens ?? 0,
      completion_tokens: payload.usage?.completion_tokens ?? 0,
      total_tokens: payload.usage?.total_tokens ?? 0,
    },
    finish_reason: choice.finish_reason ?? null,
    model: payload.model ?? config.model,
  };
}
