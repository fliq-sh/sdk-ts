import { afterEach, describe, expect, it, vi } from "vitest";
import { Fliq } from "../src/index.js";

interface RecordedRequest {
  url: string;
  path: string;
  query: URLSearchParams;
  method: string;
  body: unknown;
}

/**
 * Build a Fliq client whose fetch records every outbound request and replies
 * with `respond(req)` (defaults to an empty 200, which the client maps to
 * `undefined` — the right shape for void endpoints). Asserting on `calls` is
 * how every test here checks that a resource method hits the correct verb,
 * path, query, and body.
 */
function makeClient(respond?: (req: RecordedRequest) => { status?: number; body?: unknown }) {
  const calls: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const req: RecordedRequest = {
      url: String(url),
      path: u.pathname,
      query: u.searchParams,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(req);
    const r = respond?.(req) ?? {};
    const status = r.status ?? 200;
    const hasBody = r.body !== undefined;
    // 204/205/304 are null-body statuses — the Response constructor rejects any
    // body (even "") for them, so mirror a real no-content reply with null.
    const nullBodyStatus = status === 204 || status === 205 || status === 304;
    return new Response(nullBodyStatus ? null : hasBody ? JSON.stringify(r.body) : "", {
      status,
      headers: hasBody ? { "Content-Type": "application/json" } : {},
    });
  });
  const fliq = new Fliq({
    apiKey: "fliq_sk_test",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { fliq, calls };
}

const only = (calls: RecordedRequest[]) => {
  expect(calls).toHaveLength(1);
  return calls[0]!;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jobs resource", () => {
  it("create POSTs /jobs with the supplied body", async () => {
    const { fliq, calls } = makeClient();
    await fliq.jobs.create({
      url: "https://example.com/hook",
      method: "POST",
      scheduled_at: "2026-01-01T00:00:00Z",
    });
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/jobs");
    expect((req.body as { url: string }).url).toBe("https://example.com/hook");
  });

  it("get GETs /jobs/{id} and URL-encodes the id", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "a/b" } }));
    await fliq.jobs.get("a/b");
    const req = only(calls);
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/jobs/a%2Fb");
  });

  it("list forwards filter params as query string", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { jobs: [], next_cursor: null } }));
    await fliq.jobs.list({ status: "failed", limit: 25 });
    const req = only(calls);
    expect(req.path).toBe("/jobs");
    expect(req.query.get("status")).toBe("failed");
    expect(req.query.get("limit")).toBe("25");
  });

  it("cancel DELETEs /jobs/{id} and returns undefined on 204", async () => {
    const { fliq, calls } = makeClient(() => ({ status: 204 }));
    const out = await fliq.jobs.cancel("job_1");
    const req = only(calls);
    expect(req.method).toBe("DELETE");
    expect(req.path).toBe("/jobs/job_1");
    expect(out).toBeUndefined();
  });

  it("replay POSTs /jobs/{id}/replay with no body", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "job_2" } }));
    await fliq.jobs.replay("job_1");
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/jobs/job_1/replay");
    expect(req.body).toBeUndefined();
  });

  it("listAttempts GETs /jobs/{id}/attempts and returns the array verbatim", async () => {
    const attempts = [{ id: "att_1" }, { id: "att_2" }];
    const { fliq, calls } = makeClient(() => ({ body: attempts }));
    const out = await fliq.jobs.listAttempts("job_1");
    const req = only(calls);
    expect(req.path).toBe("/jobs/job_1/attempts");
    expect(out).toHaveLength(2);
  });
});

describe("buffers resource", () => {
  it("create POSTs /buffers", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "buf_1" } }));
    await fliq.buffers.create({ name: "outbound", url: "https://example.com/hook", rate_limit: 10 });
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/buffers");
  });

  it("pause / resume POST the action sub-paths", async () => {
    const { fliq, calls } = makeClient();
    await fliq.buffers.pause("buf_1");
    await fliq.buffers.resume("buf_1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/buffers/buf_1/pause");
    expect(calls[1]!.path).toBe("/buffers/buf_1/resume");
  });

  it("stats GETs the aggregate sub-path", async () => {
    const { fliq, calls } = makeClient(() => ({ body: {} }));
    await fliq.buffers.stats("buf_1");
    const req = only(calls);
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/buffers/buf_1/stats");
  });

  it("pushItem POSTs /buffers/{id}/items with an auto idempotency_key", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "item_1" } }));
    await fliq.buffers.pushItem("buf_1", { body: '{"x":1}' });
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/buffers/buf_1/items");
    expect((req.body as { idempotency_key?: string }).idempotency_key).toBeTruthy();
  });

  it("getItem encodes both buffer and item ids", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "i/1" } }));
    await fliq.buffers.getItem("b/1", "i/1");
    const req = only(calls);
    expect(req.path).toBe("/buffers/b%2F1/items/i%2F1");
  });

  it("replayItem POSTs the item replay sub-path", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "item_1" } }));
    await fliq.buffers.replayItem("buf_1", "item_1");
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/buffers/buf_1/items/item_1/replay");
  });

  it("listItems forwards params on the items sub-path", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { items: [], next_cursor: null } }));
    await fliq.buffers.listItems("buf_1", { status: "pending" });
    const req = only(calls);
    expect(req.path).toBe("/buffers/buf_1/items");
    expect(req.query.get("status")).toBe("pending");
  });
});

