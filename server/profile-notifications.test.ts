import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

describe("profile and notifications contracts", () => {
  it("expõe perfil e notificações no router", () => {
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procedures).toHaveProperty("profile.me");
    expect(procedures).toHaveProperty("profile.update");
    expect(procedures).toHaveProperty("notifications.subscribe");
    expect(procedures).toHaveProperty("notifications.sendTest");
  });
});
