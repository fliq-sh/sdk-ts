import {
  errorFromStatus,
  FliqConnectionError,
  FliqError,
  FliqTimeoutError,
  type FliqErrorBody,
} from "./errors.js";

export interface FliqOptions {
  /** API token (`fliq_sk_...`). Required. */
  apiKey: string;
  /** API base URL. Defaults to `https://api.fliq.sh`. */
  baseUrl?: string;
  /**
   * Custom fetch implementation. Defaults to the global `fetch` (Node 18+,
   * Deno, Bun, Cloudflare Workers, browsers).
   */
  fetch?: typeof fetch;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  /**
   * How many times to retry a failed request before giving up. Retries apply to
   * connection failures and to `408`, `429`, and `5xx` responses, with
   * exponential backoff + jitter (honoring `Retry-After` when present).
   * Defaults to `2` (i.e. up to 3 attempts total). Set `0` to disable.
   */
  maxRetries?: number;
  /**
   * Per-request timeout in milliseconds. A request that produces no response in
   * this window is aborted and (if retries remain) retried. Defaults to
   * `60000`. Set `0` to disable the timeout.
   */
  timeout?: number;
}

export type QueryValue = string | number | boolean | undefined | null;

/**
 * Query params. Accepts any object whose values serialize to a scalar — the
 * typed `List*Params` interfaces satisfy this without needing an index
 * signature on each one.
 */
/**
 * Accepted shape for query params: any object whose values are scalars or
 * undefined/null. Kept structural (not an index signature) so the typed
 * `List*Params` interfaces satisfy it directly.
 */
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  method?: string;
  query?: object;
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the client-level `maxRetries` for this request. */
  maxRetries?: number;
  /** Override the client-level `timeout` (ms) for this request. */
  timeout?: number;
  /**
   * Caller-supplied abort signal. Aborting it cancels the request immediately
   * and is **not** retried (the rejection propagates as-is).
   */
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "https://api.fliq.sh";
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const INITIAL_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 8_000;

/** Statuses worth retrying: request timeout, rate limit, and server errors. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms. */
function parseRetryAfter(res: Response, now: number): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Backoff for `attempt` (0-based). Honors a server `Retry-After` when given,
 * otherwise exponential with full jitter, capped at {@link MAX_RETRY_DELAY_MS}.
 */
function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }
  const ceiling = Math.min(
    MAX_RETRY_DELAY_MS,
    INITIAL_RETRY_DELAY_MS * 2 ** attempt,
  );
  // Full jitter: a random point in (0, ceiling].
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

/** Sleep `ms`, rejecting early with the signal's reason if it aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildQuery(params?: object): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Low-level HTTP client. Resource namespaces are layered on top of this in
 * `Fliq`. Handles auth, JSON encoding, error mapping, and 204 responses.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxRetries: number;
  private readonly timeout: number;

  constructor(options: FliqOptions) {
    if (!options || !options.apiKey) {
      throw new Error("Fliq: `apiKey` is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.extraHeaders = options.headers ?? {};
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.timeout = Math.max(0, options.timeout ?? DEFAULT_TIMEOUT_MS);

    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error(
        "Fliq: no global `fetch` available; pass `fetch` in options",
      );
    }
    // Bind so it isn't called with the wrong receiver.
    this.fetchImpl = f.bind(globalThis);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...this.extraHeaders,
      ...options.headers,
    };

    const init: RequestInit = { method: options.method ?? "GET", headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const maxRetries = Math.max(0, options.maxRetries ?? this.maxRetries);
    const timeout = Math.max(0, options.timeout ?? this.timeout);
    const userSignal = options.signal;

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= maxRetries;
      const abort = makeAbortSignal(timeout, userSignal);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: abort.signal });
      } catch (err) {
        abort.cleanup();
        // A caller-initiated abort is final — propagate it, never retry.
        if (userSignal?.aborted) throw userSignal.reason ?? err;
        const failure = abort.timedOut()
          ? new FliqTimeoutError(
              `Fliq: request to ${path} timed out after ${timeout}ms`,
            )
          : new FliqConnectionError(`Fliq: request to ${path} failed`, {
              cause: err,
            });
        if (last) throw failure;
        await sleep(backoffDelay(attempt), userSignal);
        continue;
      }
      abort.cleanup();

      const requestId = res.headers.get("X-Request-ID") ?? undefined;

      if (!res.ok) {
        if (!last && isRetryableStatus(res.status)) {
          const retryAfter = parseRetryAfter(res, Date.now());
          // Drain the body so the connection can be reused.
          await res.text().catch(() => undefined);
          await sleep(backoffDelay(attempt, retryAfter), userSignal);
          continue;
        }
        const body = await parseErrorBody(res);
        throw errorFromStatus(res.status, body, requestId);
      }

      if (res.status === 204) return undefined as T;

      // Some endpoints (DELETE/pause/resume) return 200 with an empty body.
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new FliqError(
          res.status,
          { error: "invalid JSON in response body" },
          "Fliq: failed to parse response body as JSON",
          requestId,
        );
      }
    }
  }

  get<T>(path: string, query?: object): Promise<T> {
    return this.request<T>(path, { method: "GET", query });
  }

  post<T>(path: string, body?: unknown, query?: object): Promise<T> {
    return this.request<T>(path, { method: "POST", body, query });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

interface AbortHandle {
  /** Signal to hand to `fetch` — fires on either timeout or caller abort. */
  signal: AbortSignal;
  /** Whether the timeout (not the caller) triggered the abort. */
  timedOut: () => boolean;
  /** Tear down the timer and listener; call once the fetch settles. */
  cleanup: () => void;
}

/**
 * Build an {@link AbortSignal} that fires when either the per-request timeout
 * elapses or the caller's `userSignal` aborts. A zero/absent timeout means "no
 * timeout". The returned `timedOut()` lets the caller tell the two apart so a
 * timeout becomes a {@link FliqTimeoutError} while a caller abort propagates.
 */
function makeAbortSignal(
  timeoutMs: number,
  userSignal?: AbortSignal,
): AbortHandle {
  const controller = new AbortController();
  let timedOut = false;

  const onUserAbort = () => controller.abort(userSignal!.reason);
  if (userSignal) {
    if (userSignal.aborted) controller.abort(userSignal.reason);
    else userSignal.addEventListener("abort", onUserAbort, { once: true });
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
  };
}

async function parseErrorBody(res: Response): Promise<FliqErrorBody> {
  const text = await res.text().catch(() => "");
  if (!text) return { error: res.statusText };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") return parsed as FliqErrorBody;
    return { error: String(parsed) };
  } catch {
    return { error: text };
  }
}
