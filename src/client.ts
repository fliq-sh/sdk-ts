import { errorFromStatus, FliqError, type FliqErrorBody } from "./errors.js";

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
}

const DEFAULT_BASE_URL = "https://api.fliq.sh";

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

  constructor(options: FliqOptions) {
    if (!options || !options.apiKey) {
      throw new Error("Fliq: `apiKey` is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.extraHeaders = options.headers ?? {};

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

    const res = await this.fetchImpl(url, init);
    const requestId = res.headers.get("X-Request-ID") ?? undefined;

    if (!res.ok) {
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
