import { afterEach, describe, expect, it, vi } from "vitest";
import { Fliq } from "../src/index.js";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build a Fliq client whose fetch records the outbound request and returns `response`. */
function clientThatCaptures(response: unknown, status = 200) {
  const calls: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  const fliq = new Fliq({
    apiKey: "fliq_sk_test",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { fliq, calls };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("idempotency key auto-generation", () => {
  it("auto-generates an idempotency_key for jobs.create when none is supplied", async () => {
    const { fliq, calls } = clientThatCaptures({
      id: "job_1",
      created_at: "2026-01-01T00:00:00Z",
    });

    await fliq.jobs.create({
      url: "https://example.com/hook",
      method: "POST",
      scheduled_at: "2026-01-01T00:00:00Z",
    });

    const body = calls[0]!.body as { idempotency_key?: string };
    expect(body.idempotency_key).toMatch(UUID);
  });

  it("preserves a caller-supplied idempotency_key for jobs.create", async () => {
    const { fliq, calls } = clientThatCaptures({
      id: "job_1",
      created_at: "2026-01-01T00:00:00Z",
    });

    await fliq.jobs.create({
      url: "https://example.com/hook",
      method: "POST",
      scheduled_at: "2026-01-01T00:00:00Z",
      idempotency_key: "my-key",
    });

    const body = calls[0]!.body as { idempotency_key?: string };
    expect(body.idempotency_key).toBe("my-key");
  });

  it("auto-generates an idempotency_key for buffers.pushItem", async () => {
    const { fliq, calls } = clientThatCaptures({
      id: "item_1",
      buffer_id: "buf_1",
      status: "pending",
    });

    await fliq.buffers.pushItem("buf_1", { body: '{"x":1}' });

    const body = calls[0]!.body as { idempotency_key?: string };
    expect(body.idempotency_key).toMatch(UUID);
  });

  it("sets the Authorization bearer header from the apiKey", async () => {
    const { fliq, calls } = clientThatCaptures({
      id: "job_1",
      created_at: "2026-01-01T00:00:00Z",
    });

    await fliq.jobs.create({
      url: "https://example.com/hook",
      method: "POST",
      scheduled_at: "2026-01-01T00:00:00Z",
    });

    expect(calls[0]!.headers["authorization"]).toBe("Bearer fliq_sk_test");
  });
});
