/**
 * Generate an idempotency key. Uses `crypto.randomUUID()` off the global Web
 * Crypto object — present in Node 20+ (global since 19, stable in 20), Deno,
 * Bun, Cloudflare Workers, and browsers. On older runtimes without a global
 * `crypto`, supply an `idempotency_key` explicitly (the call throws otherwise).
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
