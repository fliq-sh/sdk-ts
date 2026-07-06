/**
 * Verify the HMAC signature Fliq attaches to outbound webhook deliveries.
 *
 * Fliq signs every webhook POST and sends two headers:
 *   - `X-Fliq-Timestamp`: unix seconds when the request was signed
 *   - `X-Fliq-Signature`: `v1=<hex>` where hex = HMAC-SHA256(secret, payload)
 *
 * The signed `payload` is `` `${timestamp}.${method}.${url}.${body}` `` — the
 * same construction the API uses. `url` is the exact endpoint Fliq delivered to
 * (your registered `webhook_url`); `method` is always `POST`. Grab `secret` from
 * your dashboard (Settings → webhook signing secret, a `whsec_…` value).
 *
 * Uses the global Web Crypto (`crypto.subtle`) so it runs on Node 20+, Deno,
 * Bun, Cloudflare Workers, and browsers. Returns `true` only when the signature
 * matches (constant-time) and — unless disabled — the timestamp is fresh.
 *
 * @example
 * ```ts
 * const ok = await verifyWebhook({
 *   body: rawRequestBody,                       // the exact bytes you received
 *   signature: req.headers["x-fliq-signature"],
 *   timestamp: req.headers["x-fliq-timestamp"],
 *   secret: process.env.FLIQ_WEBHOOK_SECRET!,
 *   url: "https://api.example.com/fliq/webhook",
 * });
 * if (!ok) return res.status(400).end();
 * ```
 */
export interface VerifyWebhookParams {
  /** The raw request body, exactly as received (do not re-serialize). */
  body: string;
  /** The `X-Fliq-Signature` header value (`v1=<hex>`). */
  signature: string;
  /** The `X-Fliq-Timestamp` header value (unix seconds). */
  timestamp: string;
  /** Your webhook signing secret (`whsec_…`). */
  secret: string;
  /** The exact URL Fliq delivered to (your registered `webhook_url`). */
  url: string;
  /** HTTP method Fliq used. Defaults to `"POST"`. */
  method?: string;
  /**
   * Reject deliveries whose timestamp is more than this many seconds from now
   * (replay protection). Defaults to 300 (5 minutes). Set to 0 to skip the
   * freshness check entirely.
   */
  toleranceSeconds?: number;
}

const encoder = new TextEncoder();

/** Verify a Fliq webhook signature. Resolves to `true` iff the delivery is authentic (and fresh). */
export async function verifyWebhook(params: VerifyWebhookParams): Promise<boolean> {
  const {
    body,
    signature,
    timestamp,
    secret,
    url,
    method = "POST",
    toleranceSeconds = 300,
  } = params;

  if (!signature || !timestamp || !secret) return false;

  // Freshness / replay check.
  if (toleranceSeconds > 0) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSeconds = Date.now() / 1000;
    if (Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  }

  const payload = `${timestamp}.${method}.${url}.${body}`;
  const expected = `v1=${await hmacSha256Hex(secret, payload)}`;
  return timingSafeEqual(expected, signature);
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error(
      "Fliq: Web Crypto (`crypto.subtle`) is unavailable; verifyWebhook needs Node 20+, Deno, Bun, a Worker, or a browser",
    );
  }
  const key = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await cryptoObj.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(mac);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string comparison — never short-circuits on the first mismatch. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
