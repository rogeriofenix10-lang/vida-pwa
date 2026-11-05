import { describe, expect, it } from "vitest";
import { inferMemoryCategory, memoryScore } from "./memory-intelligence";

describe("memory intelligence", () => {
  it("classifies useful categories", () => {
    expect(inferMemoryCategory("Minha preferência é receber relatórios pela manhã")).toBe("preference");
    expect(inferMemoryCategory("O projeto IRIS terá uma agenda integrada")).toBe("project");
    expect(inferMemoryCategory("A empresa vende calçados")).toBe("business");
  });
  it("ranks matching memories above unrelated memories", () => {
    expect(memoryScore("A IRIS deve priorizar tarefas comerciais", "tarefas comerciais", 3)).toBeGreaterThan(memoryScore("Receita favorita: pizza", "tarefas comerciais", 1));
  });
});
