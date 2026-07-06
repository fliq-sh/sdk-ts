import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../src/index.js";

const SECRET = "whsec_test-secret-abc";
const URL = "https://api.example.com/fliq/webhook";
const BODY = JSON.stringify({ event: "job.completed", job_id: "job-1" });

// Independently reproduce the API's signing scheme (signer.go) with node:crypto,
// so the test validates verifyWebhook (Web Crypto) against a different impl.
function sign(secret: string, timestamp: string, method: string, url: string, body: string): string {
  const payload = `${timestamp}.${method}.${url}.${body}`;
  return "v1=" + createHmac("sha256", secret).update(payload).digest("hex");
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe("verifyWebhook", () => {
  it("accepts a valid, fresh signature", async () => {
    const timestamp = nowTs();
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(await verifyWebhook({ body: BODY, signature, timestamp, secret: SECRET, url: URL })).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const timestamp = nowTs();
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(
      await verifyWebhook({ body: BODY + " ", signature, timestamp, secret: SECRET, url: URL }),
    ).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const timestamp = nowTs();
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(
      await verifyWebhook({ body: BODY, signature, timestamp, secret: "whsec_wrong", url: URL }),
    ).toBe(false);
  });

  it("rejects a mismatched URL (URL is part of the signed payload)", async () => {
    const timestamp = nowTs();
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(
      await verifyWebhook({ body: BODY, signature, timestamp, secret: SECRET, url: "https://evil.example.com/hook" }),
    ).toBe(false);
  });

  it("rejects a stale timestamp within the default tolerance window", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1h old
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(await verifyWebhook({ body: BODY, signature, timestamp, secret: SECRET, url: URL })).toBe(false);
  });

  it("accepts a stale-but-valid signature when the freshness check is disabled", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = sign(SECRET, timestamp, "POST", URL, BODY);
    expect(
      await verifyWebhook({ body: BODY, signature, timestamp, secret: SECRET, url: URL, toleranceSeconds: 0 }),
    ).toBe(true);
  });

  it("rejects empty/missing signature or timestamp", async () => {
    expect(await verifyWebhook({ body: BODY, signature: "", timestamp: nowTs(), secret: SECRET, url: URL })).toBe(false);
    expect(await verifyWebhook({ body: BODY, signature: "v1=abc", timestamp: "", secret: SECRET, url: URL })).toBe(false);
  });

  it("honors a non-POST method in the signed payload", async () => {
    const timestamp = nowTs();
    const signature = sign(SECRET, timestamp, "PUT", URL, BODY);
    expect(
      await verifyWebhook({ body: BODY, signature, timestamp, secret: SECRET, url: URL, method: "PUT" }),
    ).toBe(true);
  });
});
