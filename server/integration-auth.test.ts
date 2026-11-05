import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isTokenUsable, normalizeScopes, redactTokenSet, tokenNeedsRefresh, verifyWebhookHmacSha256 } from "./integration-auth";

describe("integration auth foundation", () => {
  it("normalizes and deduplicates scopes", () => expect(normalizeScopes("b a a c")).toEqual(["a", "b", "c"]));
  it("detects refresh window", () => expect(tokenNeedsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() - 1 })).toBe(true));
  it("accepts usable non-expiring tokens", () => expect(isTokenUsable({ accessToken: "a" })).toBe(true));
  it("redacts credentials", () => expect(redactTokenSet({ accessToken: "a", refreshToken: "r" }).accessToken).toBe("[REDACTED]"));
  it("verifies webhook signatures with constant-time comparison", () => {
    const body = "{\"event\":1}";
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWebhookHmacSha256(body, `sha256=${sig}`, "secret")).toBe(true);
    expect(verifyWebhookHmacSha256(body, sig.slice(0, -1) + "0", "secret")).toBe(false);
  });
});
