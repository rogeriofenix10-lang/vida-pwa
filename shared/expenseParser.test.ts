import { describe, expect, it } from "vitest";
import { parseBrazilianAmount, parseExpenseLines } from "./expenseParser";

describe("individualização de gastos para revisão", () => {
  it("separa hotel, combustível e supermercado sem contar o total novamente", () => {
    const rows = parseExpenseLines("01/11 HOTEL CENTRAL R$ 350,00\n02/11 POSTO IPIRANGA R$ 150,90\n03/11 SUPERMERCADO R$ 84,50\nTotal R$ 585,40");
    expect(rows.map(row => [row.category, row.amount])).toEqual([["Hotel", 350], ["Posto de combustível", 150.9], ["Supermercado", 84.5]]);
    expect(rows[0].date).toBe("01/11");
  });
  it("preserva valor com milhares e só usa o valor final da transação", () => {
    expect(parseBrazilianAmount("1.234,56")).toBe(1234.56);
    expect(parseExpenseLines("Hotel Diária 350,00 Total cobrado 1.050,00")[0].amount).toBe(1050);
  });
  it("não cria gasto para linhas sem valor, zero, crédito ou resumo", () => {
    expect(parseExpenseLines("Hotel central\nTotal da fatura 100,00\nSaldo anterior 12,00\nTroco 2,00\nPagamento mínimo 10,00\nPosto -15,00\nMercado 0,00")).toEqual([]);
  });
  it("associa valor isolado à descrição anterior sem herdar categoria da transação anterior", () => {
    expect(parseExpenseLines("Hotel Central\nR$ 120,00\nLoja sem categoria 40,00").map(row => row.category)).toEqual(["Hotel", "Outros"]);
  });
  it("não inventa categoria quando a linha é ambígua", () => {
    expect(parseExpenseLines("Hotel e restaurante 90,00")[0].category).toBe("Outros");
  });
});
