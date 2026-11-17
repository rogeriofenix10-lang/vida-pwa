import { describe, expect, it } from "vitest";
import { buildFinanceAnalysisAggregate } from "./financeAnalysis";

describe("buildFinanceAnalysisAggregate", () => {
  it("converts local amounts to integer cents and keeps month/category totals", () => {
    const payload = buildFinanceAnalysisAggregate({
      period: "Junho 2026",
      summary: { income: 1200.5, expense: 300.25, balance: 900.25, openIncome: 100, openExpense: 50.1 },
      recordCount: 4,
      comparisonYear: 2026,
      months: [{ month: "2026-06", income: 1200.5, expense: 300.25, balance: 900.25, count: 4 }],
      periodCategories: [{ category: "Alimentação", total: 180.25, count: 3 }],
      yearCategories: [{ category: "Transporte", total: 920.35, count: 7 }],
    });

    expect(payload.totalsCentsBRL).toEqual({ income: 120050, expenses: 30025, balanceOfEntries: 90025, openIncome: 10000, openExpenses: 5010 });
    expect(payload.months[0]).toEqual({ month: "2026-06", incomeCentsBRL: 120050, expenseCentsBRL: 30025, balanceCentsBRL: 90025, recordCount: 4 });
    expect(payload.categories).toEqual([{ category: "Alimentação", totalCentsBRL: 18025, recordCount: 3 }]);
    expect(payload.chartYearCategoryTotals).toEqual([{ category: "Transporte", totalCentsBRL: 92035, recordCount: 7 }]);
  });

  it("does not serialize descriptions, holders, file names or account/card identifiers", () => {
    const payload = buildFinanceAnalysisAggregate({
      period: "Histórico completo",
      summary: { income: 0, expense: 42.99, balance: -42.99, openIncome: 0, openExpense: 42.99 },
      recordCount: 1,
      comparisonYear: 2026,
      months: [{ month: "2026-03", income: 0, expense: 42.99, balance: -42.99, count: 1 }],
      periodCategories: [{ category: "Outros", total: 42.99, count: 1 }],
      yearCategories: [],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/Rogério|Aline|Hotel Central|nubank_.*\.pdf|4111\s*1111|conta\s*123456/i);
  });
});
