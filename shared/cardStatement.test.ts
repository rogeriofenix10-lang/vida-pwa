import { describe, expect, it } from "vitest";
import { extractStatementDueAt, parseCardStatement, redactFinancialIdentifiers } from "./cardStatement";

describe("parseCardStatement", () => {
  it("usa somente linhas datadas das transações e evita advice, pagamentos e valores de continuação", () => {
    const text = [
      "Nu Pagamentos S.A.",
      "FATURA 17 MAI 2028",
      "ALTERNATIVAS DE PAGAMENTO",
      "Total a pagar R$ 4.125,80 R$ 5.030,20",
      "Pagamento mínimo R$ 400,00",
      "RESUMO DA FATURA ATUAL",
      "Total a pagar R$ 3.210,00",
      "TRANSAÇÕES DE 01 MAI A 14 MAI",
      "14 MAI 4111 1111 1111 1111 Luna Atelier - Parcela 01/03 R$ 123, 45",
      "14 MAI 5555 4444 3333 2222 Luna Atelier - Parcela 02/03 R$ 123, 45",
      "15 MAI 4111 1111 1111 1111 Nimbus Store R$ 29,00",
      "15 MAI 4111 1111 1111 1111 Nimbus Store R$ 29,00",
      "17 MAI IOF de Loja Cósmica R$ 2,14",
      "23 MAI Pagamento em 23 MAI −R$ 100,00",
      "23 MAI Crédito de atraso −R$ 10,00",
      "23 MAI Saldo em atraso R$ 10,00",
      "23 MAI Encerramento de dívida −R$ 1,00",
      "23 MAI IOF Complementar por renegociação R$ 0,03",
      "Referente ao valor em aberto de R$ 50,00 de 12/05/2028 (Valor original: R$ 50,25)",
      "Conversão estrangeira ilustrativa, sem linha datada",
      "24 MAI Multa de atraso R$ 8,50",
      "24 MAI Juros de atraso R$ 1,20",
    ].join("\n");

    const statement = parseCardStatement(text);
    expect(statement.institution).toBe("Nubank");
    expect(statement.brand).toBeUndefined();
    expect(statement.statementTotal).toBe(3210);
    expect(statement.expenses.map(row => row.amount)).toEqual([123.45, 123.45, 29, 29, 2.14, 0.03, 8.5, 1.2]);
    expect(statement.expenses.slice(0, 4).map(row => row.category)).toEqual(["Outros", "Outros", "Outros", "Outros"]);
    expect(statement.expenses.slice(4).map(row => row.category)).toEqual([
      "Tarifas e juros", "Tarifas e juros", "Tarifas e juros", "Tarifas e juros",
    ]);
    expect(statement.expenses[0].date).toBe("14 MAI");
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

  it.each([
    ["Vencimento: 17/05/2028", "2028-05-17"],
    ["Data de vencimento: 2028-05-17", "2028-05-17"],
    ["Fatura 17 MAI 2028 | Vencimento 17 MAI 2028", "2028-05-17"],
    ["Pagar até: 17 de maio de 2028", "2028-05-17"],
    ["Data de vencimento:\n17 de maio de 2028", "2028-05-17"],
    ["Pagar até\n17 MAI 2028", "2028-05-17"],
  ])("extrai somente data completa explicitamente rotulada: %s", (text, expected) => {
    expect(extractStatementDueAt(text)).toBe(expected);
  });

  it("não infere ano nem aceita datas impossíveis", () => {
    expect(extractStatementDueAt("Vencimento: 21 OUT")).toBeUndefined();
    expect(extractStatementDueAt("Data de vencimento: 31/02/2026")).toBeUndefined();
    expect(extractStatementDueAt("Vencimento: 2026-02-29")).toBeUndefined();
  });

  it("ignora datas de transações e avisa quando os vencimentos explícitos conflitam", () => {
    const transactionOnly = [
      "Resumo da fatura", "Total a pagar R$ 90,00", "TRANSAÇÕES",
      "14 SET Vencimento 17/05/2028 Loja Alfa R$ 20,00",
    ].join("\n");
    expect(extractStatementDueAt(transactionOnly)).toBeUndefined();

    const conflicting = parseCardStatement([
      "Resumo da fatura", "Vencimento 17 MAI 2028", "Data de vencimento: 18/05/2028",
      "TRANSAÇÕES", "14 SET Loja Alfa R$ 20,00",
    ].join("\n"));
    expect(conflicting.statementDueAt).toBeUndefined();
    expect(conflicting.warnings.some((warning) => warning.includes("vencimentos explícitos divergentes"))).toBe(true);
  });
});
