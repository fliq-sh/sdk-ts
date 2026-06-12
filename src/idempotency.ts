/**
 * Generate an idempotency key. Uses `crypto.randomUUID()`, available in Node
 * 16+ (via `globalThis.crypto`), Deno, Bun, Cloudflare Workers, and browsers.
 */
export function generateIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (!c || typeof c.randomUUID !== "function") {
    throw new Error(
      "Fliq: `crypto.randomUUID` is unavailable; supply an `idempotency_key` explicitly",
    );
  }
  return c.randomUUID();
}
