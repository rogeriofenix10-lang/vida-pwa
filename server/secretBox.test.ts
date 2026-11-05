import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secretBox";

describe("secretBox", () => {
  it("round-trips a provider key without storing it as plain text", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-for-encryption";
    const secret = "sk-provider-key-123456";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });
});
