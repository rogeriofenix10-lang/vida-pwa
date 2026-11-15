import { describe, expect, it } from "vitest";
import {
  buildMonthlySeries,
  filterEntriesByMonth,
  formatPeriodLabel,
  getDocumentMonth,
  getEntryPeriod,
  localToday,
  summarizeEntries,
  type FinancePeriodDocument,
} from "./financePeriods";
import { buildStatementEntries, type FinancialEntry } from "./financeDocuments";

function entry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: "entry-1",
    type: "expense",
    description: "Compra de teste",
    amount: 10,
    status: "open",
    createdAt: "2026-06-20T12:00:00.000Z",
    dueAt: "",
    ...overrides,
  };
}

const document = (
  overrides: Partial<FinancePeriodDocument> = {},
): FinancePeriodDocument => ({
  id: "statement-1",
  createdAt: "2026-06-20T12:00:00.000Z",
  ...overrides,
});

describe("finance period resolution", () => {
  it("uses a valid explicit reference date before imported purchase dates and preserves it across reparsing", () => {
    const imported = entry({
      sourceDocumentId: "statement-1",
      purchaseDate: "14/05/2026",
      referenceDate: "2026-07-09",
    });
    expect(getEntryPeriod(imported, [document()])).toEqual({
      date: "2026-07-09",
      month: "2026-07",
      basis: "Data de referência",
      inferred: false,
    });

    const statement = {
      id: "statement-1",
      name: "fatura.pdf",
      kind: "financeiro",
      createdAt: "2026-06-20",
      money: [
        { source: "14/05 Hotel", date: "14/05", amount: 10, category: "Hotel" },
      ],
    };
    const existing = buildStatementEntries<FinancialEntry>(statement, []);
    const oldRow = { ...existing[0], referenceDate: "2026-07-09" };
    const reparsed = buildStatementEntries<FinancialEntry>(statement, [oldRow]);
    expect(reparsed[0].referenceDate).toBe("2026-07-09");
  });

  it("accepts strict ISO, Brazilian numeric and Portuguese abbreviated full dates", () => {
    expect(
      getEntryPeriod(
        entry({ sourceDocumentId: "statement-1", purchaseDate: "2028-02-29" }),
        [],
      ),
    ).toMatchObject({ date: "2028-02-29", month: "2028-02", inferred: false });
    expect(
      getEntryPeriod(
        entry({ sourceDocumentId: "statement-1", purchaseDate: "14/05/2026" }),
        [],
      ),
    ).toMatchObject({ date: "2026-05-14", month: "2026-05", inferred: false });
    expect(
      getEntryPeriod(
        entry({ sourceDocumentId: "statement-1", purchaseDate: "14 mai 2026" }),
        [],
      ),
    ).toMatchObject({ date: "2026-05-14", month: "2026-05", inferred: false });
    expect(
      getEntryPeriod(
        entry({ sourceDocumentId: "statement-1", purchaseDate: "14/mai/2026" }),
        [],
      ),
    ).toMatchObject({ date: "2026-05-14", month: "2026-05", inferred: false });
  });

  it("rejects invalid explicit dates, including impossible days and non-leap February 29", () => {
    for (const purchaseDate of [
      "2028-02-30",
      "31/04/2026",
      "29/02/2027",
      "2028-2-29",
    ]) {
      const result = getEntryPeriod(
        entry({ sourceDocumentId: "statement-1", purchaseDate }),
        [document({ statementDueAt: "2028-05-10" })],
      );
      expect(result.date).toBeUndefined();
      expect(result.month).toBeUndefined();
      expect(result.inferred).toBe(false);
    }
    expect(
      getEntryPeriod(entry({ referenceDate: "2026-02-30" }), []).month,
    ).toBeUndefined();
  });

  it("does not assign a partial imported date to the upload month when invoice year is unknown", () => {
    const result = getEntryPeriod(
      entry({ sourceDocumentId: "statement-1", purchaseDate: "14/05" }),
      [document()],
    );
    expect(result.date).toBeUndefined();
    expect(result.month).toBeUndefined();
    expect(result.basis).toBe("Ano da compra não identificado");
  });

  it("infers partial purchase years only from explicit due dates and rolls cross-year purchases back", () => {
    const sameYear = getEntryPeriod(
      entry({ sourceDocumentId: "statement-1", purchaseDate: "14/05" }),
      [document({ statementDueAt: "2026-05-28" })],
    );
    expect(sameYear).toEqual({
      date: "2026-05-14",
      month: "2026-05",
      basis: "Ano da fatura",
      inferred: true,
    });

    const priorYear = getEntryPeriod(
      entry({ sourceDocumentId: "statement-1", purchaseDate: "31/12" }),
      [document({ statementDueAt: "2026-01-05" })],
    );
    expect(priorYear).toEqual({
      date: "2025-12-31",
      month: "2025-12",
      basis: "Ano da fatura",
      inferred: true,
    });

    const leapYear = getEntryPeriod(
      entry({ sourceDocumentId: "statement-1", purchaseDate: "29 fev" }),
      [document({ statementDueAt: "2028-03-10" })],
    );
    expect(leapYear).toEqual({
      date: "2028-02-29",
      month: "2028-02",
      basis: "Ano da fatura",
      inferred: true,
    });
    const impossibleLeap = getEntryPeriod(
      entry({ sourceDocumentId: "statement-1", purchaseDate: "29/02" }),
      [document({ statementDueAt: "2027-03-10" })],
    );
    expect(impossibleLeap.date).toBeUndefined();
    expect(impossibleLeap.inferred).toBe(true);
  });

  it("uses due date for legacy manual entries and registered date only as an explicit fallback", () => {
    expect(getEntryPeriod(entry({ dueAt: "2026-02-03" }), [])).toMatchObject({
      date: "2026-02-03",
      month: "2026-02",
      basis: "Data de vencimento",
      inferred: false,
    });
    expect(
      getEntryPeriod(
        entry({ dueAt: "", createdAt: "2026-06-20T23:00:00.000Z" }),
        [],
      ),
    ).toMatchObject({
      date: "2026-06-20",
      month: "2026-06",
      basis: "Data de cadastro",
      inferred: false,
    });
    expect(
      getEntryPeriod(
        entry({ dueAt: "2026-02-30", createdAt: "2026-06-20" }),
        [],
      ).month,
    ).toBeUndefined();
  });

  it("prefers a valid statement due month, falling back to document registration month", () => {
    expect(getDocumentMonth(document({ statementDueAt: "2026-05-17" }))).toBe(
      "2026-05",
    );
    expect(getDocumentMonth(document({ statementDueAt: "2026-02-30" }))).toBe(
      "2026-06",
    );
  });

  it("resolves timestamp-only legacy entries and document registration in the device calendar at month/year boundaries", () => {
    for (const createdAt of ["2026-07-01T01:30:00.000Z", "2027-01-01T01:30:00.000Z", "2026-07-01T01:30:00+03:00"]) {
      const local = new Date(createdAt);
      const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      const row = entry({ createdAt });
      expect(getEntryPeriod(row, [])).toMatchObject({ date: expected, month: expected.slice(0, 7), basis: "Data de cadastro" });
      expect(getDocumentMonth(document({ createdAt }))).toBe(expected.slice(0, 7));
      expect(filterEntriesByMonth([row], [], expected.slice(0, 7))).toEqual([row]);
      const series = buildMonthlySeries([row], [], local.getFullYear());
      expect(series[local.getMonth()]).toMatchObject({ count: 1, expense: 10 });
    }
    expect(getEntryPeriod(entry({ createdAt: "2026-07-01" }), [])).toMatchObject({ date: "2026-07-01", month: "2026-07" });
  });

  it("rejects malformed or impossible timestamp registration dates instead of keeping their prefix", () => {
    for (const createdAt of ["2026-02-30T01:30:00.000Z", "2026-07-01Tgarbage", "2026-07-01T99:99:00Z"]) {
      expect(getEntryPeriod(entry({ createdAt }), []).month).toBeUndefined();
      expect(getDocumentMonth(document({ createdAt }))).toBeUndefined();
    }
  });
});

