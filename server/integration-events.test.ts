import { describe, expect, it, beforeEach } from "vitest";
import { ingestIntegrationEvent, registerIntegrationEventHandler, resetIntegrationEvents } from "./integration-events";

describe("IRIS integration events", () => {
  beforeEach(() => resetIntegrationEvents());
  it("deduplicates webhook deliveries", async () => {
    let calls = 0; registerIntegrationEventHandler("tiktok", "video.publish.completed", () => { calls++; });
    const body = JSON.stringify({ share_id: "123" });
    const a = await ingestIntegrationEvent({ provider: "tiktok", type: "video.publish.completed", rawBody: body, eventId: "evt-1" });
    const b = await ingestIntegrationEvent({ provider: "tiktok", type: "video.publish.completed", rawBody: body, eventId: "evt-1" });
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(calls).toBe(1);
  });
});
