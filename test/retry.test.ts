import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FliqConnectionError,
  FliqTimeoutError,
  HttpClient,
  InternalServerError,
  BadRequestError,
} from "../src/index.js";

/**
 * A fetch double that replays a scripted sequence of outcomes — one per
 * attempt. Each step is either an HTTP reply (`{ status, body?, headers? }`)
 * or a thrown error (`{ throw: Error }`). The final step repeats if the client
 * makes more attempts than scripted. `calls` records how many times fetch ran.
 */
type Step =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { throw: unknown };

function scriptedFetch(steps: Step[]) {
  let i = 0;
  const calls: { url: string; signal?: AbortSignal }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), signal: init?.signal ?? undefined });
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    if ("throw" in step) throw step.throw;
    const hasBody = step.body !== undefined;
    return new Response(hasBody ? JSON.stringify(step.body) : "", {
      status: step.status,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...step.headers,
      },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function makeClient(steps: Step[], opts: { maxRetries?: number; timeout?: number } = {}) {
  const { fetchImpl, calls } = scriptedFetch(steps);
  const client = new HttpClient({
    apiKey: "fliq_sk_test",
    fetch: fetchImpl,
    maxRetries: opts.maxRetries,
    timeout: opts.timeout,
  });
  return { client, calls };
}

/** Drive a pending request to completion under fake timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  // Attach a handler now so a rejection during timer flushing isn't reported as
  // an unhandled rejection; the original `p` is still returned for assertions.
  p.catch(() => undefined);
  await vi.runAllTimersAsync();
  return p;
}

describe("retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries a 503 and returns the eventual success", async () => {
    const { client, calls } = makeClient([
      { status: 503, body: { error: "down" } },
      { status: 200, body: { id: "job_1" } },
    ]);
    const result = await settle(client.get<{ id: string }>("/jobs/job_1"));
    expect(result).toEqual({ id: "job_1" });
    expect(calls).toHaveLength(2);
  });

  it("retries on 429 (rate limit)", async () => {
    const { client, calls } = makeClient([
      { status: 429, body: { error: "slow down" } },
      { status: 200, body: { ok: true } },
    ]);
    await settle(client.get("/stats"));
    expect(calls).toHaveLength(2);
  });

  it("retries on 408 (request timeout status)", async () => {
    const { client, calls } = makeClient([
      { status: 408 },
      { status: 200, body: { ok: true } },
    ]);
    await settle(client.get("/jobs"));
    expect(calls).toHaveLength(2);
  });

  it("does NOT retry a 400 — surfaces it on the first attempt", async () => {
    const { client, calls } = makeClient([
      { status: 400, body: { error: "bad limit" } },
      { status: 200, body: { ok: true } },
    ]);
    await expect(settle(client.get("/jobs"))).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(calls).toHaveLength(1);
  });

  it("exhausts maxRetries then throws the last error", async () => {
    const { client, calls } = makeClient([{ status: 500, body: { error: "boom" } }], {
      maxRetries: 2,
    });
    await expect(settle(client.get("/jobs"))).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(calls).toHaveLength(3); // 1 initial + 2 retries
  });

  it("retries a thrown network error then succeeds", async () => {
    const { client, calls } = makeClient([
      { throw: new TypeError("fetch failed") },
      { status: 200, body: { ok: true } },
    ]);
    await settle(client.get("/jobs"));
    expect(calls).toHaveLength(2);
  });

  it("wraps an exhausted network error in FliqConnectionError", async () => {
    const { client } = makeClient([{ throw: new TypeError("fetch failed") }], {
      maxRetries: 1,
    });
    const err = await settle(client.get("/jobs")).catch((e) => e);
    expect(err).toBeInstanceOf(FliqConnectionError);
    expect(err).not.toBeInstanceOf(FliqTimeoutError);
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(TypeError);
  });

  it("maxRetries: 0 disables retries", async () => {
    const { client, calls } = makeClient([{ status: 503, body: { error: "x" } }], {
      maxRetries: 0,
    });
    await expect(settle(client.get("/jobs"))).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(calls).toHaveLength(1);
  });

  it("honors a per-request maxRetries override", async () => {
    const { client, calls } = makeClient([{ status: 503, body: { error: "x" } }], {
      maxRetries: 5,
    });
    await expect(
      settle(client.request("/jobs", { method: "GET", maxRetries: 1 })),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(2);
  });

  it("waits for the Retry-After delay before retrying", async () => {
    const { client, calls } = makeClient([
      { status: 503, headers: { "Retry-After": "2" } },
      { status: 200, body: { ok: true } },
    ]);
    const p = client.get("/jobs");
    // Not yet retried: still inside the 2s Retry-After window.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(calls).toHaveLength(2);
  });
});

describe("timeouts", () => {
  // Real timers here: the request hangs until the abort signal fires.
  afterEach(() => vi.restoreAllMocks());

  /** A fetch that only ever settles by rejecting when its signal aborts. */
  function hangingFetch() {
    const calls: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) calls.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () =>
            reject(
              signal.reason ??
                new DOMException("aborted", "AbortError"),
            ),
          { once: true },
        );
      });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it("aborts a hanging request and raises FliqTimeoutError", async () => {
    const { fetchImpl } = hangingFetch();
    const client = new HttpClient({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl,
      timeout: 15,
      maxRetries: 0,
    });
    await expect(client.get("/jobs")).rejects.toBeInstanceOf(FliqTimeoutError);
  });

  it("retries after a timeout if retries remain", async () => {
    // First attempt hangs (times out), second resolves fast.
    let attempt = 0;
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      attempt++;
      if (attempt === 1) {
        return new Promise<Response>((_r, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal!.reason ?? new Error("aborted")),
            { once: true },
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const client = new HttpClient({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
      timeout: 15,
      maxRetries: 1,
    });
    const result = await client.get<{ ok: boolean }>("/jobs");
    expect(result).toEqual({ ok: true });
    expect(attempt).toBe(2);
  });

  it("propagates a caller abort without retrying", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal!.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    });
    const client = new HttpClient({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
      maxRetries: 3,
    });
    const reason = new Error("caller cancelled");
    const p = client.request("/jobs", { method: "GET", signal: controller.signal });
    controller.abort(reason);
    await expect(p).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("propagates an already-aborted signal", async () => {
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_r, reject) => {
        // Mirror real fetch: reject immediately for an already-aborted signal.
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    });
    const client = new HttpClient({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const reason = new Error("already gone");
    const p = client.request("/jobs", {
      method: "GET",
      signal: AbortSignal.abort(reason),
    });
    await expect(p).rejects.toBe(reason);
  });
});