describe("finance period summaries", () => {
  it("filters month, all and undated entries without mutating the ledger", () => {
    const dated = entry({ id: "dated", dueAt: "2026-05-05" });
    const importedUndated = entry({
      id: "imported-undated",
      sourceDocumentId: "statement-1",
      purchaseDate: "14/05",
    });
    const ledger = [dated, importedUndated];
    const snapshot = ledger.map((item) => ({ ...item }));

    expect(filterEntriesByMonth(ledger, [document()], "2026-05")).toEqual([
      dated,
    ]);
    expect(filterEntriesByMonth(ledger, [document()], "undated")).toEqual([
      importedUndated,
    ]);
    expect(filterEntriesByMonth(ledger, [document()], "all")).toEqual(ledger);
    expect(ledger).toEqual(snapshot);
  });

  it("sums valid amounts in integer cents and reports open income and expense", () => {
    const result = summarizeEntries([
      entry({ id: "i1", type: "income", amount: 0.1, status: "open" }),
      entry({ id: "i2", type: "income", amount: 0.2, status: "paid" }),
      entry({ id: "e1", type: "expense", amount: 0.1, status: "open" }),
      entry({ id: "e2", type: "expense", amount: 0.2, status: "overdue" }),
      entry({ id: "negative", type: "expense", amount: -5 }),
      entry({
        id: "infinite",
        type: "income",
        amount: Number.POSITIVE_INFINITY,
      }),
      entry({ id: "nan", type: "income", amount: Number.NaN }),
    ]);
    expect(result).toEqual({
      income: 0.3,
      expense: 0.3,
      balance: 0,
      incomeCount: 2,
      expenseCount: 2,
      openIncome: 0.1,
      openExpense: 0.1,
    });
  });

  it("builds twelve chronological localized rows with per-month totals and signed balances", () => {
    const entries = [
      entry({
        id: "jan-income",
        type: "income",
        amount: 100.1,
        status: "paid",
        dueAt: "2026-01-05",
      }),
      entry({
        id: "jan-expense",
        type: "expense",
        amount: 40.2,
        dueAt: "2026-01-15",
      }),
      entry({
        id: "feb-expense",
        type: "expense",
        amount: 80,
        dueAt: "2026-02-02",
      }),
      entry({
        id: "nov-income",
        type: "income",
        amount: 20,
        referenceDate: "2026-11-01",
      }),
      entry({
        id: "other-year",
        type: "income",
        amount: 999,
        dueAt: "2025-01-01",
      }),
      entry({
        id: "undated",
        sourceDocumentId: "statement-1",
        purchaseDate: "14/05",
        amount: 500,
      }),
    ];
    const series = buildMonthlySeries(entries, [document()], 2026);
    expect(series).toHaveLength(12);
    expect(series.map((row) => row.month)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `2026-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    expect(series[0]).toMatchObject({
      month: "2026-01",
      label: "janeiro de 2026",
      income: 100.1,
      expense: 40.2,
      balance: 59.9,
      count: 2,
    });
    expect(series[1]).toMatchObject({
      month: "2026-02",
      income: 0,
      expense: 80,
      balance: -80,
      count: 1,
    });
    expect(series[2]).toMatchObject({
      month: "2026-03",
      income: 0,
      expense: 0,
      balance: 0,
      count: 0,
    });
    expect(series[10]).toMatchObject({
      month: "2026-11",
      income: 20,
      expense: 0,
      balance: 20,
      count: 1,
    });
  });

  it("formats Portuguese month labels and returns local calendar today", () => {
    expect(formatPeriodLabel("2026-11")).toBe("novembro de 2026");
    expect(formatPeriodLabel("2026-13")).toBe("Período inválido");
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