describe("schedules resource", () => {
  it("create / delete hit /schedules", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "sch_1" } }));
    await fliq.schedules.create({ name: "nightly", cron_expr: "* * * * *", url: "https://example.com/hook" });
    await fliq.schedules.delete("sch_1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/schedules");
    expect(calls[1]!.method).toBe("DELETE");
    expect(calls[1]!.path).toBe("/schedules/sch_1");
  });

  it("listJobs GETs the schedule's jobs sub-path with params", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { jobs: [], next_cursor: null } }));
    await fliq.schedules.listJobs("sch_1", { limit: 10 });
    const req = only(calls);
    expect(req.path).toBe("/schedules/sch_1/jobs");
    expect(req.query.get("limit")).toBe("10");
  });
});

describe("alerts resource", () => {
  it("list unwraps the { channels } envelope", async () => {
    const { fliq, calls } = makeClient(() => ({
      body: { channels: [{ id: "ch_1" }, { id: "ch_2" }] },
    }));
    const out = await fliq.alerts.list();
    const req = only(calls);
    expect(req.path).toBe("/alerts");
    expect(out).toEqual([{ id: "ch_1" }, { id: "ch_2" }]);
  });

  it("setEnabled PATCHes /alerts/{id} with { enabled }", async () => {
    const { fliq, calls } = makeClient();
    await fliq.alerts.setEnabled("ch_1", false);
    const req = only(calls);
    expect(req.method).toBe("PATCH");
    expect(req.path).toBe("/alerts/ch_1");
    expect(req.body).toEqual({ enabled: false });
  });
});

describe("billing resource", () => {
  it("getBalance GETs /billing/balance", async () => {
    const { fliq, calls } = makeClient(() => ({ body: {} }));
    await fliq.billing.getBalance();
    expect(only(calls).path).toBe("/billing/balance");
  });

  it("createCheckout POSTs /billing/checkout with { credits }", async () => {
    const { fliq, calls } = makeClient(() => ({ body: {} }));
    await fliq.billing.createCheckout(100_000);
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/billing/checkout");
    expect(req.body).toEqual({ credits: 100_000 });
  });

  it("listTransactions forwards params", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { transactions: [], next_cursor: null } }));
    await fliq.billing.listTransactions({ limit: 5 });
    const req = only(calls);
    expect(req.path).toBe("/billing/transactions");
    expect(req.query.get("limit")).toBe("5");
  });
});

describe("stats resource", () => {
  it("jobs GETs /stats/jobs with the days param", async () => {
    const { fliq, calls } = makeClient(() => ({ body: {} }));
    await fliq.stats.jobs(7);
    const req = only(calls);
    expect(req.path).toBe("/stats/jobs");
    expect(req.query.get("days")).toBe("7");
  });

  it("usage omits days when none is given", async () => {
    const { fliq, calls } = makeClient(() => ({ body: {} }));
    await fliq.stats.usage();
    const req = only(calls);
    expect(req.path).toBe("/stats/usage");
    expect(req.query.has("days")).toBe(false);
  });
});

describe("tokens resource", () => {
  it("create POSTs /tokens with { name }", async () => {
    const { fliq, calls } = makeClient(() => ({ body: { id: "tok_1", token: "fliq_sk_x" } }));
    await fliq.tokens.create("ci");
    const req = only(calls);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/tokens");
    expect(req.body).toEqual({ name: "ci" });
  });

  it("revoke DELETEs /tokens/{id}", async () => {
    const { fliq, calls } = makeClient();
    await fliq.tokens.revoke("tok_1");
    const req = only(calls);
    expect(req.method).toBe("DELETE");
    expect(req.path).toBe("/tokens/tok_1");
  });
});
