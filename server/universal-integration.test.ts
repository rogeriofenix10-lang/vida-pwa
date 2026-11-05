import { describe, expect, it } from "vitest";
import { actionAllowed } from "./connector-contract";
import { getConnector, listConnectors } from "./connector-registry";

describe("IRIS 4.0 universal integration layer", () => {
  it("registers priority official connectors", () => {
    const ids = new Set(listConnectors().map((c) => c.id));
    for (const id of ["google:gmail", "google:calendar", "google:drive", "whatsapp", "instagram", "facebook", "x", "tiktok"]) expect(ids.has(id)).toBe(true);
  });

  it("keeps action authorization provider-neutral", () => {
    const gmail = getConnector("google:gmail")! as any;
    expect(actionAllowed(gmail, "messages.list", "external:read")).toBe(true);
    expect(actionAllowed(gmail, "messages.send", "communication:send")).toBe(true);
    expect(actionAllowed(gmail, "messages.send", "external:read")).toBe(false);
  });

  it("requires confirmation for mutating actions", () => {
    const x = getConnector("x")! as any;
    expect(x.actions.find((a: any) => a.name === "posts.create")?.confirmationRequired).toBe(true);
    const calendar = getConnector("google:calendar")! as any;
    expect(calendar.actions.find((a: any) => a.name === "events.create")?.confirmationRequired).toBe(true);
  });
});
