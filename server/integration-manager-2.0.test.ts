import { describe, expect, it } from "vitest";

describe("IRIS 2.0 integration contract", () => {
  it("exports the integration manager API", async () => {
    const mod = await import("./integration-manager");
    expect(typeof mod.connectIntegration).toBe("function");
    expect(typeof mod.listUserIntegrations).toBe("function");
    expect(typeof mod.postIntegration).toBe("function");
  });
});
