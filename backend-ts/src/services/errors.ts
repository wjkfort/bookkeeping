/**
 * Service-layer errors.
 *
 * Route handlers and the AI tools both call the functions in this directory.
 * Those functions must not know about HTTP: a handler turns a `ServiceError`
 * into a status code and a response body, while the AI layer feeds the same
 * message back to the model as a tool result. Returning `c.json(...)` from a
 * service would make the tool-calling path impossible, which is the whole point
 * of extracting them.
 */

/** The status codes the existing handlers already return, plus upstream failure. */
export type ServiceErrorStatus = 400 | 404 | 409 | 500 | 502 | 503;

export class ServiceError extends Error {
  readonly status: ServiceErrorStatus;
  /** Extra payload for the cases where a handler returns more than `error`. */
  readonly details?: Record<string, unknown>;
  /** A stable machine-readable tag, when the caller is a model that can retry. */
  readonly code?: string;

  constructor(
    status: ServiceErrorStatus, message: string,
    details?: Record<string, unknown>, code?: string,
  ) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/**
 * A caller-fixable problem, optionally with a machine-readable `code`.
 *
 * The code matters for the AI path: a model that gets `UNKNOWN_UNIT` can look up
 * the legal units and retry, whereas `HTTP_400` tells it nothing. Codes are
 * therefore stored on the error, not buried in `details`.
 */
export const badRequest = (
  message: string, details?: Record<string, unknown>, code?: string,
) => new ServiceError(400, message, details, code);

export const notFound = (message: string) => new ServiceError(404, message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ServiceError(409, message, details);

export const serverError = (message: string) => new ServiceError(500, message);

/** The AI provider could not be reached or refused the request. */
export const providerError = (message: string, details?: Record<string, unknown>) =>
  new ServiceError(502, message, details, 'AI_PROVIDER_ERROR');

/** The AI layer is switched off (no key configured). */
export const unavailable = (message: string, details?: Record<string, unknown>) =>
  new ServiceError(503, message, details, 'AI_UNAVAILABLE');

/**
 * Map a thrown value onto the response a handler should send.
 *
 * Only `ServiceError` carries an intended status; anything else is an
 * unexpected failure and becomes a 500 with the caller's own message, matching
 * what the handlers did before they were refactored.
 *
 * `code` is surfaced when present so an API client — and the model, through a
 * tool result — can branch on it instead of matching on prose.
 */
export function toErrorResponse(error: unknown, fallbackMessage: string): {
  status: ServiceErrorStatus;
  body: Record<string, unknown>;
} {
  if (error instanceof ServiceError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ?? {}),
      },
    };
  }
  return { status: 500, body: { error: fallbackMessage } };
}
