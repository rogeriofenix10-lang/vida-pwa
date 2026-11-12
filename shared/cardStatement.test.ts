import { describe, expect, it } from "vitest";
import { parseCardStatement, redactFinancialIdentifiers } from "./cardStatement";

describe("parseCardStatement", () => {
  it("usa somente linhas datadas das transações e evita advice, pagamentos e valores de continuação", () => {
    const text = [
      "Nu Pagamentos S.A.",
      "FATURA 21 OUT 2026",
      "ALTERNATIVAS DE PAGAMENTO",
      "Total a pagar R$ 12.325,50 R$ 14.533,57",
      "Pagamento mínimo R$ 2.381,03",
      "RESUMO DA FATURA ATUAL",
      "Total a pagar R$ 9.805,36",
      "TRANSAÇÕES DE 14 SET A 14 OUT",
      "14 SET 4111 1111 1111 1111 Luna Atelier - Parcela 01/03 R$ 123, 45",
      "14 SET 5555 4444 3333 2222 Luna Atelier - Parcela 02/03 R$ 123, 45",
      "15 SET 4111 1111 1111 1111 Nimbus Store R$ 29,00",
      "15 SET 4111 1111 1111 1111 Nimbus Store R$ 29,00",
      "17 SET IOF de Loja Cósmica R$ 6,14",
      "23 SET Pagamento em 23 SET −R$ 600,00",
      "23 SET Crédito de atraso −R$ 5.336,16",
      "23 SET Saldo em atraso R$ 5.336,16",
      "23 SET Encerramento de dívida −R$ 14,22",
      "23 SET IOF Complementar por renegociação R$ 0,08",
      "Referente ao valor em aberto de R$ 500,00 de 05/09/2026 (Valor original: R$ 502,57)",
      "PYG 191205.00 = USD 32.78",
      "24 SET Multa de atraso R$ 10,54",
      "24 SET Juros de atraso R$ 3,60",
    ].join("\n");

    const statement = parseCardStatement(text);
    expect(statement.institution).toBe("Nubank");
    expect(statement.brand).toBeUndefined();
    expect(statement.statementTotal).toBe(9805.36);
    expect(statement.expenses.map(row => row.amount)).toEqual([123.45, 123.45, 29, 29, 6.14, 0.08, 10.54, 3.6]);
    expect(statement.expenses.slice(0, 4).map(row => row.category)).toEqual(["Outros", "Outros", "Outros", "Outros"]);
    expect(statement.expenses.slice(4).map(row => row.category)).toEqual([
      "Tarifas e juros", "Tarifas e juros", "Tarifas e juros", "Tarifas e juros",
    ]);
    expect(statement.expenses[0].date).toBe("14 SET");
    expect(statement.expenses[0].source).toContain("Parcela 01/03");
    expect(statement.expenses.every(row => !/4111 1111|5555 4444|123456|9876/.test(row.source))).toBe(true);
    expect(statement.warnings.some(warning => warning.includes("somente linhas datadas"))).toBe(true);
  });

  it("não infere instituição ou bandeira pelo nome do estabelecimento", () => {
    const statement = parseCardStatement([
      "Fatura mensal",
      "COMPRAS/Pagamentos",
      "14/09 Nubank Café R$ 40,00",
      "15/09 Itaú Papelaria R$ 25,00",
    ].join("\n"));
    expect(statement.institution).toBeUndefined();
    expect(statement.brand).toBeUndefined();
    expect(statement.expenses.map(row => row.amount)).toEqual([40, 25]);
  });

  it("reconhece bandeira e instituição somente quando aparecem explicitamente no cabeçalho", () => {
    const statement = parseCardStatement([
      "Banco do Brasil | Elo",
      "Total da fatura R$ 321,00",
      "TRANSAÇÕES",
      "02/11 Papelaria Sol R$ 21,00",
    ].join("\n"));
    expect(statement.institution).toBe("Banco do Brasil");
    expect(statement.brand).toBe("Elo");
    expect(statement.statementTotal).toBe(321);
  });

  it("redige identificadores sensíveis em todos os lançamentos devolvidos", () => {
    const statement = parseCardStatement([
      "Itaú Visa",
      "TRANSAÇÕES",
      "11/11 Loja Boreal Cartão final **** 4321 Conta: 123456-7 R$ 88,80",
      "12/11 Loja Boreal 4111-1111-1111-1111 R$ 99,90",
    ].join("\n"));
    expect(statement.institution).toBe("Itaú");
    expect(statement.brand).toBe("Visa");
    expect(statement.expenses).toHaveLength(2);
    expect(statement.expenses.map(row => row.source).join(" ")).not.toMatch(/4321|123456-7|4111-1111-1111-1111/);
    expect(redactFinancialIdentifiers("Cartão **** **** **** 9876")).not.toContain("9876");
  });
  it("keeps installment rows with a dash separator but rejects actual negative amounts", () => {
    const statement = parseCardStatement([
      "Banco Inter | Mastercard", "TRANSAÇÕES",
      "14 SET ••••4321 Farmacia Exemplo - Parcela 2/3 R$ 47,50",
      "15 SET ••••4321 Hotel Teste - R$ 180,00",
      "16 SET Estorno Hotel Teste −R$ 180,00",
      "17 SET Loja Teste R$ -20,00",
    ].join("\n"));
    expect(statement.expenses.map((row) => row.amount)).toEqual([47.5, 180]);
    expect(statement.expenses.map((row) => row.category)).toEqual(["Farmácia", "Hotel"]);
    expect(JSON.stringify(statement)).not.toContain("4321");
  });
  it("redacts digits following a named network without removing the network", () => {
    const statement = parseCardStatement([
      "Nu Pagamentos S.A. Cartão Visa final 4321",
      "TRANSAÇÕES", "14/09 Restaurante Teste R$ 50,00",
    ].join("\n"));
    expect(statement.institution).toBe("Nubank");
    expect(statement.brand).toBe("Visa");
    expect(JSON.stringify(statement)).not.toContain("4321");
    expect(redactFinancialIdentifiers("Cartão Nubank final 8765")).not.toContain("8765");
  });
});
