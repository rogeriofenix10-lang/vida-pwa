import { describe, expect, it } from "vitest";

describe("VAPID current secrets", () => {
  it("contains usable Web Push credentials", () => {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? "";
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY ?? "";
    const subject = process.env.WEB_PUSH_SUBJECT ?? "";

    if (!publicKey && !privateKey && !subject) {
      expect(true).toBe(true);
      return;
    }

    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,100}$/);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect(subject).toMatch(/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+)$/);
    expect(subject.startsWith("mailto:") || subject.startsWith("https://")).toBe(true);
  });
});
