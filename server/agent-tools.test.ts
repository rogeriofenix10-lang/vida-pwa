import { describe, expect, it } from "vitest";
import { listAgentTools, selectAgentTools } from "./agent-tools";

describe("Agent Tool Intelligence", () => {
  it("exposes only registered tools", () => {
    const tools = listAgentTools();
    expect(tools.some(tool => tool.name === "radar.create")).toBe(true);
    expect(tools.every(tool => Boolean(tool.scope))).toBe(true);
  });

  it("selects the minimum tool set for a reminder", () => {
    const tools = selectAgentTools({
      intent: "criar lembrete",
      objective: "lembrar de pagar a conta",
      message: "Me lembre de pagar a conta amanhã",
      riskLevel: "low",
    });
    expect(tools.map(tool => tool.name)).toEqual(["radar.create"]);
  });

  it("does not invent tools for unsupported actions", () => {
    const tools = selectAgentTools({
      intent: "comprar produto",
      objective: "comprar um produto",
      message: "Quero comprar um produto",
      riskLevel: "high",
    });
    expect(tools).toEqual([]);
  });
});
