import { describe, expect, it } from "vitest";
import { assertAiRateLimit } from "./rateLimit";

describe("AI rate limit", () => {
  it("allows normal use", async () => await expect(assertAiRateLimit(Date.now())).resolves.toBeUndefined());
});
