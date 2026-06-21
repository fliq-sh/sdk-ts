# @fliq/sdk

Official TypeScript SDK for [Fliq](https://fliq.sh) — reliable HTTP job
scheduling. Schedule one-off or cron HTTP calls, queue rate-limited outbound
traffic with **buffers**, and inspect every execution attempt — with auth,
idempotency keys, pagination, and typed errors handled for you.

Dependency-light, runs on Node 20+, Deno, Bun, Cloudflare Workers, and the
browser (anywhere with a global `fetch` and Web Crypto). Ships ESM + CJS + full
type declarations.

## Install

```bash
npm install @fliq/sdk
# or: pnpm add @fliq/sdk / yarn add @fliq/sdk / bun add @fliq/sdk
```

## Quickstart

```ts
import { Fliq } from "@fliq/sdk";

const fliq = new Fliq({ apiKey: process.env.FLIQ_API_KEY! }); // "fliq_sk_..."

// Schedule an HTTP job. An idempotency key is generated automatically, so
// retrying this call won't double-schedule.
const job = await fliq.jobs.create({
  url: "https://example.com/webhook",
  method: "POST",
  body: JSON.stringify({ hello: "world" }),
  scheduled_at: new Date(Date.now() + 60_000).toISOString(), // 1 min from now
  max_retries: 3,
});

console.log("scheduled", job.id);
```

Pass `baseUrl` to point at a different environment (defaults to
`https://api.fliq.sh`):

```ts
const fliq = new Fliq({ apiKey, baseUrl: "https://api.fliq.sh" });
```

### Iterate failed jobs (cursor pagination, transparent)

`list()` returns one page; `iterate()` follows `next_cursor` for you as an async
iterator:

```ts
for await (const job of fliq.jobs.iterate({ status: "failed" })) {
  console.log(job.id, job.url);
  await fliq.jobs.replay(job.id); // re-run it
}
```

### Handle insufficient credits (and other typed errors)

Every non-2xx response throws a `FliqError` subclass carrying `status` and the
parsed `body`:

```ts
import { Fliq, InsufficientCreditsError, ConflictError } from "@fliq/sdk";

try {
  await fliq.jobs.replay(jobId);
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    const { url } = await fliq.billing.createCheckout(100_000); // top up
    console.log("out of credits — top up at", url);
  } else if (err instanceof ConflictError) {
    console.log("job isn't in a replayable state");
  } else {
    throw err;
  }
}
```

Error classes: `FliqError` (base) and `BadRequestError` (400),
`AuthenticationError` (401), `InsufficientCreditsError` (402),
`PermissionDeniedError` (403), `NotFoundError` (404), `ConflictError` (409),
`RateLimitError` (429), `InternalServerError` (5xx). Each exposes `.status`,
`.body`, and `.requestId` (from the `X-Request-ID` response header).

## Buffers — outbound rate limiting

A **buffer** drains queued items to a target URL at a fixed rate, so you can
call rate-limited downstream APIs without hitting 429s.

```ts
const buffer = await fliq.buffers.create({
  name: "stripe-sync",
  url: "https://api.partner.com/ingest",
  rate_limit: 5, // requests per second
  max_retries: 3,
});

// Push items (idempotency key auto-generated per item).
await fliq.buffers.pushItem(buffer.id, { body: JSON.stringify({ id: 1 }) });

// Server-aggregated status breakdown.
const stats = await fliq.buffers.stats(buffer.id);
console.log(stats.pending, stats.success_rate);

// Replay a permanently-failed item onto the tail of the queue.
for await (const item of fliq.buffers.iterateItems(buffer.id, { status: "failed" })) {
  await fliq.buffers.replayItem(buffer.id, item.id);
}
```

## API overview

All methods are namespaced on the client and fully typed.

| Namespace | Methods |
|---|---|
| `fliq.jobs` | `create`, `get`, `list`, `iterate`, `cancel`, `replay`, `listAttempts` |
| `fliq.schedules` | `create`, `get`, `list`, `iterate`, `pause`, `resume`, `delete`, `listJobs`, `iterateJobs` |
| `fliq.buffers` | `create`, `get`, `list`, `iterate`, `pause`, `resume`, `delete`, `stats`, `pushItem`, `listItems`, `iterateItems`, `getItem`, `replayItem` |
| `fliq.alerts` | `list`, `get`, `create`, `setEnabled`, `delete` |
| `fliq.stats` | `jobs(days?)`, `usage(days?)` |
| `fliq.billing` | `getBalance`, `createCheckout`, `listTransactions`, `iterateTransactions` |
| `fliq.tokens` | `list`, `create`, `revoke` |

Every `iterate*` method is the async-iterator twin of the matching `list*`
method and transparently follows `next_cursor`. Job and buffer-item creation
auto-generate an idempotency key (`crypto.randomUUID()`) when you don't supply
one, so retries are safe by default.

### Escape hatch

For an endpoint the SDK doesn't wrap yet, call the underlying client directly:

```ts
const data = await fliq.http.get<{ ok: boolean }>("/some/new/route");
```

## Authentication

Create an API token (`fliq_sk_...`) in the Fliq dashboard under
**Settings → API tokens**, or programmatically via `fliq.tokens.create(name)`
(the raw token is returned once and never stored).

## License

MIT
