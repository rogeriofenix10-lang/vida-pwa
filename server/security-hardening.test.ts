import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { hashToken } from "./secretBox";

describe("security hardening", () => {
  it("hashes session tokens with SHA-256", () => {
    const token = "test-session-token";
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never stores the raw session token in the hash", () => {
    const token = "very-secret-session-token";
    expect(hashToken(token)).not.toContain(token);
  });
});
