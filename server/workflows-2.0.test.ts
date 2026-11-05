import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition } from "./workflows";

describe("IRIS 2.0 workflows", () => {
  it("accepts only registered tools and bounded steps", () => {
    const definition = validateWorkflowDefinition({ version: 1, steps: [{ toolName: "memory.create", input: { content: "preferência" } }] });
    expect(definition.steps).toHaveLength(1);
    expect(definition.steps[0].toolName).toBe("memory.create");
  });

  it("rejects unknown tools", () => {
    expect(() => validateWorkflowDefinition({ version: 1, steps: [{ toolName: "shell.exec", input: {} }] })).toThrow(/não permitida/);
  });

  it("rejects invalid tool inputs", () => {
    expect(() => validateWorkflowDefinition({ version: 1, steps: [{ toolName: "memory.create", input: {} }] })).toThrow(/Entrada inválida/);
  });

  it("supports explicit previous-step references", () => {
    const definition = validateWorkflowDefinition({ version: 1, steps: [
      { toolName: "memory.create", input: { content: "preferência" } },
      { toolName: "documents.search", input: { query: "$step.1.result.name" } },
    ] });
    expect(definition.steps[1].input.query).toBe("$step.1.result.name");
  });
});



describe("IRIS explicit authorization invariant", () => {
  it("requires explicit authorization for workflow execution", async () => {
    const { assertExplicitAuthorization } = await import("./workflows");
    expect(() => assertExplicitAuthorization({ authorized: false })).toThrow(/autorização explícita/i);
  });

  it("rejects autonomous execution even when the caller claims authorization", async () => {
    const { assertExplicitAuthorization } = await import("./workflows");
    expect(() => assertExplicitAuthorization({ authorized: true, autonomous: true })).toThrow(/autonomia.*bloqueada/i);
  });
});
