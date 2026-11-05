import { describe, expect, it } from "vitest";
import { connectorSupports, getConnector, listConnectors, normalizeConnectorId, registerConnector } from "./connector-registry";

describe("universal connector registry", () => {
  it("normalizes ids without changing connector identity", () => expect(normalizeConnectorId(" WhatsApp ")).toBe("whatsapp"));
  it("contains requested platform families", () => {
    for (const id of ["whatsapp", "x", "instagram", "tiktok", "facebook", "booking", "airbnb", "waze", "google:maps", "google:gmail"]) expect(getConnector(id)).toBeTruthy();
  });
  it("keeps capabilities attached to connectors", () => {
    expect(connectorSupports("whatsapp", "communication:send")).toBe(true);
    expect(connectorSupports("waze", "external:read")).toBe(true);
  });
  it("allows new connectors without editing the agent core", () => {
    const id = "test:future-platform";
    registerConnector({ id, name: "Future Platform", category: "other", auth: "api_key", capabilities: ["external:read"], official: false, description: "test", supports: ["search"] });
    expect(getConnector(id)?.name).toBe("Future Platform");
    expect(listConnectors().some((c) => c.id === id)).toBe(true);
  });
  it("rejects duplicate registrations", () => {
    expect(() => registerConnector({ id: "waze", name: "Duplicate", category: "navigation", auth: "none", capabilities: ["external:read"], official: true, description: "duplicate", supports: [] })).toThrow();
  });
});
