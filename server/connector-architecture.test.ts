import { describe, expect, it } from "vitest";
import { getConnector, listConnectors } from "./connector-registry";

describe("universal connector architecture", () => {
  it("keeps provider registration outside the agent core", () => {
    const ids = listConnectors().map(c => c.id);
    expect(ids).toContain("whatsapp");
    expect(ids).toContain("instagram");
    expect(ids).toContain("waze");
    expect(ids).toContain("booking");
    expect(ids).toContain("airbnb");
  });
  it("declares actions with capabilities", () => {
    const x = getConnector("x") as any;
    expect(x.actions.some((a: any) => a.name === "posts.create" && a.confirmationRequired)).toBe(true);
  });
  it("provides a concrete Waze adapter without user credentials", async () => {
    const waze = getConnector("waze") as any;
    const result = await waze.execute({} as any, "route.build", { destination: "Londrina PR" });
    expect(result.url).toContain("waze.com/ul?q=");
  });
});
