import { describe, expect, it } from "vitest";
import { inferExpenseCategory, parseBrazilianAmount, parseExpenseLines, redactFinancialIdentifiers } from "./expenseParser";

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
  it("aceita inteiros, uma casa decimal, ponto decimal e espaços OCR após a vírgula", () => {
    expect(parseBrazilianAmount("R$ 123")).toBe(123);
    expect(parseBrazilianAmount("R$ 123,4")).toBe(123.4);
    expect(parseBrazilianAmount("123.45")).toBe(123.45);
    expect(parseBrazilianAmount("R$ 123, 45")).toBe(123.45);
    expect(parseBrazilianAmount("R$ 1.234, 56")).toBe(1234.56);
    expect(parseExpenseLines("Loja A 123\nLoja B 123.45\nLoja C 123, 45").map(row => row.amount)).toEqual([123, 123.45, 123.45]);
  });
  it("ignora pagamentos, créditos, saldo transferido e percentuais de juros", () => {
    expect(parseExpenseLines([
      "Pagamento recebido R$ 100,00",
      "Crédito de atraso R$ 40,00",
      "Saldo em atraso R$ 500,00",
      "Encerramento de dívida R$ 20,00",
      "Juros rotativo 16,1% ao mês",
      "Mercado Aurora R$ 35,90",
    ].join("\n")).map(row => row.amount)).toEqual([35.9]);
  });
  it("classifica as categorias novas sem alterar as categorias legadas", () => {
    expect(inferExpenseCategory("Clínica Vida")).toBe("Saúde");
    expect(inferExpenseCategory("Loja Estrela")).toBe("Compras");
    expect(inferExpenseCategory("Passagem aérea")).toBe("Viagens");
    expect(inferExpenseCategory("Spotify Premium")).toBe("Assinaturas");
    expect(inferExpenseCategory("Curso de idiomas")).toBe("Educação");
    expect(inferExpenseCategory("Cinema Central")).toBe("Lazer");
    expect(inferExpenseCategory("IOF de compra internacional")).toBe("Tarifas e juros");
  });
  it("redige PANs e campos bancários sem apagar data, valor, parcela ou CNPJ formatado", () => {
    const redacted = redactFinancialIdentifiers(
      "PAN 4111111111111111 e 5555 4444-3333 2222; Agência 0001 Conta corrente 12345-6; Cartão final **** 9876; 12/11 Parcela 01/03 R$ 123,45; CNPJ 12.345.678/0001-95",
    );
    expect(redacted).not.toMatch(/4111111111111111|5555\s+4444-3333\s+2222|12345-6|9876/);
    expect(redacted).toContain("12/11");
    expect(redacted).toContain("01/03");
    expect(redacted).toContain("R$ 123,45");
    expect(redacted).toContain("CNPJ 12.345.678/0001-95");
  });
});
