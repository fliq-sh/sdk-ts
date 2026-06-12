import { describe, expect, it, vi } from "vitest";
import { Fliq, type Job } from "../src/index.js";

function job(id: string): Partial<Job> & { id: string } {
  return { id, status: "failed" };
}

/**
 * A fetch mock that serves a fixed set of `/jobs` pages keyed by the `cursor`
 * query param. Returns `next_cursor` until exhausted.
 */
function pagedFetch(pages: { items: Job[]; next: string | null }[]) {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    const cursor = u.searchParams.get("cursor");
    const index = cursor === null ? 0 : Number(cursor);
    const page = pages[index]!;
    return new Response(
      JSON.stringify({ jobs: page.items, next_cursor: page.next }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return fetchImpl;
}

describe("cursor pagination iterator", () => {
  it("walks every page, following next_cursor until null", async () => {
    const fetchImpl = pagedFetch([
      { items: [job("a"), job("b")] as Job[], next: "1" },
      { items: [job("c")] as Job[], next: "2" },
      { items: [job("d"), job("e")] as Job[], next: null },
    ]);
    const fliq = new Fliq({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const ids: string[] = [];
    for await (const j of fliq.jobs.iterate({ status: "failed" })) {
      ids.push(j.id);
    }

    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("forwards filter params on the first page request", async () => {
    const fetchImpl = pagedFetch([{ items: [] as Job[], next: null }]);
    const fliq = new Fliq({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of fliq.jobs.iterate({ status: "failed", limit: 50 }));

    const firstUrl = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(firstUrl.searchParams.get("status")).toBe("failed");
    expect(firstUrl.searchParams.get("limit")).toBe("50");
  });

  it("stops immediately on an empty first page", async () => {
    const fetchImpl = pagedFetch([{ items: [] as Job[], next: null }]);
    const fliq = new Fliq({
      apiKey: "fliq_sk_test",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const ids: string[] = [];
    for await (const j of fliq.jobs.iterate()) ids.push(j.id);

    expect(ids).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
