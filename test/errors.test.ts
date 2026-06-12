import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  Fliq,
  FliqError,
  InsufficientCreditsError,
  NotFoundError,
} from "../src/index.js";

/** A fetch mock that always returns the given status + JSON error body. */
function failingFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return vi.fn(async () => {
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  });
}

function client(fetchImpl: ReturnType<typeof failingFetch>) {
  return new Fliq({
    apiKey: "fliq_sk_test",
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

describe("error mapping", () => {
  it("maps 402 to InsufficientCreditsError", async () => {
    const fliq = client(failingFetch(402, { error: "Insufficient credits" }));

    await expect(
      fliq.jobs.create({
        url: "https://example.com",
        method: "POST",
        scheduled_at: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it("attaches status, message, and parsed body to the error", async () => {
    const fliq = client(failingFetch(402, { error: "Insufficient credits" }));

    try {
      await fliq.jobs.replay("job_1");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditsError);
      const e = err as InsufficientCreditsError;
      expect(e.status).toBe(402);
      expect(e.message).toBe("Insufficient credits");
      expect(e.body).toEqual({ error: "Insufficient credits" });
      expect(e).toBeInstanceOf(FliqError);
    }
  });

  it("maps 409 to ConflictError", async () => {
    const fliq = client(failingFetch(409, { error: "Job is not replayable" }));

    await expect(fliq.jobs.replay("job_1")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("maps 404 to NotFoundError", async () => {
    const fliq = client(failingFetch(404, { error: "Job not found" }));

    await expect(fliq.jobs.get("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("captures the X-Request-ID header on the error", async () => {
    const fliq = client(
      failingFetch(409, { error: "conflict" }, { "X-Request-ID": "req_abc" }),
    );

    try {
      await fliq.jobs.replay("job_1");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as ConflictError).requestId).toBe("req_abc");
    }
  });

  it("falls back to FliqError for unmapped statuses", async () => {
    const fliq = client(failingFetch(418, { error: "teapot" }));

    try {
      await fliq.jobs.get("x");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FliqError);
      expect(err).not.toBeInstanceOf(NotFoundError);
      expect((err as FliqError).status).toBe(418);
    }
  });

  it("handles a non-JSON error body gracefully", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("upstream exploded", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const fliq = client(fetchImpl as ReturnType<typeof failingFetch>);

    try {
      await fliq.jobs.get("x");
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as FliqError;
      expect(e.status).toBe(502);
      expect(e.body.error).toBe("upstream exploded");
    }
  });
});
