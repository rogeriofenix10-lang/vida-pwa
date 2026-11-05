import { describe, expect, it } from "vitest";
import { parseDueDate } from "./dateParsing";

describe("parseDueDate", () => {
  const now = new Date("2026-09-02T15:00:00.000Z");
  it("interpreta dia do mês", () => expect(parseDueDate("minha conta vence dia 10", "dia 10", "America/Sao_Paulo", now)).not.toBeNull());
  it("interpreta amanhã", () => expect(parseDueDate("vence amanhã", "amanhã", "America/Sao_Paulo", now)).not.toBeNull());
  it("não confunde depois de amanhã com amanhã", () => {
    const a = parseDueDate("vence depois de amanhã", "depois de amanhã", "America/Sao_Paulo", now)!;
    const b = parseDueDate("vence amanhã", "amanhã", "America/Sao_Paulo", now)!;
    expect(a.getTime()).toBeGreaterThan(b.getTime());
  });
});
