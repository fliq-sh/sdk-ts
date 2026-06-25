// Typed errors for the Fliq API. The core-api returns errors as
// `{ "error": "message" }` with a meaningful HTTP status. `FliqError` carries
// the status + parsed body; status-specific subclasses let callers branch with
// `instanceof` instead of inspecting numbers.

export interface FliqErrorBody {
  error?: string;
  [key: string]: unknown;
}

export class FliqError extends Error {
  /** HTTP status code of the failing response. */
  readonly status: number;
  /** Parsed response body (or the raw text under `error` if not JSON). */
  readonly body: FliqErrorBody;
  /** The request id from the `X-Request-ID` response header, when present. */
  readonly requestId?: string;

  constructor(
    status: number,
    body: FliqErrorBody,
    message?: string,
    requestId?: string,
  ) {
    super(message ?? body.error ?? `Fliq API error (status ${status})`);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
    this.requestId = requestId;
    // Restore prototype chain for instanceof across the transpile target.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — the request was malformed (bad params, invalid limit/status, etc.). */
export class BadRequestError extends FliqError {}

/** 401 — missing or invalid API key. */
export class AuthenticationError extends FliqError {}

/** 403 — authenticated but not allowed. */
export class PermissionDeniedError extends FliqError {}

/** 402 — not enough credits to schedule/replay this execution. */
export class InsufficientCreditsError extends FliqError {}

/** 404 — the resource does not exist (or isn't yours). */
export class NotFoundError extends FliqError {}

/** 409 — conflict (e.g. job not in a replayable/cancellable state). */
export class ConflictError extends FliqError {}

/** 429 — you are being rate limited. */
export class RateLimitError extends FliqError {}

/** 5xx — the API failed unexpectedly. */
export class InternalServerError extends FliqError {}

/**
 * The request never produced an HTTP response — a network failure, DNS error,
 * dropped connection, or an aborted request. Unlike {@link FliqError} there is
 * no status or body; the underlying cause (when there is one) is on `.cause`.
 */
export class FliqConnectionError extends Error {
  constructor(message = "Fliq: connection error", options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options && "cause" in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request exceeded the configured `timeout` and was aborted. */
export class FliqTimeoutError extends FliqConnectionError {
  constructor(message = "Fliq: request timed out") {
    super(message);
  }
}

/** Map an HTTP status to the most specific FliqError subclass. */
export function errorFromStatus(
  status: number,
  body: FliqErrorBody,
  requestId?: string,
): FliqError {
  const message = body.error;
  switch (status) {
    case 400:
      return new BadRequestError(status, body, message, requestId);
    case 401:
      return new AuthenticationError(status, body, message, requestId);
    case 402:
      return new InsufficientCreditsError(status, body, message, requestId);
    case 403:
      return new PermissionDeniedError(status, body, message, requestId);
    case 404:
      return new NotFoundError(status, body, message, requestId);
    case 409:
      return new ConflictError(status, body, message, requestId);
    case 429:
      return new RateLimitError(status, body, message, requestId);
    default:
      if (status >= 500) {
        return new InternalServerError(status, body, message, requestId);
      }
      return new FliqError(status, body, message, requestId);
  }
}
