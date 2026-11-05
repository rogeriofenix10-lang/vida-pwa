import { describe, expect, it } from "vitest";
import { buildPlan } from "./agent-planner";

describe("Agent Planner", () => {
  it("builds an authorized tool plan", () => {
    const plan = buildPlan({
      intent: "criar lembrete",
      objective: "lembrar de pagar",
      message: "Me lembre de pagar amanhã",
      decision: "propose",
      riskLevel: "low",
    });
    expect(plan.version).toBe(2);
    expect(plan.tools).toEqual(["radar.create"]);
    expect(plan.requiredScopes).toEqual(["radar:write"]);
    expect(plan.steps.some(step => step.toolName === "radar.create")).toBe(true);
  });
});
