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
 * The constraint codes the DDL triggers raise (migrations/006).
 *
 * Listed explicitly so that a trigger added later cannot be mistaken for an
 * unexpected failure: an unlisted code still surfaces as a 500, which is the
 * honest answer until someone decides what status it deserves.
 */
const TRIGGER_CONSTRAINT_CODES = [
  'CATEGORY_DEPTH',
  'CATEGORY_TYPE_MISMATCH',
  'CATEGORY_SELF_PARENT',
  'CATEGORY_CROSS_USER',
  // The value-domain rules (migrations/007). `INVALID_DATE` is raised by the
  // service layer too, deliberately: whether the service or the trigger catches
  // a bad date, the caller sees the same code.
  'INVALID_DATE',
  'INVALID_JSON',
  'NEGATIVE_AMOUNT',
  'NEGATIVE_TOKENS',
  'NON_POSITIVE_RATE',
] as const;

/**
 * Matches exactly the codes above, not "any UPPER_CASE token followed by a
 * colon". The driver wraps the message — `D1_ERROR: ...`, or
 * `SQLITE_CONSTRAINT_TRIGGER: ...` — and a generic pattern would capture the
 * wrapper's own code first and then reject it as unknown.
 */
const TRIGGER_CODE_PATTERN = new RegExp(
  `\\b(${TRIGGER_CONSTRAINT_CODES.join('|')}):[ \\t]*([^\\n]*)`,
);

/**
 * The driver's own annotation, appended to the message miniflare surfaces.
 *
 * Workerd hands back `CATEGORY_TYPE_MISMATCH: <prose>: SQLITE_CONSTRAINT
 * (extended: SQLITE_CONSTRAINT_TRIGGER)`, and that tail is noise to a user and
 * to the model — the prose is written to be read on its own. Matched from the
 * last `: SQLITE_...` / `, SQLITE_...` marker to the end.
 */
const DRIVER_ANNOTATION = /\s*[:,]\s*SQLITE_[A-Z_]*(?:\s*\(extended:[^)]*\))?\s*$/;

/**
 * Recognise a constraint violation raised by a trigger.
 *
 * The messages carry the shape `<CODE>: <prose>` — see migrations/006. The
 * prose is what a user or the model should read, so it becomes the message and
 * the code travels separately for callers that branch on it (R6).
 *
 * A `CHECK` violation cannot reach here: those carry no code of this shape and
 * stay 500s, as does any trigger whose code is not listed above.
 */
export function triggerConstraintError(error: unknown): ServiceError | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = TRIGGER_CODE_PATTERN.exec(message);
  if (!match) return null;
  const prose = match[2].replace(DRIVER_ANNOTATION, '').trim();
  return badRequest(prose, undefined, match[1]);
}

/**
 * Normalise anything a service or driver threw into the `ServiceError` that
 * should be reported, or `null` when it is genuinely unexpected.
 *
 * Both the HTTP handlers and the AI tools need this same judgement: a
 * `ServiceError` passes through, and a DDL trigger violation becomes the 400 it
 * deserves rather than the 500 a raw driver error would produce. Keeping one
 * function means the two paths cannot disagree about what a rule violation is.
 */
export function asServiceError(error: unknown): ServiceError | null {
  if (error instanceof ServiceError) return error;
  return triggerConstraintError(error);
}

/**
 * Map a thrown value onto the response a handler should send.
 *
 * Only a `ServiceError` — or a trigger violation, which is one in all but
 * packaging — carries an intended status; anything else is an unexpected
 * failure and becomes a 500 with the caller's own message, matching what the
 * handlers did before they were refactored.
 *
 * `code` is surfaced when present so an API client — and the model, through a
 * tool result — can branch on it instead of matching on prose.
 */
export function toErrorResponse(error: unknown, fallbackMessage: string): {
  status: ServiceErrorStatus;
  body: Record<string, unknown>;
} {
  const serviceError = asServiceError(error);
  if (serviceError) {
    return {
      status: serviceError.status,
      body: {
        error: serviceError.message,
        ...(serviceError.code ? { code: serviceError.code } : {}),
        ...(serviceError.details ?? {}),
      },
    };
  }
  return { status: 500, body: { error: fallbackMessage } };
}
