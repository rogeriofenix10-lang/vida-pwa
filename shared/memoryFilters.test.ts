import { describe, expect, it } from "vitest";
import { filterAndSortMemories } from "./memoryFilters";

describe("filterAndSortMemories", () => {
  const memories = [
    { id: 1, content: "Prefiro respostas objetivas", source: "user-approved" },
    { id: 3, content: "Trabalho com vendas", source: "profile" },
    { id: 2, content: "Tenho reunião na sexta", source: "user-approved" },
  ];

  it("filtra por texto e origem", () => {
    expect(filterAndSortMemories(memories, "respostas", "user-approved", "recent")).toEqual([memories[0]]);
  });

  it("ordena por data lógica e alfabeticamente", () => {
    expect(filterAndSortMemories(memories, "", "all", "recent").map((memory) => memory.id)).toEqual([3, 2, 1]);
    expect(filterAndSortMemories(memories, "", "all", "alpha").map((memory) => memory.content)).toEqual(["Prefiro respostas objetivas", "Tenho reunião na sexta", "Trabalho com vendas"]);
  });
});
